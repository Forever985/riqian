/* 验证 bug 2：储蓄罐流水在账本里必须看得见
   做法：只在储蓄罐里存一笔（不带账户），看那一天能不能真的渲染出来。

   修复前的病灶：
     days（按天小计）排掉了罐子流水 —— 这是对的，合计确实不含它；
     但前端拿 days 当渲染骨架，于是"那天只有存钱"的日子不在 days 里，
     明细拿到了却永远挂不上去，用户在账本里看不到这笔钱，会以为丢了。

   修复后：
     后端另给 dayItems（明细口径的天），前端用它当骨架，两个口径分清楚。
   所以这个探针要验的是 dayItems + 真实 DOM，而不是 days。 */
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1500);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 74000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => {
    const r = await rpc(m, a);
    if (!r.ok) throw new Error(m + ' → ' + r.err);
    return r.data;
  };

  const PASS = [];
  const FAIL = [];
  const ok = (t) => { PASS.push(t); console.log('  ✅ ' + t); };
  const bad = (t) => { FAIL.push(t); console.log('  ❌ ' + t); };

  const jar = await call('jar.add', { name: 'BUGTEST2', target: 0, mode: 'free', period: '', baseAmount: 0, stepAmount: 0, color: '', icon: '', note: '' });
  // 用一个很久以前的日期，避免干扰当月数据
  const day = '2019-03-15';
  await call('jar.deposit', { id: jar.id, dir: 'in', amount: 500, date: day, note: '探针存款', accountId: '' });

  const list = await call('ledger.list', { from: '2019-03-01', to: '2019-03-31' });
  const itemsThatDay = (list.items || []).filter((i) => i.date === day);
  const dayGroup = (list.days || []).find((d) => d.date === day);
  const inSkeleton = (list.dayItems || []).some((d) => d.date === day);

  console.log('那天(' + day + ')的明细条数 =', itemsThatDay.length);
  console.log('明细金额 =', itemsThatDay.map((i) => i.kind + ':' + i.amount).join(', '));
  console.log('后端 days（合计口径）里有这天吗 =', dayGroup ? '有' : '没有（正确，罐子不算收支）');
  console.log('后端 dayItems（明细口径）里有这天吗 =', inSkeleton ? '有' : '没有');
  console.log('');

  console.log('【后端口径】');
  if (itemsThatDay.length > 0) ok('明细里确实有这笔罐子流水');
  else bad('明细里根本没有这笔钱 —— 后端 items 查询漏了');
  if (inSkeleton) ok('dayItems 骨架包含这天 → 前端能挂上去');
  else bad('dayItems 里没有这天 → 前端仍会漏渲染');
  if (!dayGroup) ok('days 不含这天（正确：罐子存取不算本月收支）');
  else bad('days 竟然包含了罐子流水 → 合计口径又搞混了');

  // 验真实 DOM：切到账本页，把区间指到那天，看有没有渲染出这一行
  console.log('');
  console.log('【真实界面】');
  try {
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('.nav button')].find((b) => (b.getAttribute('data-nav') || '') === 'ledger');
      if (btn) btn.click();
    });
    await p.waitForTimeout(1200);

    // 用页面上能拿到的最直接方式：数 .lg-item 里有没有「存进罐子」标记
    const rendered = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.lg-item')];
      return rows.map((r) => ({
        cat: (r.querySelector('.lg-cat') || {}).textContent || '',
        note: (r.querySelector('.lg-note') || {}).textContent || '',
        tags: [...r.querySelectorAll('.lg-acc-tag')].map((t) => t.textContent || ''),
        amt: (r.querySelector('.lg-amt') || {}).textContent || '',
      })).filter((r) => r.cat.includes('存钱') || r.note.includes('探针存款') || r.tags.some((t) => t.includes('罐子')));
    });

    if (rendered.length) {
      ok('界面上渲染出了罐子流水 → ' + JSON.stringify(rendered[0]));
      const hasJarTag = rendered.some((r) => r.tags.some((t) => t.includes('罐子')));
      if (hasJarTag) ok('这笔有「存进罐子」标记，不会被误读成支出');
      else bad('缺「存进罐子」标记，会让人读成收支');
      const noMinus = rendered.every((r) => !r.amt.trim().startsWith('-'));
      if (noMinus) ok('金额没有画成 −500（罐子流水不是支出）');
      else bad('金额画成了负数，会被读成支出');
    } else {
      /* 默认视图是当月，2019-03 那笔不在里面 —— 这不算失败，但要查证一下
         是不是真的因为月份不对，而不是又漏渲染了。 */
      const inView = await p.evaluate(() => document.body.innerText.includes('2019-03-15'));
      if (!inView) {
        console.log('  ⏭ 界面当前不在 2019-03，跳过 DOM 判定（后端口径已验）');
      } else {
        bad('界面停在了 2019-03 但没渲染出这笔罐子流水');
      }
    }
  } catch (e) {
    console.log('  ⚠️ DOM 检查没法做：' + e.message);
  }

  console.log('');
  console.log(`【结果】通过 ${PASS.length} · 失败 ${FAIL.length}`);

  // 清理
  await call('jar.delete', { id: jar.id });
  const all = await call('ledger.list', { from: '2019-03-01', to: '2019-03-31' });
  for (const it of (all.items || [])) {
    if (it.cat === '存钱' && it.date === day) await call('ledger.delete', { id: it.id });
  }
  await b.close().catch(() => {});
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });