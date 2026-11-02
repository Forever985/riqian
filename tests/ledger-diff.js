/* 逐字对比重构前后的账本快照 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'shots');
const before = JSON.parse(fs.readFileSync(path.join(dir, 'ledger-before.json'), 'utf8'));
const after = JSON.parse(fs.readFileSync(path.join(dir, 'ledger-after.json'), 'utf8'));

const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
let diffN = 0;

function cmpKV(label, a, b, pathStr) {
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  // 数字/字符串逐项报
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) {
    diffN++;
    console.log(`\n  ✗ ${pathStr}${label}`);
    console.log(`      重构前: ${sa && sa.slice(0, 220)}`);
    console.log(`      重构后: ${sb && sb.slice(0, 220)}`);
    return false;
  }
  return true;
}

for (const k of keys) {
  const a = before[k], b = after[k];
  if (!a || !b) { diffN++; console.log(`\n  ✗ 状态缺失: ${k}  ${a ? '重构后没有' : '重构前没有'}`); continue; }
  if (a.err || b.err) { console.log(`  ! ${k}: err=${a.err || b.err}`); continue; }

  console.log(`\n=== ${k} ===`);
  const same = [];
  for (const field of Object.keys(a)) {
    const okSame = JSON.stringify(a[field]) === JSON.stringify(b[field]);
    if (!okSame) cmpKV(`${field}`, a[field], b[field], `${k}.`);
    else same.push(field);
  }
  if (same.length) console.log(`  ✓ 一致: ${same.join(', ')}`);
}

console.log('\n========================================');
console.log(diffN === 0 ? '  完全一致：0 处差异' : `  发现 ${diffN} 处差异`);
console.log('========================================');
process.exit(diffN ? 1 : 0);