const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(12000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 73000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const t = new Date().toISOString().slice(0,10);
  const a1 = await rpc('pomodoro.add', { minutes: 30, kind: 'focus', task: 'del测试A' });
  const a2 = await rpc('pomodoro.add', { minutes: 20, kind: 'focus', task: 'del测试B' });
  const id1 = a1?.data?.id, id2 = a2?.data?.id;
  await p.waitForTimeout(400);
  const d0 = await rpc('pomo.day', { date: t });
  console.log('造 2 条后: count=', d0.data.count, ' 合计=', d0.data.totalMinutes, ' 带 id=', d0.data.items.every(x => !!x.id));

  const del = await rpc('pomodoro.delete', { id: id1 });
  await p.waitForTimeout(400);
  const d1 = await rpc('pomo.day', { date: t });
  console.log('删 1 条后: 返回=', JSON.stringify(del.data), ' count=', d1.data.count, ' 合计=', d1.data.totalMinutes, ' (应为 1 / 20)');

  const del2 = await rpc('pomodoro.delete', { id: id1 });
  console.log('重复删同一条:', JSON.stringify(del2.data), '(应为 ok=false)');
  const del3 = await rpc('pomodoro.delete', { id: '不存在的id' });
  console.log('删不存在的:', JSON.stringify(del3.data), '(应为 ok=false)');

  // 清干净
  await rpc('pomodoro.delete', { id: id2 });
  const dEnd = await rpc('pomo.day', { date: t });
  console.log('清完: count=', dEnd.data.count, ' 合计=', dEnd.data.totalMinutes);
  console.log('页面错误:', errs.join(' | ') || '无');
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
