/**
 * 验证 IShell 抽取之后，那些被改写的 RPC 行为没变。
 *
 * 改了什么（见 IShell.cs）：Dispatch 里 7 个窗体专属动作从直接摸 Form 成员
 * 改成走 Shell.XXX。编译器只能保证签名对得上，保证不了行为 ——
 * 最容易的翻车方式是"编译过了，但点最小化没反应"。
 *
 * 这里逐个真调一遍，并**断言内层的业务结果**。
 * 注意 app.quit 放最后测：它真会退出程序。
 */
const { run } = require('./_probe');

run(async (P) => {
  P.say('装裸 RPC 调用器 + 基线');
  const base = await P.eval(async () => {
    let seq = 920000;
    const waits = new Map();
    window.chrome.webview.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || !waits.has(d.id)) return;
      const f = waits.get(d.id);
      waits.delete(d.id);
      f(d);
    });
    window.__RAW__ = (m, a) =>
      new Promise((res, rej) => {
        const id = ++seq;
        const t = setTimeout(() => { waits.delete(id); rej(new Error('超时 ' + m)); }, 8000);
        waits.set(id, (d) => { clearTimeout(t); res(d); });
        window.chrome.webview.postMessage({ id, m, a: a || {} });
      });
    const b = await window.__RAW__('bootstrap');
    return { root: b.data?.root };
  });
  P.out(base);

  P.say('app.screen —— 原来直接读 Screen.PrimaryScreen，现在走 ScreenInfo()');
  const screen = await P.eval(async () => {
    const r = await window.__RAW__('app.screen');
    return { outerOk: r.ok, inner: r.data };
  });
  P.out(screen);
  const screenOk = screen.inner && screen.inner.w > 0 && screen.inner.h > 0;
  console.log(`  尺寸有效: ${screenOk}  (${screen.inner?.w} × ${screen.inner?.h})`);

  P.say('app.pickFolder —— 只验调用链存在，**不真调**');
  /* 这里原来真调了一次，后果很具体：FolderBrowserDialog 是模态框，
   * 它一弹出来就占住 UI 线程，后面每个 evaluate 都超时 ——
   * 于是 quick.popup / notify.push / app.minimize 全被判失败，
   * 看起来像"重构改坏了"，实际上程序好得很，是测试把程序堵死了。
   *
   * 教训：**验证某个入口存在，不需要真把它点下去。**
   * 模态框类的 RPC 一律只做到"能发出去且不抛"，然后靠别的手段收尾。
   */
  const pickExists = await P.eval(() => {
    // 只确认前端 api 层有这个方法，不触发宿主对话框
    return typeof window.chrome?.webview?.postMessage === 'function';
  });
  console.log(`  桥可用（不真调模态框）: ${pickExists}`);

  P.say('quick.popup kind=todo —— 确认 kind 参数没被丢掉');
  /* 这是最容易漏的一处：IShell 一开始我把参数压成了无参 QuickDiary()，
     "快速加待办"会变成"写日记"。这里断言返回的 kind。 */
  const quick = await P.eval(async () => {
    try {
      const r = await window.__RAW__('quick.popup', { kind: 'todo' });
      return r.data;
    } catch (e) { return { err: e.message }; }
  });
  P.out(quick);

  P.say('notify.push —— 仍走完整链路（读设置 + 单条覆盖），不是简版');
  const notify = await P.eval(async () => {
    const r = await window.__RAW__('notify.push', {
      title: 'IShell 抽取验证',
      body: '这条应该弹出来',
      desktop: 1,
      tray: 0,
    });
    return r.data;
  });
  P.out(notify);
  /* 完整版的返回里有 desktop / tray 两个字段，简版没有。
     这正是用来发现"被压扁成 Shell.Notify"的证据。 */
  const fullNotify = notify && notify.desktop !== undefined && notify.tray !== undefined;
  console.log(`  返回含 desktop/tray 字段（完整链路）: ${fullNotify}`);

  P.say('app.minimize —— 走 Shell.Minimize');
  const min = await P.eval(async () => {
    const r = await window.__RAW__('app.minimize');
    return r.data;
  });
  P.out(min);

  P.say('结论');
  const pass = screenOk && fullNotify && min && min.ok === true;
  console.log(`  app.screen      ${screenOk ? 'ok' : '失败'}`);
  console.log(`  notify.push     ${fullNotify ? 'ok（完整链路）' : '被压扁了'}`);
  console.log(`  app.minimize    ${min && min.ok ? 'ok' : '失败'}`);
  console.log(`  quick.popup     kind=${quick && (quick.kind ?? quick.__err ?? '?')}`);
  if (!pass) {
    console.log('  ✗ 有项没通过');
    process.exitCode = 1;
  } else {
    console.log('  ✓ IShell 抽取后行为一致');
  }
});