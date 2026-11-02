/* 量尺寸而不是看图：卡片排版有没有溢出、进度条宽度、文字截断 */
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57010');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(20000);
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.click('.nav button:has-text("记账本")');
  await p.waitForTimeout(1000);
  await p.evaluate(() => {
    const c = [...document.querySelectorAll('.card')].find((x) => (x.querySelector('h3') || {}).textContent?.indexOf('储蓄罐') >= 0);
    if (c) c.scrollIntoView({ block: 'start' });
  });
  await p.waitForTimeout(600);

  const r = await p.evaluate(() => {
    const grid = document.querySelector('.jars');
    if (!grid) return { err: '.jars 不存在' };
    const cards = [...grid.querySelectorAll('.jar')].map((c) => {
      const bb = c.getBoundingClientRect();
      const bar = c.querySelector('.jar-bar i');
      const v = c.querySelector('.jar-v');
      const n = c.querySelector('.jar-n');
      const acts = c.querySelector('.jar-acts');
      return {
        name: n ? n.textContent : '',
        w: Math.round(bb.width), h: Math.round(bb.height),
        barW: bar ? bar.style.width : '(无)',
        barPx: bar ? Math.round(bar.getBoundingClientRect().width) : 0,
        valW: v ? Math.round(v.getBoundingClientRect().width) : 0,
        valScrollW: v ? v.scrollWidth : 0,
        actsH: acts ? Math.round(acts.getBoundingClientRect().height) : 0,
        overflowX: c.scrollWidth > c.clientWidth + 1,
      };
    });
    return {
      cols: getComputedStyle(grid).gridTemplateColumns,
      gap: getComputedStyle(grid).gap,
      cards,
      // 主容器有没有横向溢出
      docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
