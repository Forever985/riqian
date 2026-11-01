const { run } = require('./_probe');

run(async (P) => {
  P.say('窗口尺寸');
  P.out(await P.eval(() => ({
    w: innerWidth, h: innerHeight,
    dpr: devicePixelRatio,
    wrap: (() => { const w = document.querySelector('.wrap'); return w ? Math.round(w.getBoundingClientRect().width) : -1; })(),
    view: (() => { const v = document.querySelector('.view'); return v ? Math.round(v.getBoundingClientRect().width) : -1; })(),
  })));
});