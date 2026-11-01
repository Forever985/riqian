const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  console.log(await p.evaluate(() => ({
    masks: [...document.querySelectorAll('.mask')].map(m => m.textContent.slice(0,60)),
    dlg: document.querySelector('.dlg .h h3')?.textContent,
    qmask: document.querySelectorAll('.qmask').length,
  })));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  console.log('after esc', await p.evaluate(() => document.querySelectorAll('.mask').length));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
