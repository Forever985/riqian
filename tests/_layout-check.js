const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const b = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch());
  const results = [];

  for (const vp of [{ w: 1440, h: 1000, name: '1440 桌面' }, { w: 900, h: 1000, name: '900 平板' }, { w: 390, h: 844, name: '390 手机' }]) {
    const p = await b.newPage({ viewport: { width: vp.w, height: vp.h } });
    await p.goto('file:///' + path.resolve(process.argv[2]).replace(/\\/g, '/'), { waitUntil: 'load' });
    await p.waitForTimeout(400);

    const r = await p.evaluate(() => {
      const out = { problems: [] };

      // 1) 横向溢出
      const sw = document.documentElement.scrollWidth, iw = window.innerWidth;
      if (sw > iw + 1) out.problems.push(`横向溢出 scrollWidth=${sw} > ${iw}`);

      // 2) 找出任何越出视口右边界或左边界为负的元素
      const all = [...document.querySelectorAll('body *')];
      for (const el of all) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.right > iw + 2 || b.left < -2) {
          out.problems.push(`越界: <${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}> left=${b.left.toFixed(0)} right=${b.right.toFixed(0)}`);
          if (out.problems.length > 6) break;
        }
      }

      // 3) 文字被裁：scrollWidth 明显大于 clientWidth
      for (const el of all) {
        if (!el.textContent || el.children.length > 0) continue;
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          out.problems.push(`文字溢出: "${el.textContent.trim().slice(0, 20)}" ${el.scrollWidth}>${el.clientWidth}`);
          if (out.problems.length > 10) break;
        }
      }

      // 4) 下载卡片是否等高
      const cards = [...document.querySelectorAll('.dl-card')].map(c => Math.round(c.getBoundingClientRect().height));
      out.dlCards = cards;

      // 5) 功能卡片是否等高（同一行内）
      const feats = [...document.querySelectorAll('.feat-card')].map(c => Math.round(c.getBoundingClientRect().height));
      out.featCards = feats;

      // 6) 图片是否都加载成功
      out.imgs = [...document.images].map(i => ({
        src: i.src.split('/').pop(),
        ok: i.complete && i.naturalWidth > 0,
        w: i.naturalWidth,
      }));

      // 7) hero 两栏：右边截图相对左边文字是否重叠
      const hero = document.querySelector('.hero-grid');
      if (hero) {
        const cols = [...hero.children].map(c => c.getBoundingClientRect());
        if (cols.length === 2 && cols[0].right > cols[1].left + 1) {
          out.problems.push('Hero 两栏重叠');
        }
      }

      out.h1 = (() => {
        const h = document.querySelector('h1');
        if (!h) return null;
        const r = h.getBoundingClientRect();
        return { lines: Math.round(r.height / parseFloat(getComputedStyle(h).lineHeight)), w: Math.round(r.width) };
      })();

      return out;
    });

    results.push({ vp: vp.name, ...r });
    await p.close();
  }

  for (const r of results) {
    console.log('\n=== ' + r.vp + ' ===');
    console.log('  H1: ' + (r.h1 ? `${r.h1.lines} 行, 宽 ${r.h1.w}px` : '无'));
    console.log('  下载卡片高: ' + r.dlCards.join(' / ') + (new Set(r.dlCards).size === 1 ? '  ✓ 等高' : '  (不同高，单列时正常)'));
    console.log('  功能卡片高: ' + r.featCards.join(' / '));
    const badImgs = r.imgs.filter(i => !i.ok);
    console.log('  图片: ' + r.imgs.length + ' 张, ' + (badImgs.length ? '✗ 失败: ' + badImgs.map(i => i.src).join(',') : '✓ 全部加载'));
    if (r.problems.length) {
      console.log('  ⚠ 问题:');
      r.problems.forEach(x => console.log('     - ' + x));
    } else {
      console.log('  ✓ 无布局问题');
    }
  }
  await b.close();
})();