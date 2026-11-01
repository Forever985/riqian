/** 第 165 条：让宿主弹一次浮窗，再从外部确认窗口真的存在 */
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
  P.say('叫出 todo 浮窗');
  P.out(await P.eval(async () => window.__c('quick.popup', { kind: 'todo' })));
  P.say('浮窗已请求（它失焦会自己收，所以马上到外部去看窗口）');
  await P.sleep(1200);
});