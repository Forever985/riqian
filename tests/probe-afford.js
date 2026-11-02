const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const page = b.contexts()[0].pages()[0];
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    // 找出所有看起来可点、但静态状态没有任何视觉提示的元素
    const clickable = [...document.querySelectorAll('button, a, [role="button"], [onclick]')];
    const noAfford = [];
    for (const el of clickable) {
      const cs = getComputedStyle(el);
      const hasBorder = cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none'
        && cs.borderTopColor !== 'rgba(0, 0, 0, 0)';
      const hasBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const txt = (el.innerText || '').trim().slice(0, 20);
      if (!hasBorder && !hasBg && txt) {
        noAfford.push({ cls: el.className.slice(0, 40), txt });
      }
    }
    return { total: clickable.length, noAfford: noAfford.length, sample: noAfford.slice(0, 20) };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
