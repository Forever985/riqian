/*
 * verify-bug-bom.js —— 验证 BOM 收口（Bug 7 的彻底修复）
 *
 * 要证的事：
 *   A. 导出的文件**不带** BOM（第一个字节是 0x7B '{'）
 *   B. 导出的文件原样导回 → 成功，且模块数不变（连导两次也不翻倍）
 *   C. 手工把文件改成带 BOM（模拟老版本导出）→ 导入**仍然成功**
 *      ← 这是用户可见的关键改进：手里已有的旧文件不作废
 *   D. 文件前面多几个空格/换行/零宽字符 → 也能导入
 *   E. 真·坏文件（不是 JSON）→ 仍然明确报错，不装成功
 *
 * 运行：cd tests && CDP_PORT=57041 node verify-bug-bom.js
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = process.env.CDP_PORT || '57011';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = b.contexts()[0];
  let p = ctx.pages().find((x) => x.url().includes('index.html')) || ctx.pages()[0];
  if (!p) { console.error('没找到页面'); process.exit(1); }
  await p.bringToFront().catch(() => {});

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 72000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? '  →  ' + JSON.stringify(extra) : '')); }
  };

  console.log('\n=== A. 导出文件不带 BOM ===');
  const exp1 = await rpc('settings.export');
  const r1 = exp1 && exp1.data;
  ok('导出接口返回 ok', !!(r1 && r1.ok), exp1);
  const file = r1 && r1.path;
  ok('拿到导出路径', !!file, r1);
  if (!file) { console.log('\n无路径，后续跳过'); process.exit(1); }

  const raw = fs.readFileSync(file);
  const head3 = Array.from(raw.slice(0, 3));
  ok('前 3 字节不是 EF BB BF', !(head3[0] === 0xEF && head3[1] === 0xBB && head3[2] === 0xBF),
    { head3, firstChar: String.fromCharCode(head3[0]) });
  ok('第一个字节是 "{" (0x7B)', head3[0] === 0x7B, { head3 });
  console.log('    文件大小 ' + raw.length + ' 字节，头部 hex = ' +
    head3.map((x) => x.toString(16).padStart(2, '0')).join(' '));

  const before = JSON.parse(raw.toString('utf8'));
  const modCount = (before.modules || []).length;
  const setCount = Object.keys(before.settings || {}).length;
  console.log('    文件内容：settings ' + setCount + ' 项，modules ' + modCount + ' 项');

  console.log('\n=== B. 原样导回（干净文件） ===');
  const imp1 = await rpc('settings.import', { json: raw.toString('utf8') });
  const i1 = imp1 && imp1.data;
  ok('干净文件导入成功', !!(i1 && i1.ok), imp1);
  ok('modules 数量与文件一致', !!(i1 && i1.modules === modCount), { got: i1 && i1.modules, want: modCount });

  console.log('\n=== C. 带 BOM 的文件（模拟老版本导出） ===');
  const text = raw.toString('utf8');
  // 直接从字节层面加 BOM，等价于老版本 Encoding.UTF8 写出来的文件
  const bomBuf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
  const bomPath = path.join(os.tmpdir(), '_riqian_bom_test.json');
  fs.writeFileSync(bomPath, bomBuf);
  ok('临时 BOM 文件已写出且头 3 字节正确',
    Array.from(fs.readFileSync(bomPath).slice(0, 3)).join(',') === '239,187,191');

  const imp2 = await rpc('settings.import', { json: bomBuf.toString('utf8') });
  const i2 = imp2 && imp2.data;
  ok('带 BOM 的内容**导入成功**（旧文件不作废）', !!(i2 && i2.ok), imp2);
  ok('带 BOM 导入后 modules 也进来了', !!(i2 && i2.modules === modCount), { got: i2 && i2.modules, want: modCount });

  console.log('\n=== D. 前面多空白 / 零宽字符 ===');
  const dirty = '  \r\n\t\u200B' + text;   // 空格 + 换行 + 制表 + 零宽空格
  const imp3 = await rpc('settings.import', { json: dirty });
  const i3 = imp3 && imp3.data;
  ok('带前导空白与零宽字符仍能导入', !!(i3 && i3.ok), imp3);

  console.log('\n=== E. 真·坏文件必须报错，不能装成功 ===');
  const imp4 = await rpc('settings.import', { json: '这不是 JSON，真的不是' });
  const i4 = imp4 && imp4.data;
  ok('坏内容返回 ok=false', !!(i4 && i4.ok === false), imp4);
  ok('坏内容带错误信息', !!(i4 && i4.err), i4);
  console.log('    报错原文：' + (i4 && i4.err));

  console.log('\n=== F. 连导两次，模块不翻倍 ===');
  const imp5 = await rpc('settings.import', { json: text });
  const i5 = imp5 && imp5.data;
  ok('第二次导入仍成功', !!(i5 && i5.ok), imp5);
  const modsNow = await rpc('modules.list');
  const listNow = (modsNow && modsNow.data) || [];
  const arr = Array.isArray(listNow) ? listNow : (listNow.modules || []);
  const types = arr.map((x) => x.type);
  const dup = types.filter((t, i) => types.indexOf(t) !== i);
  ok('模块没有重复 type', dup.length === 0, { dup, count: types.length });
  ok('模块总数等于导出时的 ' + modCount, arr.length === modCount, { got: arr.length, want: modCount });

  try { fs.unlinkSync(bomPath); } catch {}

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('探针自身出错：', e); process.exit(2); });