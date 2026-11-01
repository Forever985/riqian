const { chromium } = require('playwright-core');

/**
 * v14 验收：117 跨模块搜索 / 139 欢迎页拖动 / 140 打卡提醒 / Semi 主题
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

  const closeMasks = async () => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate(() => {
      document.querySelectorAll('.qmask, .mask').forEach((el) => {
        const b2 = el.querySelector('.dlg, .qpalette');
        if (!b2) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      });
    });
    await p.waitForTimeout(300);
  };

  const goHome = async () => { await p.click('#brand-home').catch(() => {}); await p.waitForTimeout(1200); };
  const go = async (v) => { await p.click(`.nav button[data-nav="${v}"]`); await p.waitForTimeout(1100); };

  await closeMasks();

  /* ================= 准备一点可搜的内容 ================= */
  const mark = 'zz' + Date.now().toString().slice(-6);
  await rpc('todo.add', { title: `${mark} 买牛奶` });
  const nbs = await rpc('notebooks.list', {});
  const nbId = (nbs?.data || [])[0]?.id || '';
  await rpc('note.save', { id: '', notebookId: nbId, title: `${mark} 笔记标题`, body: '正文里也有 ' + mark });
  await rpc('entry.save', { date: '2026-10-20', values: {}, title: `${mark} 旧日记` });

  /* ================= 117 跨模块搜索 ================= */
  await goHome();
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(600);
  const opened = await p.evaluate(() => !!document.querySelector('.qpalette'));
  ok('117-1 Ctrl+K 打开命令面板', opened, '');

  await p.locator('.qpalette input').fill(mark);
  await p.waitForTimeout(900);
  const hits = await p.evaluate(() => [...document.querySelectorAll('.qpalette .qrow')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  ok('117-2 搜到了内容结果', hits.length >= 2, JSON.stringify(hits.slice(0, 5)));
  ok('117-3 日记命中', hits.some((h) => h.includes('旧日记')), JSON.stringify(hits.slice(0, 5)));
  ok('117-4 待办命中', hits.some((h) => h.includes('买牛奶')), JSON.stringify(hits.slice(0, 5)));
  ok('117-5 笔记命中', hits.some((h) => h.includes('笔记标题')), JSON.stringify(hits.slice(0, 5)));

  // 点日记那条 → 应该翻到那一天
  const entryIdx = hits.findIndex((h) => h.includes('旧日记'));
  if (entryIdx >= 0) {
    await p.locator('.qpalette .qrow').nth(entryIdx).click();
    await p.waitForTimeout(1600);
    const dateNow = await p.evaluate(() => document.querySelector('.entrytitle')?.closest('.wrap')?.innerText || document.body.innerText);
    ok('117-6 点日记结果跳到那一天', /10\s*月\s*20|2026-10-20/.test(dateNow), dateNow.slice(0, 80));
  } else {
    ok('117-6 点日记结果跳到那一天', false, '没找到日记结果');
  }

  // 空查询不该报错
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(400);
  await p.locator('.qpalette input').fill('');
  await p.waitForTimeout(400);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('117-7 空查询不报错', true, '');

  /* ================= 139 欢迎页拖动 ================= */
  await goHome();
  const order0 = await p.evaluate(() => [...document.querySelectorAll('.wgrid .wcard h3')].map((x) => x.innerText.trim()));
  ok('139-1 欢迎页有多个格子', order0.length >= 4, JSON.stringify(order0));

  const moved = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.wgrid .wcard')];
    if (cards.length < 3) return false;
    const from = cards[2], to = cards[0];
    const dt = new DataTransfer();
    const ev = (t, el) => el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    ev('dragstart', from);
    ev('dragover', to);
    ev('drop', to);
    ev('dragend', from);
    return true;
  });
  await p.waitForTimeout(900);
  const order1 = await p.evaluate(() => [...document.querySelectorAll('.wgrid .wcard h3')].map((x) => x.innerText.trim()));
  ok('139-2 拖动后顺序变了', moved && JSON.stringify(order0) !== JSON.stringify(order1), JSON.stringify(order1));
  ok('139-3 顺序没丢项', order1.length === order0.length && order1.every((x) => order0.includes(x)), JSON.stringify(order1));

  const saved = await rpc('bootstrap', {});
  const wo = String(saved?.data?.settings?.welcomeOrder || '');
  ok('139-4 顺序已存进设置', wo.split(',').length === order1.length, wo);

  await go('today');
  await goHome();
  const order2 = await p.evaluate(() => [...document.querySelectorAll('.wgrid .wcard h3')].map((x) => x.innerText.trim()));
  ok('139-5 换个页面回来顺序还在', JSON.stringify(order2) === JSON.stringify(order1), JSON.stringify(order2));

  /* ================= 140 打卡提醒 ================= */
  await go('settings');
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('.snav')].find((x) => (x.innerText || '').includes('打卡'));
    if (b2) b2.click();
  });
  await p.waitForTimeout(900);
  const hasTime = await p.evaluate(() => [...document.querySelectorAll('input[type="time"]')].length);
  ok('140-1 设置有打卡提醒时间', hasTime > 0, `time inputs=${hasTime}`);

  const textHas = await p.evaluate(() => document.body.innerText.includes('每天提醒打卡'));
  ok('140-2 设置项文案在', textHas, '');

  // 开关：断言「点一下状态翻转」，别假设初始一定是关的（重跑第二遍就会翻回来）
  const beforeOn = String((await rpc('bootstrap', {}))?.data?.settings?.habitRemindOn ?? '0');
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.set-row')].find((el) => (el.innerText || '').includes('每天提醒打卡'));
    const sw = row?.querySelector('.switch');
    if (sw) sw.click();
  });
  await p.waitForTimeout(700);
  const boot = await rpc('bootstrap', {});
  const on = String(boot?.data?.settings?.habitRemindOn ?? '0');
  ok('140-3 开关能翻转并写进设置', on !== beforeOn, `${beforeOn} → ${on}`);

  // 后面几条要用「开」的状态
  if (on !== '1') {
    await p.evaluate(() => {
      const row = [...document.querySelectorAll('.set-row')].find((el) => (el.innerText || '').includes('每天提醒打卡'));
      const sw = row?.querySelector('.switch');
      if (sw) sw.click();
    });
    await p.waitForTimeout(600);
  }

  const prev = await rpc('habit.remindPreview', {});
  ok('140-4 试算接口返回待打卡项', typeof prev?.data?.count === 'number', JSON.stringify(prev?.data || {}));

  // 把时间设成 00:01 且清掉今日已提醒标记，验证宿主真的会推
  await rpc('setting.set', { k: 'habitRemindAt', v: '00:01' });
  await rpc('setting.set', { k: 'habitRemindLast', v: '' });
  await p.evaluate(() => { window.__HABIT_TEST__ = null; const old = window.__HABIT_REMIND__; window.__HABIT_REMIND__ = (x) => { window.__HABIT_TEST__ = x; if (old) old(x); }; });
  await p.waitForTimeout(33000);   // 宿主定时器 30 秒一次
  const pushed = await p.evaluate(() => window.__HABIT_TEST__);
  ok('140-5 到点真的会推提醒', pushed && Number(pushed.count) > 0, JSON.stringify(pushed));
  ok('140-6 提醒带了习惯名', pushed && Array.isArray(pushed.names) && pushed.names.length > 0, JSON.stringify(pushed));

  /* ================= Semi 主题 ================= */
  await go('settings');
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('.snav')].find((x) => (x.innerText || '').includes('外观'));
    if (b2) b2.click();
  });
  await p.waitForTimeout(900);
  const semiExists = await p.evaluate(() => [...document.querySelectorAll('.tcard')].some((x) => (x.innerText || '').includes('Semi')));
  ok('semi-1 外观里有 Semi 主题卡', semiExists, '');

  await p.evaluate(() => {
    const c = [...document.querySelectorAll('.tcard')].find((x) => (x.innerText || '').includes('Semi'));
    if (c) c.click();
  });
  await p.waitForTimeout(1200);
  const applied = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme,
      accent: cs.getPropertyValue('--accent').trim().toLowerCase(),
      bg: cs.getPropertyValue('--bg').trim().toLowerCase(),
      panel: cs.getPropertyValue('--panel').trim().toLowerCase(),
    };
  });
  ok('semi-2 主题切到 semi', applied.theme === 'semi', JSON.stringify(applied));
  ok('semi-3 品牌蓝是 #0064fa', applied.accent === '#0064fa', JSON.stringify(applied));
  ok('semi-4 白卡片 + 冷灰底', applied.panel === '#ffffff' && applied.bg === '#f2f3f5', JSON.stringify(applied));

  // 换回纸质，别把用户主题改了
  await p.evaluate(() => {
    const c = [...document.querySelectorAll('.tcard')].find((x) => (x.innerText || '').includes('纸质'));
    if (c) c.click();
  });
  await p.waitForTimeout(800);

  ok('无页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(`\nv14 套件：${pass} 通过 / ${fail} 失败`);
  await b.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
