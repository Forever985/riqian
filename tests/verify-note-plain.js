/*
 * verify-note-plain.js —— 纯文本笔记的分段渲染
 *
 * 起因：用户那篇「第三季度工作复盘（草稿）」在库里存的是**没有任何标签的纯文本**
 * （`一、本季度完成情况\n1. ...\n\n二、存在的问题`）。
 * 旧实现把整篇包进一个 <p>，换行符被 CSS 折叠成空格，三节内容挤成一整片。
 *
 * 这个探针专门盯这条路径：不开编辑器、不改数据，直接按库里真实正文的长度造数据。
 */
const { chromium } = require('playwright-core');

let okN = 0, badN = 0;
const ok = (m, e) => { okN++; console.log(`  ✅ ${m}${e ? '  ' + e : ''}`); };
const bad = (m, e) => { badN++; console.log(`  ❌ ${m}${e ? '  ' + e : ''}`); };

const PLAIN = '一、本季度完成情况\n1. 项目排期按计划推进，关键节点均已交付；\n2. 与相关部门完成了两轮需求对齐，范围基本冻结；\n3. 遗留问题清单已同步，等待下周例会确认。\n\n二、存在的问题\n1. 部分环节沟通成本偏高，信息同步不够及时；\n2. 排期缓冲预留不足，遇到变更时调整空间有限。\n\n三、下季度计划\n1. 把月度复盘固定下来，减少临时对齐；\n2. 关键路径上的任务提前一周做风险预判。\n\n（待补充：数据部分、案例部分）';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57054'));
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  await p.waitForTimeout(1500);
  if (await p.evaluate(() => document.querySelectorAll('.mask').length)) {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
  }

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 88000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  await p.evaluate(() => localStorage.setItem('noteZen', '0'));

  const nb = await rpc('notebooks.list', {});
  const nbId = (nb.data || [])[0]?.id || '';
  const made = await rpc('note.save', {
    id: '', notebookId: nbId, title: '纯文本分段校验',
    body: PLAIN, pinned: 0, color: '', icon: '',
  });
  const noteId = made.data && made.data.id;

  /* ---------- 1. 库里存的必须是纯文本（复现真实数据形态） ---------- */
  console.log('\n=== 1. 数据形态 ===');
  const got = await rpc('note.get', { id: noteId });
  const saved = (got.data && got.data.body) || '';
  if (!/<[a-z][^>]*>/i.test(saved)) ok('库里存的是纯文本，与真实笔记一致');
  else bad('库里存成了 HTML，没复现出真实形态', saved.slice(0, 60));

  /* ---------- 2. 打开后必须拆成段落 ---------- */
  console.log('\n=== 2. 纯文本渲染成段落 ===');
  await p.click('.nav button[data-nav="today"]');
  await p.waitForTimeout(400);
  await p.click('.nav button[data-nav="notes"]');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const r = [...document.querySelectorAll('.nrow')].find((x) => (x.innerText || '').includes('纯文本分段校验'));
    if (r) r.click();
  });
  await p.waitForTimeout(1500);

  const dom = await p.evaluate(() => {
    const box = document.querySelector('.nbody');
    if (!box) return { err: 'no .nbody' };
    const ps = [...box.querySelectorAll(':scope > p')];
    return {
      pCount: ps.length,
      brCount: box.querySelectorAll('br').length,
      texts: ps.map((x) => (x.textContent || '').trim()).filter(Boolean).slice(0, 20),
      innerLen: box.innerHTML.length,
    };
  });
  console.log('  ' + JSON.stringify({ pCount: dom.pCount, brCount: dom.brCount, innerLen: dom.innerLen }));

  // 内容 14 行 → 应该是 14 个段落（4 个空行 → 空段落）
  if (dom.pCount >= 13) ok(`拆成 ${dom.pCount} 个段落（原来是 1 个）`);
  else bad(`只拆出 ${dom.pCount} 个段落，换行还是被吞了`);

  if (dom.texts.length && dom.texts[0] === '一、本季度完成情况') ok('首段是「一、本季度完成情况」');
  else bad('首段不对', JSON.stringify(dom.texts[0]));

  const hasSec2 = dom.texts.some((t) => t === '二、存在的问题');
  const hasSec3 = dom.texts.some((t) => t === '三、下季度计划');
  if (hasSec2 && hasSec3) ok('三个小节标题各自独立成段');
  else bad('小节标题没分开', JSON.stringify({ hasSec2, hasSec3 }));

  /* ---------- 3. 段落之间真的有间距 ---------- */
  console.log('\n=== 3. 段落间距 ===');
  const gap = await p.evaluate(() => {
    const ps = [...document.querySelectorAll('.nbody > p')].filter((x) => (x.textContent || '').trim());
    if (ps.length < 2) return null;
    const a = ps[0].getBoundingClientRect(), c = ps[1].getBoundingClientRect();
    const cs = getComputedStyle(ps[0]);
    return { gapPx: Math.round(c.top - a.bottom), mb: cs.marginBottom, lh: getComputedStyle(document.querySelector('.nbody')).lineHeight };
  });
  if (gap && gap.gapPx > 0) ok(`相邻段间隔 ${gap.gapPx}px（行高 ${gap.lh}，由用户「疏密」设置决定）`);
  else bad('段落之间没间距', JSON.stringify(gap));

  /* ---------- 4. 空行不被吞掉 ---------- */
  console.log('\n=== 4. 空行保留 ===');
  const empties = await p.evaluate(() =>
    [...document.querySelectorAll('.nbody > p')].filter((x) => !(x.textContent || '').trim()).length);
  if (empties >= 2) ok(`保留了 ${empties} 个空段落（原有两个空行）`);
  else bad(`空行被吞了，只剩 ${empties} 个`);

  /* ---------- 5. 转义：正文含尖括号不被当标签 ---------- */
  console.log('\n=== 5. 尖括号转义 ===');
  const made2 = await rpc('note.save', {
    id: '', notebookId: nbId, title: '转义校验',
    body: '条件是 a < b 且 c > d\n第二行 & 符号', pinned: 0, color: '', icon: '',
  });
  const id2 = made2.data && made2.data.id;
  await p.click('.nav button[data-nav="today"]');
  await p.waitForTimeout(400);
  await p.click('.nav button[data-nav="notes"]');
  await p.waitForTimeout(1400);
  await p.evaluate(() => {
    const r = [...document.querySelectorAll('.nrow')].find((x) => (x.innerText || '').includes('转义校验'));
    if (r) r.click();
  });
  await p.waitForTimeout(1400);
  const esc = await p.evaluate(() => {
    const box = document.querySelector('.nbody');
    const t = box ? box.textContent || '' : '';
    return { txt: t.trim().slice(0, 40), p: box ? box.querySelectorAll(':scope > p').length : 0, html: box ? box.innerHTML.slice(0, 80) : '' };
  });
  console.log('  ' + JSON.stringify(esc));
  if (esc.txt.includes('a < b') && esc.txt.includes('c > d')) ok('「a < b」原样显示，没被当成标签吃掉');
  else bad('尖括号内容被破坏', esc.txt);
  if (esc.p === 2) ok('两行拆成 2 段');
  else bad(`拆成 ${esc.p} 段`);

  /* ---------- 6. 收尾 ---------- */
  console.log('\n=== 6. 清理与错误 ===');
  const d1 = await rpc('note.delete', { id: noteId });
  const d2 = await rpc('note.delete', { id: id2 });
  if (d1.ok && d2.ok) ok('测试笔记已删除');
  else bad('清理失败', JSON.stringify({ d1, d2 }));

  if (!errs.length) ok('控制台无错误'); else bad('有错误', JSON.stringify(errs.slice(0, 3)));

  console.log('\n========================================');
  console.log(`  通过 ${okN} 项，失败 ${badN} 项`);
  console.log('========================================');
  await b.close();
  process.exit(badN ? 1 : 0);
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });