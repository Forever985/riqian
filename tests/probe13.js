const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  const rpc = (m,a) => p.evaluate(([mm,aa]) => new Promise(res => {
    const id = 63000 + Math.floor(Math.random()*20000);
    const h = e => { if (e.data && e.data.id===id) { window.chrome.webview.removeEventListener('message',h); res(e.data); } };
    window.chrome.webview.addEventListener('message',h);
    window.chrome.webview.postMessage({id, m:mm, a:aa||{}});
  }), [m,a]);
  const habits = (await rpc('habits.list', {})).data;
  const hid = habits[0].id;
  console.log('habit', habits[0].name, hid);
  const date = new Date().toISOString().slice(0,10);
  console.log('log1', JSON.stringify(await rpc('habit.log', { date, habitId: hid, val: null, note: '直接写的备注 7 公里' })));
  console.log('notes', JSON.stringify(await rpc('habit.notes', { date })));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
