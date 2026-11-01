const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(8000);
  const bad = [];
  p.on('requestfailed', r => bad.push(r.url().slice(0, 140) + ' :: ' + (r.failure()?.errorText || '')));
  p.on('console', m => { if (m.type() === 'error') bad.push('CONSOLE ' + m.text().slice(0, 160)); });
  for (const v of ['今天', '流', '记录', '日历', '统计', '我的', '笔记']) {
    await p.click(`#app .nav button[title^="${v}"]`).catch(() => {});
    await p.waitForTimeout(900);
  }
  console.log(bad.length ? bad : 'no failures');
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
