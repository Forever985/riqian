const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57010');
  const p = b.contexts()[0].pages()[0];
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 75000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => (await rpc(m, a)).data;
  const lst = await call('jar.list', {});
  let n = 0;
  for (const j of lst.jars || []) {
    const dt = await call('jar.detail', { id: j.id });
    for (const it of dt.items || []) { await call('jar.removeItem', { id: it.id }); n++; }
    await call('jar.delete', { id: j.id });
  }
  console.log('清掉罐子', (lst.jars || []).length, '个、流水', n, '笔');
  const after = await call('jar.list', {});
  console.log('剩余罐子:', (after.jars || []).length);
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
