const { chromium } = require('playwright-core');

/**
 * v16 验收：141 四象限直接选 / 167 笔记富文本轮子 / 188 大事时间轴 / 190 标签复合搜索
 */
(async () => {
  const port = process.argv[2] || '57001';
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);

  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text().slice(0, 160)); });

  let pass = 0, fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  ✓', name); }
    else { fail++; console.log('  ✗', name, String(extra).slice(0, 200)); }
  };

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 53000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (v) => { await p.click(`.nav button[data-nav="${v}"]`); await p.waitForTimeout(1100); };
  await p.keyboard.press('Escape').catch(() => {});

  /* ================= 141 四象限：编辑弹层直接选 ================= */
  const mk = 'qz' + Date.now().toString().slice(-5);
  await rpc('todo.add', { title: `${mk}-选象限` });
  await go('todos');
  await p.waitForTimeout(800);

  // 找到这一行，点编辑
  const opened = await p.evaluate((m) => {
    const row = [...document.querySelectorAll('.todo-row')].find((r) => (r.innerText || '').includes(m));
    if (!row) return false;
    const btn = row.querySelector('.rowtools button[data-act="edit"], button[data-act="edit"]');
    if (btn) { btn.click(); return true; }
    return false;
  }, mk);
  await p.waitForTimeout(700);
  ok('141-1 能打开待办编辑', opened && await p.evaluate(() => !!document.querySelector('.dlg')), '');

  const optTexts = await p.evaluate(() => {
    const dlg = document.querySelector('.dlg');
    const sel = [...(dlg?.querySelectorAll('select') || [])].find((s) => [...s.options].some((o) => (o.textContent || '').includes('象限') || (o.textContent || '').includes('紧急且重要')));
    return sel ? [...sel.options].map((o) => o.textContent.trim()) : [];
  });
  ok('141-2 选项就是四个象限', optTexts.length === 4 && optTexts.some((t) => t.includes('紧急且重要')), JSON.stringify(optTexts));

  // 选「重要不紧急」
  const picked = await p.evaluate(() => {
    const dlg = document.querySelector('.dlg');
    const sel = [...(dlg?.querySelectorAll('select') || [])].find((s) => [...s.options].some((o) => (o.textContent || '').includes('紧急且重要')));
    if (!sel) return false;
    const i = [...sel.options].findIndex((o) => (o.textContent || '').includes('重要不紧急'));
    if (i < 0) return false;
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.dlg button')].find((x) => /保存/.test(x.textContent || ''));
    if (btn) btn.click();
  });
  await p.waitForTimeout(1400);

  const saved = (await rpc('todos.list', {})).data?.find((x) => x.title === `${mk}-选象限`);
  ok('141-3 选完象限写进了优先级和日期', picked && saved && saved.priority >= 2 && !!saved.due, JSON.stringify({ p: saved?.priority, due: saved?.due }));

  /* ================= 167 笔记用同一套富文本 ================= */
  // 直接用接口造一篇再点开 —— 「新建笔记」是弹层，多一步填表，跟这条要测的东西无关
  const nbs = await rpc('notebooks.list', {});
  const nbId = (nbs?.data || [])[0]?.id || '';
  await rpc('note.save', { id: '', notebookId: nbId, title: '富文本测试', body: '' });
  await go('notes');
  await p.waitForTimeout(1500);
  const openedNote = await p.evaluate(() => {
    const row = document.querySelector('.nrow');
    if (row) { row.click(); return true; }
    return false;
  });
  await p.waitForTimeout(1400);
  const hasEditor = await p.evaluate(() => !!document.querySelector('.nbody[contenteditable="true"]'));
  ok('167-1 笔记正文是可编辑区', openedNote && hasEditor, `opened=${openedNote} editor=${hasEditor}`);

  if (hasEditor) {
    await p.locator('.nbody[contenteditable="true"]').click();
    await p.keyboard.type('笔记里也能用 **加粗** 了', { delay: 30 });
    await p.waitForTimeout(900);
    const bodyHtml = await p.evaluate(() => (document.querySelector('.nbody[contenteditable="true"]')?.innerHTML || '').replace(/\u200b/g, ''));
    ok('167-2 笔记里输入即格式化生效', /<strong>加粗<\/strong>/.test(bodyHtml), bodyHtml.slice(0, 120));

    // 撤销一步退一步：第一次退掉后面打的字，第二次才退掉格式化。
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(450);
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(550);
    const afterUndo = await p.evaluate(() => (document.querySelector('.nbody[contenteditable="true"]')?.innerHTML || '').replace(/\u200b/g, ''));
    ok('167-3 笔记里 Ctrl+Z 能退掉格式化', !/<strong>加粗<\/strong>/.test(afterUndo), afterUndo.slice(0, 120));
    await p.keyboard.press('Control+y');
    await p.waitForTimeout(400);
  }
  await p.keyboard.press('Escape').catch(() => {});

  /* ================= 190 标签复合搜索 ================= */
  await rpc('entry.save', { date: '2026-10-15', values: {}, title: '标签测试' });
  await rpc('entry.tag', { date: '2026-10-15', tags: ['读书笔记', '跑步'] }).catch(() => null);
  await go('records');
  await p.waitForTimeout(1200);
  const pickerHere = await p.evaluate(() => !!document.querySelector('.tagpick input'));
  ok('190-1 记录页标签是可输入的框', pickerHere, '');

  if (pickerHere) {
    await p.locator('.tagpick input').click();
    await p.waitForTimeout(400);
    const popItems = await p.evaluate(() => document.querySelectorAll('.tagpick-pop .tagpick-it').length);
    ok('190-2 点开有下拉列表', popItems >= 1, `items=${popItems}`);

    await p.locator('.tagpick input').fill('读');
    await p.waitForTimeout(400);
    const filtered = await p.evaluate(() => [...document.querySelectorAll('.tagpick-pop .tagpick-it .n')].map((x) => x.textContent));
    ok('190-3 输入能过滤标签', filtered.length >= 1 && filtered.every((t) => t.includes('读') || t === '全部标签'), JSON.stringify(filtered));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  }

  /* ================= 188 大事时间轴 ================= */
  await go('timeline');
  await p.waitForTimeout(1200);
  const msTitle = await p.evaluate(() => document.querySelector('.topbar h2')?.textContent || document.body.innerText.slice(0, 40));
  ok('188-1 时间轴页面已就位', /时间轴/.test(msTitle), msTitle);

  const addBtn = await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('button')].find((x) => /记一件大事|记第一件/.test(x.textContent || ''));
    if (b2) { b2.click(); return true; }
    return false;
  });
  await p.waitForTimeout(700);
  ok('188-2 能打开新建弹层', addBtn && await p.evaluate(() => !!document.querySelector('.dlg')), '');

  const mark = '大事' + Date.now().toString().slice(-4);
  await p.evaluate((t) => {
    const dlg = document.querySelector('.dlg');
    const input = dlg?.querySelector('input[type="text"], input:not([type])');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, t);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, mark);
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('.dlg button')].find((x) => /记下|保存/.test(x.textContent || ''));
    if (b2) b2.click();
  });
  await p.waitForTimeout(1400);

  const listed = await p.evaluate(() => document.body.innerText.includes(document.body.innerText.match(/大事\d{4}/)?.[0] || '@@'));
  const nodes = await p.evaluate(() => document.querySelectorAll('.msnode').length);
  ok('188-3 新建后出现在时间轴上', nodes >= 1, `nodes=${nodes}`);

  const savedMs = (await rpc('milestone.list', {})).data || [];
  ok('188-4 数据已落库', savedMs.length >= 1, JSON.stringify(savedMs.map((x) => x.title)));

  // 编辑
  await p.evaluate(() => document.querySelector('.mscard')?.click());
  await p.waitForTimeout(700);
  const editOpen = await p.evaluate(() => !!document.querySelector('.dlg'));
  ok('188-5 点卡片能改', editOpen, '');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  // 删除（confirm 走 dialog 事件）
  p.once('dialog', (d) => void d.accept());
  await p.evaluate(() => {
    const x = document.querySelector('.msdel');
    if (x) x.click();
  });
  await p.waitForTimeout(1200);
  const afterDel = (await rpc('milestone.list', {})).data || [];
  ok('188-6 能删掉', afterDel.length === savedMs.length - 1, `${savedMs.length} → ${afterDel.length}`);

  // 记录页的时间轴视图
  await go('records');
  await p.waitForTimeout(1000);
  const hasSwitch = await p.evaluate(() => [...document.querySelectorAll('.seg-b')].some((x) => /时间轴/.test(x.textContent || '')));
  ok('188-7 记录页有「时间轴」切换', hasSwitch, '');
  if (hasSwitch) {
    await p.evaluate(() => {
      const b2 = [...document.querySelectorAll('.seg-b')].find((x) => /时间轴/.test(x.textContent || ''));
      if (b2) b2.click();
    });
    await p.waitForTimeout(1600);
    const embeddedOk = await p.evaluate(() => !!document.querySelector('.tl-embedded') && document.querySelectorAll('.topbar').length === 1);
    ok('188-8 切过去是内嵌的时间轴（没有第二个顶栏）', embeddedOk, '');
  }

  ok('无页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(`\nv16 套件：${pass} 通过 / ${fail} 失败`);
  await b.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
