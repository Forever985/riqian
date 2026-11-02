/* 用 CDP 原生 Page.captureScreenshot，绕开 Playwright 截图前的字体等待 */
const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57010');
  const ctx = b.contexts()[0];
  const page = ctx.pages()[0];
  const client = await ctx.newCDPSession(page);

  const targets = process.argv.slice(2);
  // 默认：先首页，再设置页
  const plan = targets.length ? targets : ['welcome', 'settings'];

  for (const t of plan) {
    if (t === '__stay') {
      // 不跳页，直接截当前
    } else {
      await page.evaluate((v) => {
        const btn = document.querySelector(`[data-nav="${v}"]`);
        if (btn) btn.click();
      }, t);
      await page.waitForTimeout(900);
    }
    const { data } = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const f = `C:/Users/18405/WorkBuddy/2026-10-28-10-51-20/riqian4/tests/shot-${t}.png`;
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log('saved', f, fs.statSync(f).size);
  }
  await b.close();
})();