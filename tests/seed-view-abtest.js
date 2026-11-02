/*
 * seed-view-abtest.js —— 给笔记 / 待办的 A/B 对比造一份确定的测试数据
 *
 * 为什么必须固定数据：静态快照靠「逐字对比」，两次采样之间只要数据变了一点，
 * 「3 篇 vs 5 篇」这种差异就会被误读成渲染回归。上一轮做账本 A/B 时
 * 头一跑报了 32 处差异，全是别的探针中途改了数据 —— 白忙半小时。
 *
 * 这个脚本做的事：
 *   1. 清掉既有的笔记 / 笔记本 / 待办 / 清单（只清自己造的名字前缀，不碰用户数据）
 *   2. 造一套固定结构：3 层笔记本 + 分层笔记 + 各种排序维度都能区分的属性
 *   3. 造待办：四象限各有、已完成/已放弃/回收站各一、带重复规则的
 *   4. 打印摘要，供前后两次基线跑对得上
 *
 * 只清 `ABTEST-` 前缀造的东西，用户原有数据一条不动。
 *
 * 用法：CDP_PORT=57060 node seed-view-abtest.js
 */
const { chromium } = require('playwright-core');

const TAG = 'ABTEST';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57060'));
  const p = b.contexts()[0].pages()[0];
  await p.waitForTimeout(1200);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 55000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  /* ---------- 1. 清掉自己上次造的 ---------- */
  const oldNotes = (await rpc('notes.list', { notebookId: '', q: '' })).data || [];
  let delN = 0;
  for (const r of oldNotes) {
    if (!(r.title || '').startsWith(TAG)) continue;
    await rpc('note.delete', { id: r.id });
    await rpc('note.purge', { id: r.id });
    delN += 1;
  }
  const oldBooks = (await rpc('notebooks.list', {})).data || [];
  let delB = 0;
  // 先删子后删父：从深到浅按名字长度排没用，直接倒序遍历两次
  for (let round = 0; round < 3; round += 1) {
    for (const nb of oldBooks) {
      if (!(nb.name || '').startsWith(TAG)) continue;
      const r = await rpc('notebook.delete', { id: nb.id });
      if (!r.err) delB += 1;
    }
  }
  const oldTodos = (await rpc('todos.list', {})).data || [];
  let delT = 0;
  for (const t of oldTodos) {
    if (!(t.title || '').startsWith(TAG)) continue;
    await rpc('todo.trash', { id: t.id, trashed: 1 });
    await rpc('todo.delete', { id: t.id });
    delT += 1;
  }
  const oldLists = (await rpc('todo.lists', {})).data || [];
  let delL = 0;
  for (const l of oldLists) {
    if (!(l.name || '').startsWith(TAG)) continue;
    await rpc('todo.list.delete', { id: l.id });
    delL += 1;
  }
  console.log(`清理上一轮：笔记 ${delN} / 笔记本 ${delB} / 待办 ${delT} / 清单 ${delL}`);

  /* ---------- 2. 笔记本：3 层，每层带颜色 ---------- */
  const b1 = (await rpc('notebook.add2', { name: `${TAG}-工作`, color: '#b8623a', parentId: '' })).data;
  const b2 = (await rpc('notebook.add2', { name: `${TAG}-工作/项目A`, color: '#4a7396', parentId: b1.id })).data;
  const b3 = (await rpc('notebook.add2', { name: `${TAG}-工作/项目A/子层`, color: '#5f8256', parentId: b2.id })).data;
  const b4 = (await rpc('notebook.add2', { name: `${TAG}-生活`, color: '#8e6a9e', parentId: '' })).data;
  console.log('笔记本:', [b1.name, b2.name, b3.name, b4.name].join(' | '));

  /* ---------- 3. 笔记：覆盖「更新/创建/名称/篇幅」四个维度各自可区分 ---------- */
  const notes = [
    // title, notebook, body(str 长度不同), pinned
    { t: `${TAG}-短`, nb: b1.id, body: '<p>短</p>', pin: 0 },
    { t: `${TAG}-中等篇幅`, nb: b1.id, body: `<p>${'中等'.repeat(30)}</p>`, pin: 1 },
    { t: `${TAG}-很长的一篇`, nb: b2.id, body: `<p>${'长文'.repeat(200)}</p><p>#标签甲 #标签乙</p>`, pin: 0 },
    { t: `${TAG}-带标签`, nb: b2.id, body: '<p>正文 #标签甲</p>', pin: 0 },
    { t: `${TAG}-子层里的`, nb: b3.id, body: '<p>子层</p><ul><li>条目一</li><li>条目二</li></ul>', pin: 0 },
    { t: `${TAG}-生活那本`, nb: b4.id, body: '<p>生活</p>', pin: 0 },
    { t: '', nb: b4.id, body: '<p>没有标题的一篇</p>', pin: 0 },
  ];
  const madeIds = [];
  for (const n of notes) {
    const r = await rpc('note.save', {
      id: '', notebookId: n.nb, title: n.t, body: n.body, pinned: n.pin, color: '', icon: '',
    });
    if (r.err) { console.log('  笔记失败:', n.t, r.err); continue; }
    madeIds.push(r.data.id);
  }
  // 让它有时间把 updatedAt 拉开差距（同一毫秒排序不稳）
  await p.waitForTimeout(1300);
  console.log('笔记:', madeIds.length, '篇');

  /* ---------- 4. 清单 + 待办 ---------- */
  const l1 = (await rpc('todo.list.add', { name: `${TAG}-清单甲`, color: '#b8623a' })).data;
  const l2 = (await rpc('todo.list.add', { name: `${TAG}-清单乙`, color: '#4a7396' })).data;
  const l2sub = (await rpc('todo.list.parent', { id: l2.id, parentId: l1.id }));
  if (l2sub.err) console.log('  清单层级失败:', l2sub.err);

  const today = new Date();
  const d = (off) => {
    const x = new Date(today.getTime() + off * 86400000);
    return x.toISOString().slice(0, 10);
  };

  // 四象限：重要×紧急 靠 priority + due 组合
  const todos = [
    // 重要且紧急：priority 2 + 今天到期
    { title: `${TAG}-重要且紧急`, due: d(0), priority: 2, listId: l1.id },
    // 重要不紧急：priority 2 + 远期
    { title: `${TAG}-重要不紧急`, due: d(20), priority: 2, listId: l1.id },
    // 紧急不重要：priority 0 + 今天
    { title: `${TAG}-紧急不重要`, due: d(0), priority: 0, listId: l2.id },
    // 不重要不紧急：priority 0 + 远期 / 无日期
    { title: `${TAG}-都不占`, due: '', priority: 0, listId: '' },
    // 逾期
    { title: `${TAG}-已经逾期`, due: d(-3), priority: 1, listId: l2.id },
    // 带重复
    { title: `${TAG}-每天重复`, due: d(0), priority: 1, listId: l1.id },
    // 带备注
    { title: `${TAG}-有备注`, due: d(2), priority: 1, listId: '' },
    // 未来
    { title: `${TAG}-下个月`, due: d(30), priority: 1, listId: l2.id },
  ];
  const todoIds = {};
  for (const t of todos) {
    const r = await rpc('todo.add', {
      title: t.title, due: t.due, dueTime: t.due ? '09:00' : '', priority: t.priority,
      note: t.title.includes('有备注') ? '这是备注内容' : '', listId: t.listId,
    });
    if (r.err) { console.log('  待办失败:', t.title, r.err); continue; }
    todoIds[t.title] = r.data.id;
  }
  const rep = await rpc('todo.repeat', { id: todoIds[`${TAG}-每天重复`], repeat: 'daily' });
  if (rep.err) console.log('  重复规则失败:', rep.err);

  // 已完成一条
  const doneOne = (await rpc('todo.add', { title: `${TAG}-已经完成`, due: d(-1), priority: 1, listId: l1.id })).data;
  await rpc('todo.update', { id: doneOne.id, done: 1 });
  // 已放弃一条
  const giveUp = (await rpc('todo.add', { title: `${TAG}-已经放弃`, due: d(-2), priority: 0, listId: '' })).data;
  await rpc('todo.trash', { id: giveUp.id, trashed: 1 });
  // 回收站一条
  const recycled = (await rpc('todo.add', { title: `${TAG}-进回收站`, due: '', priority: 0, listId: '' })).data;
  await rpc('todo.delete', { id: recycled.id });

  await p.waitForTimeout(600);

  /* ---------- 5. 摘要：两次跑必须完全一致 ---------- */
  const allTodos = (await rpc('todos.list', {})).data || [];
  const mine = allTodos.filter((t) => (t.title || '').startsWith(TAG));
  const lists = (await rpc('todo.lists', {})).data || [];
  const myLists = lists.filter((l) => (l.name || '').startsWith(TAG));
  const nbAll = (await rpc('notebooks.list', {})).data || [];
  const myBooks = nbAll.filter((l) => (l.name || '').startsWith(TAG));
  const nAll = (await rpc('notes.list', { notebookId: '', q: '' })).data || [];
  const myNotes = nAll.filter((r) => (r.title || '').startsWith(TAG) || (r.title === '' && madeIds.includes(r.id)));

  console.log('\n--- 种子摘要（两次基线跑必须一致） ---');
  console.log('笔记本', myBooks.length, ':', myBooks.map((x) => x.name).sort().join(' , '));
  console.log('笔记', myNotes.length, '篇；置顶', myNotes.filter((r) => r.pinned).length,
    '；字数合计', myNotes.reduce((s, r) => s + (r.chars || 0), 0));
  console.log('清单', myLists.length, ':', myLists.map((x) => x.name).sort().join(' , '));
  console.log('待办', mine.length, '条；已完成', mine.filter((t) => t.done).length,
    '；已放弃', mine.filter((t) => t.trashed).length);
  const rec = (await rpc('todos.recycle', {})).data || [];
  console.log('回收站', rec.filter((t) => (t.title || '').startsWith(TAG)).length, '条');

  await b.close();
})().catch((e) => { console.error('种子崩了:', e); process.exit(2); });