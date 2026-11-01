// #192 单元验证：只验算法，不连应用。
// 「每月最后一个周四」这类规则最容易在月末边界上错，先离线算准。
// 用法：node unit-192.js  （会先调 esbuild 把 smartDate.ts 转成 CJS）
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
/*
 * 转译用 esbuild。踩过两个坑：
 *   1. .bin/esbuild 在 Windows 上是个 shell 脚本 → execFile ENOENT
 *   2. .bin/esbuild.cmd 要 cmd.exe 才能跑 → execFile EINVAL
 * 直接用包装好的原生二进制最省事。
 */
const ESBUILD = path.join(ROOT, 'web/node_modules/@esbuild/win32-x64/esbuild.exe');
const OUT = path.join(__dirname, '.smartDate.cjs');

execFileSync(ESBUILD, [
  path.join(ROOT, 'web/src/lib/smartDate.ts'),
  '--format=cjs', `--outfile=${OUT}`, '--log-level=error',
], { stdio: 'inherit' });

const { nthWeekdayOfMonth, parseSmartDate, repeatCode, repeatLabel } = require(OUT);

let pass = 0, fail = 0;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function eq(actual, expect, what) {
  const a = actual instanceof Date ? ymd(actual) : actual;
  if (a === expect) pass++;
  else { fail++; console.log(`  ✗ ${what}: 得到 ${JSON.stringify(a)}，应为 ${JSON.stringify(expect)}`); }
}

console.log('=== nthWeekdayOfMonth（月末边界最容易错）===');
// 2026-11：11/1 是周日，周四 = 5,12,19,26
eq(nthWeekdayOfMonth(2026, 10, 4, -1), '2026-11-26', '2026-11 最后一个周四');
eq(nthWeekdayOfMonth(2026, 10, 4, 1), '2026-11-05', '2026-11 第 1 个周四');
eq(nthWeekdayOfMonth(2026, 10, 4, 2), '2026-11-12', '2026-11 第 2 个周四');
// 2026-02 只有 28 天
eq(nthWeekdayOfMonth(2026, 1, 4, -1), '2026-02-26', '2026-02 最后一个周四（短月）');
eq(nthWeekdayOfMonth(2026, 1, 4, 5), '2026-02-26', '2026-02 要第 5 个周四 → 退回最后一个');
// 2028 闰年 2/29
eq(nthWeekdayOfMonth(2028, 1, 2, -1), '2028-02-29', '2028-02 最后一个周二（闰月末日）');
// w=0（周日）边界：(last.getDay()-0+7)%7 必须是 0 而不是 7
eq(nthWeekdayOfMonth(2026, 10, 0, -1), '2026-11-29', '2026-11 最后一个周日（w=0 边界）');
eq(nthWeekdayOfMonth(2026, 10, 0, 1), '2026-11-01', '2026-11 第 1 个周日');
// 跨年
eq(nthWeekdayOfMonth(2026, 11, 5, -1), '2026-12-25', '2026-12 最后一个周五');

console.log('\n=== parseSmartDate 识别 ===');
const cases = [
  ['每月最后一个周四 交房租', 'monthly-weekday', -1, 4],
  ['每月第2个周二 复盘', 'monthly-weekday', 2, 2],
  ['每个月最后1个星期五 对账', 'monthly-weekday', -1, 5],
  ['每月第一个周一 例会', 'monthly-weekday', 1, 1],
];
for (const [text, rep, nth, wd] of cases) {
  const p = parseSmartDate(text);
  eq(p.repeat, rep, `「${text}」repeat`);
  eq(p.nth, nth, `「${text}」nth`);
  eq(p.weekday, wd, `「${text}」weekday`);
  if (p.due) {
    const d = new Date(p.due + 'T00:00:00');
    // 断言「算出来的日子确实是第 n 个周 wd」，而不是只看格式：
    //   ① 星期对   ② 用同月同规则再算一次，必须等于它自己
    eq(d.getDay(), wd, `「${text}」due 的星期`);
    const again = nthWeekdayOfMonth(d.getFullYear(), d.getMonth(), wd, nth);
    eq(again, ymd(d), `「${text}」due 与同规则重算一致`);
    // 再补一条：往前推 7 天必须是上一个月（说明这是「第 1 个」或「最后一个」那一侧）
    if (nth === -1) {
      const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
      eq(prev.getMonth() !== d.getMonth() ? 'next-month' : 'same-month', 'next-month', `「${text}」确实是当月最后一个`);
    }
  }
  console.log(`  · ${text} → ${p.due} / ${p.hint}`);
}

console.log('\n=== 不该被误伤的旧规则 ===');
const keep = [
  ['每月最后一天 交水电', 'monthly-last'],
  ['每月5号 还信用卡', 'monthly'],
  ['每周四 运动', 'weekly'],
  ['每天 吃药', 'daily'],
  ['每年3月6日 生日', 'yearly'],
];
for (const [text, rep] of keep) {
  const p = parseSmartDate(text);
  eq(p.repeat, rep, `「${text}」仍然是 ${rep}`);
  console.log(`  · ${text} → ${p.due} / ${p.hint}`);
}

console.log('\n=== 编码往返 ===');
eq(repeatCode({ repeat: 'monthly-weekday', nth: -1, weekday: 4 }), 'monthly-weekday:-1:4', '编码最后一个周四');
eq(repeatLabel('monthly-weekday:-1:4'), '每月最后一个周四', '解码最后一个周四');
eq(repeatLabel('monthly-weekday:2:2'), '每月第 2 个周二', '解码第 2 个周二');
eq(repeatCode({ repeat: 'daily' }), 'daily', '普通规则原样返回');
eq(repeatLabel('monthly-last'), '每月最后一天', '旧规则标签不受影响');

fs.unlinkSync(OUT);
console.log(`\n${fail === 0 ? '✓ 全部通过' : '✗ 有失败'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);