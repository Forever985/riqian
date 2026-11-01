const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const pages = b.contexts()[0].pages();
  console.log('pages', pages.length, pages.map(p => p.url().slice(0,60)));
  const p = pages[0];
  console.log(await p.evaluate(() => ({ title: document.title, hasApp: !!document.getElementById('app'), body: document.body.innerText.slice(0,120) })).catch(e => 'eval fail: ' + e.message));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
