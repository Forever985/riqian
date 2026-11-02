/* 验证 bug 3 的完整闭环：移入回收站 → 列表里能看到 → 捡回来 → 列表里消失
   修复前 draft.trash 抛 "no such column: published"，草稿根本删不掉。*/
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1400);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 75100 + Math.floor(Math.random() * 400);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => { const r = await rpc(m, a); if (!r.ok) throw new Error(m + ' → ' + r.err); return r.data; };

  const PASS = [], FAIL = [];
  const ok = (t) => { PASS.push(t); console.log('  ✅ ' + t); };
  const bad = (t) => { FAIL.push(t); console.log('  ❌ ' + t); };

  // 用很久以前的一天，不碰用户真实草稿
  const day = '2018-06-06';
  const MARK = 'DRAFT-TRASH-PROBE';

  // 造一篇草稿
  await call('entry.save', { date: day, values: { body: MARK + ' 内容' }, fav: 0, bg: '', title: MARK, bgTone: '' });

  const draftsBefore = await call('entry.drafts', {});
  const inDraftsBefore = (draftsBefore || []).some((d) => d.date === day);
  console.log('【准备】2018-06-06 造了一篇草稿，在草稿列表里 =', inDraftsBefore);
  if (inDraftsBefore) ok('草稿已建好'); else bad('草稿没建出来，后面没法验');

  // 移入回收站
  console.log('');
  console.log('【移入回收站】');
  try {
    const r = await call('draft.trash', { date: day });
    if (r && r.ok) ok('draft.trash 执行成功（修复前这里抛 SQL 错）');
    else bad('draft.trash 返回失败：' + JSON.stringify(r));
  } catch (e) {
    bad('draft.trash 抛异常：' + e.message);
  }

  const draftsAfter = await call('entry.drafts', {});
  if (!(draftsAfter || []).some((d) => d.date === day)) ok('草稿列表里已经没有了（真的删掉了）');
  else bad('草稿列表里还在 —— 可能没真删');

  const trash = await call('draft.trashList', {});
  const inTrash = (trash || []).some((d) => d.date === day);
  console.log('  回收站里共', (trash || []).length, '篇');
  if (inTrash) ok('回收站列表里能看到它');
  else bad('回收站列表里看不到 —— trashList 还是坏的');

  // 捡回来
  console.log('');
  console.log('【捡回来】');
  try {
    const r = await call('draft.restore', { date: day });
    if (r && r.ok) ok('draft.restore 执行成功'); else bad('restore 失败');
  } catch (e) { bad('restore 抛异常：' + e.message); }

  const draftsBack = await call('entry.drafts', {});
  if ((draftsBack || []).some((d) => d.date === day)) ok('草稿回到列表里了');
  else bad('捡回来之后草稿列表里还是没有');

  const trash2 = await call('draft.trashList', {});
  if (!(trash2 || []).some((d) => d.date === day)) ok('回收站里已经没有了');
  else bad('回收站里还留着');

  // 定稿的不该被拖进回收站
  console.log('');
  console.log('【定稿的不受回收站影响】');
  await call('entry.publish', { date: day, published: 1 });
  await call('draft.trash', { date: day });
  const draftsPub = await call('entry.drafts', {});
  const trashPub = await call('draft.trashList', {});
  if (!(trashPub || []).some((d) => d.date === day)) ok('定稿的没被拖进回收站（判据用的是 status 不是 published）');
  else bad('定稿的也被丢进回收站了 —— 判据仍不对');

  // 清干净
  try { await call('draft.restore', { date: day }); } catch { }
  try { await call('entry.delete', { date: day }); } catch { }
  try { await call('draft.purge', { date: day }); } catch { }

  console.log('');
  console.log(`【结果】通过 ${PASS.length} · 失败 ${FAIL.length}`);
  await b.close().catch(() => {});
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });