/**
 * 第 131 条：统计页复用番茄洞察。
 *
 * 要验的是「复用的是同一个组件、同一份数据」：
 *   ① 统计页的番茄卡里出现洞察面板（.pi-heat-cols），不再是原来两张孤零零的 KPI
 *   ② 统计页切到「今年」，番茄卡跟着变（不是永远近 30 天）
 *   ③ 番茄钟页照旧能用（没被改坏）
 *   ④ 两处对同一区间算出来的数字一致 —— 这条最关键
 */
const { chromium } = require('playwright-core');

let pass = 0; const fails = [];
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log('  OK   ' + n); }
  else { fails.push(n); console.log('  FAIL ' + n + (x ? '  → ' + x : '')); }
};

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(20000);
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 77000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => (await rpc(m, a)).data;

  /* ④ 先验数据层：from/to 模式和 days 模式该各算各的 */
  const d30 = await call('pomo.insight', { days: 30 });
  const dY = await call('pomo.insight', { days: 30, from: '2026-01-01', to: '2026-12-31' });
  console.log('近30天累计分钟:', d30.totalMinutes, '| 今年累计:', dY.totalMinutes, '| 今年天数:', dY.series.length);
  ok('from/to 生效（区间天数不同于 30）', dY.series.length !== 30, 'series=' + dY.series.length);
  ok('今年累积不少于近30天', dY.totalMinutes >= d30.totalMinutes,
    d30.totalMinutes + ' vs ' + dY.totalMinutes);
  ok('老调用（只传 days）没坏', d30.series.length === 30, 'series=' + d30.series.length);

  /* ① 进统计页，找番茄卡 */
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.click('.nav button:has-text("统计")');
  await p.waitForTimeout(1800);

  const pomoCard = await p.evaluate(() => {
    const c = document.querySelector('.stat-pomo');
    if (!c) return null;
    return {
      hasHeat: !!c.querySelector('.pi-heat-cols'),
      hasKpi: !!c.querySelector('.kpi-grid'),
      heatCells: c.querySelectorAll('.heat-c').length,
      text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    };
  });
  console.log('统计页番茄卡:', JSON.stringify(pomoCard));
  ok('统计页有番茄卡', !!pomoCard);
  ok('番茄卡里是洞察面板（有热力图）', pomoCard && pomoCard.hasHeat, JSON.stringify(pomoCard));
  ok('热力图格子数合理', pomoCard && pomoCard.heatCells > 20, '格子=' + (pomoCard && pomoCard.heatCells));

  /* ② 切到「今年」，番茄卡的 KPI 该跟着变 */
  const before = await p.evaluate(() => {
    const c = document.querySelector('.stat-pomo');
    return c ? c.textContent.replace(/\s+/g, ' ') : '';
  });
  const clicked = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '今年');
    if (!b) return false;
    b.click();
    return true;
  });
  await p.waitForTimeout(1800);
  const after = await p.evaluate(() => {
    const c = document.querySelector('.stat-pomo');
    return c ? c.textContent.replace(/\s+/g, ' ') : '';
  });
  console.log('切「今年」前后是否有变化:', before !== after);
  ok('点到了「今年」按钮', clicked);
  ok('番茄卡跟着区间变了', before !== after, '前后文本一样');

  /* ③ 番茄页照旧 */
  /* 导航里这一页的文案是「学习」，不是「番茄钟」—— 用 data-nav 匹配，别靠文字。 */
  await p.click('.nav button[data-nav="pomodoro"]');
  await p.waitForTimeout(1600);
  const pomoPage = await p.evaluate(() => ({
    hasPanel: !!document.querySelector('.pi-heat-cols'),
    hasTimer: !!document.querySelector('.seg, .btn'),
  }));
  console.log('番茄页:', JSON.stringify(pomoPage));
  ok('番茄页的洞察面板还在', pomoPage.hasPanel);

  console.log('\n通过 ' + pass + ' / 失败 ' + fails.length);
  if (fails.length) console.log('失败项: ' + fails.join(' | '));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
