const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(10000);
  await p.click('#app .nav button[title^="今天"]').catch(()=>{});
  await p.waitForTimeout(800);
  const before = await p.evaluate(() => document.querySelectorAll('.mask').length);
  await p.locator('.mod .mod-tools button[title="插入 LaTeX 公式"]').first().click();
  await p.waitForTimeout(600);
  const opened = await p.evaluate(() => document.querySelectorAll('.mask').length);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  const afterEsc = await p.evaluate(() => document.querySelectorAll('.mask').length);
  // 再开一次，测点遮罩空白处能不能关
  if (afterEsc === 0) {
    await p.locator('.mod .mod-tools button[title="插入 LaTeX 公式"]').first().click();
    await p.waitForTimeout(500);
    await p.mouse.click(8, 8);
    await p.waitForTimeout(500);
  }
  const afterBackdrop = await p.evaluate(() => document.querySelectorAll('.mask').length);
  console.log({ before, opened, afterEsc, afterBackdrop });
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
