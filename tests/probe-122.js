const { run } = require('./_probe');

run(async (P) => {
  P.say('CDP 是否就绪');
  P.out(await P.eval(() => document.title));

  P.say('切到「今天」页');
  await P.go('today');

  P.say('第 122 条：把正文模块切成 Markdown，量双栏宽度');
  await P.eval(() => {
    const b = document.querySelector('[data-act="toggle-source"]');
    if (b && b.textContent !== 'MD') b.click();
    return b ? b.textContent : 'no-button';
  });
  await P.sleep(900);
  P.out(await P.eval(() => {
    const sp = document.querySelector('.md-split');
    if (!sp) return { found: false };
    const ta = sp.querySelector('textarea');
    const pv = sp.querySelector('.rt');
    return {
      found: true,
      split: Math.round(sp.getBoundingClientRect().width),
      textarea: Math.round(ta.getBoundingClientRect().width),
      preview: Math.round(pv.getBoundingClientRect().width),
      grip: !!sp.querySelector('[data-md-grip]'),
      mdsplit: getComputedStyle(document.documentElement).getPropertyValue('--mdsplit').trim(),
    };
  }));

  P.say('第 122 条：拖到 35% 是否能变');
  P.out(await P.eval(() => {
    document.documentElement.style.setProperty('--mdsplit', '35%');
    const sp = document.querySelector('.md-split');
    const ta = sp && sp.querySelector('textarea');
    return ta ? Math.round(ta.getBoundingClientRect().width) : -1;
  }));
  await P.eval(() => document.documentElement.style.setProperty('--mdsplit', '50%'));

  P.say('第 122 条：专注写作开关');
  P.out(await P.eval(() => {
    const b = document.querySelector('[data-act="focus-write"]');
    if (!b) return { found: false };
    const before = document.querySelector('.today-side')?.getBoundingClientRect().width;
    b.click();
    return { found: true, before: Math.round(before || 0) };
  }));
  await P.sleep(700);
  P.out(await P.eval(() => ({
    attr: document.getElementById('app')?.getAttribute('data-focus-write'),
    sideDisplay: (() => {
      const s = document.querySelector('.today-side');
      return s ? getComputedStyle(s).display : 'no-el';
    })(),
  })));
  await P.eval(() => document.querySelector('[data-act="focus-write"]')?.click());
  await P.sleep(500);
  P.out(await P.eval(() => ({
    restored: document.getElementById('app')?.getAttribute('data-focus-write'),
    sideDisplay: (() => {
      const s = document.querySelector('.today-side');
      return s ? getComputedStyle(s).display : 'no-el';
    })(),
  })));

  P.say('第 88 条：图标组导入入口');
  await P.go('settings');
  P.out(await P.eval(() => {
    const btns = Array.from(document.querySelectorAll('button')).map((b) => b.textContent || '');
    return btns.filter((t) => t.includes('图标组')).slice(0, 5);
  }));
});