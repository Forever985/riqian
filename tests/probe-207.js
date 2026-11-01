// #207：日历右键要能直接加待办 / 加倒计时，并落在点中的那一天。
const { run } = require('./_probe.js');

run(async (P) => {
  P.say('进日历页');
  if (!(await P.go('calendar'))) return;
  await P.sleep(800);

  const cells = await P.eval(() => {
    const c = [...document.querySelectorAll('.cal2-cell')];
    return { n: c.length, sample: c.slice(0, 3).map((e) => e.getAttribute('title') || e.textContent.trim().slice(0, 12)) };
  }, null, '找日历格子');
  P.out(cells);
  if (!cells || !cells.n) { console.log('  ✗ 没有日历格子'); process.exitCode = 1; return; }

  /* ---------- 挑一个「未来」的日子，避免落到过去 ---------- */
  const picked = await P.eval(() => {
    const c = [...document.querySelectorAll('.cal2-cell')];
    // title 形如 2026-11-26 …；取第一个日期 >= 今天且在当月的（不跨月点，样子最稳）
    const today = new Date();
    const key = today.toISOString().slice(0, 10);
    const cand = c
      .map((e) => ({ e, d: (e.getAttribute('title') || '').slice(0, 10) }))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.d) && x.d >= key);
    return cand.length ? cand[0].d : null;
  }, null, '挑日期');
  console.log('  目标日期：' + picked);
  if (!picked) { console.log('  ✗ 本月没有可选日期'); process.exitCode = 1; return; }

  /* ---------- 右键弹菜单 ---------- */
  P.say('右键这一天');
  const box = await P.eval(({ d }) => {
    const el = [...document.querySelectorAll('.cal2-cell')].find((e) => (e.getAttribute('title') || '').slice(0, 10) === d);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, { d: picked }, '定位格子');
  if (!box) { console.log('  ✗ 找不到格子'); process.exitCode = 1; return; }

  /*
   * 不能走 mouse.down/up：CalendarView 里有个 `window mousedown` **捕获阶段**监听，
   * 目的是「点别处就关菜单」。mouse.down 会先把它触发一遍，菜单刚开就被关掉，
   * 表现成「右键没弹出菜单」。
   * 直接派发 contextmenu 事件最干净，也只测我们关心的那条路径（onContextMenu）。
   */
  const fired = await P.eval(({ d, x, y }) => {
    // 精确拿那个格子本身（.cal2-cell），不要 elementFromPoint 的深层子节点
    const el = [...document.querySelectorAll('.cal2-cell')]
      .find((e) => (e.getAttribute('title') || '').slice(0, 10) === d);
    if (!el) return { ok: false, why: 'cell-not-found' };
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2,
    }));
    return { ok: true, cls: el.className.slice(0, 40) };
  }, { d: picked, x: box.x, y: box.y }, '派发 contextmenu');
  P.out(fired);
  await P.sleep(450);

  const menu = await P.eval(() => {
    const m = document.querySelector('.rowmenu');
    return m ? [...m.querySelectorAll('button')].map((b) => (b.textContent || '').trim()) : null;
  }, null, '读菜单');
  P.out({ 菜单项: menu });
  if (!menu) { console.log('  ✗ 右键没弹出菜单'); process.exitCode = 1; return; }

  const hasTodo = menu.some((t) => /加待办/.test(t));
  const hasCd = menu.some((t) => /加倒计时/.test(t));
  console.log(`  含「加待办」=${hasTodo}，含「加倒计时」=${hasCd}`);

  /* ---------- 点「在这天加待办」，填标题并确认 ---------- */
  P.say('点「在这天加待办」→ 填标题 → 保存');
  const clicked = await P.eval(() => {
    const b = [...document.querySelectorAll('.rowmenu button')].find((x) => /加待办/.test(x.textContent || ''));
    if (!b) return false;
    b.click();
    return true;
  }, null, '点加待办');
  if (!clicked) { console.log('  ✗ 点不到'); process.exitCode = 1; return; }
  await P.sleep(600);

  const dlgInfo = await P.eval(() => {
    const m = document.querySelector('.mask .dlg');
    return m
      ? { open: true, title: (m.querySelector('h3')?.textContent || '').trim(), hasInput: !!m.querySelector('input') }
      : { open: false };
  }, null, '看弹层');
  P.out(dlgInfo);

  const title = '__t207__' + Date.now();
  const filled = await P.eval(({ title }) => {
    const m = document.querySelector('.mask .dlg');
    const inp = m && m.querySelector('input');
    if (!inp) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, title);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, { title }, '填标题');

  if (filled) {
    // 弹层的确认按钮：找「确定 / 保存 / 添加 / 好」
    const ok = await P.eval(() => {
      const m = document.querySelector('.mask .dlg');
      if (!m) return false;
      const b = [...m.querySelectorAll('button')].find((x) => /确定|保存|添加|好$/.test((x.textContent || '').trim()));
      if (!b) return false;
      b.click();
      return true;
    }, null, '点确认');
    await P.sleep(900);

    P.say('回查这条待办是不是落在 ' + picked);
    const back = await P.page.evaluate(async ({ title, want }) => {
      const call = (m, a) => new Promise((res) => {
        const id = Math.floor(Math.random() * 1e9);
        const h = (ev) => {
          const d = ev.data;
          if (d && d.id === id) { window.chrome.webview.removeEventListener('message', h); res(d); }
        };
        window.chrome.webview.addEventListener('message', h);
        window.chrome.webview.postMessage({ id, m, a });
        setTimeout(() => { window.chrome.webview.removeEventListener('message', h); res({ timeout: true }); }, 6000);
      });
      const l = await call('todos.list', {});
      const arr = Array.isArray(l.data) ? l.data : (l.data && l.data.todos) || [];
      const mine = arr.find((t) => t.title === title);
      if (mine) await call('todos.delete', { id: mine.id });
      return { found: !!mine, due: mine ? mine.due : null, want, deleted: !!mine };
    }, { title, want: picked });
    P.out(back);
    const okDate = back && back.found && back.due === picked;
    console.log(okDate ? `  ✓ 待办日期正确（${back.due}），已清理` : `  ✗ 日期不对或没建成：${JSON.stringify(back)}`);
    if (!okDate) process.exitCode = 1;
  }

  // 收尾：Esc 关掉可能残留的弹层
  await P.page.keyboard.press('Escape').catch(() => {});
});