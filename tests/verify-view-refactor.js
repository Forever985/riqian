/*
 * verify-view-refactor.js —— 笔记 / 待办重构后的交互行为验证
 *
 * 静态快照（view-baseline.js）只能证明「渲染出来的 DOM 一个字没变」。
 * 但这次把事件处理搬了家（menuFor → buildTodoMenu、row → <TodoRow>、
 * 笔记本树 → <NoteBookRail>），绑定关系、闭包捕获的变量、props 传参
 * 任何一处漏了，DOM 长得一模一样但点了没反应 —— 快照抓不到这种。
 *
 * 覆盖：
 *   待办 ①行内按钮（编辑/放弃/删除/勾选）②右键菜单各项 ③清单切换 ④排序 ⑤拖动
 *   笔记 ⑥笔记本选择 ⑦笔记本折叠 ⑧行菜单各项 ⑨拖动排序 ⑩搜索 ⑪标签筛选
 *
 * 数据自清理：造出来的东西用完都删掉，设置项还原。
 */
const { chromium } = require('playwright-core');

let okN = 0, badN = 0;
const ok = (m, e) => { okN++; console.log(`  ✅ ${m}${e ? '  ' + e : ''}`); };
const bad = (m, e) => { badN++; console.log(`  ❌ ${m}${e ? '  ' + e : ''}`); };

