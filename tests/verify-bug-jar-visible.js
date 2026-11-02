/* 验证 bug 2 的界面侧：罐子流水必须在账本页真的渲染出来。
   verify-bug-ledgerday.js 验的是后端口径（dayItems 骨架），
   这里补上"眼睛能不能看见"—— 用当月日期，让默认视图就能撞上。*/
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1500);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 74500 + Math.floor(Math.random() * 400);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => {
    const r = await rpc(m, a);
    if (!r.ok) throw new Error(m + ' → ' + r.err);
    return r.data;
  };

  const PASS = [], FAIL = [];
  const ok = (t) => { PASS.push(t); console.log('  ✅ ' + t); };
  const bad = (t) => { FAIL.push(t); console.log('  ❌ ' + t); };

  const today = new Date();
  const ymd = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const MARK = '罐子可见性探针';

  const jar = await call('jar.add', { name: 'VIS-TEST', target: 0, mode: 'free', period: '', baseAmount: 0, stepAmount: 0, color: '', icon: '', note: '' });
  const dep = await call('jar.deposit', { id: jar.id, dir: 'in', amount: 77, date: ymd, note: MARK, accountId: '' });

  // 切到账本页。必须先切走再切回来 ——
  // 如果页面本来就停在账本页，点同一个导航按钮不会让组件重新挂载，
  // load() 就不会重跑，刚插进去的数据自然看不见（那是探针的问题，不是产品的）。
  const goNav = async (name) => {
    await p.evaluate((n) => {
      const btn = [...document.querySelectorAll('.nav button')].find((b) => (b.getAttribute('data-nav') || '') === n);
      if (btn) btn.click();
    }, name);
  };
  await goNav('today');
  await p.waitForTimeout(500);
  await goNav('ledger');
  await p.waitForTimeout(1800);

  const row = await p.evaluate((mark) => {
    const rows = [...document.querySelectorAll('.lg-item')];
    for (const r of rows) {
      const note = (r.querySelector('.lg-note') || {}).textContent || '';
      if (note.includes(mark)) {
        return {
          cat: (r.querySelector('.lg-cat') || {}).textContent || '',
          note,
          tags: [...r.querySelectorAll('.lg-acc-tag')].map((t) => t.textContent || ''),
          amt: (r.querySelector('.lg-amt') || {}).textContent || '',
          amtClass: (r.querySelector('.lg-amt') || {}).className || '',
        };
      }
    }
    return null;
  }, MARK);

  console.log(`【界面】今天 ${ymd} 存 77 进罐子，账本页能不能看见`);
  if (row) {
    ok('渲染出来了 → ' + JSON.stringify(row));
    if (row.tags.some((t) => t.includes('存进罐子'))) ok('带「存进罐子」标记');
    else bad('没有「存进罐子」标记，会被读成普通收支');
    if (!row.amt.trim().startsWith('-')) ok(`金额没有画成负数（实际 "${row.amt.trim()}"）`);
    else bad(`金额画成了负数 "${row.amt.trim()}"，会被读成支出`);
    if (row.amtClass.includes('muted')) ok('金额用弱化色，和正常收支区分开');
    else bad('金额和正常收支同色，看不出这是转账');
  } else {
    bad('界面里找不到这笔罐子流水 —— 这正是修复前的症状');
  }

  // 那天抬头不能是空白
  const head = await p.evaluate((mark) => {
    const cards = [...document.querySelectorAll('.lg-day')];
    for (const c of cards) {
      if ((c.textContent || '').includes(mark)) {
        const h = c.querySelector('.lg-day-h');
        return h ? (h.textContent || '').trim() : '';
      }
    }
    return null;
  }, MARK);
  console.log('');
  console.log('【抬头】' + JSON.stringify(head));
  if (head && head.length > 0) ok('日期抬头有文字，不是一片空白');
  else bad('抬头是空的，用户不知道这天发生了什么');

  console.log('');
  console.log(`【结果】通过 ${PASS.length} · 失败 ${FAIL.length}`);

  // 清理
  try { if (dep && dep.id) await call('jar.removeItem', { id: dep.id }); } catch { }
  try { await call('jar.delete', { id: jar.id }); } catch { }
  try {
    const all = await call('ledger.list', { from: ymd, to: ymd });
    for (const it of (all.items || [])) {
      if ((it.note || '').includes(MARK)) await call('ledger.delete', { id: it.id });
    }
  } catch { }

  await b.close().catch(() => {});
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });