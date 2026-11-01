/* e2e-v21：161 预算（日均/预警）/ 162 账户（总览/本月收支）/ 汇总下推 SQL */
const { chromium } = require('playwright-core');

let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 65000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (k) => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate((kk) => { const b2 = document.querySelector(`.nav button[data-nav="${kk}"]`); if (b2) b2.click(); }, k);
    await p.waitForTimeout(1300);
  };

  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const mk = 'v21' + String(Date.now()).slice(-4);

  /* ---------- 准备数据：一个账户 + 几笔账 ---------- */
  const acc = await rpc('account.save', { id: '', name: `${mk}卡`, kind: 'bank', init: 100 });
  const accId = acc?.data?.id || '';

  /*
   * 这个套件以前默认「本月只有我刚造的那几笔账」，于是别人（v11 的 888 房租、
   * 手工记的真实账）一进库就全红。改成先量一次存量，后面所有断言看「我造成的增量」。
   */
  const before = (await rpc('ledger.list', { from: `${ym}-01`, to: `${ym}-31` }))?.data || {};
  const baseOut = Number(before.expense || 0);
  await rpc('ledger.add', { date: `${ym}-02`, kind: 'out', amount: 40, cat: `${mk}餐饮`, note: '午饭', accountId: accId });
  await rpc('ledger.add', { date: `${ym}-03`, kind: 'out', amount: 160, cat: `${mk}交通`, note: '打车', accountId: accId });
  await rpc('ledger.add', { date: `${ym}-04`, kind: 'in', amount: 500, cat: `${mk}工资`, note: '工资', accountId: accId });

  /*
   * 预算必须走界面写：settings 是 bootstrap 时读进 store 的，
   * 直接调 setting.set 只改了库，前端那份不会更新，界面还是空的。
   */

  console.log('\n=== 161 预算 ===');
  await go('today');
  await go('ledger');
  await p.waitForTimeout(1500);

  // 通过「编辑预算」弹层设置：总额 800 + 交通 100
  await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => (c.querySelector('h3')?.innerText || '').includes('预算'));
    const btn = card && [...card.querySelectorAll('button')].find((x) => (x.innerText || '').includes('编辑预算'));
    if (btn) btn.click();
  });
  await p.waitForTimeout(700);
  /*
   * 总额不能写死 800：库里可能已经有别人记的支出（v11 的 888 房租就躺在这儿），
   * 800 会被瞬间击穿，预算条直接切到「已超出」，断言就永远看不到「还剩」。
   * 所以按「存量 + 800」设，保证本月一定有余量。
   */
  const budgetTotal = Math.round(baseOut + 800);
  await p.evaluate((sum) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const dlg = document.querySelector('.mask .dlg');
    const total = dlg?.querySelector('input[type="number"]');
    set?.call(total, String(sum));
    total.dispatchEvent(new Event('input', { bubbles: true }));
    // 加一行分类预算：交通 100
    const add = [...dlg.querySelectorAll('button')].find((x) => (x.innerText || '').includes('加一个分类'));
    if (add) add.click();
  }, budgetTotal);
  await p.waitForTimeout(500);
  await p.evaluate((k) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const dlg = document.querySelector('.mask .dlg');
    const rows = [...dlg.querySelectorAll('.row')].filter((r) => r.querySelector('input[list="lg-cat-list"]'));
    const last = rows[rows.length - 1];
    if (!last) return;
    const cat = last.querySelector('input[list="lg-cat-list"]');
    const amt = last.querySelector('input[type="number"]');
    set?.call(cat, k + '交通');
    cat.dispatchEvent(new Event('input', { bubbles: true }));
    set?.call(amt, '100');
    amt.dispatchEvent(new Event('input', { bubbles: true }));
  }, mk);
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.mask .dlg button')].find((x) => (x.innerText || '').trim() === '保存');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1400);

  const budget = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => (c.querySelector('h3')?.innerText || '').includes('预算'));
    const bar = card?.querySelector('.lg-bar');
    const txt = bar?.querySelector('.lg-bar-s')?.innerText || '';
    return {
      has: !!bar,
      text: txt.replace(/\s+/g, ' '),
      paceMark: !!card?.querySelector('.lg-bar-pace'),
      pct: bar?.querySelector('.lg-bar-t i')?.style.width || '',
    };
  });
  ok('161-1 预算条显示「还剩」', /还剩/.test(budget.text), budget.text);
  ok('161-2 显示每天可花多少', /每天可花/.test(budget.text), budget.text);
  ok('161-3 有「时间进度」标记线', budget.paceMark);

  // 分类预算：交通 100，已花 160 → 超支
  const catOver = await p.evaluate((k) => {
    const card = [...document.querySelectorAll('.card')].find((c) => (c.querySelector('h3')?.innerText || '').includes('预算'));
    const bars = [...(card?.querySelectorAll('.lg-bars .lg-bar') || [])];
    const row = bars.find((x) => (x.innerText || '').includes(k));
    return row ? { text: row.innerText.replace(/\s+/g, ' '), color: getComputedStyle(row.querySelector('.lg-bar-n')).color } : null;
  }, `${mk}交通`);
  ok('161-4 分类超支会标出来', !!catOver && /超/.test(catOver.text), catOver?.text || '(没找到)');

  /* ---------- 162 账户 ---------- */
  console.log('\n=== 162 账户 ===');
  await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => (c.querySelector('h3')?.innerText || '').includes('账户'));
    const btn = card && [...card.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '管理');
    if (btn) btn.click();
  });
  await p.waitForTimeout(900);
  const accUi = await p.evaluate((k) => ({
    open: !!document.querySelector('.mask .dlg'),
    sum: document.querySelector('.lg-acc-sum')?.innerText.replace(/\s+/g, ' ') || '',
    sub: [...document.querySelectorAll('.lg-acc-sub')].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' | '),
    mine: [...document.querySelectorAll('.lg-acc-block input.inp')].some((x) => (x.value || '').includes(k)),
  }), `${mk}卡`);
  ok('162-1 账户弹层打开且有总览', accUi.open && /总资产/.test(accUi.sum), accUi.sum.slice(0, 60));
  ok('162-2 每行显示余额与本月收支', /余额/.test(accUi.sub) && /本月/.test(accUi.sub), accUi.sub.slice(0, 60));
  ok('162-3 新建的账户在列表里', accUi.mine);

  /*
   * 余额要看「我建的那个账户」那一行。以前取的是第一个 .lg-acc-sub ——
   * 库里有别人的账户时（比如手工建的「测试」），拿到的是它的余额，一眼全是错的。
   * 正确做法：先按账户名找到它所在的那一块，再读块里的余额。
   */
  const bal = await p.evaluate((k) => {
    const block = [...document.querySelectorAll('.lg-acc-block')]
      .find((b) => (b.querySelector('input.inp')?.value || '') === k);
    return block?.querySelector('.lg-acc-sub')?.innerText.replace(/\s+/g, ' ') || '';
  }, `${mk}卡`);
  ok('162-4 余额算对了（100-40-160+500=400）', /400/.test(bal), bal || '(没找到这个账户的行)');

  await p.keyboard.press('Escape').catch(() => {});
  await p.waitForTimeout(400);

  /* ---------- 汇总下推：筛选后合计跟着变 ---------- */
  console.log('\n=== 汇总下推 SQL ===');
  const beforeSum = await p.evaluate(() => {
    const kpis = [...document.querySelectorAll('.kpi')].map((x) => x.innerText.replace(/\s+/g, ' '));
    return kpis.join(' || ');
  });

  await p.evaluate(() => {
    const seg = [...document.querySelectorAll('.lg-filter .seg-b')].find((x) => (x.innerText || '').trim() === '收入');
    if (seg) seg.click();
  });
  await p.waitForTimeout(1200);

  const afterSum = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lg-item')].map((x) => x.innerText.replace(/\s+/g, ' '));
    const kpis = [...document.querySelectorAll('.kpi')].map((x) => x.innerText.replace(/\s+/g, ' '));
    return { rows, kpis: kpis.join(' || ') };
  });
  ok('下推-1 只看收入时列表只剩收入', afterSum.rows.length > 0 && afterSum.rows.every((r) => r.includes('+')),
    afterSum.rows.slice(0, 3).join(' / '));
  ok('下推-2 合计也跟着筛选变了（不是全月）', afterSum.kpis !== beforeSum,
    `前「${beforeSum.slice(0, 40)}」后「${afterSum.kpis.slice(0, 40)}」`);

  const catOptions = await p.evaluate(() => [...document.querySelectorAll('.lg-filter select option')].map((x) => x.textContent));
  ok('下推-3 分类下拉仍是全量（没被筛选缩掉）',
    catOptions.some((c) => c.includes('餐饮')) && catOptions.some((c) => c.includes('工资')),
    catOptions.slice(0, 6).join(','));

  // 关键词也下推
  await p.evaluate(() => {
    const seg = [...document.querySelectorAll('.lg-filter .seg-b')].find((x) => (x.innerText || '').trim() === '全部');
    if (seg) seg.click();
  });
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    const inp = document.querySelector('.lg-filter .searchbox input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(inp, '打车');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(1200);
  const kwRows = await p.evaluate((k) => [...document.querySelectorAll('.lg-item')]
    .filter((x) => (x.innerText || '').includes(k)).length, mk);
  ok('下推-4 关键词只留一条', kwRows === 1, `剩 ${kwRows} 条`);

  // 清搜索 + 复原预算，删测试数据
  await p.evaluate(() => {
    const inp = document.querySelector('.lg-filter .searchbox input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(800);
  await rpc('setting.set', { k: 'ledgerBudget', v: '' });
  await rpc('setting.set', { k: 'ledgerBudgetCats', v: '{}' });
  const rest = (await rpc('ledger.list', { from: `${ym}-01`, to: `${ym}-28` }))?.data?.items || [];
  for (const x of rest) if ((x.cat || '').includes(mk)) await rpc('ledger.delete', { id: x.id });
  if (accId) await rpc('account.delete', { id: accId });

  console.log('\n页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '无'));
  console.log(`\n套件结果：${pass} 通过 / ${fails.length} 失败`);
  await b.close().catch(() => {});
})();
