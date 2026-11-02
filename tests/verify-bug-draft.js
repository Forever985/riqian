/* 验证 bug 5：草稿回收站用了一个不存在的列 published（实际列名是 status） */
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1500);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 77000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const show = async (m, a) => {
    const r = await rpc(m, a);
    return r.ok ? { ok: true, data: r.data } : { ok: false, err: r.err };
  };

  console.log('draft.trashList →', JSON.stringify(await show('draft.trashList')));
  console.log('');
  console.log('draft.trash（随便挑一天）→', JSON.stringify(await show('draft.trash', { date: '2019-03-16' })));
  console.log('');
  console.log('draft.purge（同一天）→', JSON.stringify(await show('draft.purge', { date: '2019-03-16' })));

  await b.close().catch(() => {});
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });