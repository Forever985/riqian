/* 清掉 v22 测试图：必须走 media.delete(hard:1)，media.bulk 只软删 */
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 68000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const all = (await rpc('media.list2', { kind: 'all', q: '', sort: 'new', dir: 'desc', folder: '' }))?.data || [];
  const ids = all.filter((m) => (m.name || '').startsWith('v22-')).map((m) => m.id);
  for (const id of ids) await rpc('media.delete', { id, hard: 1 });
  console.log('硬删:', ids.length, '张');
  await b.close().catch(() => {});
})();
