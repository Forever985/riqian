/**
 * v10.3 验收：84 任务排序 / 89 托盘菜单排序 / 89 搜索历史 / 93 拖动动画
 *
 * HTML5 原生拖拽用 Playwright 的 dragTo 驱动不了（它模拟鼠标，不产生 drag 事件），
 * 所以这里直接派发 DragEvent —— 和浏览器真实拖动走的是同一套 handler。
 *
 *   NO_PROXY=127.0.0.1,localhost node e2e-v12.js 57001
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '57001';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(12000);

  const ok = (n, v, extra = '') => console.log(`${v ? '✅' : '❌'} ${n}${extra ? `（${extra}）` : ''}`);
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CON ' + m.text().slice(0, 150)); });

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 63000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (v) => { await p.click(`.nav button[data-nav="${v}"]`); await p.waitForTimeout(1000); };
  const closeMasks = async () => {
    for (let i = 0; i < 4; i++) {
      const open = await p.evaluate(() => document.querySelectorAll('.mask,.qmask').length);
      if (!open) break;
      await p.keyboard.press('Escape');
      await p.waitForTimeout(250);
      await p.mouse.click(6, 6).catch(() => {});
      await p.waitForTimeout(250);
    }
  };
  /** 派发一次完整拖拽：dragstart(源) → dragover(目标) → drop(目标) */
  const dragTo = (selSrc, innerSrc, selDst, iSrc, iDst) => p.evaluate(([a, b2, c, d, e]) => {
    const src = document.querySelectorAll(a)[d];
    const dst = document.querySelectorAll(b2)[e];
    if (!src || !dst) return false;
    const handle = c ? src.querySelector(c) : src;
    if (!handle) return false;
    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
  }, [selSrc, selDst, innerSrc, iSrc, iDst]);

  await closeMasks();

  /* ============ 1. 待办：任务自己也能拖（84） ============ */
  const lb = await rpc('todos.lists', {});
  const listId = (lb?.data || [])[0]?.id || '';
  const marks = ['甲甲甲', '乙乙乙', '丙丙丙'];
  for (const t of marks) await rpc('todo.add', { title: `${t}项`, listId });

  await go('todos');
  const inbox = p.locator('.rail-item', { hasText: '收集箱' }).first();
  if (await inbox.count()) { await inbox.click(); await p.waitForTimeout(900); }

  const todoRows = await p.locator('.todo-sortable .todo-row').count();
  ok('待办未完成项可排序（有拖拽容器）', todoRows >= 3, `${todoRows} 行`);

  /*
   * 比的是真实 id 顺序，不是标题 —— 反复跑会留下多条同名任务，
   * 拿标题前三个字符比较，顺序换了也看不出来（这里踩过一次）。
   */
  const tBefore = await p.evaluate(() => [...document.querySelectorAll('.todo-sortable .todo-row')].map((x) => x.getAttribute('data-dragkey')));
  if (todoRows >= 3) {
    await dragTo('.todo-sortable .todo-row', '', '.todo-sortable .todo-row', 0, 2);
    await p.waitForTimeout(1600);
  }
  const tAfter = await p.evaluate(() => [...document.querySelectorAll('.todo-sortable .todo-row')].map((x) => x.getAttribute('data-dragkey')));
  ok('任务拖到第 3 位后顺序真的变了', JSON.stringify(tBefore) !== JSON.stringify(tAfter),
    `前 3 个 id：${tBefore.slice(0, 3).join(',')} → ${tAfter.slice(0, 3).join(',')}`);

  const afterIds = await rpc('todos.list', { listId });
  const sorted = (afterIds?.data || []).filter((t) => !t.done && !t.trashed).slice(0, 3);
  ok('新顺序已落库（sort 归一化成 0/10/20）',
    sorted.every((t, i) => (t.sort || 0) === i * 10), sorted.map((t) => t.sort).join('/'));

  /* ============ 2. 打卡：换实现后仍能拖（93 的载体） ============ */
  await go('habits');
  await p.waitForTimeout(600);
  const cards = await p.locator('.habit-sortable .hcard').count();
  ok('打卡卡片有拖动手柄', cards >= 2 && (await p.locator('.habit-sortable .mod-grip').count()) >= 2, `${cards} 张`);

  const hBefore = await p.evaluate(() => [...document.querySelectorAll('.habit-sortable .hcard .nm')].map((x) => x.textContent));
  if (cards >= 3) {
    await dragTo('.habit-sortable .hcard', '.mod-grip', '.habit-sortable .hcard', 0, 2);
    await p.waitForTimeout(1600);
  }
  const hAfter = await p.evaluate(() => [...document.querySelectorAll('.habit-sortable .hcard .nm')].map((x) => x.textContent));
  ok('打卡拖到第 3 位后顺序变了', JSON.stringify(hBefore) !== JSON.stringify(hAfter), `${hBefore.slice(0, 3).join('/')} → ${hAfter.slice(0, 3).join('/')}`);

  // 拖起时的样式钩子：.dragging 存在（CSS 里给了半透明 + 缩放）
  const draggingCss = await p.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'dragging';
    document.body.appendChild(el);
    const s = getComputedStyle(el).opacity;
    el.remove();
    return s;
  });
  ok('拖起有视觉反馈（.dragging 半透明）', Number(draggingCss) < 1, `opacity=${draggingCss}`);

  /* ============ 3. 托盘菜单顺序可调（89） ============ */
  await go('settings');
  await p.locator('.snav', { hasText: '托盘与窗口' }).click();
  await p.waitForTimeout(700);
  const trayBefore = await rpc('bootstrap', {});
  const beforeMenu = String(trayBefore?.data?.settings?.trayMenu || '');
  const upBtns = p.locator('.orderlist .orow button[data-act="up"]');
  ok('托盘菜单有顺序编辑器', (await upBtns.count()) >= 3, `${await upBtns.count()} 项`);

  await p.locator('.orderlist .orow').nth(1).locator('button[data-act="up"]').click();
  await p.waitForTimeout(1000);
  const trayAfter = await rpc('bootstrap', {});
  const afterMenu = String(trayAfter?.data?.settings?.trayMenu || '');
  ok('上移后菜单顺序已变并落库', beforeMenu !== afterMenu, `${beforeMenu.slice(0, 34)} → ${afterMenu.slice(0, 34)}`);
  ok('「退出」仍在最后', afterMenu.trim().endsWith('quit'), afterMenu.split(',').slice(-2).join(','));

  // 恢复默认
  const resetBtn = p.locator('button', { hasText: '恢复默认顺序' }).first();
  if (await resetBtn.count()) { await resetBtn.click(); await p.waitForTimeout(900); }
  const trayReset = await rpc('bootstrap', {});
  ok('能一键恢复默认菜单', String(trayReset?.data?.settings?.trayMenu || '') === 'open,today,diary,note,todo,pomo,sep,hide,boss,sep,quit',
    String(trayReset?.data?.settings?.trayMenu || '').slice(0, 40));

  /* ============ 4. 搜索历史（89） ============ */
  await go('records');
  const box = p.locator('.filters .searchbox input').first();
  await box.click();
  await box.fill('');
  await p.keyboard.type('验收关键词甲');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);

  await go('media');
  await p.waitForTimeout(500);
  await go('records');
  await p.waitForTimeout(700);
  await p.locator('.filters .searchbox input').first().click();
  await p.waitForTimeout(500);
  const hist = await p.evaluate(() => ({
    open: !!document.querySelector('.sb-hist'),
    items: [...document.querySelectorAll('.sb-hist .sb-item .q')].map((x) => x.textContent),
    hasClear: /清空搜索历史/.test(document.querySelector('.sb-hist')?.textContent || ''),
  }));
  ok('搜索后能记住历史', hist.items.includes('验收关键词甲'), hist.items.join('/'));
  ok('历史下拉有「清空」入口', hist.hasClear);

  // 点历史能回填并触发搜索
  const hit = p.locator('.sb-hist .sb-item', { hasText: '验收关键词甲' }).first();
  if (await hit.count()) {
    await hit.click();
    await p.waitForTimeout(900);
    const filled = await p.evaluate(() => document.querySelector('.filters .searchbox input')?.value);
    ok('点历史能回填搜索框', filled === '验收关键词甲', String(filled));
  } else {
    ok('点历史能回填搜索框', false, '历史项找不到');
  }

  // 清空
  const clearBtn = p.locator('.sb-hist .linkbtn', { hasText: '清空搜索历史' }).first();
  if (await clearBtn.count()) {
    await clearBtn.click();
    await p.waitForTimeout(700);
  } else {
    await p.locator('.filters .searchbox input').first().click();
    await p.waitForTimeout(400);
    await p.locator('.sb-hist .linkbtn', { hasText: '清空搜索历史' }).first().click().catch(() => {});
    await p.waitForTimeout(700);
  }
  const afterClear = await rpc('bootstrap', {});
  ok('能清空搜索历史', String(afterClear?.data?.settings?.searchHistory || '[]') === '[]',
    String(afterClear?.data?.settings?.searchHistory || '[]').slice(0, 20));

  // 三个搜索框都换成了带历史的组件
  await go('media');
  await p.waitForTimeout(600);
  ok('多媒体库搜索框也带历史', (await p.locator('.searchbox.sb-wrap').count()) > 0);
  await go('notes');
  await p.waitForTimeout(700);
  ok('笔记搜索框也带历史', (await p.locator('.searchbox.sb-wrap').count()) > 0);

  console.log('页面错误:', errs.length ? errs.slice(0, 6) : '无');
  await b.close().catch(() => {});
})().catch((e) => { console.log('FATAL', e.message); process.exit(1); });
