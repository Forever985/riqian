/**
 * 第三轮：专打「容易漏」的路径
 * 重点 1：打字后立刻触发重新拉取（收藏/背景/关联/切日期）会不会丢字
 * 重点 2：切日期时草稿会不会串到另一天
 * 重点 3：全新习惯 / 标签 / 模板 / 历史恢复 / 导出的完整闭环
 */
const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '56330';
const log = [];
const ok = (n, v) => { const line = `${v ? '✅' : '❌'} ${n}`; log.push(line); console.log(line); };

const rpc = (p, m, a) => p.evaluate(([m, a]) => new Promise(res => {
  const id = 40000 + Math.floor(Math.random() * 50000);
  const h = e => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data.data); } };
  window.chrome.webview.addEventListener('message', h);
  window.chrome.webview.postMessage({ id, m, a });
}), [m, a]);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
  p.on('dialog', async d => { await d.accept(); });
  await p.waitForTimeout(1600);
  // 上一次跑失败时可能留着弹层（LaTeX / 分享 / 快速记录），先收干净再开始
  for (let i = 0; i < 4; i++) {
    const open = await p.evaluate(() => document.querySelectorAll('.qmask,.mask').length);
    if (!open) break;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.mouse.click(6, 6).catch(() => {});
    await p.waitForTimeout(250);
  }


  // 前面套件/手工探测可能把日期停在别的日子，先归位到今天，否则断言会打在错误的一天
  const backToday = async () => {
    // 先在侧栏点「今天」，否则上一套把界面停在别的页时，这里根本找不到日期栏
    await p.click('#app .nav button:has-text("今天")').catch(() => {});
    await p.waitForTimeout(600);
    const btn = p.locator('.datehead button:has-text("回到今天")');
    if (await btn.count()) { await btn.click(); await p.waitForTimeout(900); }
  };
  await backToday();

  // 定稿的日子是只读的：写之前先改回草稿，否则点正文点不动（这是应用的正确行为，不是 bug）

  // 正文模块可能停在上次用的 Markdown/BBCode，先切回富文本，否则没有 .rt 可点
  const ensureRich = async () => {
    for (let i = 0; i < 3; i++) {
      if (await p.locator('.rt[contenteditable="true"]').count()) return;
      await p.locator('.mod .mod-tools button[data-act="toggle-source"]').first().click().catch(() => {});
      await p.waitForTimeout(600);
    }
  };
  await ensureRich();

  const unpub = p.locator('.pubbar button:has-text("改回草稿")');
  if (await unpub.count()) { await unpub.click(); await p.waitForTimeout(1000); }



  const go = async (t) => { await p.click(`#app .nav button:has-text("${t}")`); await p.waitForTimeout(800); };
  /** v10 起双击日历=看总结，进日记要走右键菜单 */
  /** 从日历打开某一天：右键 → 「写这天日记」（v10 查双击=看总结） */
  const openCalDay = async (index) => {
    const cell = p.locator('.cal2-cell:not(.other)').nth(index);
    const box = await cell.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down({ button: 'right' });
    await p.mouse.up({ button: 'right' });
    await p.waitForTimeout(450);
    await p.locator('.rowmenu button', { hasText: '写这天日记' }).first().click();
    await p.waitForTimeout(1400);
  };
  const typeBody = async (txt) => {
    const rt = p.locator('.rt[contenteditable="true"]').first();
    await rt.click();
    await rt.press('Control+A');
    await rt.type(txt);
  };

  /* ============ 1. 打字后立刻点收藏：不能丢字 ============ */
  await go('今天');
  await typeBody('这是一个丢字测试');
  // 不等防抖（420ms），立刻点收藏，历史上这条路径会用旧值覆盖草稿
  await p.locator('button:has-text("收藏")').first().click();
  await p.waitForTimeout(1500);
  let e = await rpc(p, 'entry.get', { date: today() });
  ok('打字后立刻收藏，内容不丢: ' + JSON.stringify((e.plain || '').slice(0, 20)), (e.plain || '').includes('这是一个丢字测试'));
  await p.waitForTimeout(300);
  const stillThere = await p.evaluate(() => {
    const rt = document.querySelector('.rt[contenteditable="true"]');
    return rt ? rt.textContent.includes('这是一个丢字测试') : false;
  });
  ok('界面上内容也还在', stillThere);

  /* ============ 2. 打字后立刻切日期：不能串到另一天 ============ */
  await typeBody('今天的第二段');
  await p.waitForTimeout(60);
  // 立刻换到昨天
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await p.evaluate(async (d) => {
    const el = [...document.querySelectorAll('#app .nav button')];
    return d;
  }, yKey);
  await go('日历');
  const findCell = () => p.evaluate((d) => {
    const cells = [...document.querySelectorAll('.cal2-cell:not(.other)')];
    return cells.findIndex(c => (c.title || '').startsWith(d));
  }, yKey);
  let cellIdx = await findCell();
  /*
   * 跨月边界：今天是 11 月 1 号时，昨天 10-31 落在「上个月的格子」里，
   * 当前月的 :not(.other) 找不到它。先翻回上个月再找 —— 这个套件以前只在
   * 「昨天和今天同月」的日子能过，每月 1 号必然失败。
   */
  if (cellIdx < 0) {
    await p.locator('button[data-act="prev-month"]').first().click().catch(() => {});
    await p.waitForTimeout(800);
    cellIdx = await findCell();
  }
  if (cellIdx >= 0) {
    await openCalDay(cellIdx);
    // 双击后要先 flush 草稿再拉数据，1.3 秒不一定够（上次就是这么偶发失败的）
    await p.waitForFunction(
      (d) => (document.querySelector('.topbar .sub')?.textContent || '').includes(d),
      yKey, { timeout: 8000 },
    ).catch(() => {});
    await p.waitForTimeout(300);
  }
  const yEntry = await rpc(p, 'entry.get', { date: yKey });
  const tEntry = await rpc(p, 'entry.get', { date: today() });
  ok('昨天没有被写入今天的内容', !(yEntry.plain || '').includes('今天的第二段'));
  ok('今天的内容仍在今天', (tEntry.plain || '').includes('今天的第二段'));
  ok('切到昨天后日期栏正确', (await p.evaluate(() => (document.querySelector('.topbar .sub') || {}).textContent || '')).includes(yKey));

  /* ============ 3. 标签 → 记录页下拉能看到 ============ */
  await go('今天');
  const tagInput = p.locator('input[placeholder*="加标签"]').first();
  if (await tagInput.count()) {
    await tagInput.fill('验收标签');
    await tagInput.press('Enter');
    await p.waitForTimeout(1200);
  }
  await go('记录');
  await p.waitForTimeout(600);
  /*
   * 第 190 条之后标签筛选不再是 <select>，换成了「输入框 + 下拉」（TagPicker）。
   * 先点开，再读里面的选项；顺便试一下打字过滤。
   */
  const tagOpts = await p.evaluate(async () => {
    const pick = document.querySelector('.tagpick');
    const input = pick?.querySelector('input');
    if (!input) return { ok: false, text: '(没有标签选择器)' };
    input.click();
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, text: [...document.querySelectorAll('.tagpick-it')].map((x) => x.innerText).join('|') };
  });
  ok('记录页标签下拉包含新标签', tagOpts.ok && tagOpts.text.includes('验收标签'), tagOpts.text.slice(0, 80));

  const tagFiltered = await p.evaluate(async () => {
    const input = document.querySelector('.tagpick input');
    if (!input) return '(无)';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '验收');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return [...document.querySelectorAll('.tagpick-it')].map((x) => x.innerText).join('|');
  });
  ok('标签可以打字过滤', tagFiltered.includes('验收标签'), String(tagFiltered).slice(0, 80));
  await p.keyboard.press('Escape').catch(() => {});
  await p.mouse.click(400, 300).catch(() => {});
  await p.waitForTimeout(300);

  /* ============ 4. 习惯：新建 → 改名 → 删除 ============ */
  await go('打卡');
  const before = await p.locator('.hcard').count();
  await p.locator('button:has-text("＋ 新建习惯")').click();
  await p.waitForTimeout(600);
  await p.locator('.dlg input').nth(1).fill('验收习惯');
  await p.locator('.dlg select').selectOption('number');
  await p.locator('.dlg input').nth(2).fill('页');
  await p.locator('.dlg button:has-text("保存")').click();
  await p.waitForTimeout(1000);
  ok(`新建习惯成功（${before} → ${await p.locator('.hcard').count()}）`, await p.locator('.hcard').count() === before + 1);
  ok('新习惯出现在列表', (await p.evaluate(() => document.body.innerText)).includes('验收习惯'));

  // 改名
  const idx = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.hcard')];
    return cards.findIndex(c => c.textContent.includes('验收习惯'));
  });
  await p.locator('.hcard').nth(idx).locator('button:has-text("改")').click();
  await p.waitForTimeout(600);
  await p.locator('.dlg input').nth(1).fill('验收习惯改名');
  await p.locator('.dlg button:has-text("保存")').click();
  await p.waitForTimeout(1000);
  ok('习惯改名成功', (await p.evaluate(() => document.body.innerText)).includes('验收习惯改名'));

  // 删除
  await p.locator('button:has-text("管理已有")').click();
  await p.waitForTimeout(600);
  const delIdx = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.dlg .hrow')];
    return rows.findIndex(r => r.textContent.includes('验收习惯改名'));
  });
  await p.locator('.dlg .hrow').nth(delIdx).locator('button:has-text("✕")').click();
  await p.waitForTimeout(1000);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  ok(`习惯删除成功（回到 ${before}）`, await p.locator('.hcard').count() === before);

  /* ============ 5. 模板套用 ============ */
  await go('今天');
  await p.locator('button:has-text("模板")').click();
  await p.waitForTimeout(800);
  const tplCount = await p.locator('.tpl').count();
  await p.locator('.tpl').first().click();
  await p.waitForTimeout(1600);
  const afterTpl = await p.evaluate(() => {
    const rt = document.querySelector('.rt[contenteditable="true"]');
    return rt ? rt.innerText.length : 0;
  });
  ok(`模板套用（${tplCount} 个内置，正文 ${afterTpl} 字）`, afterTpl > 20);

  /* ============ 6. 历史版本 → 恢复 ============ */
  await p.locator('button:has-text("历史版本")').click();
  await p.waitForTimeout(900);
  const revCount = await p.locator('.dlg .quote-pick').count();
  if (revCount > 0) {
    await p.locator('.dlg .quote-pick').first().click();
    await p.waitForTimeout(900);
    const hasRestore = await p.locator('button:has-text("恢复到这个版本")').count();
    ok(`历史版本可查看（${revCount} 条）且有恢复按钮`, hasRestore === 1);
    await p.locator('button:has-text("恢复到这个版本")').click();
    await p.waitForTimeout(1500);
    ok('恢复后仍在今天页无报错', (await p.locator('.datehead').count()) === 1);
  } else {
    ok('历史版本有记录', false);
  }

  /* ============ 7. 待办：改 → 删 ============ */
  await go('待办');
  await p.fill('#view-root input.inp', '验收待办');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  const todoN = await p.locator('.todo-row').count();
  ok('待办新增', todoN > 0);
  // v10 起待办改名走编辑弹层（铅笔按钮 → 保存）
  await p.locator('.todo-row').first().locator('button[data-act="edit"]').click();
  await p.waitForTimeout(700);
  await p.locator('.dlg input').first().fill('验收待办已改名');
  await p.locator('.dlg button:has-text("保存")').click();
  await p.waitForTimeout(900);
  ok('待办改名', (await p.evaluate(() => document.body.innerText)).includes('验收待办已改名'));
  const n2 = await p.locator('.todo-row').count();
  await p.locator('.todo-row').first().locator('button[data-act="giveup"]').click();
  await p.waitForTimeout(900);
  ok(`待办移入「已放弃」（${n2} → ${await p.locator('.todo-row').count()}）`, await p.locator('.todo-row').count() === n2 - 1);

  /* ============ 8. 倒计时：增 → 删 ============ */
  await go('倒计时');
  await p.fill('#view-root input.inp >> nth=0', '2027年1月1日 验收纪念日');
  await p.locator('button:has-text("添加")').first().click();
  await p.waitForTimeout(900);
  const cdN = await p.locator('.cd').count();
  ok('倒计时新增', cdN > 0);
  await p.locator('.cd').first().locator('button[data-act="del"]').click();
  await p.waitForTimeout(900);
  ok(`倒计时删除（${cdN} → ${await p.locator('.cd').count()}）`, await p.locator('.cd').count() === cdN - 1);

  /* ============ 9. 导出 JSON ============ */
  await go('设置');
  await p.evaluate(() => { const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('数据与缓存')); if (g) g.click(); });
  await p.waitForTimeout(600);
  await p.locator('button:has-text("日记 JSON")').click();
  await p.waitForTimeout(1800);
  const toastTxt = await p.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok('导出 JSON 有反馈: ' + toastTxt, toastTxt.includes('已导出'));

  /* ============ 10. v8：排序入口搬进设置 ============ */
  await go('今天');
  const todayTools = await p.evaluate(() => [...document.querySelectorAll('.mod .mod-tools button')].map(b => b.title || b.textContent.trim()));
  ok('今天页不再有上移/下移按钮', !todayTools.some(t => /上移|下移/.test(t)), todayTools.join('|'));

  const navDraggable = await p.evaluate(() => [...document.querySelectorAll('#app .nav button')].some(b => b.draggable));
  ok('侧栏导航不可拖动排序', !navDraggable);

  await go('设置');
  await p.locator('.snav', { hasText: '日记与模块' }).click();
  await p.waitForTimeout(600);
  const modBefore = await p.evaluate(() => [...document.querySelectorAll('.modlist .nm')].map(x => x.textContent));
  await p.locator('.modlist .moditem').first().locator('button[data-act="down"]').click();
  await p.waitForTimeout(1000);
  const modAfter = await p.evaluate(() => [...document.querySelectorAll('.modlist .nm')].map(x => x.textContent));
  ok(`设置里模块下移生效（${modBefore[0]} → ${modAfter[0]}）`, modBefore[0] !== modAfter[0]);

  await p.locator('.snav', { hasText: '界面布局' }).click();
  await p.waitForTimeout(500);
  const navRows = await p.evaluate(() => document.querySelectorAll('.orderlist .orow').length);
  ok('界面布局里有导航顺序编辑器', navRows >= 8, `${navRows} 项`);

  console.log(log.join('\n'));
  console.log('页面错误:', errs.length ? errs.slice(0, 8) : '无');
  await b.close().catch(() => {});
})().catch(e => {
  console.log(log.join('\n'));
  console.log('FATAL', e.message);
  process.exit(1);
});