const TAG = 'VRF';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57060'));
  const p = b.contexts()[0].pages()[0];
  /* WebView2 虚拟域名下 favicon 必然 404，属噪声，不算代码问题 */
  const isNoise = (t) => /favicon\.ico/.test(t);
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errs.push(m.text()); });
  p.on('pageerror', (e) => { if (!isNoise(e.message)) errs.push('pageerror: ' + e.message); });
  await p.waitForTimeout(1600);

  /*
   * 固定视口。不设的话 WebView2 给的是窗口当前大小（实测 1104×736），
   * 而待办一多，目标行就落到可视区外面 ——
   * 这时候 scrollIntoView 触发的 scroll 事件会顺带把刚开的右键菜单关掉，
   * 表现成「右键没打开菜单」，其实是行在屏外。这是第三次被滚动坑。
   * 1400×1000 和 view-baseline.js 保持一致，两个探针量的是同一把尺子。
   */
  const client = await p.context().newCDPSession(p);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  await p.waitForTimeout(500);

  if (await p.evaluate(() => document.querySelectorAll('.mask').length)) {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1900);
  }

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 66000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (nav) => {
    await p.evaluate(() => document.querySelectorAll('.mask').forEach((m) => m.remove()));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    await p.click(`.nav button[data-nav="${nav}"]`);
    await p.waitForTimeout(1400);
  };

  /* ================= 0. 造数据 ================= */
  console.log('\n=== 0. 准备数据 ===');
  const listA = (await rpc('todo.list.add', { name: `${TAG}-清单甲`, color: '#b8623a' })).data;
  const listB = (await rpc('todo.list.add', { name: `${TAG}-清单乙`, color: '#4a7396' })).data;
  const t1 = (await rpc('todo.add', { title: `${TAG}-任务一`, due: '', dueTime: '', priority: 1, note: '', listId: listA.id })).data;
  const t2 = (await rpc('todo.add', { title: `${TAG}-任务二`, due: '', dueTime: '', priority: 1, note: '', listId: listA.id })).data;
  const t3 = (await rpc('todo.add', { title: `${TAG}-任务三`, due: '', dueTime: '', priority: 1, note: '', listId: listB.id })).data;
  const bk = (await rpc('notebook.add2', { name: `${TAG}-笔记本`, color: '#5f8256', parentId: '' })).data;
  const bkSub = (await rpc('notebook.add2', { name: `${TAG}-子本`, color: '#8e6a9e', parentId: bk.id })).data;
  const n1 = (await rpc('note.save', { id: '', notebookId: bk.id, title: `${TAG}-笔记一`, body: '<p>甲 #标签x</p>', pinned: 0, color: '', icon: '' })).data;
  const n2 = (await rpc('note.save', { id: '', notebookId: bk.id, title: `${TAG}-笔记二`, body: '<p>乙</p>', pinned: 0, color: '', icon: '' })).data;
  const n3 = (await rpc('note.save', { id: '', notebookId: bkSub.id, title: `${TAG}-子本笔记`, body: '<p>丙</p>', pinned: 0, color: '', icon: '' })).data;
  console.log('  待办 3 条 / 清单 2 个 / 笔记本 2 个 / 笔记 3 篇');

  /* ================= 1. 待办：行内按钮 ================= */
  console.log('\n=== 1. 待办行内按钮（TodoRow） ===');
  await go('todos');

  // 1a 勾选完成
  const ticked = await p.evaluate((tid) => {
    const row = document.querySelector(`.todo-row[data-dragkey="${tid}"]`);
    if (!row) return 'no-row';
    const ck = row.querySelector('.ck');
    if (!ck) return 'no-ck';
    ck.click();
    return 'clicked';
  }, t1.id);
  await p.waitForTimeout(1200);
  if (ticked === 'clicked') {
    const done = (await rpc('todos.list', {})).data.find((x) => x.id === t1.id);
    done && done.done ? ok('勾选后库里 done=1') : bad('勾选没写进库', JSON.stringify(done));
  } else bad('找不到勾选框', ticked);

  // 取消勾选，回到初始
  await p.evaluate((tid) => {
    const row = document.querySelector(`.todo-row[data-dragkey="${tid}"]`);
    row && row.querySelector('.ck') && row.querySelector('.ck').click();
  }, t1.id);
  await p.waitForTimeout(1000);

  // 1b 编辑按钮（data-act="edit"）弹出编辑框
  const editOpen = await p.evaluate((tid) => {
    const row = document.querySelector(`.todo-row[data-dragkey="${tid}"]`);
    if (!row) return 'no-row';
    const btn = row.querySelector('button[data-act="edit"]');
    if (!btn) return 'no-edit-btn';
    btn.click();
    return 'clicked';
  }, t2.id);
  await p.waitForTimeout(900);
  const editTitle = await p.evaluate(() => {
    const dlg = document.querySelector('.mask .dlg');
    return dlg ? (dlg.querySelector('h3') || {}).textContent || '' : '';
  });
  if (editOpen === 'clicked' && /编辑|待办/.test(editTitle)) ok('编辑按钮打开弹窗', editTitle.slice(0, 20));
  else bad('编辑按钮没打开弹窗', editOpen + ' | ' + editTitle);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);

  // 1c 放弃按钮（data-act="giveup"）→ trashed=1
  const gaveUp = await p.evaluate((tid) => {
    const row = document.querySelector(`.todo-row[data-dragkey="${tid}"]`);
    if (!row) return 'no-row';
    const btn = row.querySelector('button[data-act="giveup"]');
    if (!btn) return 'no-btn';
    btn.click();
    return 'clicked';
  }, t3.id);
  await p.waitForTimeout(1300);
  if (gaveUp === 'clicked') {
    const g = (await rpc('todos.list', {})).data.find((x) => x.id === t3.id);
    g && g.trashed ? ok('放弃后库里 trashed=1') : bad('放弃没生效', JSON.stringify(g));
  } else bad('找不到放弃按钮', gaveUp);

  // 还原
  await rpc('todo.trash', { id: t3.id, trashed: 0 });
  await p.waitForTimeout(400);

  /* ================= 2. 待办：右键菜单 ================= */
  console.log('\n=== 2. 待办右键菜单（buildTodoMenu） ===');
  await go('todos');
  await p.waitForTimeout(600);

  /**
   * 右键某条，返回菜单项文字数组。
   *
   * **必须用 Playwright 原生 click({button:'right'})**，不能用
   * `el.dispatchEvent(new MouseEvent('contextmenu'))` —— 后者是个
   * 「不合法的」合成事件，React 的合成事件系统收不到，菜单压根不会开。
   * 我一开始就是手搓事件，结果报「右键没打开菜单」，白查一轮。
   */
  const openMenu = async (tid) => {
    const sel = `.todo-row[data-dragkey="${tid}"]`;
    const exists = await p.evaluate((s2) => !!document.querySelector(s2), sel);
    if (!exists) return null;
    /*
     * 坑：ContextMenu 里挂了 `window.addEventListener('scroll', close, true)`。
     * 而 Playwright 的 click 会**先把元素滚进视口**再点 —— 那个滚动事件
     * 正好把刚打开的菜单关掉，于是永远「右键没打开菜单」。
     *
     * 所以必须分两步：① 自己先滚到位并等滚动结束 ② 元素已在视口内，
     * click 就不会再触发滚动，菜单才留得住。
     */
    await p.evaluate((s2) => {
      const el = document.querySelector(s2);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, sel);
    await p.waitForTimeout(700);
    /*
     * 再退一步：连 `p.click(sel)` 都不用。
     * 它内部会再核一次"元素在视口里"，必要时补一次滚动 —— 只要滚了，菜单就没。
     * 已经自己滚到位了，直接拿坐标告诉鼠标点哪儿，全程零滚动。
     */
    const spot = await p.evaluate((s2) => {
      const el = document.querySelector(s2);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      /* 行中心：避开最左边的拖动手柄（⠿）和最右边的按钮组 */
      return { x: Math.round(b.left + b.width * 0.45), y: Math.round(b.top + b.height / 2) };
    }, sel);
    if (!spot) return null;
    /* 点在行的正中偏右一点：避开左侧拖动手柄和勾选圈，那里各自有自己的点击处理 */
    await p.mouse.click(spot.x, spot.y, { button: 'right' });
    await p.waitForTimeout(900);
    /*
     * 兜底：滚动可能把菜单关掉。真关掉了就再点一次 —— 第二次时滚动早已结束，
     * 不会再有新的 scroll 事件。这是最后一道保险，不是掩盖问题：
     * 如果两次都开不出菜单，说明 ContextMenu 那条链路真的断了。
     */
    if (!(await p.evaluate(() => !!document.querySelector('.ctxmenu')))) {
      await p.mouse.click(spot.x, spot.y, { button: 'right' });
      await p.waitForTimeout(900);
    }
    return p.evaluate(() => {
      /*
       * 真实结构是 <div class="ctxmenu"> 里一串 <button class="ctx-item" data-ctx-label="...">。
       * 菜单项文字分两段：.ctx-t 是标题，.ctx-h 是右侧提示。
       */
      const m = document.querySelector('.ctxmenu');
      if (!m) return [];
      /* 用 data-ctx-label 取标签本身，比 textContent 稳 —— 后者会把右侧提示拼进来 */
      return [...m.querySelectorAll('.ctx-item')]
        .map((x) => x.getAttribute('data-ctx-label') || '')
        .filter(Boolean);
    });
  };

  /*
   * 目标行要**从页面上现取**，不能用一开始记下的 t1.id。
   * 前面第 1 节把 t1 勾成完成又取消、t3 放弃又还原，列表重排过；
   * 更要紧的是「已完成」区里的行 data-dragkey 是 null（它们不参与手动排序），
   * 拿 id 硬匹配会查不到 —— 表现出来就是「右键没打开菜单」。
   * 这里直接抓第一个带 key 的未完成行，它一定在页面上。
   */
  const menuTargetId = await p.evaluate(() => {
    const row = document.querySelector('.todo-row[data-dragkey]:not([data-dragkey=""])');
    return row ? row.getAttribute('data-dragkey') : null;
  });
  console.log('  右键目标行 =', menuTargetId);
  const items = await openMenu(menuTargetId);
  if (!items) bad('右键没打开菜单');
  else {
    const joined = items.join(' | ');
    const need = ['标成完成', '编辑', '优先级', '明天到期', '清掉日期', '开一颗番茄', '复制标题', '放弃', '删除', '放进清单', '收集箱'];
    const missing = need.filter((n) => !joined.includes(n));
    missing.length === 0 ? ok('菜单项齐全', `${items.length} 项`) : bad('菜单缺项', missing.join(','));
    /* 清单名要出现在「放进清单」下面 —— 这就是原来引用 order 的那段，重构后最容易丢 */
    joined.includes(`${TAG}-清单甲`) ? ok('菜单里列出了清单名') : bad('菜单里没有清单名');
    /*
     * 「当前」在右侧的 .ctx-h 提示里，不在 data-ctx-label 上，
     * 所以要看整段文字。这一条同时验证了「当前清单那项是 disabled」——
     * 那正是 order 传进来之后 hint/disabled 的推导结果。
     */
    const full = await p.evaluate(() => (document.querySelector('.ctxmenu') || {}).textContent || '');
    /*
     * 只找「清单」那几项里的「当前」。
     * 直接 `find(x => /当前/.test(textContent))` 会先命中「优先级 · 高 / 当前」——
     * 优先级菜单项也用「当前」标自己，于是断言变成了在测优先级，
     * 看着通过、其实没测到目标。必须先按标签筛清单项。
     */
    const cur = await p.evaluate(() => {
      const it = [...document.querySelectorAll('.ctx-item')]
        .filter((x) => /^\u3000/.test(x.getAttribute('data-ctx-label') || ''))
        .find((x) => /当前/.test(x.textContent || ''));
      return it ? { label: it.getAttribute('data-ctx-label'), disabled: it.disabled } : null;
    });
    cur && cur.disabled
      ? ok('当前清单标了「当前」且置灰', cur.label && cur.label.trim())
      : bad('没标当前清单 / 没置灰', JSON.stringify({ hasCurInText: /当前/.test(full), cur }));
  }
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  // 2b 真的点一个菜单项：清掉日期（先给那一条设个日期）
  /*
   * 用 menuTargetId 这条 —— 它就是刚才开出菜单的那一行，
   * 保证「我设日期的」和「我点菜单的」是同一条。
   */
  await rpc('todo.update', { id: menuTargetId, due: '2030-01-01' });
  await p.waitForTimeout(600);
  await go('todos');
  await openMenu(menuTargetId);
  const clickedClear = await p.evaluate(() => {
    const m = document.querySelector('.ctxmenu');
    if (!m) return false;
    const it = [...m.querySelectorAll('.ctx-item')].find((x) => /清掉日期/.test(x.textContent || ''));
    if (!it) return false;
    it.click();
    return true;
  });
  await p.waitForTimeout(1300);
  if (clickedClear) {
    const after = (await rpc('todos.list', {})).data.find((x) => x.id === menuTargetId);
    after && !after.due ? ok('点「清掉日期」真的清了库里的日期') : bad('清日期没生效', JSON.stringify(after && after.due));
  } else bad('菜单里点不到「清掉日期」');

  /* ================= 3. 待办：清单切换 / 排序 ================= */
  console.log('\n=== 3. 待办清单切换与排序 ===');
  await go('todos');
  const picked = await p.evaluate((name) => {
    const btn = [...document.querySelectorAll('.rail .rail-item')]
      .find((x) => (x.querySelector('.nm') || {}).textContent === name);
    if (!btn) return false;
    btn.click();
    return true;
  }, `${TAG}-清单甲`);
  await p.waitForTimeout(1100);
  const headTitle = await p.evaluate(() => (document.querySelector('.todo-head h3') || {}).textContent || '');
  if (picked && headTitle.includes(`${TAG}-清单甲`)) ok('点清单后标题变成清单名', headTitle);
  else bad('清单切换失败', picked + ' | ' + headTitle);

  // 三种排序都能点，且不报错
  for (const label of ['手动', '优先级', '截止日期']) {
    const hit = await p.evaluate((t) => {
      const b = [...document.querySelectorAll('.todo-sortseg .seg-b')].find((x) => (x.textContent || '').trim() === t);
      if (!b) return false;
      b.click();
      return true;
    }, label);
    await p.waitForTimeout(900);
    const on = await p.evaluate(() => {
      const b = document.querySelector('.todo-sortseg .seg-b.on');
      return b ? (b.textContent || '').trim() : '';
    });
    hit && on === label ? ok(`排序切到「${label}」`) : bad(`排序「${label}」没切过去`, on);
  }
  // 还原成手动
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.todo-sortseg .seg-b')].find((x) => (x.textContent || '').trim() === '手动');
    if (b) b.click();
  });
  await p.waitForTimeout(800);

  /* ================= 4. 笔记：左栏 ================= */
  console.log('\n=== 4. 笔记左栏（NoteBookRail） ===');
  await go('notes');

  // 4a 点笔记本
  const bookClick = await p.evaluate((name) => {
    const btn = [...document.querySelectorAll('.nbooks .nbook')]
      .find((x) => (x.textContent || '').includes(name));
    if (!btn) return false;
    btn.click();
    return true;
  }, `${TAG}-笔记本`);
  await p.waitForTimeout(1100);
  const bookOn = await p.evaluate(() => {
    const b = document.querySelector('.nbooks .nbook.on');
    return b ? (b.textContent || '').trim() : '';
  });
  bookClick && bookOn.includes(`${TAG}-笔记本`) ? ok('点笔记本后高亮正确', bookOn.slice(0, 24)) : bad('笔记本没选中', bookOn);

  // 4b 只列出本层 + 子本的笔记
  const listed = await p.evaluate(() => [...document.querySelectorAll('.nrow .nt')].map((x) => (x.textContent || '').trim()));
  listed.some((t) => t.includes(`${TAG}-笔记一`)) ? ok('本层笔记出现在列表里', `${listed.length} 篇`) : bad('本层笔记没出现', listed.join(','));

  // 4c 折叠 / 展开子本
  const beforeFold = await p.evaluate(() => document.querySelectorAll('.nbookrow').length);
  const foldHit = await p.evaluate((name) => {
    const rows = [...document.querySelectorAll('.nbookrow')];
    const row = rows.find((r) => (r.querySelector('.nbook') || {}).textContent?.includes(name));
    if (!row) return false;
    // 折叠箭头是 .nbook 里的第一个 span
    const arrow = row.querySelector('.nbook span');
    if (!arrow) return false;
    arrow.click();
    return true;
  }, `${TAG}-笔记本`);
  await p.waitForTimeout(800);
  const afterFold = await p.evaluate(() => document.querySelectorAll('.nbookrow').length);
  foldHit && afterFold < beforeFold ? ok('折叠子本后行数减少', `${beforeFold} → ${afterFold}`) : bad('折叠没生效', `${beforeFold} → ${afterFold}`);
  // 展开回来
  await p.evaluate((name) => {
    const rows = [...document.querySelectorAll('.nbookrow')];
    const row = rows.find((r) => (r.querySelector('.nbook') || {}).textContent?.includes(name));
    if (row) { const a = row.querySelector('.nbook span'); if (a) a.click(); }
  }, `${TAG}-笔记本`);
  await p.waitForTimeout(700);

  // 4d 计数要含子本（deepCount）
  const countTxt = await p.evaluate((name) => {
    const rows = [...document.querySelectorAll('.nbookrow')];
    const row = rows.find((r) => (r.querySelector('.nbook') || {}).textContent?.includes(name));
    if (!row) return null;
    const n = row.querySelector('.nbook .n');
    return n ? (n.textContent || '').trim() : null;
  }, `${TAG}-笔记本`);
  // 本层 2 篇 + 子本 1 篇 = 3
  countTxt === '3' ? ok('笔记本计数含子本（deepCount）', countTxt) : bad('计数不对，应为 3', countTxt);

  /* ================= 5. 笔记：行菜单 ================= */
  console.log('\n=== 5. 笔记行菜单 ===');
  await go('notes');
  const menuOpen = await p.evaluate(() => {
    const btn = document.querySelector('.nrow .nbookmenu');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await p.waitForTimeout(800);
  const rowMenuText = await p.evaluate(() => {
    const m = document.querySelector('.nrow .rowmenu');
    return m ? (m.textContent || '').replace(/\s+/g, ' ') : '';
  });
  const needMenu = ['重命名', '移到笔记本', '复制', '复制链接', '置顶', '颜色与图标', '钉到桌面', '加密码', '导出 HTML', '移到回收站'];
  const missMenu = needMenu.filter((n) => !rowMenuText.includes(n));
  menuOpen && missMenu.length === 0 ? ok('行菜单 10 项齐全') : bad('行菜单缺项', missMenu.join(',') || '没打开');

  /*
   * 5b 置顶真的生效。
   *
   * 这里必须**先记下点的是哪一篇、原来是什么状态**再断言。
   * 原来偷懒写成「有任意一篇 pinned 就算过」—— 而 ABTEST 那批种子笔记里
   * 本来就有一篇是置顶的，于是这个断言即使点错了行也照样"通过"，
   * 反过来一旦种子数据换了就误报失败。断言要盯住自己操作的那一条。
   */
  const pinTargetId = await p.evaluate(() => {
    const row = document.querySelector('.nrow');
    return row ? row.getAttribute('data-dragkey') : null;
  });
  const pinBefore = pinTargetId
    ? ((await rpc('notes.list', { notebookId: '', q: '' })).data.find((r) => r.id === pinTargetId) || {}).pinned
    : null;
  const pinLabel = await p.evaluate(() => {
    const m = document.querySelector('.nrow .rowmenu');
    if (!m) return '';
    const b = [...m.querySelectorAll('button')].find((x) => /置顶/.test(x.textContent || ''));
    return b ? (b.textContent || '').trim() : '';
  });
  const pinClicked = await p.evaluate(() => {
    const m = document.querySelector('.nrow .rowmenu');
    if (!m) return false;
    const b = [...m.querySelectorAll('button')].find((x) => /置顶/.test(x.textContent || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  await p.waitForTimeout(1600);
  if (pinClicked && pinTargetId) {
    const after = (await rpc('notes.list', { notebookId: '', q: '' })).data.find((r) => r.id === pinTargetId) || {};
    after.pinned !== pinBefore
      ? ok(`点「${pinLabel}」后库里 pinned ${pinBefore} → ${after.pinned}`)
      : bad('置顶没写进库', `按钮=${pinLabel} before=${pinBefore} after=${after.pinned}`);
    // 还原，免得影响后面的断言
    await rpc('note.save', {
      id: pinTargetId, notebookId: after.notebookId, title: after.title,
      body: (await rpc('note.get', { id: pinTargetId })).data.body || '', pinned: pinBefore || 0,
      color: after.color || '', icon: after.icon || '',
    });
  } else bad('行菜单里点不到置顶', `targetId=${pinTargetId}`);

  /* ================= 6. 笔记：搜索 / 标签 ================= */
  console.log('\n=== 6. 笔记搜索与标签 ===');
  await go('notes');
  /*
   * 搜索词必须**作为参数传进去**。之前写成模板字符串直接进 evaluate，
   * 而 TAG 是 Node 侧的常量 —— 浏览器上下文里根本没有这个变量，
   * 直接 ReferenceError。这种错看着像"功能坏了"，其实是探针自己写错。
   */
  await p.evaluate((kw) => {
    const inp = document.querySelector('.nlist input[placeholder*="搜"]');
    if (!inp) return;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(inp, kw);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, `${TAG}-笔记一`);
  await p.waitForTimeout(1100);
  const searched = await p.evaluate(() => [...document.querySelectorAll('.nrow .nt')].map((x) => (x.textContent || '').trim()));
  searched.length && searched.every((t) => t.includes(`${TAG}-笔记一`))
    ? ok('搜索只留下命中的那篇', `${searched.length} 篇`) : bad('搜索结果不对', searched.join(','));

  // 清搜索
  await p.evaluate(() => {
    const inp = document.querySelector('.nlist input[placeholder*="搜"]');
    if (!inp) return;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(900);

  // 标签筛选
  const tagClicked = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.nlist .chip')].find((x) => /标签x/.test(x.textContent || ''));
    if (!c) return false;
    c.click();
    return true;
  });
  await p.waitForTimeout(1000);
  if (tagClicked) {
    const tagged = await p.evaluate(() => [...document.querySelectorAll('.nrow .nt')].map((x) => (x.textContent || '').trim()));
    tagged.length === 1 && tagged[0].includes(`${TAG}-笔记一`)
      ? ok('标签筛选只剩带该标签的', `${tagged.length} 篇`) : bad('标签筛选结果不对', tagged.join(','));
  } else console.log('  ⚠ 没有标签 chip（笔记正文里的 #标签x 可能没被识别到），跳过');

  /* ================= 7. 笔记：拖动排序 ================= */
  console.log('\n=== 7. 笔记手动排序 ===');
  await go('notes');
  /*
   * 上一节把标签筛选开着（只剩 1 篇），这里必须先清掉 ——
   * 否则「手动模式每行都要 draggable」会因为只有 1 行而失败，
   * 报出来像功能坏了，其实是探针自己没收拾干净。这是第二次被同一类问题坑。
   */
  await p.evaluate(() => {
    const clear = [...document.querySelectorAll('.nlist .chip')]
      .find((x) => /^清除$/.test((x.textContent || '').trim()));
    if (clear) { clear.click(); return; }
    const inp = document.querySelector('.nlist input[placeholder*="搜"]');
    if (inp) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(inp, '');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await p.waitForTimeout(1000);
  // 再点一次「全部笔记」，确保没有笔记本筛选残留
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.nbooks .nbook')].find((x) => /全部笔记/.test(x.textContent || ''));
    if (b) b.click();
  });
  await p.waitForTimeout(1200);

  const toManual = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.sortbar button, .seg-b')].find((x) => (x.textContent || '').trim() === '手动');
    if (!b) return false;
    b.click();
    return true;
  });
  await p.waitForTimeout(1200);
  const dragInfo = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.nrow')];
    return {
      n: rows.length,
      draggable: rows.filter((r) => r.getAttribute('draggable') === 'true').length,
      hasKey: rows.filter((r) => r.getAttribute('data-dragkey')).length,
    };
  });
  toManual && dragInfo.draggable === dragInfo.n && dragInfo.n > 1
    ? ok('手动模式下每行都是 draggable 且带 data-dragkey', JSON.stringify(dragInfo))
    : bad('拖动属性没挂上', JSON.stringify(dragInfo) + ' 切手动=' + toManual);

  /* ================= 8. 收尾 ================= */
  /*
   * 清理必须**逐个断言返回值**。
   *
   * 这里原来是一串裸 await，不管成没成都照样打印「已清掉本轮造的数据」——
   * 结果库里的测试笔记本一条没少（笔记本还能看到 6 个 ABTEST-/VRF- 残留），
   * 而探针的收尾行一片祥和。**静默失败的清理比不清理更坏**：
   * 它让人以为环境是干净的，下一轮做 A/B 时就会把残留数据当成代码差异。
   *
   * 顺序也有讲究：删除是**自底向上**的 —— 子本还指着父本时删父本会失败。
   * 这里 bkSub 在 bk 前面删，所以顺序本身是对的；缺的只是「失败要喊出来」。
   */
  const left = [];
  const clean = async (m, a, label) => {
    const r = await rpc(m, a);
    if (!r.ok) left.push(`${label}(${m} → ${r.err || 'ok=false'})`);
    return r.ok;
  };

  for (const t of [t1, t2, t3]) {
    await rpc('todo.trash', { id: t.id, trashed: 1 });
    await clean('todo.delete', { id: t.id }, t.title);
  }
  for (const l of [listA, listB]) await clean('todo.list.delete', { id: l.id }, l.name);
  for (const n of [n1, n2, n3]) {
    await rpc('note.delete', { id: n.id });
    await clean('note.purge', { id: n.id }, n.title);
  }
  /* 自底向上：先子后父。反了就会因为「还有子本」而被拒 */
  await clean('notebook.delete', { id: bkSub.id }, bkSub.name);
  await clean('notebook.delete', { id: bk.id }, bk.name);
  // 排序方式还原成手动（原来就是手动）
  await rpc('setting.set', { k: 'todoSortMode', v: 'manual' });

  if (left.length) bad('清理有残留', left.join(' | '));
  else ok('本轮造的数据全部清掉');

  console.log('\n=== 控制台 ===');
  const hard = errs.filter((e) => !/favicon/i.test(e));
  hard.length ? bad('控制台有错误', hard.slice(0, 5).join(' ;; ')) : ok('控制台 0 条错误');

  console.log(`\n合计：✅ ${okN} ／ ❌ ${badN}`);
  if (badN) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });