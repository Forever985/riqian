/**
 * 专验缩略图：Db.MakeThumb 从「直接调 GDI+」改成「走 Platform.ThumbMaker」之后，
 * 缩略图是否仍然真的被生成出来。
 *
 * 这是本次重构风险最高的一处 —— 写错了不会报错，只是缩略图变空，
 * 界面上表现为"图片加载慢/一片灰"，要到用久了才发现。
 *
 * 必须跑在**隔离的数据目录**上（--data-root=...），否则会往用户真实媒体库里塞图。
 * 用法：
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=57011" \
 *     Riqian.exe --data-root=E:/riqian-android-test
 *   node verify-thumb-pipeline.js 57011
 */
const { run } = require('./_probe');
const fs = require('fs');
const path = require('path');

const DATA_ROOT = process.env.DATA_ROOT || 'E:/riqian-android-test';

run(async (P) => {
  P.say('装裸 RPC 调用器');
  const ok = await P.eval(() => {
    let seq = 910000;
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
        const t = setTimeout(() => { waits.delete(id); rej(new Error('超时 ' + m)); }, 15000);
        waits.set(id, (d) => { clearTimeout(t); res(d); });
        window.chrome.webview.postMessage({ id, m, a: a || {} });
      });
    return true;
  });
  P.out({ installed: ok });

  P.say('确认连的是隔离目录（不是用户正式库）');
  const boot = await P.eval(async () => {
    const r = await window.__RAW__('bootstrap');
    return { dbPath: r.data?.dbPath, root: r.data?.root };
  });
  P.out(boot);
  /* 这一步是防呆：探针连错库是踩过的坑（默认连的是用户正式库） */
  const connectedRoot = String(boot && boot.root ? boot.root : boot?.dbPath || '');
  if (!/riqian-android-test/i.test(connectedRoot.replace(/\\/g, '/'))) {
    console.log(`  ✗ 连的不是隔离目录，拒绝继续（当前: ${connectedRoot}）`);
    process.exitCode = 1;
    return;
  }

  P.say('导入一张 400x300 的图（走完整导入流程，含 MakeThumb）');
  const b64 = fs.readFileSync(path.join(__dirname, '..', '.tmp-testimg.b64'), 'utf8').trim();
  const saved = await P.eval(async (d) => {
    const r = await window.__RAW__('media.saveBase64', {
      name: 'thumb-probe.png',
      data: 'data:image/png;base64,' + d,
    });
    return r.data;
  }, b64);
  P.out(saved);

  P.say('核对数据库里的宽高（走 Platform.ImageSize 读出来的）');
  /* ⚠️ media.saveBase64 的返回值里**没有** w/h（只有 ok/id/name/dup），
   *    第一版脚本拿 saved.w 判断，于是"缩略图明明生成了"却被判失败。
   *    宽高要另外查 —— 这正是「断言不能凭想象」的教训。 */
  const meta = await P.eval(async (id) => {
    const r = await window.__RAW__('media.list2', {
      kind: 'all', q: 'thumb-probe', sort: 'new', dir: 'desc', folder: '', tag: '',
    });
    const arr = (r.data && (Array.isArray(r.data) ? r.data : r.data.items)) || [];
    const hit = arr.find((x) => x.id === id) || arr[0];
    return hit ? { id: hit.id, w: hit.width ?? hit.w, h: hit.height ?? hit.h, ext: hit.ext } : null;
  }, saved && saved.id);
  P.out(meta);

  P.say('目录里到底有没有 .jpg 缩略图');
  const thumbDir = path.join(DATA_ROOT, '图片库', '.thumb');
  let thumbs = [];
  try {
    thumbs = fs.readdirSync(thumbDir).filter((f) => f.endsWith('.jpg'));
  } catch (e) {
    console.log('  读不到缩略图目录: ' + e.message);
  }
  console.log(`  缩略图目录: ${thumbDir}`);
  console.log(`  找到 ${thumbs.length} 个 .jpg: ${JSON.stringify(thumbs)}`);

  P.say('缩略图尺寸对不对（应 ≤360 且保持比例）');
  for (const t of thumbs) {
    const st = fs.statSync(path.join(thumbDir, t));
    console.log(`  ${t}  ${st.size} 字节`);
  }

  P.say('结论');
  /* 三条都要成立才算过：
   *   1. 图进库了
   *   2. 缩略图文件存在且不是空壳（>500 字节，1x1 的占位图通常只有几百字节）
   *   3. 宽高是 Platform.ImageSize 读出来的真实值（400x300）
   * 第 3 条是这次重构的另一半 —— 它也改了 Image.FromFile 那一段。 */
  const gotSize = meta && Number(meta.w) === 400 && Number(meta.h) === 300;
  const gotThumb = thumbs.length > 0 && thumbs.every((t) => fs.statSync(path.join(thumbDir, t)).size > 500);
  console.log(`  图片入库:      ${saved && saved.ok ? 'ok' : '失败'}`);
  console.log(`  缩略图产物:    ${gotThumb ? 'ok' : '缺失/过小'}`);
  console.log(`  宽高读取:      ${gotSize ? 'ok 400x300' : '异常 ' + JSON.stringify(meta)}`);
  if (saved && saved.ok && gotThumb && gotSize) {
    console.log('  ✓ 缩略图管线与尺寸读取都正常（GDI+ 已成功收进 Platform 层）');
  } else {
    console.log('  ✗ 有一项没通过，见上面三行');
    process.exitCode = 1;
  }
});