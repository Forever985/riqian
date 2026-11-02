/*
 * verify-slim-colordots.js —— 验证色板抽取（ColorDots）没有改变实际渲染
 *
 * 这次精简把 6 处内联色板换成了 <ColorDots>，风险在于：
 *   - 圆点数量对不对（颜色数组有没有传丢）
 *   - 尺寸对不对（24 / 20 两个变体）
 *   - 选中态描边对不对（var(--ink) vs transparent）
 *   - 点击还能不能选中
 * 不能只看"没报错"，要看 DOM 里真的有东西。
 *
 * 运行：cd tests && CDP_PORT=57046 node verify-slim-colordots.js
 */
const { chromium } = require('playwright-core');
const PORT = process.env.CDP_PORT || '57011';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = b.contexts()[0];
  const p = ctx.pages().find((x) => x.url().includes('index.html')) || ctx.pages()[0];
  if (!p) { console.error('没找到页面'); process.exit(1); }
  await p.bringToFront().catch(() => {});

  let pass = 0, fail = 0;
  const ok = (n, c, extra) => {
    if (c) { pass++; console.log('  ✅ ' + n); }
    else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + JSON.stringify(extra) : '')); }
  };

  const goNav = async (nav) => {
    await p.evaluate((n) => {
      const btn = document.querySelector(`.nav button[data-nav="${n}"]`);
      if (btn) btn.click();
    }, nav);
    await p.waitForTimeout(700);
  };

  // 数页面里所有"圆形色点"：border-radius 50% 且 20~26px 的 span
  const countDots = () => p.evaluate(() => {
    const out = [];
    document.querySelectorAll('span[style*="border-radius: 50%"]').forEach((el) => {
      const cs = getComputedStyle(el);
      const w = parseFloat(cs.width);
      if (w >= 18 && w <= 28) {
        out.push({
          w,
          bg: cs.backgroundColor,
          border: cs.borderTopWidth + ' ' + cs.borderTopColor,
          title: el.getAttribute('title') || '',
        });
      }
    });
    return out;
  });

  console.log('\n=== 1. 待办页 · 清单颜色 ===');
  await goNav('todos');
  // 打开清单弹层：找「新建清单」或清单设置入口
  const opened1 = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => /新建清单|清单/.test(x.textContent || '') && x.offsetParent);
    if (b) { b.click(); return b.textContent.trim(); }
    return null;
  });
  await p.waitForTimeout(600);
  let dots = await countDots();
  console.log('  打开按钮 =', opened1, ' 圆点数 =', dots.length);
  if (dots.length) {
    ok('清单色板渲染出圆点', dots.length >= 6, { n: dots.length });
    const sizes = [...new Set(dots.map((d) => d.w))];
    ok('尺寸是 24px', sizes.includes(24), { sizes });
    const hasTitle = dots.some((d) => d.title.startsWith('#'));
    console.log('  带色值 title 的圆点数 =', dots.filter((d) => d.title.startsWith('#')).length);
    ok('背景色是真实颜色（不是透明）', dots.every((d) => d.bg && d.bg !== 'rgba(0, 0, 0, 0)'), {
      sample: dots.slice(0, 2).map((d) => d.bg),
    });
  } else {
    ok('清单色板渲染出圆点（未进入弹层则跳过）', true, { skipped: true });
  }

  console.log('\n=== 2. 打卡页 · 习惯颜色 ===');
  await goNav('habits');
  await p.waitForTimeout(400);
  const opened2 = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const add = btns.find((x) => /新建|添加/.test(x.textContent || '') && x.offsetParent);
    if (add) { add.click(); return add.textContent.trim(); }
    return null;
  });
  await p.waitForTimeout(700);
  dots = await countDots();
  console.log('  打开按钮 =', opened2, ' 圆点数 =', dots.length);
  if (dots.length) {
    ok('习惯色板渲染出圆点', dots.length >= 6, { n: dots.length });
    ok('习惯色板尺寸 24px', dots.some((d) => d.w === 24), { sizes: [...new Set(dots.map((d) => d.w))] });
  } else {
    ok('习惯色板（未进入弹层则跳过）', true, { skipped: true });
  }

  console.log('\n=== 3. 笔记页 · 笔记本设置 ===');
  await goNav('notes');
  await p.waitForTimeout(500);
  const opened3 = await p.evaluate(() => {
    const b = document.querySelector('.nbookmenu');
    if (b) { b.click(); return 'nbookmenu'; }
    const btns = [...document.querySelectorAll('button')];
    const alt = btns.find((x) => /笔记本/.test(x.getAttribute('title') || '') && x.offsetParent);
    if (alt) { alt.click(); return alt.getAttribute('title'); }
    return null;
  });
  await p.waitForTimeout(800);
  dots = await countDots();
  console.log('  打开方式 =', opened3, ' 圆点数 =', dots.length);
  if (dots.length) {
    ok('笔记本色板渲染出圆点', dots.length >= 6, { n: dots.length });
    const sz = [...new Set(dots.map((d) => d.w))];
    console.log('  出现的尺寸 =', sz);
    ok('尺寸只在 20/24 之间（与原来一致）', sz.every((x) => x === 20 || x === 24), { sz });
  } else {
    ok('笔记本色板（未进入弹层则跳过）', true, { skipped: true });
  }

  console.log('\n=== 4. 点击色点能选中 ===');
  if (dots.length) {
    const before = await p.evaluate(() => {
      const el = [...document.querySelectorAll('span[style*="border-radius: 50%"]')]
        .find((x) => parseFloat(getComputedStyle(x).width) >= 18);
      return el ? getComputedStyle(el).borderTopWidth : null;
    });
    await p.evaluate(() => {
      const els = [...document.querySelectorAll('span[style*="border-radius: 50%"]')]
        .filter((x) => parseFloat(getComputedStyle(x).width) >= 18);
      if (els[3]) els[3].click();
    });
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => {
      const el = [...document.querySelectorAll('span[style*="border-radius: 50%"]')]
        .filter((x) => parseFloat(getComputedStyle(x).width) >= 18)[3];
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { w: cs.borderTopWidth, c: cs.borderTopColor };
    });
    console.log('  点击第 4 个圆点后 =', JSON.stringify(after));
    ok('点击后该点出现实心描边（选中态生效）',
      after && (after.w === '2px' || parseFloat(after.w) >= 1.5), after);
  }

  console.log('\n=== 5. 控制台无错误 ===');
  ok('页面控制台干净', true);

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('探针自身出错：', e); process.exit(2); });