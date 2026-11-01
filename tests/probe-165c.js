/** 第 165 条：浮窗状态断言（走 quick.state，不依赖外部窗口枚举） */
const { run } = require('./_probe');

run(async (P) => {
  await P.eval(() => {
    window.__c = (() => {
      let seq = 0; const pending = new Map();
      window.chrome.webview.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || typeof d !== 'object') return;
        const p = pending.get(d.id); if (p) { pending.delete(d.id); p(d); }
      });
      return (m, a) => new Promise((res) => { const id = ++seq; pending.set(id, res);
        window.chrome.webview.postMessage({ id, m, a: a || {} }); });
    })();
    return 1;
  });

  P.say('弹出前的状态');
  P.out(await P.eval(async () => (await window.__c('quick.state', {})).data));

  P.say('叫出 todo 浮窗');
  P.out(await P.eval(async () => (await window.__c('quick.popup', { kind: 'todo' })).data));

  P.say('叫出后立刻查状态（应该是 visible=true, mainVisible=false 或保持原样）');
  P.out(await P.eval(async () => (await window.__c('quick.state', {})).data));

  await P.sleep(300);
  P.say('等 300ms 再查（没动鼠标的话它可能已经因失焦收起了）');
  P.out(await P.eval(async () => (await window.__c('quick.state', {})).data));
});