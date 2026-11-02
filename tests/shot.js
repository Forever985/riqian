const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const port = process.argv[2] || '57010';
  const view = process.argv[3] || 'settings';
  const out = process.argv[4] || '/tmp/shot.png';
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = b.contexts()[0].pages()[0];
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1280, height: 820 });
  // 切视图：点侧栏对应按钮
  const clicked = await page.evaluate((v) => {
    const side = document.querySelector('.side');
    if (!side) return false;
    const btns = [...side.querySelectorAll('button, a')];
    const map = { settings: '设置', today: '今天', ledger: '记账本', habits: '打卡', pomodoro: '番茄', stats: '统计', info: '说明书', countdown: '倒计时', notes: '笔记' };
    const want = map[v] || v;
    const t = btns.find(b => (b.innerText || '').trim().startsWith(want));
    if (!t) return false;
    t.click();
    return true;
  }, view);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out, fullPage: false });
  console.log('clicked=' + clicked + ' -> ' + out);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
