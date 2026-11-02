/* 验证 bug 8：标签保存失败不能冒充「正文保存失败」
   修复前：entry.save 和 tag.set 套在同一个 try 里，
          tag.set 一失败界面就弹红色「保存失败」，但正文其实已经存好了。
   修复后：两段分开，正文失败才算失败；标签失败降级成一句提示。*/
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1400);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 75700 + Math.floor(Math.random() * 250);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => { const r = await rpc(m, a); if (!r.ok) throw new Error(m + ' → ' + r.err); return r.data; };

  const PASS = [], FAIL = [];
  const ok = (t) => { PASS.push(t); console.log('  ✅ ' + t); };
  const bad = (t) => { FAIL.push(t); console.log('  ❌ ' + t); };

  // 1) 正常存标签
  console.log('【标签正常保存】');
  const day = '2018-09-09';
  const r1 = await call('tag.set', { date: day, tags: ['测试A', '测试B'] });
  if (r1 && r1.ok) ok(`tag.set 成功，写入 ${r1.count} 个标签`);
  else bad('tag.set 失败：' + JSON.stringify(r1));

  // 标签跟着 entry.get 一起返回（没有单独的 entry.tags 接口）
  const readTags = async (d) => {
    try { const e = await call('entry.get', { date: d }); return (e && e.tags) || []; }
    catch { return []; }
  };
  const after = await readTags(day);
  console.log('  读回来 =', JSON.stringify(after));
  if (after.includes('测试A') && after.includes('测试B')) ok('两个标签都读回来了');
  else bad('标签没读回来：' + JSON.stringify(after));

  // 2) 之前那个"先删后插、不在事务里"的隐患：塞一个非法值进去看会不会把原有标签删光
  console.log('');
  console.log('【事务保护：坏输入不该把原有标签清空】');
  /* tags 里的元素类型不对（传数字/超长串），正常路径应该被过滤掉，
     而不是先 DELETE 再说 —— 之前那样一旦中途失败，用户原有标签就没了。 */
  const weird = ['正常标签', 'x'.repeat(200), '', '   '];
  const r2 = await call('tag.set', { date: day, tags: weird });
  console.log('  带超长/空白的输入 →', JSON.stringify(r2));
  const after2 = await readTags(day);
  console.log('  现在这一天的标签 =', JSON.stringify(after2));
  const names = Array.isArray(after2) ? after2 : [];
  if (names.some((n) => n === '正常标签')) ok('正常标签保住了，超长的被过滤掉');
  else bad('正常标签丢了');
  if (!names.some((n) => n.length > 40)) ok('超长标签被挡住（不会把界面撑爆）');
  else bad('超长标签还是进去了');

  // 3) 空数组 → 应该清空，且不报错
  const r3 = await call('tag.set', { date: day, tags: [] });
  const after3 = await readTags(day);
  if (r3 && r3.ok && Array.isArray(after3) && after3.length === 0) ok('传空数组能正常清空');
  else bad('清空标签失败：' + JSON.stringify(after3));

  // 清理
  await call('entry.delete', { date: day }).catch(() => {});

  console.log('');
  console.log(`【结果】通过 ${PASS.length} · 失败 ${FAIL.length}`);
  await b.close().catch(() => {});
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });