/* 一次性清理：把这几天测试留下的假账户 / 假账目去掉。
 * 只删「名字带测试特征」的东西，真实数据一律不动。 */
const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '57001';
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 68000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const accs = (await rpc('ledger.accounts', {}))?.data || [];
  const junk = accs.filter((x) => /^验收账户\d+$/.test(x.name) || /^v\d+卡$/.test(x.name));
  for (const a of junk) {
    await rpc('account.delete', { id: a.id });
    console.log('删账户', a.name);
  }
  const recs = (await rpc('ledger.recur.list', {}))?.data || [];
  for (const r of recs) {
    if ((r.note || '') === '验收房租') { await rpc('ledger.recur.delete', { id: r.id }); console.log('删周期账单', r.note); }
  }
  const ym = new Date().toISOString().slice(0, 7);
  const rows = (await rpc('ledger.list', { from: ym + '-01', to: ym + '-31' }))?.data?.items || [];
  for (const x of rows) {
    if ((x.note || '') === '验收房租' || /^v\d+/.test(x.cat || '')) { await rpc('ledger.delete', { id: x.id }); console.log('删账目', x.date, x.cat, x.amount); }
  }
  console.log('剩余账户:', ((await rpc('ledger.accounts', {}))?.data || []).map((x) => x.name).join(', ') || '(无)');
  await b.close().catch(() => {});
})();
