/* 验证 bug 3：notebook.parent 没有防环校验
   把 A 设成 B 的子，再把 B 设成 A 的子 → 成环 */
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1500);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 75000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => {
    const r = await rpc(m, a);
    if (!r.ok) throw new Error(m + ' → ' + r.err);
    return r.data;
  };

  const A = await call('notebook.add2', { name: 'BUGTEST-A-' + Date.now(), color: '', parentId: '' });
  const B = await call('notebook.add2', { name: 'BUGTEST-B-' + Date.now(), color: '', parentId: '' });
  console.log('A =', A.id, ' B =', B.id);

  // A 变成 B 的子
  console.log('设 A.parent = B :', JSON.stringify(await call('notebook.parent', { id: A.id, parentId: B.id })));
  // B 变成 A 的子 —— 应该被拒绝
  const r = await rpc('notebook.parent', { id: B.id, parentId: A.id });
  console.log('设 B.parent = A :', JSON.stringify(r.data));

  // 读回来
  const tree = await call('notebook.tree', {});
  const flat = JSON.stringify(tree);
  const aParent = (tree.notebooks || []).find((x) => x.id === A.id)?.parentId;
  const bParent = (tree.notebooks || []).find((x) => x.id === B.id)?.parentId;
  console.log('');
  console.log('A.parent =', aParent, ' B.parent =', bParent);
  console.log('');
  console.log('【判定】');
  const cycle = aParent === B.id && bParent === A.id;
  console.log('  是否成环 =', cycle ? '❌ 是，A 和 B 互为父子（前端递归会死循环/爆栈）' : '✅ 否');

  // 清理（成环时得先解开）
  try {
    await call('notebook.parent', { id: A.id, parentId: '' });
    await call('notebook.parent', { id: B.id, parentId: '' });
    await call('notebook.delete', { id: A.id });
    await call('notebook.delete', { id: B.id });
  } catch (e) { console.log('清理时:', e.message); }

  await b.close().catch(() => {});
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });