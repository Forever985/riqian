/* 全量只读接口冒烟 —— 用后端自己的 write 标记区分读写，不靠黑名单猜。
   目标：找出「一调就抛异常」的接口。前端点不到的分支也能暴露出来。 */
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1500);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 80000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const meta = await rpc('diag.methods', {});
  const methods = (meta.data && meta.data.methods) || [];
  console.log('方法总数:', methods.length);

  // 只跑 write=false 的。这些即使只读也不适合跑：会开窗口 / 动文件
  const SKIP = new Set([
    'app.quit', 'app.hide', 'app.minimize', 'app.screen', 'app.openRoot', 'app.openMedia',
    'app.openExport', 'app.pickFolder', 'cache.open', 'diag.openDir', 'media.openFolder',
    'media.openImport', 'notify.test', 'notify.push', 'quick.popup', 'quick.capture',
    'font.bytes', 'diag.logs', 'diag.frontend',
  ]);

  const ok = [], errs = [];
  for (const it of methods) {
    const m = it.name;
    if (it.write) continue;          // 写接口一律不碰
    if (SKIP.has(m)) continue;
    const r = await rpc(m, {});
    if (r.ok) ok.push(m);
    else errs.push({ m, err: r.err });
  }

  const needArg = /缺少|没指定|no id|需要|必填/;
  const required = errs.filter((e) => needArg.test(String(e.err)));
  const real = errs.filter((e) => !needArg.test(String(e.err)));

  console.log('只读调用成功:', ok.length);
  console.log('因缺参数被拒（正常）:', required.length);
  console.log('');
  console.log('================ 真正报错 ================');
  if (!real.length) console.log('  无');
  for (const e of real) console.log('  X ' + e.m + '  ->  ' + e.err);

  await b.close().catch(() => {});
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });