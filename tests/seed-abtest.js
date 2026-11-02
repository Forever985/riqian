/*
 * seed-abtest.js —— 给 A/B 对比造一份确定的测试数据
 *
 * 为什么需要它：静态快照必须两次跑在同一份数据上，否则「账户 2 个 vs 1 个」
 * 这种数据差异会被误判成渲染回归。这个脚本把数据固定成一套可复现的样子，
 * 跑完打印状态摘要，供 ledger-baseline.js 前后各跑一次。
 */
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57060'));
  const p = b.contexts()[0].pages()[0];
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 66000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  // 先清空既有账目/账户/规则，保证可复现
  const accs0 = (await rpc('ledger.accounts', {})).data || [];
  for (const a of accs0) await rpc('account.delete', { id: a.id });
  const recs0 = (await rpc('ledger.recur.list', {})).data || [];
  for (const r of recs0) await rpc('ledger.recur.delete', { id: r.id });

  const ym = new Date().toISOString().slice(0, 7);
  // 两个账户
  const a1 = await rpc('account.save', { name: '现金钱包', kind: '现金', init: 500, currency: 'CNY', note: '日常零花' });
  const a2 = await rpc('account.save', { name: '工资卡', kind: '银行卡', init: 8000, currency: 'CNY', note: '' });
  console.log('账户:', JSON.stringify(a1.data), JSON.stringify(a2.data));

  // 几条账目，覆盖收入/支出/多分类
  const rows = [
    { date: `${ym}-01`, kind: 'out', amount: 66.5, cat: '餐饮', note: '午餐', accountId: a1.data.id },
    { date: `${ym}-02`, kind: 'out', amount: 128, cat: '交通', note: '打车', accountId: a1.data.id },
    { date: `${ym}-03`, kind: 'out', amount: 39.9, cat: '餐饮', note: '外卖', accountId: a2.data.id },
    { date: `${ym}-05`, kind: 'out', amount: 320, cat: '购物', note: '衣服', accountId: a2.data.id },
    { date: `${ym}-06`, kind: 'in', amount: 12000, cat: '工资', note: '月薪', accountId: a2.data.id },
    { date: `${ym}-08`, kind: 'out', amount: 88, cat: '娱乐', note: '电影', accountId: a1.data.id },
  ];
  for (const r of rows) {
    const res = await rpc('ledger.add', r);
    if (res.err) console.log('  账目失败:', JSON.stringify(r), res.err);
  }

  // 一条固定支出规则
  const rec = await rpc('ledger.recur.save', { kind: 'out', amount: 1500, cat: '住房', note: '房租', day: 1, enabled: 1 });
  console.log('规则:', JSON.stringify(rec.err || rec.data));

  // 固定预算
  await rpc('setting.set', { k: 'ledgerBudget', v: '5000' });
  await rpc('setting.set', { k: 'ledgerBudgetCats', v: '{"餐饮":1200,"交通":500}' });

  await p.waitForTimeout(800);
  const bs = (await rpc('bootstrap', {})).data || {};
  const s = bs.settings || {};
  const accs = (await rpc('ledger.accounts', {})).data || [];
  const recs = (await rpc('ledger.recur.list', {})).data || [];
  const ins = (await rpc('ledger.insight', { ym })).data || {};
  console.log('--- 种子摘要 ---');
  console.log('ledgerBudget =', JSON.stringify(s.ledgerBudget), '/ cats =', JSON.stringify(s.ledgerBudgetCats));
  console.log('账户', accs.length, ':', accs.map(a => a.name).join(','));
  console.log('规则', recs.length, '条');
  console.log('本月总支出 =', ins.totalOut, '/ 总收入 =', ins.totalIn, '/ 分类数 =', (ins.byCat || []).length);
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
