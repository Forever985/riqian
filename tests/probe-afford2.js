const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const page = b.contexts()[0].pages()[0];
  const r = await page.evaluate(() => {
    const clickable = [...document.querySelectorAll('button, a, [role="button"]')];
    const byCls = {};
    for (const el of clickable) {
      const cs = getComputedStyle(el);
      const hasBorder = cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none' && cs.borderTopColor !== 'rgba(0, 0, 0, 0)';
      const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
      if (!hasBorder && !hasBg && (el.innerText || '').trim()) {
        const k = (el.className || '(none)').trim().split(/\s+/)[0];
        byCls[k] = (byCls[k] || 0) + 1;
      }
    }
    return byCls;
  });
  console.log('静止无视觉提示的类：', JSON.stringify(r, null, 1));
  await b.close();
})();
