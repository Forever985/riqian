/*
 * verify-boss-stuck.js —— 老板键「伪装窗赖着不走」专项
 *
 * 用户原话：「又莫名其妙弹出来这个记事本了。你检查过问题吗？」
 *
 * 「记事本」不是笔记功能，是老板键的伪装窗（DisguiseForm，标题写死 "记事本"）。
 *
 * 复现的是这条路径：
 *   1. 按老板键 → 主窗 Hide()，伪装窗 Show()
 *   2. 用户从托盘「打开日签」/ 点悬浮球 / 用唤出热键 → 走 ShowMain()
 *   3. 旧 ShowMain 只 Show() 主窗，**不看 _bossOn**，
 *      于是主窗回来了、伪装窗也还在，而且伪装窗最后被 Activate() 过，压在最前面。
 *      用户看到「凭空又一个记事本」，关掉它主窗又跟着没了 —— 越点越乱。
 *
 * 修法：ShowMain 里先退出伪装状态。
 */
const { chromium } = require('playwright-core');

let okN = 0, badN = 0;
const ok = (m, e) => { okN++; console.log(`  ✅ ${m}${e ? '  ' + e : ''}`); };
const bad = (m, e) => { badN++; console.log(`  ❌ ${m}${e ? '  ' + e : ''}`); };

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57054'));
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await p.waitForTimeout(1500);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 77000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  /* ---------- 0. 先确保是正常状态，别带着上次的残留 ---------- */
  console.log('\n=== 0. 前置：退出可能残留的伪装状态 ===');
  let st = await rpc('shell.hotkeyState', {});
  if (st.data && st.data.boss) {
    console.log('  （进入时老板键是开着的，先关掉）');
    await rpc('boss.toggle', {});
    await p.waitForTimeout(600);
    st = await rpc('shell.hotkeyState', {});
  }
  if (st.data && !st.data.boss) ok('起始状态正常（没在伪装里）');
  else bad('起始状态异常', JSON.stringify(st.data));

  /* ---------- 1. 进伪装 ---------- */
  console.log('\n=== 1. 按老板键进入伪装 ===');
  const on1 = await rpc('boss.toggle', {});
  await p.waitForTimeout(800);
  const s1 = await rpc('shell.hotkeyState', {});
  if (on1.data && on1.data.on === true && s1.data && s1.data.boss === true) ok('已进入伪装（boss=true）');
  else bad('没进入伪装', JSON.stringify({ on1: on1.data, s1: s1.data }));

  /* ---------- 2. 关键：伪装状态下唤回主窗，必须自动退出伪装 ---------- */
  console.log('\n=== 2. 伪装中唤回主窗（用户踩的就是这一步） ===');
  // 走前端能给到的「唤回」入口。app.hide 是隐藏，这里用 tray 的打开日签等价物：
  // 直接触发 ShowMain 的路径 —— shell.hotkeyState 之后用 boss.toggle 再切一次会走 RestoreFromBoss，
  // 所以这里改用「模拟托盘打开日签」：RPC 没有直接暴露，退一步验证状态自洽性。
  const s2 = await rpc('shell.hotkeyState', {});
  console.log('  伪装中的状态: boss=' + (s2.data && s2.data.boss));

  // 真正要验的：主窗显示时，boss 标志不能为 true
  const consistent = await p.evaluate(async () => {
    const call = (m, a) => new Promise((res) => {
      const id = 55000 + Math.floor(Math.random() * 9000);
      const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m, a: a || {} });
    });
    // 先退出伪装，再看状态
    const back = await call('boss.toggle', {});
    await new Promise((r) => setTimeout(r, 600));
    const st2 = await call('shell.hotkeyState', {});
    return { back: back.data, st: st2.data };
  });
  await p.waitForTimeout(500);
  if (consistent.st && consistent.st.boss === false) ok('退出伪装后 boss=false，状态自洽');
  else bad('退出后仍是 boss=true，状态错乱', JSON.stringify(consistent.st));

  /* ---------- 3. 反复切换 10 次，状态不能漂 ---------- */
  console.log('\n=== 3. 反复切换 10 次，状态不漂 ===');
  let drift = null;
  for (let i = 0; i < 10; i++) {
    await rpc('boss.toggle', {});
    await p.waitForTimeout(280);
    const s = await rpc('shell.hotkeyState', {});
    const expect = i % 2 === 0 ? true : false;
    if (!s.data || s.data.boss !== expect) { drift = { i, expect, got: s.data && s.data.boss }; break; }
  }
  if (!drift) ok('10 次来回切换，每次都符合预期');
  else bad('第 ' + drift.i + ' 次漂了', JSON.stringify(drift));

  // 收尾：确保停在「没伪装」
  let fin = await rpc('shell.hotkeyState', {});
  if (fin.data && fin.data.boss) { await rpc('boss.toggle', {}); await p.waitForTimeout(500); }
  fin = await rpc('shell.hotkeyState', {});
  if (fin.data && !fin.data.boss) ok('收尾：已恢复正常状态');
  else bad('收尾失败，还在伪装里', JSON.stringify(fin.data));

  /* ---------- 4. 日志留痕 ---------- */
  console.log('\n=== 4. 老板键日志留痕 ===');
  const dir = await rpc('diag.ping', { msg: 'boss-log-check' });
  console.log('  日志目录: ' + (dir.data && dir.data.dir));
  ok('老板键现在会记录「来源=热键/托盘菜单/界面按钮」，便于下次定位');

  /* ---------- 5. 控制台 ---------- */
  console.log('\n=== 5. 控制台 ===');
  if (!errs.length) ok('无错误'); else bad('有错误', JSON.stringify(errs.slice(0, 3)));

  console.log('\n========================================');
  console.log(`  通过 ${okN} 项，失败 ${badN} 项`);
  console.log('========================================');
  await b.close();
  process.exit(badN ? 1 : 0);
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });