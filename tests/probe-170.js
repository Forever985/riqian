// #107 / #170 现场实测：字体预设是否真的变多、能不能导入、导入后 FontFace 是否注册成功。
//
// 关键难点（踩过一次就要写下来）：
//   · P.eval 走 page.evaluate，里面 await RPC 不会等 → 会 8s 超时。要 await 必须用 P.page.evaluate。
//   · 字体目录在 <数据根>/字体，是宿主负责的文件操作；探针不能自己造字体文件，
//     所以「导入」这一步用 font.import 会弹系统文件框 —— 无人值守跑不了。
//     改成验证链路的两半：font.list 能返目录 + font.bytes 对不存在的文件会说清错误，
//     再补一个「造一个最小 ttf 塞进去 → 注册 → 立即可用」的纯前端分支。
//     最小 ttf 不可伪造（FontFace 要解析 sfnt 头），所以导入分支只验到「目录可写、list 能列出」。
const { run } = require('./_probe.js');

run(async (P, page) => {
  /* ---------- ① 设置页能打开、字体行存在 ---------- */
  P.say('进设置页 → 界面布局（字体行在这个组里，跟字号/行距挨着）');
  if (!(await P.go('settings'))) return;
  await P.sleep(600);
  const jumped = await P.eval(() => {
    const b = [...document.querySelectorAll('.snav')].find((e) => e.textContent.trim() === '界面布局');
    if (!b) return false;
    b.click();
    return true;
  }, null, '切到界面布局');
  if (jumped !== true) { console.log('  ✗ 找不到「界面布局」分组'); process.exitCode = 1; return; }
  await P.sleep(700);

  const has = await P.eval(() => {
    const sel = document.querySelector('[data-act="font-import"]');
    const prev = document.querySelector('[data-act="font-preview"]');
    const mgr = document.querySelector('[data-act="font-manage"]');
    const dropdown = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => /楷体|等宽|思源/.test(o.textContent || '')),
    );
    return {
      importBtn: !!sel,
      preview: !!prev,
      manageBtn: !!mgr,
      presetCount: dropdown ? dropdown.options.length : 0,
      groupCount: dropdown ? dropdown.querySelectorAll('optgroup').length : 0,
      groups: dropdown ? [...dropdown.querySelectorAll('optgroup')].map((g) => g.label) : [],
    };
  }, null, '检查字体控件');
  P.out(has);
  if (!has || has.__err) { process.exitCode = 1; return; }
  if (!has.importBtn) { console.log('  ✗ 没有「导入字体」按钮'); process.exitCode = 1; return; }
  if (!has.preview) { console.log('  ✗ 没有预览区'); process.exitCode = 1; return; }
  // 原来 6 项 + 系统默认 = 7；现在至少 20 项，否则等于没扩
  if (has.presetCount < 20) {
    console.log(`  ✗ 预设只有 ${has.presetCount} 项，没有扩到预期规模`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ 预设 ${has.presetCount} 项 / ${has.groupCount} 组：${has.groups.join('、')}`);

  /* ---------- ② RPC 通不通 ---------- */
  P.say('font.list RPC');
  const list = await page.evaluate(() => new Promise((res) => {
    const id = 90001;
    const h = (e) => {
      if (!e.data || e.data.id !== id) return;
      window.chrome.webview.removeEventListener('message', h);
      res(e.data);
    };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: 'font.list', a: {} });
    setTimeout(() => res({ timeout: true }), 6000);
  }));
  P.out({ ok: list.ok, dir: list.dir, n: list.data ? list.data.items.length : -1, err: list.err || list.data?.err });
  if (!list.ok) { console.log('  ✗ font.list 失败'); process.exitCode = 1; return; }
  console.log(`  ✓ 目录 = ${list.data.dir}，现有 ${list.data.items.length} 个字体文件`);

  /* ---------- ③ font.bytes 的错误处理 ---------- */
  P.say('font.bytes 对不存在的文件');
  const bad = await page.evaluate(() => new Promise((res) => {
    const id = 90002;
    const h = (e) => {
      if (!e.data || e.data.id !== id) return;
      window.chrome.webview.removeEventListener('message', h);
      res(e.data);
    };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: 'font.bytes', a: { file: '___nope___.ttf' } });
    setTimeout(() => res({ timeout: true }), 6000);
  }));
  P.out({ ok: bad.ok, err: bad.err || bad.data?.err });
  if (bad.ok !== true || bad.data?.ok !== false) {
    console.log('  ✗ 期望「RPC 成功但内部 ok:false」，实际不是');
    process.exitCode = 1;
    return;
  }
  console.log('  ✓ 不存在的文件返回了明确错误，不会抛');

  /* ---------- ④ 选中一个预设，--font 立刻变 ---------- */
  P.say('选「楷体」预设，检查 --font 与预览区');
  const picked = await page.evaluate(() => new Promise((res) => {
    const sel = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.textContent === '楷体'),
    );
    if (!sel) { res({ err: '下拉里没有「楷体」这一项' }); return; }
    const opt = [...sel.options].find((o) => o.textContent === '楷体');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt.value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => {
      const prev = document.querySelector('[data-act="font-preview"]');
      res({
        value: opt.value,
        cssVar: getComputedStyle(document.documentElement).getPropertyValue('--font').trim(),
        previewFamily: prev ? getComputedStyle(prev).fontFamily : '',
      });
    }, 700);
  }));
  P.out(picked);
  if (!picked || picked.err) { console.log('  ✗ ' + (picked?.err || '失败')); process.exitCode = 1; return; }
  if (!/Kaiti/i.test(picked.cssVar)) {
    console.log('  ✗ --font 没跟着变（改了设置但样式没生效）');
    process.exitCode = 1;
    return;
  }
  if (!/Kaiti/i.test(picked.previewFamily)) {
    console.log('  ✗ 预览区没跟着换字体');
    process.exitCode = 1;
    return;
  }
  console.log('  ✓ --font 与预览区都换成了楷体');

  /* ---------- ⑤ 还原成系统默认，别把用户设置改了 ---------- */
  P.say('还原为系统默认');
  const back = await page.evaluate(() => new Promise((res) => {
    const sel = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.textContent === '楷体'),
    );
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, '');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => res({
      cssVar: getComputedStyle(document.documentElement).getPropertyValue('--font').trim().slice(0, 40),
    }), 600);
  }));
  P.out(back);
  console.log('  ✓ 已还原');

  /* ---------- ⑥ 自定义输入框存在 ---------- */
  P.say('自定义 font-family 输入框');
  const custom = await P.eval(() => {
    const el = document.querySelector('[data-act="font-custom"]');
    return { has: !!el, ph: el ? el.placeholder : '' };
  }, null, '找自定义输入框');
  P.out(custom);
  if (!custom?.has) { console.log('  ✗ 没有自定义输入框'); process.exitCode = 1; return; }
  console.log('  ✓ 存在，placeholder = ' + custom.ph);

  /*
   * ---------- ⑦ 导入链路 ----------
   *
   * 「点导入按钮」这一步会弹 Windows 文件框，无人值守跑不了（会一直挂着）。
   * 所以这条链路拆成两半各自验证：
   *   · 文件在目录里时，list 列得出、bytes 读得到、FontFace 能注册、UI 会列进「我导入的」
   *   · 文件不在时，bytes 明确报错（③ 已经验过）
   * 前提：跑之前往 <数据根>/字体/ 里放一个真实字体文件，名字以 _probe- 开头，跑完删掉。
   * 这个前提写在 tests/README.md 的对应条目里。
   */
  P.say('导入链路（需要 <数据根>/字体/ 里放一个 _probe-*.ttf）');
  const files = list.data?.items || [];
  const tf = files.find((x) => x.file.startsWith('_probe-'));
  if (!tf) {
    console.log('  … 跳过：字体目录里没有 _probe-* 测试字体（这是可选的深入验证）');
    return;
  }
  const bytes = await page.evaluate((file) => new Promise((res) => {
    const id = 90003;
    const h = (e) => {
      if (!e.data || e.data.id !== id) return;
      window.chrome.webview.removeEventListener('message', h);
      res(e.data);
    };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: 'font.bytes', a: { file } });
    setTimeout(() => res({ timeout: true }), 15000);
  }), tf.file);
  if (!bytes.data?.data) { console.log('  ✗ 没读到字节：' + (bytes.err || bytes.data?.err)); process.exitCode = 1; return; }
  console.log(`  ✓ ${tf.file} 读到 ${bytes.data.data.length} 字符 base64（format=${bytes.data.format}）`);

  const reg = await page.evaluate(async ({ file, b64 }) => {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const v = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) v[i] = bin.charCodeAt(i);
    const fam = 'Rq:' + file;
    try {
      const face = new FontFace(fam, buf, { style: 'normal', weight: '400' });
      await face.load();
      document.fonts.add(face);
      const ok = document.fonts.check(`16px "${fam}"`);
      [...document.fonts].forEach((x) => { if (x.family === fam) document.fonts.delete(x); });
      return { ok, status: face.status, family: face.family };
    } catch (e) {
      return { ok: false, err: String(e.message || e) };
    }
  }, { file: tf.file, b64: bytes.data.data });
  P.out(reg);
  if (!reg.ok) { console.log('  ✗ FontFace 注册失败：' + reg.err); process.exitCode = 1; return; }
  console.log('  ✓ FontFace 注册为 loaded，document.fonts.check 通过（注册后已清理）');
});