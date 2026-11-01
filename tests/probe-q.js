const { run } = require('./_probe');
run(async (P) => {
  P.say('切到网格视图');
  P.out(await P.eval(() => {
    const b = document.querySelector('[data-view="grid"]');
    if (!b) return 'no btn: ' + Array.from(document.querySelectorAll('[data-view]')).map((x) => x.getAttribute('data-view')).join(',');
    b.click(); return 'ok';
  }));
  await P.sleep(900);
  P.say('进入整理模式并检查 draggable');
  P.out(await P.eval(() => {
    const pm = document.querySelector('[data-act="pickmode"]');
    if (pm && /整理/.test(pm.textContent) && !/完成/.test(pm.textContent)) pm.click();
    return pm ? pm.textContent.trim() : 'no pickmode';
  }));
  await P.sleep(600);
  P.out(await P.eval(() => {
    const el = document.querySelector('.marqwrap .imgpick[data-selid]');
    return {
      cards: document.querySelectorAll('.marqwrap .imgpick[data-selid]').length,
      attrs: el ? Array.from(el.attributes).map((a) => `${a.name}=${a.value}`) : [],
      draggable: el ? el.draggable : null,
      picking: document.querySelector('.marqwrap')?.getAttribute('data-picking'),
    };
  }));
});
