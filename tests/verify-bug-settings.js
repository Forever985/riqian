/* 验证 bug 7：设置导出/导入必须把 modules 也带回来
   修复前 SettingsExport 写了 modules，SettingsImport 只读 settings，模块配置静默丢失。*/
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1400);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 75500 + Math.floor(Math.random() * 300);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => { const r = await rpc(m, a); if (!r.ok) throw new Error(m + ' → ' + r.err); return r.data; };

  const PASS = [], FAIL = [];
  const ok = (t) => { PASS.push(t); console.log('  ✅ ' + t); };
  const bad = (t) => { FAIL.push(t); console.log('  ❌ ' + t); };

  // 导出
  const exp = await call('settings.export', {});
  if (!exp || !exp.path) { bad('导出失败'); }
  else ok('导出成功：' + exp.path);

  // 读回文件看结构
  const fs = require('fs');
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(exp.path, 'utf8')); } catch (e) { bad('导出的文件读不了：' + e.message); }
  if (doc) {
    console.log('');
    console.log('【导出文件里有什么】');
    console.log('  settings 条数 =', Object.keys(doc.settings || {}).length);
    console.log('  modules 条数 =', (doc.modules || []).length);
    console.log('  pomoPresets =', JSON.stringify(doc.pomoPresets));
    if ((doc.modules || []).length > 0) ok('导出文件里确实带了 modules');
    else bad('导出文件里没有 modules');
  }

  // 直接拿这份文件导回去
  console.log('');
  console.log('【原样导回】');
  const raw = fs.readFileSync(exp.path, 'utf8');
  try {
    const r = await call('settings.import', { json: raw });
    if (r && r.ok) {
      ok(`导入成功：settings ${r.count} 项 · modules ${r.modules} 条`);
      if (typeof r.modules === 'number') {
        if (r.modules > 0) ok('导入时说清楚处理了几个模块（修复前根本不提 modules）');
        else bad('导入报 modules 0 条 —— 模块还是被丢掉了');
      } else {
        bad('导入返回值里没有 modules 字段');
      }
    } else {
      bad('导入失败：' + JSON.stringify(r));
    }
  } catch (e) { bad('import 抛异常：' + e.message); }

  // 模块列表不能因为重复导入而变多
  console.log('');
  console.log('【重复导入不会让模块翻倍】');
  const before = (await call('modules.list', {})) || [];
  await call('settings.import', { json: raw });
  await call('settings.import', { json: raw });
  const after = (await call('modules.list', {})) || [];
  console.log('  导入前', before.length, '个 → 连导两次后', after.length, '个');
  if (after.length === before.length) ok('模块数量没变（按 type 做 upsert，不是无脑插入）');
  else bad(`模块数量变了 ${before.length} → ${after.length}，重复导入会堆出一堆重复模块`);

  // 坏文件不能把现有设置搞坏
  console.log('');
  console.log('【坏文件不该搞坏现有设置】');
  const bootBefore = await call('bootstrap', {});
  const themeBefore = (bootBefore.settings || {}).theme;
  try {
    const r = await call('settings.import', { json: '{"settings":{"theme":"X"},"modules":"这不是数组"}' });
    console.log('  半坏文件的返回 =', JSON.stringify(r));
    ok('坏文件没有让接口崩掉');
  } catch (e) {
    ok('坏文件被挡住并报错：' + e.message);
  }
  const bootAfter = await call('bootstrap', {});
  const themeAfter = (bootAfter.settings || {}).theme;
  console.log('  theme:', JSON.stringify(themeBefore), '→', JSON.stringify(themeAfter));
  if (themeAfter !== undefined && themeAfter !== null) ok('设置里的 theme 仍然存在，没被冲成空');
  else bad('theme 被冲没了');

  // 上面那条是用 theme:"X" 试的，跑完必须把原值写回去，
  // 否则这个探针每跑一次就把用户的主题改成 "X"，属于污染真实库。
  if (themeBefore !== undefined && themeBefore !== null && themeAfter !== themeBefore) {
    try {
      await call('settings.import', { json: JSON.stringify({ settings: { theme: themeBefore } }) });
      const back = (await call('bootstrap', {})).settings || {};
      if (back.theme === themeBefore) ok(`已把 theme 还原成 ${JSON.stringify(themeBefore)}`);
      else bad(`theme 还原失败，现在还是 ${JSON.stringify(back.theme)}`);
    } catch (e) { bad('theme 还原出错：' + e.message); }
  }

  console.log('');
  console.log(`【结果】通过 ${PASS.length} · 失败 ${FAIL.length}`);
  await b.close().catch(() => {});
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });