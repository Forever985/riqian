const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  const rpc = (m,a) => p.evaluate(([mm,aa]) => new Promise(res => {
    const id = 61000 + Math.floor(Math.random()*20000);
    const h = e => { if (e.data && e.data.id===id) { window.chrome.webview.removeEventListener('message',h); res(e.data); } };
    window.chrome.webview.addEventListener('message',h);
    window.chrome.webview.postMessage({id, m:mm, a:aa||{}});
  }), [m,a]);
  console.log('bootstrap hotkeys', await p.evaluate(async () => {
    const r = await new Promise(res => { const id=61234; const h=e=>{ if(e.data&&e.data.id===id){window.chrome.webview.removeEventListener('message',h);res(e.data);} }; window.chrome.webview.addEventListener('message',h); window.chrome.webview.postMessage({id,m:'bootstrap',a:{}}); });
    const s = r.data.settings; return { t:s.hotkeyToggle, b:s.hotkeyBoss, d:s.hotkeyDiary, n:s.hotkeyNote, td:s.hotkeyTodo, cd:s.hotkeyCd, p:s.hotkeyPomo, enable:s.hotkeyEnable };
  }));
  console.log('apply', JSON.stringify((await rpc('hotkey.apply', {})).data));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
