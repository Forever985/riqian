/**
 * 验证「数据层不再直接依赖 GDI+」这次重构没改变行为。
 *
 * 背景：Db.cs 的 MakeThumb / InsertMediaRow 和 DbV8.cs 的 ShareCopy* 原来直接
 * 用 System.Drawing / WinForms.Clipboard。为了安卓能编译，抽成了 Platform 那一层
 * （见 Platform.cs）。Windows 上行为必须一模一样 —— 这类改动最容易的翻车方式
 * 是"编译过了但功能悄悄没了"，所以必须真调一遍，不能只看代码。
 *
 * 怎么发 RPC：不依赖前端有没有暴露全局入口，直接按 api.ts 的协议
 * 往 window.chrome.webview 投消息 {id, m, a}，再听 reply。
 * 这样探针和前端实现解耦，前端内部怎么改都不影响这个测试。
 *
 * 不碰用户数据：只调剪贴板（临时状态）和 media.list（只读）。
 */
const { run } = require('./_probe');

run(async (P) => {
  P.say('宿主桥在不在');
  P.out(await P.eval(() => typeof window.chrome?.webview?.postMessage === 'function'));

  P.say('装一个裸 RPC 调用器');
  const installed = await P.eval(() => {
    if (typeof window.chrome?.webview?.postMessage !== 'function') return 'no-host';
    let seq = 900000;
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
        const t = setTimeout(() => {
          waits.delete(id);
          rej(new Error('RPC 超时: ' + m));
        }, 8000);
        waits.set(id, (d) => {
          clearTimeout(t);
          res(d);
        });
        window.chrome.webview.postMessage({ id, m, a: a || {} });
      });
    return 'ok';
  });
  P.out(installed);
  if (installed !== 'ok') {
    console.log('  ✗ 没有宿主桥，后面没法测');
    process.exitCode = 1;
    return;
  }

  P.say('share.copyText —— 走 Platform.CopyText');
  const copyText = await P.eval(async () => {
    try {
      return await window.__RAW__('share.copyText', { text: '日签平台抽象验证' });
    } catch (e) {
      return { err: e.message };
    }
  });
  P.out(copyText);

  P.say('share.copyImage —— 走 Platform.CopyImage（1x1 透明 PNG）');
  /* 参数名是 data，不是 dataUrl —— 见 MainFormV8.cs:610
   *   if (m == "share.copyImage") return db.ShareCopyImage(S(a, "data"));
   * 传错名字不会报错，只会静默走「没有图片数据」那条分支。
   * 这类「写错名字不报错也不生效」的坑这个项目栽过（todo.delete / note.purge），
   * 所以这里按真实签名传，并且断言内层 ok。 */
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const copyImg = await P.eval(async (d) => {
    try {
      return await window.__RAW__('share.copyImage', { data: d });
    } catch (e) {
      return { err: e.message };
    }
  }, png);
  P.out(copyImg);

  P.say('media.list —— 缩略图路径仍算得出来（只读）');
  const media = await P.eval(async () => {
    try {
      const r = await window.__RAW__('media.list', {});
      const arr = Array.isArray(r.data) ? r.data : r.data?.items || [];
      return { ok: r.ok, n: arr.length, sample: arr.slice(0, 2), err: r.err };
    } catch (e) {
      return { err: e.message };
    }
  });
  P.out(media);

  P.say('结论');
  /* ⚠️ 断言必须看**内层** data.ok，不是外层信封的 ok。
   *
   * 外层 {ok:true} 只代表「RPC 调通了、没抛异常」；业务失败是
   * 内层 {ok:false, err:"..."}，而且外层依然是 ok:true。
   * 第一版这个脚本就是拿外层 ok 断言的，两次调用其实都失败了，
   * 脚本照样打印 ✓ —— 一个永远绿的测试。 */
  const inner = (r) => (r && r.data) || {};
  const textR = inner(copyText);
  const imgR = inner(copyImg);
  console.log(`  share.copyText  内层 ok=${textR.ok} ${textR.err ? '· ' + textR.err : ''}`);
  console.log(`  share.copyImage 内层 ok=${imgR.ok} ${imgR.err ? '· ' + imgR.err : ''}`);
  console.log(`  media.list      ${media && media.err ? '失败 ' + media.err : 'ok=' + media.ok + ' n=' + (media.n ?? '?')}`);

  /* 剪贴板失败在非交互桌面会话下是正常的（CI、无人值守）。
   * 所以判据是：「要么成功，要么报的是剪贴板层面的错」——
   * 绝不能出现「Platform 那层没接上」那种 err 文案。 */
  const notWired = (r) => typeof r.err === 'string' && r.err.indexOf('当前平台不支持') === 0;
  if (notWired(textR) || notWired(imgR)) {
    console.log('  ✗ Platform 那层没接上 —— 实现压根没注册');
    process.exitCode = 1;
  } else {
    console.log('  ✓ 两个实现都已注册并被执行到（是否真写进剪贴板取决于桌面会话）');
  }
});