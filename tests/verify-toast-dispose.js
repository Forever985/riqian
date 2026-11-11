/**
 * 提醒窗（ToastForm）释放后仍被定时器访问的回归。
 *
 * 背景：2026-11-02 / 11-09 / 11-10 三次界面线程崩溃，堆栈完全一致：
 *
 *   System.ObjectDisposedException: Cannot access a disposed object.
 *   Object name: 'Riqian.ToastForm'.
 *      at Form.set_Opacity(Double value)
 *      at Riqian.ToastForm.<.ctor>b__16_1(...)   ← _fade 定时器的 Tick
 *
 * 触发条件：提醒窗正在淡入（约 130 ms）时被关掉 —— 用户点了它，
 * 或者紧接着又来了一个提醒（ShowToast 会先关掉上一个）。
 * 窗体的 Handle 没了，16 ms 跳一次的 _fade 还在跑，下一跳就 set_Opacity → 崩。
 *
 * 这个探针就是复现那个时序：**间隔 40 ms 连发两个提醒**，
 * 第二个必然在第一个淡入途中把它关掉。
 *
 * 用法：node tests/verify-toast-dispose.js <token>
 * 前置：程序已启动且带 --debug-api。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN = process.argv[2] || '';
const PORT = Number(process.env.DEBUG_PORT || 57111);

function rpc(m, a) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ m, a });
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/rpc', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Token': TOKEN,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { reject(new Error(buf.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** 当天日志路径。桌面版把日志放在 %LOCALAPPDATA%\Riqian\logs。 */
function todayLog() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Riqian', 'logs', `${y}-${m}-${day}.log`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function countDisposed(file) {
  try {
    const s = fs.readFileSync(file, 'utf8');
    return (s.match(/ObjectDisposedException/g) || []).length;
  } catch { return 0; }
}

(async () => {
  if (!TOKEN) { console.error('需要 token：node verify-toast-dispose.js <token>'); process.exit(2); }

  const log = todayLog();
  if (!fs.existsSync(log)) {
    console.log('找不到今天的日志：' + log);
    console.log('（程序可能没启动过，或日志目录被改过）');
    process.exit(2);
  }

  const ROUNDS = 5;
  const before = countDisposed(log);

  console.log(`\n日志：${log}`);
  console.log(`修复前累计 ObjectDisposedException：${before}`);
  console.log(`\n连发 ${ROUNDS} 轮「间隔 40 ms 的两个提醒」——\n` +
              `第二个必然在第一个淡入（约 130 ms）途中把它关掉，正是崩溃条件。\n`);

  for (let i = 1; i <= ROUNDS; i++) {
    // 第一个：立刻返回（不 await），第二个 40ms 后到
    const first = rpc('notify.push', {
      title: `探针第${i}轮-A`, body: '第一个（会被立刻关掉）', desktop: 1, duration: 2,
    }).catch(() => null);

    await sleep(40);

    const second = await rpc('notify.push', {
      title: `探针第${i}轮-B`, body: '第二个（替换掉上一个）', desktop: 1, duration: 2,
    }).catch(() => null);
    await first;

    if (!second || !second.ok) {
      console.log(`  ✗ 第 ${i} 轮 notify.push 调用失败：${second && second.err}`);
    }
    await sleep(900);   // 等这轮的两个提醒都淡出完
  }

  await sleep(1500);    // 留时间让最后一跳 tick 落地

  const after = countDisposed(log);
  const delta = after - before;

  console.log(`\n修复后累计：${after}（新增 ${delta}）`);
  if (delta === 0) {
    console.log('\n✓ 通过：提醒窗被提前关掉时不再访问已释放对象');
    process.exit(0);
  } else {
    console.log(`\n✗ 失败：又崩了 ${delta} 次。`);
    console.log('  说明 _fade/_life 定时器仍然在窗体 Dispose 后继续 tick，');
    console.log('  或者 tick 里没有判 Alive()。见 MainFormV7.cs 的 ToastForm。');
    process.exit(1);
  }
})().catch((e) => {
  console.error('探针异常：', e.message);
  process.exit(2);
});
