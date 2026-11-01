const { run } = require('./_probe');
run(async (P) => {
  // 装一个主题包，再去设置页看调色板标题，然后还原
  const PACK = { rq:1, kind:'theme', id:'probe.dusk', name:'探针暮色', version:'1.0.0',
    colors:{ bg:'#201a2b', panel:'#2a2237', ink:'#efe7f5', accent:'#c07be0' } };
  P.say('装主题包');
  await P.go('themeCenter');
  await P.page.evaluate(async (pack) => {
    document.querySelector('[data-act="theme-install-open"]')?.click();
    await new Promise((r) => setTimeout(r, 350));
    const ta = document.querySelector('[data-act="pack-paste"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, JSON.stringify(pack));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('[data-act="pack-install"]')?.click();
  }, PACK);
  await P.sleep(1800);
  P.out(await P.eval(() => ({ 当前bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() })));

  P.say('主题中心里装来的那条要显示使用中');
  P.out(await P.eval(() => {
    const inst = document.querySelector('[data-act="theme-activate"]');
    return {
      有启用按钮: !!inst,
      按钮文字: inst ? inst.textContent : '(无)',
      内置高亮数: document.querySelectorAll('.theme-grid .tcard.on').length,
    };
  }));

  P.say('去设置页，调色板标题不该是 pack:xxx');
  await P.go('settings');
  await P.sleep(700);
  P.out(await P.eval(() => {
    // 找到"自定义颜色"那一行的按钮并查看调色板标题（需要打开弹层）
    const btns = [...document.querySelectorAll('button')].filter((b) => /调色板/.test(b.textContent));
    return { 找到按钮: btns.length, 文案: btns[0] ? btns[0].textContent.trim() : '' };
  }));
  P.out(await P.page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => /打开调色板/.test(b.textContent));
    btn?.click();
    await new Promise((r) => setTimeout(r, 600));
    const h = document.querySelector('.dlg .h h3');
    const t = h ? h.textContent : '(没弹层)';
    document.querySelector('.dlg .h .x')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return { 调色板标题: t, 出现了机器名: /pack:/.test(t) };
  }));

  P.say('切回内置主题，装来的主题应停用');
  await P.go('themeCenter');
  await P.sleep(500);
  P.out(await P.page.evaluate(async () => {
    document.querySelector('[data-act="theme-builtin-paper"]')?.click();
    await new Promise((r) => setTimeout(r, 1200));
    return { 当前bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() };
  }));
  P.out(await P.eval(() => {
    const inst = document.querySelector('[data-act="theme-activate"]');
    return { 内置高亮: document.querySelectorAll('.theme-grid .tcard.on').length, 启用按钮文字: inst ? inst.textContent : '(无)' };
  }));

  P.say('清理：卸载装来的那个');
  P.out(await P.page.evaluate(async () => {
    document.querySelector('[data-act="pack-uninstall"]')?.click();
    await new Promise((r) => setTimeout(r, 1300));
    return { 列表还在: !!document.querySelector('[data-act="pack-list"]') };
  }));
});
