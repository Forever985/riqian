/** v6 验收：13 条需求的逐项验证 */
const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '56351';
const log = [];
const ok = (n, v) => { const line = `${v ? '✅' : '❌'} ${n}`; log.push(line); console.log(line); };

const rpc = (p, m, a) => p.evaluate(([m, a]) => new Promise(res => {
  const id = 50000 + Math.floor(Math.random() * 40000);
  const h = e => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data.data); } };
  window.chrome.webview.addEventListener('message', h);
  window.chrome.webview.postMessage({ id, m, a });
}), [m, a]);

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
  const unpub = p.locator('.pubbar button:has-text("改回草稿")');
  if (await unpub.count()) { await unpub.click(); await p.waitForTimeout(1000); }



  const go = async (t) => { await p.click(`#app .nav button:has-text("${t}")`); await p.waitForTimeout(800); };

  /* ---------- 5. 折叠为图标 ---------- */
  await go('设置');
  await p.evaluate(() => { const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('界面布局')); if (g) g.click(); });
  await p.waitForTimeout(500);
  const widthBefore = await p.evaluate(() => Math.round(document.querySelector('.side').getBoundingClientRect().width));
  const collapseBtn = p.locator('.set-row:has-text("折叠为图标") .switch');
  await collapseBtn.click();
  await p.waitForTimeout(600);
  const widthAfter = await p.evaluate(() => Math.round(document.querySelector('.side').getBoundingClientRect().width));
  const labelsHidden = await p.evaluate(() => {
    const lb = document.querySelector('#app .nav button .lb');
    return lb ? getComputedStyle(lb).display === 'none' : false;
  });
  ok(`折叠生效：宽 ${widthBefore} → ${widthAfter}px，文字隐藏=${labelsHidden}`, widthAfter < 80 && labelsHidden);
  await collapseBtn.click();
  await p.waitForTimeout(500);

  /* ---------- 6. 导航排序：v8 起只允许在设置里调 ---------- */
  const navDraggable = await p.evaluate(() => [...document.querySelectorAll('#app .nav button')].some(b => b.draggable));
  ok('侧栏不再支持拖动排序', !navDraggable);

  await p.evaluate(() => {
    const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('界面布局'));
    if (g) g.click();
  });
  await p.waitForTimeout(600);
  // 导航项现在用 data-nav 标识（title 已经被悬浮提示接管，会被摘掉）
  const orderBefore = await p.evaluate(() => [...document.querySelectorAll('#app .nav button')].map(b => b.getAttribute('data-nav')));
  await p.locator('.orderlist .orow').first().locator('button[data-act="down"]').click();
  await p.waitForTimeout(900);
  const orderAfter = await p.evaluate(() => [...document.querySelectorAll('#app .nav button')].map(b => b.getAttribute('data-nav')));
  ok(`设置里调导航顺序生效：${orderBefore.slice(0, 3).join('/')} → ${orderAfter.slice(0, 3).join('/')}`,
    JSON.stringify(orderBefore) !== JSON.stringify(orderAfter));

  const savedOrder = await rpc(p, 'bootstrap', {});
  ok('排序已持久化到设置', typeof savedOrder.settings.navOrder === 'string' && savedOrder.settings.navOrder.includes('today'));

  // 还原默认顺序（走设置页里的按钮，顺手把 store 也刷新回去）
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find(b => b.textContent.includes('恢复默认'));
    el && el.click();
  });
  await p.waitForTimeout(700);

  /* ---------- 3. 打卡备注 ---------- */
  await go('打卡');
  const noteInput = p.locator('.hcard .hnote input').first();
  ok('打卡页有备注输入框', await noteInput.count() > 0);
  if (await noteInput.count()) {
    await noteInput.fill('今天六点半起的，跑了 5 公里');
    await noteInput.blur();
    await p.waitForTimeout(1200);
  }
  const notes = await rpc(p, 'habit.notes', { date: new Date().toISOString().slice(0, 10) });
  ok('备注已落库', JSON.stringify(notes).includes('5 公里'));

  /* ---------- 11. 待办清单 + 已放弃 ---------- */
  await go('待办');
  await p.locator('.rail-h button').first().click();
  await p.waitForTimeout(500);
  await p.locator('.dlg input').fill('工作');
  await p.locator('.dlg button:has-text("保存")').click();
  await p.waitForTimeout(900);
  ok('新建清单成功', (await p.evaluate(() => document.body.innerText)).includes('工作'));

  await p.locator('.rail-item:has-text("工作")').first().click();
  await p.waitForTimeout(400);
  await p.locator('#view-root input.inp').first().fill('写周报');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  ok('清单内新增待办', await p.locator('.todo-row').count() > 0);

  const beforeTrash = await p.evaluate(() => document.querySelector('.rate-bar i').style.width);
  const rowsBefore = await p.locator('.todo-row').count();
  await p.locator('.todo-row').first().locator('button[data-act="giveup"]').click();
  await p.waitForTimeout(1000);
  ok('放弃后本视图少一条', await p.locator('.todo-row').count() === rowsBefore - 1);

  await p.locator('.rail-item:has-text("已放弃")').click();
  await p.waitForTimeout(800);
  ok('已放弃里能看到它', await p.locator('.todo-row').count() >= 1);
  const trashN = await p.locator('.todo-row').count();
  await p.locator('.todo-row').first().locator('button:has-text("捡回来")').click();
  await p.waitForTimeout(900);
  ok('可以从已放弃捡回来', await p.locator('.todo-row').count() === trashN - 1);

  /* ---------- 8. 番茄钟 ---------- */
  await go('番茄钟');
  await p.locator(".seg-b:has-text(\"近 30 天\")").click();
  await p.waitForTimeout(900);
  const charts = await p.evaluate(() => ({
    svg: document.querySelectorAll('.chart, .donut-wrap svg').length,
    kpi: document.querySelectorAll('.kpi').length,
    bars: document.querySelectorAll('.wd-bars .col').length,
  }));
  ok(`番茄钟图表：${charts.svg} 个图 / ${charts.kpi} 个指标 / 星期柱 ${charts.bars}`,
    charts.svg >= 3 && charts.kpi >= 6 && charts.bars === 7);

  // v10 起番茄中央多了「手动设定分钟」的输入框，休息时长要用带 label 的那个
  const breakInput = p.locator('.pomo-wrap input.inp[type=number]').first();
  await breakInput.fill('12');
  await breakInput.blur();
  await p.waitForTimeout(900);
  const breakSaved = await p.evaluate(async () => {
    const r = await new Promise(res => {
      const id = 6666;
      const h = e => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data.data); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m: 'bootstrap', a: {} });
    });
    return r.settings.pomoBreak;
  });
  ok('自定义休息时长已保存：' + breakSaved, String(breakSaved) === '12');

  /* ---------- 10. 侧边栏番茄迷你条可点 ---------- */
  await p.locator('.btn.primary:has-text("开始")').click();
  await p.waitForTimeout(1400);
  await go('今天');
  const miniExists = await p.locator('.pomo-mini').count() > 0;
  ok('侧边栏出现迷你计时', miniExists);
  if (miniExists) {
    await p.locator('.pomo-mini .pm-body').click();
    await p.waitForTimeout(800);
    ok('点迷你条跳到番茄钟页', (await p.evaluate(() => document.querySelector('.topbar h2').textContent)) === '番茄钟');
    const before = await p.evaluate(() => document.querySelector('.pomo-time').textContent);
    await p.locator('.pomo-mini .pm-btn').click({ force: true }).catch(() => {});
    await p.waitForTimeout(1500);
    const after = await p.evaluate(() => document.querySelector('.pomo-time') ? document.querySelector('.pomo-time').textContent : '');
    ok(`点暂停后计时停住（${before} → ${after}）`, before === after || !after);
  }

  /* ---------- 9. 日历 ---------- */
  await go('日历');
  const cal = await p.evaluate(() => ({
    grid: document.querySelectorAll('.cal2-cell').length,
    agenda: !!document.querySelector('.agenda'),
    other: document.querySelectorAll('.cal2-cell.other').length,
    today: document.querySelectorAll('.cal2-cell.today').length,
  }));
  ok(`日历：${cal.grid} 格，含上下月灰格 ${cal.other}，今日标记 ${cal.today}，右侧议程=${cal.agenda}`,
    cal.grid % 7 === 0 && cal.agenda && cal.other >= 0);
  const cellCount = await p.locator('.cal2-cell:not(.other)').count();
  await p.locator('.cal2-cell:not(.other)').nth(Math.max(0, cellCount - 2)).click();
  await p.waitForTimeout(400);
  ok('点日期后议程更新', await p.locator('.cal2-cell.sel').count() === 1);

  /* ---------- 12. 统计 ---------- */
  await go('统计');
  const stats = await p.evaluate(() => ({
    kpi: document.querySelectorAll('.kpi').length,
    charts: document.querySelectorAll('.chart, .donut-wrap svg').length,
    tagcloud: document.querySelectorAll('.tagcloud .t').length,
  }));
  ok(`统计：${stats.kpi} 个指标卡 / ${stats.charts} 个图表`, stats.kpi >= 14 && stats.charts >= 3);
  await p.screenshot({ path: 'v6-stats.png', timeout: 8000 }).catch(() => {});

  /* ---------- 1. 搜索框 ---------- */
  await go('记录');
  const hasSearch = await p.locator('.searchbox input').count() > 0;
  ok('记录页新搜索框', hasSearch);
  await p.fill('.searchbox input', 'abc');
  await p.waitForTimeout(300);
  const hasClear = await p.locator('.searchbox .sb-clear').count() > 0;
  await p.locator('.searchbox .sb-clear').click();
  await p.waitForTimeout(300);
  const cleared = await p.evaluate(() => document.querySelector('.searchbox input').value === '');
  ok('搜索框有清除按钮且生效', hasClear && cleared);
  await p.screenshot({ path: 'v6-records.png', timeout: 8000 }).catch(() => {});

  /* ---------- 4. 模块恢复默认样式 ---------- */
  await go('今天');
  for (let i = 0; i < 3; i++) {
    await p.locator('.mod-tools button[data-act="toggle-source"]').first().click();
    await p.waitForTimeout(700);
    if (await p.locator('textarea').count() > 0) break;
  }
  const isMd = await p.locator('textarea').count() > 0;
  await go('设置');
  await p.evaluate(() => { const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('日记与模块')); if (g) g.click(); });
  await p.waitForTimeout(500);
  const resetBtn = p.locator('.moditem:has(.nm:text-is("正文"))').first().locator('button.reset');
  ok('模块行有"恢复初始样式"按钮', await resetBtn.count() > 0);
  await resetBtn.click({ force: true });
  await p.waitForTimeout(900);
  await go('今天');
  const backToRich = await p.locator('.rt[contenteditable="true"]').count() > 0;
  ok(`Markdown(${isMd}) → 恢复默认后回到富文本(${backToRich})`, isMd && backToRich);

  /* ---------- 7. 图片拖拽导入 ---------- */
  await go('设置');
  await p.evaluate(() => { const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('日记与模块')); if (g) g.click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.moditem')];
    const row = rows.find(r => r.querySelector('.nm') && r.querySelector('.nm').textContent === '图片');
    const sw = row && row.querySelector('.switch');
    if (sw && !sw.className.includes('on')) sw.click();
  });
  await p.waitForTimeout(800);
  await go('今天');
  await p.waitForTimeout(600);

  await p.evaluate(async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin = atob(png);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'drag-test.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target = document.querySelector('.imgs');
    if (!target) return;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await p.waitForTimeout(2500);
  const media = await rpc(p, 'media.list', { limit: 50 });
  ok('拖拽图片直接入库：' + media.length + ' 张', media.length >= 1);
  await p.screenshot({ path: 'v6-today-img.png', timeout: 8000 }).catch(() => {});

  console.log(log.join('\n'));
  console.log('页面错误:', errs.length ? errs.slice(0, 6) : '无');
  await b.close().catch(() => {});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
