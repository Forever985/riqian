/**
 * 第 165 条：快捷浮窗。
 *
 * 关键验证点不是「窗口能弹出来」，而是：
 *  a) quick.capture 能落库（todo 多行 → 多条待办）
 *  b) quick.popup 能让宿主动作，且主窗口不出现在前台
 *  c) 快速面板里的「用小浮窗」按钮存在
 */
const { run } = require('./_probe');

run(async (P, page) => {
  await page.keyboard.press('Escape').catch(() => {});
  await P.sleep(400);

  // 注入一个数字 id 的 RPC helper（字符串 id 匹配不上宿主回包）
  await P.eval(() => {
    window.__c = (() => {
      let seq = 0; const pending = new Map();
      window.chrome.webview.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || typeof d !== 'object' || typeof d.id === 'undefined') return;
        const p = pending.get(d.id);
        if (p) { pending.delete(d.id); p(d); }
      });
      return (m, a) => new Promise((res) => {
        const id = ++seq; pending.set(id, res);
        window.chrome.webview.postMessage({ id, m, a: a || {} });
      });
    })();
    return 1;
  });

  P.say('先把待办数记下来');
  const before = await P.eval(async () => {
    const r = await window.__c('todos.list', {});
    return Array.isArray(r.data) ? r.data.length : -1;
  });
  P.out({ before });

  P.say('quick.capture 存 3 行待办（多行应拆成 3 条）');
  P.out(await P.eval(async () => {
    const r = await window.__c('quick.capture', {
      kind: 'todo',
      text: '浮窗测试 A\n浮窗测试 B\n\n浮窗测试 C',
    });
    return r;
  }));

  P.say('待办数应 +3');
  P.out(await P.eval(async (b) => {
    const r = await window.__c('todos.list', {});
    const arr = Array.isArray(r.data) ? r.data : [];
    return {
      before: b,
      after: arr.length,
      delta: arr.length - b,
      titles: arr.slice(0, 4).map((t) => t.title),
    };
  }, before));

  P.say('quick.capture 存笔记');
  P.out(await P.eval(async () => {
    const r = await window.__c('quick.capture', { kind: 'note', text: '浮窗笔记测试' });
    return r;
  }));

  P.say('quick.capture 空内容应被拒');
  P.out(await P.eval(async () => window.__c('quick.capture', { kind: 'todo', text: '   ' })));

  P.say('quick.popup 应该唤醒宿主浮窗且不报错');
  P.out(await P.eval(async () => window.__c('quick.popup', { kind: 'todo' })));
  await P.sleep(900);

  P.say('主窗口此时是否被拽出来（应该仍然是用户原本的状态）');
  P.out(await P.eval(() => ({
    hash: location.hash,
    view: document.querySelector('.view') ? 'visible' : 'none',
    onTopOf: document.visibilityState,
  })));

  P.say('快速面板里有「用小浮窗」按钮吗');
  P.out(await P.eval(async () => {
    const st = window.__STORE__;
    return { hasStore: !!st };
  }));

  // 用界面路径再验一遍按钮
  P.say('打开快速面板（快速加待办）');
  P.out(await P.eval(() => {
    const c = window.__HOST_CMD__;
    if (typeof c === 'function') { c('quick:todo'); return 'via host cmd'; }
    return 'no host cmd';
  }));
  await P.sleep(700);
  P.out(await P.eval(() => {
    const qp = document.querySelector('.qpanel');
    const b = document.querySelector('[data-act="to-float"]');
    return {
      panelOpen: !!qp,
      title: qp ? qp.querySelector('b')?.textContent : null,
      floatBtn: b ? b.textContent : null,
    };
  }));

  P.say('清理：删掉刚建的测试待办');
  P.out(await P.eval(async () => {
    const r = await window.__c('todos.list', {});
    const arr = Array.isArray(r.data) ? r.data : [];
    const dels = arr.filter((t) => /浮窗测试/.test(t.title || ''));
    let n = 0;
    for (const t of dels) { const d = await window.__c('todo.delete', { id: t.id }); if (d.ok) n++; }
    return { matched: dels.length, deleted: n };
  }));
});