const { run } = require('./_probe');

run(async (P, page) => {
  const cdp = await page.context().newCDPSession(page);
  P.say('模拟最大化：2560×1440（用户的真实屏幕）');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false,
  });
  await P.sleep(600);

  const snap = () => P.eval(() => {
    const w = document.querySelector('.wrap');
    const v = document.querySelector('.view');
    if (!w || !v) return { found: false };
    const wr = w.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    return {
      win: innerWidth,
      view: Math.round(vr.width),
      wrap: Math.round(wr.width),
      leftGap: Math.round(wr.left - vr.left),
      rightGap: Math.round(vr.right - wr.right),
      pagew: getComputedStyle(document.documentElement).getPropertyValue('--pagew').trim() || '(未设)',
    };
  });

  P.say('默认（自适应）');
  await P.sleep(300);
  P.out(await snap());

  P.say('切「铺满」');
  await P.eval(() => {
    document.documentElement.style.setProperty('--pagew', '100%');
  });
  await P.sleep(250);
  P.out(await snap());

  P.say('切「固定 1080」（老行为，做对比）');
  await P.eval(() => {
    document.documentElement.style.setProperty('--pagew', '1080px');
  });
  await P.sleep(250);
  P.out(await snap());

  P.say('恢复自适应');
  await P.eval(() => {
    document.documentElement.style.removeProperty('--pagew');
  });
  await P.sleep(250);
  P.out(await snap());

  P.say('导航拖宽后空白会不会被吞掉（第 153 条核心）');
  P.out(await P.eval(() => {
    document.documentElement.style.setProperty('--navw', '320px');
    const w = document.querySelector('.wrap');
    const v = document.querySelector('.view');
    const wr = w.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    return {
      view: Math.round(vr.width),
      wrap: Math.round(wr.width),
      leftGap: Math.round(wr.left - vr.left),
      rightGap: Math.round(vr.right - wr.right),
    };
  }));
  await P.eval(() => document.documentElement.style.setProperty('--navw', '218px'));

  await cdp.send('Emulation.clearDeviceMetricsOverride');
});