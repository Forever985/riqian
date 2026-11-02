/*
 * 界面冒烟：逐个点开侧栏每一页，确认「渲染出来了」而不是白屏。
 *
 * 判定不是看截图，而是三条硬指标：
 *   1) 主区有可见文本（>20 字），空壳页面立刻暴露
 *   2) 控制台没有新增 error（console.error / uncaught）
 *   3) 侧栏没有因为页面切换丢掉选中项
 *
 * 用法：node smoke.js [端口，默认 57010]
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '57010';

(async () => {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const p = b.contexts()[0].pages()[0];

  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 160)));

  // 先取全部导航项的 key
  const navs = await p.evaluate(() =>
    [...document.querySelectorAll('.nav button[data-nav]')].map((e) => e.getAttribute('data-nav'))
  );

  const fails = [];
  const results = [];

  for (const k of navs) {
    const before = errors.length;
    await p.evaluate((kk) => {
      const btn = document.querySelector(`.nav button[data-nav="${kk}"]`);
      if (btn) btn.click();
    }, k);
    await p.waitForTimeout(650);

    const st = await p.evaluate(() => {
      const main = document.querySelector('.main');
      const txt = (main?.innerText || '').trim();
      const on = document.querySelector('.nav button.on')?.getAttribute('data-nav');
      return { len: txt.length, on, head: txt.slice(0, 24).replace(/\s+/g, ' ') };
    });

    const newErr = errors.length - before;
    const ok = st.len > 20 && st.on === k && newErr === 0;
    results.push({ k, len: st.len, on: st.on, err: newErr, ok });
    if (!ok) fails.push({ k, ...st, err: newErr });
  }

  console.log(JSON.stringify({ total: navs.length, pass: results.filter(r => r.ok).length, fail: fails.length, fails, errors: errors.slice(0, 8) }, null, 1));
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.log('ERR', e.message); process.exit(2); });