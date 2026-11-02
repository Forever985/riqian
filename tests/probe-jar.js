/**
 * 储蓄罐探针（第 97 条）。
 *
 * 判据不看截图，只看数字：
 *   ① 建罐子后卡片上有进度条、百分比
 *   ② 存 10 → 余额 10；下一期建议 20（递增模式推算正确）
 *   ③ 取 999（超过余额）要被拒，余额不变
 *   ④ 关键：账本「支出合计」不该被存钱撑大 —— 这是后端口径的事，
 *      存钱在 ledger 里是一条记录，但它不是支出。
 */
const { chromium } = require('playwright-core');

let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fails.push(name); console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(20000);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 72000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const call = async (m, a) => {
    const r = await rpc(m, a);
    if (!r.ok) throw new Error(m + ' 失败: ' + r.err);
    return r.data;
  };

  /* 清掉旧探针数据，保证可重复 */
  const list0 = await call('jar.list', {});
  for (const j of list0.jars || []) {
    if (j.name.indexOf('探针') === 0) await call('jar.delete', { id: j.id });
  }

  const before = await call('ledger.list', { from: '2026-01-01', to: '2026-12-31' });

  /* ---------- ① 建罐子 ---------- */
  const added = await call('jar.add', {
    name: '探针-52周', target: 13780, mode: 'step', period: 'week',
    baseAmount: 10, stepAmount: 10, color: '', icon: '🎯', note: '',
  });
  ok('jar.add 返回 id', !!added.id);

  const presets = await call('jar.presets', {});
  ok('预设 5 档', presets.length === 5, '实际 ' + presets.length);

  /* ---------- ② 存 10 ---------- */
  const d1 = await call('jar.deposit', { id: added.id, dir: 'in', amount: 10, date: '2026-11-02', note: '第1期' });
  ok('存 10 成功', d1.ok !== false);
  const det1 = await call('jar.detail', { id: added.id });
  ok('余额 = 10', det1.balance === 10, '实际 ' + det1.balance);
  ok('下一期建议 = 20', det1.nextAmount === 20, '实际 ' + det1.nextAmount);

  /* ---------- ③ 取超余额要被拒 ---------- */
  const d2 = await call('jar.deposit', { id: added.id, dir: 'out', amount: 999, date: '2026-11-02', note: '' });
  ok('取 999 被拒', d2.ok === false, '竟然成功了');
  ok('拒绝理由带余额', /只有/.test(d2.err || ''), d2.err || '(无 err)');
  const det2 = await call('jar.detail', { id: added.id });
  ok('被拒后余额仍是 10', det2.balance === 10, '实际 ' + det2.balance);

  /* ---------- ④ 账本口径 ---------- */
  const after = await call('ledger.list', { from: '2026-01-01', to: '2026-12-31' });
  ok('账本支出没被存钱撑大', before.expense === after.expense,
    before.expense + ' → ' + after.expense);
  ok('明细条数 +1', after.items.length === before.items.length + 1,
    before.items.length + ' → ' + after.items.length);
  const jarRows = after.items.filter((i) => i.cat === '存钱').length;
  ok('明细里看得见「存钱」', jarRows === 1, '实际 ' + jarRows);

  /* ---------- ⑤ 界面真的画出来了 ---------- */
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(1400);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.nav button')].find((x) => (x.textContent || '').indexOf('记账本') >= 0);
    if (btn) btn.click();
  });
  await p.waitForTimeout(1000);

  const card = await p.evaluate(() => {
    const c = document.querySelector('.jar');
    if (!c) return null;
    const bar = c.querySelector('.jar-bar i');
    return {
      text: (c.textContent || '').replace(/\s+/g, ' ').trim(),
      barW: bar ? bar.style.width : '',
    };
  });
  ok('卡片渲染出来了', !!card, '找不到 .jar');
  if (card) {
    ok('卡片显示余额 10', /10\.00/.test(card.text), card.text);
    ok('卡片显示 0.1%', /0\.1%/.test(card.text), card.text);
    ok('进度条宽度 > 0', parseFloat(card.barW) > 0, 'barW=' + card.barW);
  }

  /* ---------- 清理 ---------- */
  const lst = await call('jar.list', {});
  for (const j of lst.jars || []) {
    if (j.name.indexOf('探针') === 0) {
      const dt = await call('jar.detail', { id: j.id });
      for (const it of dt.items || []) await call('jar.removeItem', { id: it.id });
      await call('jar.delete', { id: j.id });
    }
  }

  console.log('\n通过 ' + pass + ' / 失败 ' + fails.length);
  if (fails.length) console.log('失败项: ' + fails.join(' | '));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
