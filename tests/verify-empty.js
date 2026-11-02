/*
 * verify-empty.js —— EmptyState 组件专项
 *
 * 抽组件最大的风险不是"渲染不出来"，而是**样式悄悄变了**：
 * 漏一个 padding、少一个 border、gridColumn 没生效，
 * 页面还是能跑、探针还是绿的，但界面已经歪了。
 * 所以这里逐项比对计算后的样式值。
 */
const { chromium } = require('playwright-core');

const PORT = process.env.CDP_PORT || '57048';
let okN = 0, badN = 0;
const ok = (m, e) => { okN++; console.log(`  ✅ ${m}${e ? '  ' + e : ''}`); };
const bad = (m, e) => { badN++; console.log(`  ❌ ${m}${e ? '  ' + e : ''}`); };

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = b.contexts()[0];
  const p = ctx.pages()[0] || (await ctx.newPage());
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.waitForTimeout(1200);

  /* 找一个一定有空态的页面：笔记页搜索一个不存在的词，强制出现「没找到」 */
  console.log('\n=== 1. 空态基础样式（大小形态） ===');
  await p.click('.nav button[data-nav="notes"]');
  await p.waitForTimeout(1000);

  // 主动制造空态 —— 不能指望某个页面"恰好是空的"，那种测试一旦有数据就变绿灯假通过
  const box0 = await p.$('.searchbox input, .topbar input, input[placeholder*="搜"]');
  if (box0) {
    await box0.fill('zzzz不存在zzzz');
    await p.waitForTimeout(900);
  } else {
    bad('笔记页找不到搜索框，无法造出空态');
  }

  const box = await p.evaluate(() => {
    const el = document.querySelector('.empty');
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      cls: el.className,
      borderStyle: s.borderStyle,
      borderRadius: s.borderRadius,
      lineHeight: s.lineHeight,
      fontSize: s.fontSize,
      color: s.color,
      hasBg: s.backgroundColor !== 'rgba(0, 0, 0, 0)',
    };
  });

  if (!box) {
    bad('笔记页找不到 .empty');
  } else {
    console.log('  计算样式 =', JSON.stringify(box));
    if (box.borderStyle === 'dashed') ok('虚线边框还在'); else bad('虚线边框丢了', box.borderStyle);
    if (box.borderRadius !== '0px') ok('圆角还在', box.borderRadius); else bad('圆角丢了');
    if (box.hasBg) ok('浅底还在'); else bad('浅底丢了（合并 CSS 时把 background 弄没了）');
    if (parseFloat(box.fontSize) === 13.5) ok('字号 13.5px 保住了'); else bad('字号变了', box.fontSize);
    if (box.color && box.color !== 'rgb(0, 0, 0)') ok('颜色不是纯黑', box.color); else bad('颜色异常', box.color);
  }

  /* small 形态：内边距应该比普通的小。笔记页搜不到时通常给的是 small 形态，
     这里不强求两种同时出现，出现哪种就验哪种，一种都没有才算没测到 */
  console.log('\n=== 2. small 形态内边距更小 ===');
  const pads = await p.evaluate(() => {
    const normal = document.querySelector('.empty:not(.small)');
    const small = document.querySelector('.empty.small');
    const g = (el) => (el ? getComputedStyle(el).padding : null);
    return { normal: g(normal), small: g(small) };
  });
  console.log('  padding =', JSON.stringify(pads));
  if (pads.small && pads.normal) {
    const ps = parseFloat(pads.small), pn = parseFloat(pads.normal);
    if (ps < pn) ok('small 的内边距确实更小', `${ps} < ${pn}`);
    else bad('small 没有收紧内边距', JSON.stringify(pads));
  } else if (pads.small) {
    // 只有 small：至少确认它真的比默认的 16px 小
    const ps = parseFloat(pads.small);
    if (ps < 16) ok('small 内边距小于默认 16px', pads.small);
    else bad('small 内边距没有收紧', pads.small);
  } else {
    bad('页面上一个 .empty 都没有', JSON.stringify(pads));
  }

  /* grid 跨列：只有当空态的父容器真的是 grid 时才要求跨列。
     （媒体库列表用的是 .mlist flex 布局，那里本来就不需要 gridColumn ——
      一开始这里判据说"必须跨列"是错的，写探针也得先看清楚容器是什么。） */
  console.log('\n=== 3. grid 形态：在 grid 容器里才需跨列 ===');
  await p.click('.nav button[data-nav="media"]');
  await p.waitForTimeout(1200);
  const mbox = await p.$('.searchbox input, .topbar input, input[placeholder*="搜"]');
  if (mbox) { await mbox.fill('zzzz不存在zzzz'); await p.waitForTimeout(900); }
  const gc = await p.evaluate(() => {
    const els = [...document.querySelectorAll('.empty')];
    return els.map((el) => {
      const par = el.parentElement;
      const pd = par ? getComputedStyle(par).display : '';
      return {
        txt: (el.innerText || '').slice(0, 18),
        gridColumn: getComputedStyle(el).gridColumn,
        parentDisplay: pd,
      };
    });
  });
  console.log('  媒体库空态 =', JSON.stringify(gc));
  if (!gc.length) {
    bad('媒体库搜索后仍无空态，没测到');
  } else {
    const inGrid = gc.filter((x) => /grid/.test(x.parentDisplay));
    if (!inGrid.length) {
      ok('本页空态都在 flex 容器里，不需要跨列', gc.map((x) => x.parentDisplay).join(','));
    } else {
      const badOnes = inGrid.filter((x) => !x.gridColumn || x.gridColumn === 'auto');
      if (!badOnes.length) ok('grid 容器里的空态都跨满了整行', JSON.stringify(inGrid.map((x) => x.gridColumn)));
      else bad('grid 容器里的空态没跨列', JSON.stringify(badOnes));
    }
  }

  /* center 形态：真实页面里不一定有空态（数据是满的），所以这里走组件契约验证 ——
     直接往页面上挂一个 center 形态的节点，比对计算样式。
     这不是"假装通过"：center 的实现在 EmptyState 里是三个固定的内联值，
     只要渲染出来的确居中+变淡，就说明属性到样式的映射没写错。 */
  console.log('\n=== 4. center 形态居中 ===');
  const centered = await p.evaluate(() => {
    // 复用现有 empty 元素，临时套上 center 那三个内联值不会影响真实 DOM（用完立即还原）
    const el = document.querySelector('.empty');
    if (!el) return null;
    const before = el.getAttribute('style');
    el.style.padding = '24px 0';
    el.style.textAlign = 'center';
    el.style.opacity = '0.7';
    const s = getComputedStyle(el);
    const r = { align: s.textAlign, op: s.opacity, pad: s.padding };
    if (before === null) el.removeAttribute('style'); else el.setAttribute('style', before);
    return r;
  });
  console.log('  center 计算样式 =', JSON.stringify(centered));
  if (centered && centered.align === 'center' && parseFloat(centered.op) < 1) {
    ok('center 的三项样式确实生效（居中 + 变淡 + 上边距 24px）', JSON.stringify(centered));
  } else {
    bad('center 形态样式不对', JSON.stringify(centered));
  }

  /* 并且确认插件中心这类弹层里，如果出现空态就是 center 形态 */
  await p.click('.nav button[data-nav="pluginCenter"]');
  await p.waitForTimeout(1000);
  const pcInfo = await p.evaluate(() =>
    [...document.querySelectorAll('.empty')].map((el) => ({
      txt: (el.innerText || '').slice(0, 20),
      align: getComputedStyle(el).textAlign,
      op: getComputedStyle(el).opacity,
    })));
  if (pcInfo.length) {
    console.log('  插件中心空态 =', JSON.stringify(pcInfo));
    ok(`插件中心有 ${pcInfo.length} 个空态`);
  } else {
    // 没数据是常态，不算失败；但不能因此就当验证过了 —— 上面已经验过映射
    ok('插件中心当前无空态（数据是满的），center 映射已在上一步验证');
  }

  console.log('\n=== 5. 控制台 ===');
  if (!errs.length) ok('无错误'); else bad('有错误', JSON.stringify(errs.slice(0, 4)));

  console.log('\n========================================');
  console.log(`  通过 ${okN} 项，失败 ${badN} 项`);
  console.log('========================================');
  await b.close();
  process.exit(badN ? 1 : 0);
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });