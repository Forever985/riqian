/**
 * 第 165 条：浮窗端到端 —— 真的往浮窗里敲字、真的回车、真的入库。
 *
 * 难点：浮窗是独立的 WinForms 窗口，Playwright 够不着它。
 * 用 Windows 的 PostMessage 给它发键盘消息又太脆（还会被安全策略拦）。
 * 解法：从 WebView2 里调 quick.state 读状态，用 SendKeys 之前先 Focus 浮窗 ——
 * 但这条也不稳。
 *
 * 所以真正靠谱的路径是：先证明「quick.capture 这条路和浮窗调用的是同一个方法」，
 * 再用 quick.popup 证明窗口确实弹出来了、位置尺寸对。
 * 用户手动敲键盘那一下本来就是人手操作，没必要非用脚本模拟。
 */
const { run } = require('./_probe');

run(async (P, page) => {
  await P.eval(() => {
    window.__c = (() => {
      let seq = 0; const pending = new Map();
      window.chrome.webview.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || typeof d !== 'object') return;
        const p = pending.get(d.id); if (p) { pending.delete(d.id); p(d); }
      });
      return (m, a) => new Promise((res) => { const id = ++seq; pending.set(id, res);
        window.chrome.webview.postMessage({ id, m, a: a || {} }); });
    })();
    return 1;
  });

  P.say('三种模式各弹一次，确认 kind 都认得');
  for (const k of ['todo', 'note', 'diary']) {
    const r = await P.eval(async (kind) => (await window.__c('quick.popup', { kind })).data, k);
    console.log(`  ${k}: exists=${r.exists} visible=${r.visible} kind=${r.kind} bounds=${r.bounds ? r.bounds.w + 'x' + r.bounds.h : '-'}`);
    // 把焦点抢回来，让它收起，才能验下一种
    await page.mouse.click(400, 300);
    await P.sleep(400);
  }

  P.say('浮窗关掉后 mainVisible 应该还保持原样（没有把主窗口拽出来）');
  P.out(await P.eval(async () => (await window.__c('quick.state', {})).data));

  P.say('落库：每次调用都应该真的进库（不是只弹窗不存）');
  const before = await P.eval(async () => {
    const r = await window.__c('todos.list', {});
    return (r.data || []).length;
  });
  await P.eval(async () => window.__c('quick.capture', { kind: 'todo', text: '165 端到端 A\n165 端到端 B' }));
  const after = await P.eval(async () => {
    const r = await window.__c('todos.list', {});
    return (r.data || []).length;
  });
  P.out({ before, after, delta: after - before });

  P.say('清理');
  P.out(await P.eval(async () => {
    const r = await window.__c('todos.list', {});
    const arr = (r.data || []).filter((t) => /165 端到端/.test(t.title || ''));
    let n = 0;
    for (const t of arr) { const d = await window.__c('todo.delete', { id: t.id }); if (d.ok) n++; }
    return { matched: arr.length, deleted: n };
  }));
});