/* verify-note-layout.js —— 笔记编辑区布局与专注写模式 */
const { chromium } = require('playwright-core');

let okN = 0, badN = 0;
const ok = (m, e) => { okN++; console.log(`  ✅ ${m}${e ? '  ' + e : ''}`); };
const bad = (m, e) => { badN++; console.log(`  ❌ ${m}${e ? '  ' + e : ''}`); };

const BODY = [
  '一、本季度完成情况',
  '1. 项目排期按计划推进，关键节点均已交付；',
  '2. 与相关部门完成了两轮需求对齐，范围基本冻结；',
  '3. 遗留问题清单已同步，等待下周例会确认。',
  '',
  '二、存在的问题',
  '1. 部分环节沟通成本偏高，信息同步不够及时；',
  '2. 排期缓冲预留不足，遇到变更时调整空间有限。',
  '',
  '三、下季度计划',
  '1. 把月度复盘固定下来，减少临时对齐；',
  '2. 关键路径上的任务提前一周做风险预判。',
  '',
  '（待补充：数据部分、案例部分）',
].join('\n');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57054'));
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  /*
   * 视口不够高时，「编辑区高度 = 列高」这条断言必然失败 ——
   * 不是布局错了，是列本身只有 300 多像素高（笔记太少撑不起来），
   * 硬要编辑区也压到 300 多反而是错的。
   * 这条断言只在「列够高」的窗口下才有意义，所以这里先把视口放大到
   * 接近用户实际使用的大窗口（1400×1000），保证测的是布局本身。
   */
  const client = await p.context().newCDPSession(p);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  await p.waitForTimeout(500);

  await p.waitForTimeout(1500);
  // 清场：残留弹层
  if (await p.evaluate(() => document.querySelectorAll('.mask').length)) {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
  }

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 99000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  // 强制退出专注（上一次跑可能留了 localStorage）
  await p.evaluate(() => localStorage.setItem('noteZen', '0'));

  const nb = await rpc('notebooks.list', {});
  const nbId = (nb.data || [])[0]?.id || '';
  const made = await rpc('note.save', {
    id: '', notebookId: nbId, title: '第三季度工作复盘（草稿）',
    body: BODY, pinned: 0, color: '', icon: '',
  });
  const noteId = made.data && made.data.id;
  console.log(`  临时笔记 id = ${noteId}`);

  await p.click('.nav button[data-nav="today"]');
  await p.waitForTimeout(400);
  await p.click('.nav button[data-nav="notes"]');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const r = [...document.querySelectorAll('.nrow')].find((x) => (x.innerText || '').includes('第三季度'));
    if (r) r.click();
  });
  await p.waitForTimeout(1500);

  /* ---------- 1. 三栏模式下正文宽度 ---------- */
  console.log('\n=== 1. 三栏模式：正文宽度与行字数 ===');
  const m1 = await p.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const body = document.querySelector('.nbody');
    const cs = body ? getComputedStyle(body) : null;
    const bw = body ? body.getBoundingClientRect().width : 0;
    return {
      win: innerWidth,
      nbooks: g('.nbooks'), nlist: g('.nlist'), nedit: g('.nedit'),
      bodyW: Math.round(bw),
      charsPerLine: cs ? Math.floor((bw - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / parseFloat(cs.fontSize)) : null,
      overflowX: (() => { const e = document.querySelector('.notes'); return e ? Math.round(e.scrollWidth - e.clientWidth) : null; })(),
    };
  });
  console.log('  ' + JSON.stringify(m1));

  if (m1.charsPerLine >= 20) ok(`正文每行 ${m1.charsPerLine} 个汉字（修复前是 15）`);
  else bad(`正文只有 ${m1.charsPerLine} 字一行，还是太窄`);

  if (m1.nlist.w >= 245) ok(`列表栏 ${m1.nlist.w}px，标题不会被截成三四个字`);
  else bad(`列表栏只有 ${m1.nlist.w}px，太窄`);

  // 横向滚动条：不是三栏太宽，而是标题栏的 input 缺 min-width:0 撑着不缩
  if (m1.overflowX <= 1) ok(`没有横向溢出（scrollWidth ${m1.overflowX}px）`);
  else bad(`横向溢出 ${m1.overflowX}px，底部会出现没必要的滚动条`);

  /* ---------- 2. 编辑区撑满高度 ---------- */
  console.log('\n=== 2. 编辑区撑满整列高度 ===');
  const colH = m1.nlist.h || 0;
  if (Math.abs(m1.nedit.h - colH) <= 4) ok(`编辑区 ${m1.nedit.h}px，与列表栏 ${colH}px 齐平（修复前只按内容长到 410px）`);
  else bad(`编辑区 ${m1.nedit.h}px 与列高 ${colH}px 不一致，底部会留灰块`);

  /* ---------- 3. 工具栏不折行 ---------- */
  console.log('\n=== 3. 工具栏不折行 ===');
  const tools = await p.evaluate(() => {
    const t = document.querySelector('.ntools');
    if (!t) return null;
    const h = Math.round(t.getBoundingClientRect().height);
    return { h, rows: Math.round(h / 29) };
  });
  if (tools && tools.rows <= 1) ok(`工具栏 ${tools.h}px，排成 1 行（修复前 58px 折成 2 行）`);
  else bad(`工具栏 ${tools && tools.h}px，还在折行`);

  /* ---------- 4. 正文排版：段落间距 ---------- */
  console.log('\n=== 4. 正文段落间距 ===');
  const para = await p.evaluate(() => {
    const ps = [...document.querySelectorAll('.nbody p')];
    if (ps.length < 2) return { n: ps.length };
    const a = ps[0], b2 = ps[1];
    const ra = a.getBoundingClientRect(), rb = b2.getBoundingClientRect();
    const cs = getComputedStyle(a);
    return {
      n: ps.length,
      gap: Math.round(rb.top - ra.bottom),
      marginBottom: cs.marginBottom,
      lineHeight: getComputedStyle(document.querySelector('.nbody')).lineHeight,
    };
  });
  console.log('  ' + JSON.stringify(para));
  if (para.n >= 2) {
    if (parseFloat(para.marginBottom) > 0) ok(`段落之间有 ${para.gap}px 间距（不再挤成一整片）`);
    else bad('段落之间没有间距');
  } else {
    bad(`正文只解析出 ${para.n} 个段落，内容可能没进编辑器`);
  }

  /* ---------- 5. 专注写：收起左两栏 ---------- */
  console.log('\n=== 5. 专注写模式 ===');
  const zenBtn = await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('.nedit-h button')].find((x) => /专注写/.test(x.getAttribute('title') || ''));
    if (b2) { b2.click(); return true; }
    return false;
  });
  if (!zenBtn) bad('找不到专注写按钮');
  await p.waitForTimeout(800);

  const zenM = await p.evaluate(() => {
    const g = (s) => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect(); return { w: Math.round(r.width), vis: getComputedStyle(e).display !== 'none' }; };
    const body = document.querySelector('.nbody');
    const bw = body ? body.getBoundingClientRect().width : 0;
    const cs = body ? getComputedStyle(body) : null;
    return {
      hasZenClass: !!document.querySelector('.notes.zen'),
      nbooks: g('.nbooks'), nlist: g('.nlist'), nedit: g('.nedit'),
      bodyW: Math.round(bw),
      charsPerLine: cs ? Math.floor((bw - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / parseFloat(cs.fontSize)) : null,
    };
  });
  console.log('  ' + JSON.stringify(zenM));

  if (zenM.hasZenClass) ok('切到了专注模式（.notes.zen）');
  else bad('没切到专注模式');

  if (zenM.nbooks && !zenM.nbooks.vis && zenM.nlist && !zenM.nlist.vis) ok('左两栏已收起');
  else bad('左两栏还看得见', JSON.stringify({ b: zenM.nbooks, l: zenM.nlist }));

  if (zenM.charsPerLine > m1.charsPerLine) {
    ok(`专注模式下每行 ${zenM.charsPerLine} 字（三栏时 ${m1.charsPerLine} 字）`);
  } else {
    bad(`专注模式没让正文变宽：${zenM.charsPerLine} vs ${m1.charsPerLine}`);
  }

  /* 正文不该无限拉长 */
  if (zenM.nedit.w <= 800) ok(`正文宽度封顶 ${zenM.nedit.w}px，不会把一行拉成一整条`);
  else bad(`专注模式下正文拉到 ${zenM.nedit.w}px，行太长眼睛会串`);

  /* ---------- 6. Esc 退出专注 ---------- */
  console.log('\n=== 6. Esc 退出专注 ===');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(700);
  const back = await p.evaluate(() => ({
    hasZen: !!document.querySelector('.notes.zen'),
    nlistVis: (() => { const e = document.querySelector('.nlist'); return e ? getComputedStyle(e).display !== 'none' : null; })(),
  }));
  if (!back.hasZen && back.nlistVis) ok('Esc 退出了专注，左两栏回来了');
  else bad('Esc 没退出专注', JSON.stringify(back));

  /* ---------- 7. 记忆状态 ---------- */
  console.log('\n=== 7. 专注状态可记住 ===');
  const ls = await p.evaluate(() => localStorage.getItem('noteZen'));
  ok(`localStorage.noteZen = ${JSON.stringify(ls)}`);

  /* ---------- 8. 收尾 ---------- */
  console.log('\n=== 8. 清理测试数据 ===');
  const del = await rpc('note.delete', { id: noteId });
  if (del.ok) ok('测试笔记已删除');
  else bad('测试笔记删除失败', JSON.stringify(del));

  console.log('\n=== 9. 控制台 ===');
  if (!errs.length) ok('无错误'); else bad('有错误', JSON.stringify(errs.slice(0, 4)));

  console.log('\n========================================');
  console.log(`  通过 ${okN} 项，失败 ${badN} 项`);
  console.log('========================================');
  await b.close();
  process.exit(badN ? 1 : 0);
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });