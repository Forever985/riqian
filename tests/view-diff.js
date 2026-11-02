/*
 * view-diff.js —— 逐字对比两次快照，只报「真差异」
 *
 * 输出策略：
 *   - 每个状态分别比，行数不同先报出来
 *   - 按行做最长公共子序列之外的差异，报前 12 处
 *   - 全部一致就明确打印「0 处差异」，不能什么都不说
 *
 * 用法：node view-diff.js before after
 */
const fs = require('fs');
const path = require('path');

const [a, b] = [process.argv[2] || 'before', process.argv[3] || 'after'];
const dir = path.join(__dirname, 'shots');
const A = JSON.parse(fs.readFileSync(path.join(dir, `view-${a}.json`), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(dir, `view-${b}.json`), 'utf8'));

const keysA = Object.keys(A);
const keysB = Object.keys(B);
const onlyA = keysA.filter((k) => !(k in B));
const onlyB = keysB.filter((k) => !(k in A));

if (onlyA.length) console.log('仅在 ' + a + ' 里（现在没了）:', onlyA.join(' | '));
if (onlyB.length) console.log('仅在 ' + b + ' 里（新出来的）:', onlyB.join(' | '));

/** 简单的逐行 diff：找出 A 有而 B 没有 / B 有而 A 没有的行 */
function diffLines(x, y) {
  const setX = new Map();
  const setY = new Map();
  x.forEach((l, i) => { if (!setX.has(l)) setX.set(l, []); setX.get(l).push(i); });
  y.forEach((l, i) => { if (!setY.has(l)) setY.set(l, []); setY.get(l).push(i); });

  const gone = [];
  const came = [];
  for (const [l, idxs] of setX) {
    const cntY = (setY.get(l) || []).length;
    if (idxs.length > cntY) gone.push({ line: l, at: idxs[0], extra: idxs.length - cntY });
  }
  for (const [l, idxs] of setY) {
    const cntX = (setX.get(l) || []).length;
    if (idxs.length > cntX) came.push({ line: l, at: idxs[0], extra: idxs.length - cntX });
  }
  return { gone, came };
}

let totalDiff = 0;
const report = [];

for (const k of keysA) {
  if (!(k in B)) continue;
  const x = A[k];
  const y = B[k];
  if (x.length === y.length && x.every((l, i) => l === y[i])) {
    report.push({ key: k, same: true, n: x.length });
    continue;
  }
  const { gone, came } = diffLines(x, y);
  const n = Math.max(gone.length, came.length);
  totalDiff += n;
  report.push({ key: k, same: false, n: x.length, m: y.length, gone, came });
}

console.log('\n=== 逐状态结果 ===');
for (const r of report) {
  if (r.same) {
    console.log(`  ✅ ${r.key}  (${r.n} 行，完全一致)`);
  } else {
    console.log(`  ❌ ${r.key}  (${r.n} → ${r.m} 行，${r.gone.length + r.came.length} 处差异)`);
    r.gone.slice(0, 12).forEach((g) => console.log(`        - 少了 [第${g.at}行] ${g.line.slice(0, 160)}`));
    r.came.slice(0, 12).forEach((c) => console.log(`        + 多了 [第${c.at}行] ${c.line.slice(0, 160)}`));
    if (r.gone.length > 12 || r.came.length > 12) console.log('        …（还有更多，已截断）');
  }
}

const bad = report.filter((r) => !r.same).length;
console.log('\n=== 合计 ===');
console.log(`状态 ${report.length} 个；一致 ${report.length - bad} 个；有差异 ${bad} 个；差异条目 ${totalDiff}`);
if (!bad) console.log('**0 处差异**');
else process.exitCode = 1;