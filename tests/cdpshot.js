/* 用 CDP 原生 Page.captureScreenshot，绕开 Playwright 截图前的字体等待 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

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
    // 存到脚本所在目录，不要写死绝对路径 —— 别人 clone 到哪都能用
    const f = path.join(__dirname, `shot-${t}.png`);
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log('saved', f, fs.statSync(f).size);
  }
  await b.close();
})();