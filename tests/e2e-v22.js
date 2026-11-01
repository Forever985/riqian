/**
 * 第 153 条复测：宽屏下中间空白应消失（默认「铺满」）。
 *
 * 上一版把默认设成「自适应 1600 上限」，2560 宽实测仍留 366/376px 空白，
 * 违背用户原话「移除中间空白，或令中间空白变为可设置可拖动」。
 * 这一版默认是 full。
 */
const { run } = require('./_probe');

run(async (P, page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2560, height: 1400, deviceScaleFactor: 1, mobile: false,
  });
  await P.sleep(600);

  for (const nav of ['today', 'todo', 'media']) {
    P.say(`量 ${nav} 页在 2560 宽下的留白`);
    const r = await P.eval((k) => {
      document.querySelector(`.nav button[data-nav="${k}"]`)?.click();
      return true;
    }, nav);
    if (!r) continue;
    await P.sleep(900);

    const m = await P.eval(() => {
      const view = document.querySelector('.view');
      const wrap = document.querySelector('.wrap');
      const pw = getComputedStyle(document.documentElement).getPropertyValue('--pagew').trim();
      if (!view) return { err: '没有 .view' };
      const v = view.getBoundingClientRect();
      const w = wrap ? wrap.getBoundingClientRect() : null;
      return {
        pagew: pw,
        winW: innerWidth,
        view: `${Math.round(v.left)}..${Math.round(v.right)} (${Math.round(v.width)})`,
        wrap: w ? `${Math.round(w.left)}..${Math.round(w.right)} (${Math.round(w.width)})` : '无 .wrap',
        leftGap: w ? Math.round(w.left - v.left) : -1,
        rightGap: w ? Math.round(v.right - w.right) : -1,
      };
    });
    P.out(m);
  }

  P.say('切回 1104 宽确认窄屏也没坏');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await P.sleep(500);
  P.out(await P.eval(() => {
    const view = document.querySelector('.view');
    const wrap = document.querySelector('.wrap');
    if (!view) return { err: '没有 .view' };
    const v = view.getBoundingClientRect();
    const w = wrap ? wrap.getBoundingClientRect() : null;
    return {
      winW: innerWidth,
      view: Math.round(v.width),
      wrap: w ? Math.round(w.width) : '无',
      overflowX: document.documentElement.scrollWidth > innerWidth,
    };
  }));
});