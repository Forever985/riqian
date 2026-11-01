const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(8000);
  const bad = [];
  p.on('requestfailed', r => bad.push('FAIL ' + r.url().slice(0, 160) + ' :: ' + (r.failure()?.errorText || '')));
  p.on('console', m => { if (m.type() === 'error') bad.push('CON ' + m.text().slice(0, 120)); });
  await p.click('#app .nav button[title^="今天"]');
  await p.waitForTimeout(900);
  await p.click('.datehead button:has-text("背景")');
  await p.waitForTimeout(1200);
  console.log(bad.length ? bad : 'none');
  console.log('imgs', await p.evaluate(() => [...document.querySelectorAll('.dlg img')].map(i => i.getAttribute('src').slice(0, 100))));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
