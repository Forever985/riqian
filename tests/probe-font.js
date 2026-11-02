/* probe-font：验证 KaTeX 字体外置之后，公式还能正常渲染
 *
 * 背景：2026-11-02 把 20 个 woff2 从 base64 内嵌改成外置文件
 * （index.html 1755 → 1428 KB）。这一步的真实风险是「字体 404 → 公式变豆腐块」，
 * 而这个错误**不会抛异常**，只是字形悄悄退化成方框。所以必须实测字形，
 * 不能只看构建日志。
 *
 * 用法：node probe-font.js 57007
 */
const { chromium } = require('playwright-core');

const port = process.argv[2] || '57007';
let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = b.contexts()[0];
  const page = ctx.pages()[0] || await ctx.waitForEvent('page');

  console.log('\n== 字体外置验证 ==');

  // 1) 页面 origin 是不是虚拟主机（不是 about:blank）
  const url = page.url();
  ok('页面走的是虚拟主机映射', url.startsWith('https://riqian-app.example'), url);

  // 2) 字体文件能通过 HTTP 拿到 —— 这是外置方案的命门
  const fontRes = await page.evaluate(async () => {
    const out = [];
    for (const name of ['KaTeX_AMS-Regular.woff2', 'KaTeX_Main-Regular.woff2', 'KaTeX_Math-Italic.woff2']) {
      try {
        const r = await fetch(`/fonts/${name}`);
        const buf = await r.arrayBuffer();
        out.push({ name, ok: r.ok, status: r.status, len: buf.byteLength });
      } catch (e) {
        out.push({ name, ok: false, err: String(e) });
      }
    }
    return out;
  });
  for (const f of fontRes) {
    ok(`字体可取 ${f.name}`, f.ok && f.len > 1000, `status=${f.status} len=${f.len}`);
  }

  // 3) 用 KaTeX 真渲染一个公式（走页面里已经加载好的 katex）
  const renderRes = await page.evaluate(async () => {
    // katex 被打进 bundle，没有挂到 window；用 tex 对话框同款路径：
    // 直接构造一个 .tex 节点的 HTML 需要 katex，所以退一步——用已有的渲染结果判断。
    // 先找一个页面里已经存在的公式节点。
    const existing = document.querySelector('span.tex');
    if (existing) return { source: 'existing', html: existing.innerHTML.slice(0, 120), w: existing.getBoundingClientRect().width };

    // 没有现成公式就手动塞一个最小 KaTeX DOM（用 MathML，不依赖 JS 引擎）
    const probe = document.createElement('span');
    probe.className = 'tex';
    probe.innerHTML = '<span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span>'
      + '<span class="katex-html"><span class="base"><span class="mord mathnormal">x</span></span></span></span>';
    probe.style.cssText = 'position:fixed;left:-9999px;font-size:20px';
    document.body.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return { source: 'synthetic', w };
  });
  ok('公式节点可渲染', renderRes.w > 0, JSON.stringify(renderRes));

  // 4) document.fonts 里 KaTeX 字体的状态
  const fontStatus = await page.evaluate(() => {
    const all = [...document.fonts].filter((f) => /KaTeX/i.test(f.family));
    return {
      total: all.length,
      loaded: all.filter((f) => f.status === 'loaded').length,
      statuses: [...new Set(all.map((f) => f.status))],
    };
  });
  ok('KaTeX 字体已注册', fontStatus.total > 0, JSON.stringify(fontStatus));
  ok('已加载的字体 > 0', fontStatus.loaded > 0, `loaded=${fontStatus.loaded}/${fontStatus.total}`);

  // 5) 关键：真正把字形拉起来再用 check() 验证可用性
  const checks = await page.evaluate(async () => {
    const specs = ['20px KaTeX_Main', '20px KaTeX_Math', '20px KaTeX_AMS'];
    const out = [];
    for (const s of specs) {
      try {
        await document.fonts.load(s, 'x=1');
        out.push({ s, check: document.fonts.check(s, 'x=1') });
      } catch (e) { out.push({ s, err: String(e) }); }
    }
    return out;
  });
  for (const c of checks) ok(`字形可用 ${c.s}`, c.check === true, JSON.stringify(c));

  // 6) 有没有字体 404（控制台错误）
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.waitForTimeout(600);
  const fontErrs = errs.filter((e) => /font|woff|404/i.test(e));
  ok('没有字体加载错误', fontErrs.length === 0, fontErrs.join(' | '));

  // 7) 体积核对：内联产物里不该再有 base64 字体
  const cssLen = await page.evaluate(() => {
    const st = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    return { total: st.length, hasBase64Font: /data:font/.test(st) };
  });
  ok('CSS 里没有残留 base64 字体', !cssLen.hasBase64Font, `style 总长 ${cssLen.total}`);

  await b.close();
  console.log(`\n结果：${pass} 通过 / ${fails.length} 失败`);
  if (fails.length) { console.log('失败项：' + fails.join('、')); process.exit(1); }
})().catch((e) => { console.error('探针异常：', e); process.exit(1); });