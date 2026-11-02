/* 验证 bug 1：储蓄罐存钱时账户余额方向反了
   预期：存 100 → 账户余额 -100，罐子 +100，总资产不变
   实测：见输出 */
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1800);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 73000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => {
    const r = await rpc(m, a);
    if (!r.ok) throw new Error(m + ' → ' + r.err);
    return r.data;
  };

  // 建一个干净账户
  const accName = 'BUGTEST-账户-' + Date.now();
  const acc = await call('account.save', { name: accName, kind: 'bank', init: 1000 });
  console.log('新账户:', JSON.stringify(acc));
  const accId = acc.id;

  const before = (await call('ledger.accounts')).find((x) => x.id === accId);
  console.log('存钱前 账户余额 =', before.balance);

  // 建罐子
  const jar = await call('jar.add', { name: 'BUGTEST-罐', target: 0, mode: 'free', period: '', baseAmount: 0, stepAmount: 0, color: '', icon: '', note: '' });
  console.log('新罐子:', JSON.stringify(jar));

  // 存入 100，指定账户
  const dep = await call('jar.deposit', { id: jar.id, dir: 'in', amount: 100, date: '', note: 'test', accountId: accId });
  console.log('存入结果:', JSON.stringify(dep));

  const after = (await call('ledger.accounts')).find((x) => x.id === accId);
  const jarList = await call('jar.list');
  const jarBal = (jarList.jars || []).find((x) => x.id === jar.id)?.balance;

  console.log('');
  console.log('存钱后 账户余额 =', after.balance, '  罐子余额 =', jarBal);
  console.log('');
  console.log('【判定】');
  const accDelta = after.balance - before.balance;
  console.log('  账户余额变化 =', accDelta, accDelta === -100 ? '✅ 正确（应为 -100）' : '❌ 错误！应为 -100');
  console.log('  罐子余额      =', jarBal, jarBal === 100 ? '✅ 正确' : '❌ 错误');
  const total = after.balance + jarBal;
  console.log('  账户+罐子总额 =', total, before.balance === total ? '✅ 守恒' : '❌ 不守恒（凭空多了钱）');

  // 清理
  await call('jar.delete', { id: jar.id });
  const items = await call('ledger.list', { from: '2000-01-01', to: '2099-12-31' });
  for (const it of (items.items || [])) {
    if (it.accountId === accId) await call('ledger.delete', { id: it.id });
  }
  await call('account.delete', { id: accId });

  await b.close().catch(() => {});
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });