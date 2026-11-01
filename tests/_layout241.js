const { run } = require('./_probe');
run(async (P) => {
  for (const v of ['themeCenter', 'pluginCenter', 'workshop']) {
    P.say(v);
    await P.go(v);
    await P.sleep(500);
    P.out(await P.eval(() => {
      const page = document.querySelector('.page');
      const r = page.getBoundingClientRect();
      // 找所有溢出页面右边界或互相重叠的块
      const bad = [];
      page.querySelectorAll('*').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return;
        if (b.right > r.right + 2) bad.push({ tag: el.tagName, cls: el.className, over: Math.round(b.right - r.right) });
      });
      // 横向滚动出现了没
      return {
        页宽: Math.round(r.width),
        内容高: Math.round(page.scrollHeight),
        横向溢出元素: bad.slice(0, 5),
        出现横向滚动: page.scrollWidth > page.clientWidth + 2,
        段落数: page.querySelectorAll('h3').length,
      };
    }));
  }
  P.say('画板拾色器面板是否出界');
  await P.go('draw');
  await P.sleep(700);
  await P.page.evaluate(async () => {
    const add = [...document.querySelectorAll('button')].find((b) => /新建/.test(b.textContent));
    add?.click();
    await new Promise((r) => setTimeout(r, 900));
    document.querySelector('[data-act="draw-picker-open"]')?.click();
  });
  await P.sleep(500);
  P.out(await P.eval(() => {
    const cp = document.querySelector('[data-act="cp-panel"]');
    if (!cp) return '面板没开';
    const b = cp.getBoundingClientRect();
    return {
      面板: { 左: Math.round(b.left), 右: Math.round(b.right), 上: Math.round(b.top), 下: Math.round(b.bottom) },
      窗口宽: window.innerWidth,
      窗口高: window.innerHeight,
      右边没出界: b.right <= window.innerWidth,
      下边没出界: b.bottom <= window.innerHeight,
    };
  }));
});
