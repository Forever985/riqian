const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(8000);
  await p.click('#app .nav button[title^="设置"]');
  await p.waitForTimeout(900);
  const inp = p.locator('.topbar .searchbox input');
  await inp.click();
  await p.keyboard.type('字号');
  await p.waitForTimeout(700);
  console.log('typed', await p.evaluate(() => ({
    g: document.querySelector('.snav.on span')?.textContent,
    q: document.querySelector('.topbar .searchbox input')?.value,
    rows: [...document.querySelectorAll('.set-row .lbl')].map(x => x.textContent.split('\n')[0]),
    hits: document.querySelectorAll('.snav .hit').length,
  })));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
