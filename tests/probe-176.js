// #176 现场实测：软件背景的「高级参数」开关是否能放出原本被挡住的高级滑块。
//
// 为什么原来不可用：Tone.blur 一直存在、toneFilter 也一直在算，
// 但 Settings.tsx 调 ToneSliders 时硬传 groups="basic"，高级项根本没渲染。
//
// 三个前提，缺一个都找不到按钮：
//   ① 要先点「设置背景」把这个弹窗打开（按钮在弹窗里，不在设置行内）；
//   ② 得先选一张**图片**当背景 —— isImg 为真时才渲染那一整块（含高级参数按钮）；
//   ③ 选了图之后 ToneSliders 才挂出来，所以「滑块变多」这个断言才有意义。
const { run } = require('./_probe.js');

run(async (P) => {
  P.say('进设置 → 外观主题');
  if (!(await P.go('settings'))) return;
  await P.sleep(600);
  await P.eval(() => {
    const b = [...document.querySelectorAll('.snav')].find((e) => e.textContent.trim() === '外观主题');
    if (b) b.click();
  });
  await P.sleep(700);

  P.say('点「设置背景」打开弹窗');
  const opened = await P.eval(() => {
    const rows = [...document.querySelectorAll('.set-row')];
    const r = rows.find((e) => /软件背景/.test(e.textContent || ''));
    if (!r) return { found: false };
    const b = r.querySelector('button');
    if (b) b.click();
    return { found: true };
  }, null, '打开背景弹窗');
  P.out(opened);
  if (!opened?.found) { console.log('  ✗ 找不到「软件背景」行'); process.exitCode = 1; return; }
  await P.sleep(800);

  P.say('确认弹窗开了');
  const dlg = await P.eval(() => {
    const d = document.querySelector('.dlg');
    return {
      open: !!d,
      title: d ? (d.querySelector('h3')?.textContent || '').trim() : '',
      thumbs: d ? d.querySelectorAll('.imgpick').length : 0,
    };
  }, null, '查弹窗');
  P.out(dlg);
  if (!dlg?.open) { console.log('  ✗ 弹窗没打开'); process.exitCode = 1; return; }
  if (!dlg.thumbs) { console.log('  ✗ 多媒体库里没有图片，这项无法验证'); process.exitCode = 1; return; }

  P.say('选第一张图（isImg 才会变真）');
  await P.eval(() => {
    const t = document.querySelector('.dlg .imgpick');
    if (t) t.click();
  }, null, '选图');
  await P.sleep(900);

  P.say('找「高级参数」按钮');
  const btn = await P.eval(() => {
    const b = document.querySelector('[data-act="bg-advanced"]');
    return { has: !!b, text: b ? b.textContent.trim() : '' };
  }, null, '找高级参数按钮');
  P.out(btn);
  if (!btn?.has) { console.log('  ✗ 选了图仍然没有「高级参数」按钮'); process.exitCode = 1; return; }
  console.log(`  ✓ 存在，当前文案「${btn.text}」`);

  /*
   * 数滑块要精确：背景弹窗里有两个 range —— 工具栏那个「压暗」和 ToneSliders 里的。
   * 只有后者包在 .tone-row 里，所以按 .tone-row 数，别按 input[type=range] 数。
   * 前两版就是栽在这：向上找「第一个含 range 的祖先」正好命中工具栏，数字恒为 1。
   */
  const countSliders = () => P.eval(() =>
    document.querySelectorAll('.dlg .tone-row').length, null, '数 tone-row');

  const before = await countSliders();
  P.say('高级参数关闭时的滑块数');
  P.out({ sliders: before });

  P.say('点「高级参数」');
  await P.eval(() => { document.querySelector('[data-act="bg-advanced"]').click(); }, null, '点击');
  await P.sleep(900);
  const n2 = await countSliders();
  const txt2 = await P.eval(() => document.querySelector('[data-act="bg-advanced"]').textContent.trim(), null, '文案');
  P.out({ sliders: n2, text: txt2 });

  if (!(n2 > before)) {
    console.log(`  ✗ 点开高级参数后滑块没变多（${before} → ${n2}）`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ✓ 滑块 ${before} → ${n2}，文案变「${txt2}」`);

  P.say('再点一次，应收回去');
  await P.eval(() => { document.querySelector('[data-act="bg-advanced"]').click(); }, null, '再点');
  await P.sleep(700);
  const n3 = await countSliders();
  P.out({ sliders: n3 });
  if (n3 !== before) { console.log(`  ✗ 收回后应回到 ${before}，实际 ${n3}`); process.exitCode = 1; return; }
  console.log('  ✓ 可开关，收回后数量回到初始');

  P.say('关掉弹窗（不保存，背景不会被改）');
  await P.eval(() => {
    const x = document.querySelector('.dlg .h .x');
    if (x) x.click();
  }, null, '关弹窗');
  await P.sleep(400);
  P.out(await P.eval(() => ({ dlgLeft: !!document.querySelector('.dlg') }), null, '确认已关'));
});
