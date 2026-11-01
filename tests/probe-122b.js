const { run } = require('./_probe');

run(async (P) => {
  P.say('确认在「今天」页的 Markdown 模式');
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
    const left = document.querySelector('.today > div');
    return {
      cols: sp ? getComputedStyle(sp).gridTemplateColumns : '',
      host: sp ? Math.round(sp.getBoundingClientRect().width) : -1,
      ta: ta ? Math.round(ta.getBoundingClientRect().width) : -1,
      pv: pv ? Math.round(pv.getBoundingClientRect().width) : -1,
      leftCol: left ? Math.round(left.getBoundingClientRect().width) : -1,
      side: (() => { const s = document.querySelector('.today-side'); return s ? Math.round(s.getBoundingClientRect().width) : -1; })(),
    };
  });

  P.say('默认（右边边栏在）');
  P.out(await snap());

  P.say('打开专注写作');
  await P.eval(() => document.querySelector('[data-act="focus-write"]')?.click());
  await P.sleep(700);
  P.out(await snap());

  P.say('专注模式下再裁到 35% 宽度');
  await P.eval(() => document.documentElement.style.setProperty('--mdsplit', '35%'));
  await P.sleep(250);
  P.out(await snap());

  P.say('双击把手复位');
  await P.eval(() => {
    const g = document.querySelector('[data-md-grip]');
    if (g) g.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return !!g;
  });
  await P.sleep(500);
  P.out(await snap());

  P.say('关掉专注写作，回到原样');
  await P.eval(() => document.querySelector('[data-act="focus-write"]')?.click());
  await P.sleep(500);
  P.out(await snap());
});