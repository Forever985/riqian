/* 验证 bug 4：ChangeRoot 在 WAL 模式下直接 File.Copy 会漏掉还没 checkpoint 的写入。

   修复前：conn.Close() 后直接 File.Copy(DbPath, dst)，只拷主文件，-wal 里的全丢。
          实测主库 356 KB / wal 2.77 MB → 拷出来缺约 89% 数据。
   修复后：Close 前先 PRAGMA wal_checkpoint(TRUNCATE)，wal 归零，主库才是完整的；
          拷完再用 integrity_check 验一遍，坏了就中止迁移并原地退回。

   这个探针不真的迁移目录（会动用户数据），而是验同一条链路的两个可观测事实：
     1. checkpoint(TRUNCATE) 之后 -wal 归零、主文件变大到包含全部数据
     2. 用独立连接读主文件（不挂 -wal），能看到刚写进去的那条 —— 证明拷它不会丢
*/
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1500);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 76000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => { const r = await rpc(m, a); if (!r.ok) throw new Error(m + ' → ' + r.err); return r.data; };

  const PASS = [], FAIL = [];
  const ok = (t) => { PASS.push(t); console.log('  ✅ ' + t); };
  const bad = (t) => { FAIL.push(t); console.log('  ❌ ' + t); };

  const boot = await call('bootstrap');
  const dbPath = boot.dbPath;
  const walPath = dbPath + '-wal';
  const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return -1; } };

  console.log('库文件:', dbPath);
  console.log('写数据前  主文件 =', sizeOf(dbPath), ' wal =', sizeOf(walPath));

  // 写一条能唯一定位的记录
  const mark = 'WALTEST-' + Date.now();
  await call('setting.set', { k: 'walTestMark', v: mark });
  await p.waitForTimeout(400);

  console.log('写数据后  主文件 =', sizeOf(dbPath), ' wal =', sizeOf(walPath));
  console.log('');

  // 关键一步：让后端做 checkpoint，看 wal 是否归零
  console.log('【checkpoint 是否生效】');
  const beforeMain = sizeOf(dbPath);
  const beforeWal = sizeOf(walPath);
  try {
    const r = await call('diag.checkpoint', {});
    if (r && (r.ok || r.busy === 0)) ok('后端能执行 wal_checkpoint'); else console.log('  返回：', JSON.stringify(r));
  } catch (e) {
    console.log('  后端没有 diag.checkpoint 这个接口：' + e.message);
  }
  await p.waitForTimeout(500);

  const afterMain = sizeOf(dbPath);
  const afterWal = sizeOf(walPath);
  console.log('  checkpoint 后  主文件 =', afterMain, ' wal =', afterWal);
  if (afterWal <= 0 || afterWal < beforeWal) ok(`wal 被并回主库（${beforeWal} → ${afterWal}）`);
  else bad(`wal 没减小（${beforeWal} → ${afterWal}），checkpoint 没起效`);
  if (afterMain >= beforeMain) ok(`主文件没有变小（${beforeMain} → ${afterMain}）`);
  else bad('主文件反而变小了，不正常');

  // 用独立连接读主文件，确认那条 mark 真的在主库里（而不是只躺在 wal）
  console.log('');
  console.log('【主文件本身是否含最新数据】');
  const tmp = path.join(os.tmpdir(), 'wal-probe-' + Date.now() + '.db');
  fs.copyFileSync(dbPath, tmp);          // 只拷主文件，故意不拷 -wal
  let found = false;
  try {
    const { execFileSync } = require('child_process');
    // 用 node 里没有 sqlite 绑定，借后端的读接口不现实（它读的是原库）
    // 所以这里退一步：直接扫文件字节里有没有那个 mark 字符串
    const buf = fs.readFileSync(tmp);
    found = buf.includes(Buffer.from(mark, 'utf8'));
  } catch { }
  console.log('  单独拷主文件，里面能找到刚写的 mark =', found);
  if (found) ok('主文件本身就含最新写入 → 拷它不会丢数据');
  else bad('主文件里没有最新写入 → 直接拷主文件仍然会丢（checkpoint 没真正落盘）');
  try { fs.unlinkSync(tmp); } catch { }

  // 清理
  await call('setting.set', { k: 'walTestMark', v: '' });

  console.log('');
  console.log(`【结果】通过 ${PASS.length} · 失败 ${FAIL.length}`);
  await b.close().catch(() => {});
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });