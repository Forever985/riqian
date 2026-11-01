/** 第 165 条：验证失焦自动收起（把焦点抢回 WebView2，浮窗应自己 Hide） */
const { run } = require('./_probe');

run(async (P, page) => {
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

  P.say('叫出浮窗');
  P.out(await P.eval(async () => (await window.__c('quick.popup', { kind: 'todo' })).data));
  await P.sleep(400);

  P.say('把焦点抢回主窗口（点一下页面中央）');
  await page.mouse.click(600, 400);
  await P.sleep(700);

  P.say('浮窗应已收起');
  P.out(await P.eval(async () => (await window.__c('quick.state', {})).data));

  P.say('再叫一次，确认能重复打开（不是一次性的）');
  P.out(await P.eval(async () => (await window.__c('quick.popup', { kind: 'note' })).data));
  await P.sleep(300);
  P.out(await P.eval(async () => (await window.__c('quick.state', {})).data));
  await page.mouse.click(600, 400);
  await P.sleep(600);
  P.out(await P.eval(async () => (await window.__c('quick.state', {})).data));
});