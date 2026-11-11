/**
 * 加锁日记的泄漏回归（#244 及其衍生面）。
 *
 * 为什么单独写这个探针：
 *   #244 第一次只修了 `entry.list` 和 `search.all`，跑完当时那 9 项是**全绿**的，
 *   但 `review.day` 照样把加锁那天的全文吐出来。
 *   「改完这一处就绿了」不等于「没有别的地方漏」——
 *   锁是在数据层判的，那就必须**把所有会返回日记内容的接口挨个点一遍**。
 *
 * 用法：
 *   node tests/verify-lock-leak.js <token> [lockedDate]
 *   不传 lockedDate 时自动从 vault.status 里找第一条 diary 规则。
 */
const http = require('http');

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

let failed = 0;
function check(ok, label, extra = '') {
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`);
}

(async () => {
  if (!TOKEN) { console.error('需要 token：node verify-lock-leak.js <token>'); process.exit(2); }

  // 找出一个真正被锁住的日期
  const st = await rpc('vault.status', {});
  const rules = (st.data && st.data.rules) || [];
  const dayRule = rules.find((r) => r.scope === 'diary' && r.target);
  if (!dayRule) {
    console.log('\n当前没有「单日加锁」规则，跳过泄漏回归（这是正常情况）。');
    console.log('建议手动给某一天加密码后再跑一次。');
    process.exit(0);
  }
  const LOCKED = process.argv[3] || dayRule.target;

  // 取一段包含该日期的区间，用于测区间类接口
  const from = LOCKED.slice(0, 8) + '01';
  const to = LOCKED;

  console.log(`\n锁定日期: ${LOCKED}   区间: ${from} ~ ${to}\n`);

  /* ---------- 1. 必须**不**出现锁定日内容 / 日期痕迹的接口 ---------- */
  console.log('=== 不应泄漏内容或存在性的接口 ===');

  /*
   * entry.get 是**唯一能拿到全部模块值 + 正文 + 标签**的接口。
   * 只在列表上过滤、把内容源留着，锁就只是界面装饰。
   * 这条是第二轮回归才补上的 —— 上一次只测了 list / search，漏了它。
   */
  const one = (await rpc('entry.get', { date: LOCKED })).data || {};
  check(one.locked === true, 'entry.get 标记 locked=true');
  check(!one.plain && !one.title, 'entry.get 不返回正文/标题');
  check(Object.keys(one.values || {}).length === 0, 'entry.get 不返回任何模块值');
  check((one.tags || []).length === 0, 'entry.get 不返回标签');

  // 单日总结：正文、字数、标签全部必须为空
  const day = (await rpc('review.day', { date: LOCKED })).data || {};
  check(day.locked === true, 'review.day 标记 locked=true');
  check(!day.plain, 'review.day 不返回正文', JSON.stringify(day.plain || ''));
  check(!day.oneLine, 'review.day 不返回摘要');
  check((day.tags || []).length === 0, 'review.day 不返回标签');
  check(Number(day.chars) === 0, 'review.day 字数为 0', String(day.chars));
  check(Number(day.mood) === 0 && !day.weather, 'review.day 不返回心情/天气');

  // 列表：流 / 记录都走这个
  const list = (await rpc('entry.list', { limit: 200 })).data || [];
  const hit = list.find((x) => x.date === LOCKED);
  if (hit) {
    check(hit.locked === true, 'entry.list 该日标记 locked=true');
    check(!hit.plain && !hit.title && !(hit.tags || []).length,
      'entry.list 该日正文/标题/标签全空');
  } else {
    check(true, 'entry.list 该日未出现在结果中（等价于不可见）');
  }

  // 全局搜索：整条跳过
  const search = (await rpc('search.all', { q: '的', per: 20 })).data || [];
  check(!search.some((x) => x.kind === 'entry' && x.date === LOCKED),
    'search.all 不返回该日');

  // 草稿箱
  const drafts = (await rpc('entry.drafts', {})).data || [];
  check(!drafts.some((x) => x.date === LOCKED), 'entry.drafts 不返回该日');

  // 那年今日
  const otd = (await rpc('onthisday', { date: LOCKED })).data || [];
  check(!otd.some((x) => x.date === LOCKED), 'onthisday 不返回该日');

  // 分区间总结：逐日摘要里不能有这天
  const range = (await rpc('review.range', { from, to })).data || {};
  const dayPt = (range.byDay || []).find((x) => x.date === LOCKED);
  check(!dayPt || (!dayPt.oneLine && Number(dayPt.chars) === 0),
    'review.range 该日摘要与字数均为空');
  check(!(range.tagsTop || []).some((t) => t.tag && t.tag === '黄文'),
    'review.range 不泄漏锁定日的标签');

  /* ---------- 2. 解锁之后必须恢复正常 ---------- */
  console.log('\n=== 解锁后应恢复（否则是「锁死」而非「上锁」）===');
  const before = (await rpc('review.day', { date: LOCKED })).data || {};
  check(before.locked === true, '解锁前 locked=true（作为对照）');
  console.log('  说明：解锁需要密码，探针不猜密码；');
  console.log('        手动在界面解锁后重跑本脚本，locked 应为 false 且正文回来。');

  console.log('\n' + (failed ? `✗ ${failed} 项未通过` : '✓ 全部通过'));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('探针异常:', e.message);
  process.exit(2);
});
