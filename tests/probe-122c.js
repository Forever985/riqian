const { run } = require('./_probe');

run(async (P, page) => {
  P.say('把视口模拟成 1500 宽（窄屏规矩是上下堆叠，双栏只在宽屏出现）');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1500, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await P.sleep(600);

  P.say('确认在 Markdown 模式');
  await P.go('today');
  await P.eval(() => {
    const b = document.querySelector('[data-act="toggle-source"]');
    if (b && b.textContent !== 'MD') b.click();
    return true;
  });
  await P.sleep(800);

  const snap = () => P.eval(() => {
    const sp = document.querySelector('.md-split');
    const ta = sp && sp.querySelector('textarea');
    const pv = sp && sp.querySelector('.rt');
    const g = document.querySelector('[data-md-grip]');
    return {
      w: innerWidth,
      cols: sp ? getComputedStyle(sp).gridTemplateColumns : '',
      host: sp ? Math.round(sp.getBoundingClientRect().width) : -1,
      ta: ta ? Math.round(ta.getBoundingClientRect().width) : -1,
      pv: pv ? Math.round(pv.getBoundingClientRect().width) : -1,
      gripShown: g ? getComputedStyle(g).display : 'none',
    };
  });

  P.say('1500 宽 / 默认 50%');
  P.out(await snap());

  P.say('改成 70%（模拟拖到右边）');
  await P.eval(() => document.documentElement.style.setProperty('--mdsplit', '70%'));
  await P.sleep(250);
  P.out(await snap());

  P.say('改成 30%');
  await P.eval(() => document.documentElement.style.setProperty('--mdsplit', '30%'));
  await P.sleep(250);
  P.out(await snap());

  P.say('点把手的复位（双击）');
  await P.eval(() => {
    const g = document.querySelector('[data-md-grip]');
    if (g) g.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return !!g;
  });
  await P.sleep(500);
  P.out(await snap());

  P.say('恢复视口');
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await P.sleep(300);
  P.out(await P.eval(() => ({ w: innerWidth })));
});