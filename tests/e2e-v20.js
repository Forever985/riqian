/* e2e-v20：159 记账 改一笔 / 筛选排序 / 分类改名与删除 */
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
    const id = 64000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (k) => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate((kk) => { const b2 = document.querySelector(`.nav button[data-nav="${kk}"]`); if (b2) b2.click(); }, k);
    await p.waitForTimeout(1300);
  };

  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const mk = 'v20' + String(Date.now()).slice(-4);

  // 造三笔：两笔支出（不同分类/金额）、一笔收入
  const made = [];
  for (const [d, kind, amt, cat, note] of [
    [`${ym}-03`, 'out', 12.5, `${mk}甲类`, '早饭'],
    [`${ym}-05`, 'out', 88, `${mk}乙类`, '打车'],
    [`${ym}-07`, 'in', 300, `${mk}甲类`, '报销'],
  ]) {
    const r = await rpc('ledger.add', { date: d, kind, amount: amt, cat, note, accountId: '' });
    if (r?.data?.id) made.push(r.data.id);
  }
  ok('v20 准备了三笔测试账', made.length === 3);

  await go('today');
  await go('ledger');
  await p.waitForTimeout(900);

  const rows = () => p.evaluate((k) => [...document.querySelectorAll('.lg-item')]
    .filter((x) => (x.innerText || '').includes(k))
    .map((x) => x.innerText.replace(/\s+/g, ' ').trim()), mk);

  const r0 = await rows();
  ok('159-1 三笔都在列表里', r0.length === 3, r0.join(' | ').slice(0, 120));

  /* ---------- 改一笔 ---------- */
  const opened = await p.evaluate((k) => {
    const row = [...document.querySelectorAll('.lg-item')].find((x) => (x.innerText || '').includes(k) && (x.innerText || '').includes('早饭'));
    const btn = row?.querySelector('button.lg-edit');
    if (btn) { btn.click(); return true; }
    return false;
  }, mk);
  await p.waitForTimeout(800);
  const dlg = await p.evaluate(() => ({
    open: !!document.querySelector('.mask .dlg'),
    title: document.querySelector('.mask .dlg h3, .mask .dlg .dlg-t')?.textContent || '',
  }));
  ok('159-2 点「改」打开编辑弹层', opened && dlg.open, JSON.stringify(dlg));

  if (dlg.open) {
    // 改金额 12.5 → 66，备注 早饭 → 改过的备注
    await p.evaluate(() => {
      const amt = document.querySelector('.mask .dlg input.lg-amount');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(amt, '66');
      amt.dispatchEvent(new Event('input', { bubbles: true }));
      const note = [...document.querySelectorAll('.mask .dlg input.inp')].pop();
      set?.call(note, '改过的备注');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('.mask .dlg button')].find((x) => (x.innerText || '').includes('保存'));
      if (btn) btn.click();
    });
    await p.waitForTimeout(1500);
    const r1 = await rows();
    ok('159-3 金额改成功', r1.some((x) => x.includes('66')), r1.join(' | ').slice(0, 120));
    ok('159-4 备注改成功', r1.some((x) => x.includes('改过的备注')));
  } else {
    ok('159-3 金额改成功', false, '弹层没开');
    ok('159-4 备注改成功', false, '弹层没开');
  }

  /* ---------- 筛选 ---------- */
  const filtered = await p.evaluate((k) => {
    const seg = [...document.querySelectorAll('.lg-filter .seg-b')].find((x) => (x.innerText || '').trim() === '收入');
    if (seg) seg.click();
    return true;
  }, mk);
  await p.waitForTimeout(900);
  const onlyIn = await rows();
  ok('159-5 「收入」筛选只留收入', filtered && onlyIn.length === 1 && onlyIn[0].includes('+'), onlyIn.join(' | '));

  await p.evaluate(() => {
    const seg = [...document.querySelectorAll('.lg-filter .seg-b')].find((x) => (x.innerText || '').trim() === '全部');
    if (seg) seg.click();
  });
  await p.waitForTimeout(800);

  // 关键词搜
  await p.evaluate(() => {
    const inp = document.querySelector('.lg-filter .searchbox input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(inp, '打车');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(900);
  const kwRows = await rows();
  ok('159-6 关键词只留一条', kwRows.length === 1 && kwRows[0].includes('打车'), kwRows.join(' | '));
  await p.evaluate(() => {
    const inp = document.querySelector('.lg-filter .searchbox input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(700);

  /* ---------- 排序 ---------- */
  await p.evaluate(() => {
    const seg = [...document.querySelectorAll('.lg-filter .seg-b')].find((x) => (x.innerText || '').trim() === '按金额');
    if (seg) seg.click();
  });
  await p.waitForTimeout(900);
  const sorted = await p.evaluate((k) => [...document.querySelectorAll('.lg-item')]
    .filter((x) => (x.innerText || '').includes(k))
    .map((x) => Number((x.querySelector('.lg-amt')?.textContent || '').replace(/[^\d.]/g, ''))), mk);
  ok('159-7 按金额从大到小', sorted.length === 3 && sorted[0] >= sorted[1] && sorted[1] >= sorted[2], sorted.join('>'));

  await p.evaluate(() => {
    const seg = [...document.querySelectorAll('.lg-filter .seg-b')].find((x) => (x.innerText || '').trim() === '按日期');
    if (seg) seg.click();
  });
  await p.waitForTimeout(700);

  /* ---------- 分类管理 ---------- */
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.lg-filter button')].find((x) => (x.innerText || '').includes('分类'));
    if (btn) btn.click();
  });
  await p.waitForTimeout(800);
  const catDlg = await p.evaluate(() => ({
    open: !!document.querySelector('.mask .dlg'),
    rows: [...document.querySelectorAll('.lg-catrow .n')].map((x) => x.textContent),
  }));
  ok('159-8 分类管理能看到用过的分类', catDlg.open && catDlg.rows.some((r) => r.includes('甲类')), JSON.stringify(catDlg.rows).slice(0, 120));

  // 改名：甲类 → 新甲类
  const renamed = await p.evaluate((k) => {
    const row = [...document.querySelectorAll('.lg-catrow')].find((x) => (x.querySelector('.n')?.textContent || '').includes('甲类'));
    const btn = row && [...row.querySelectorAll('button')].find((x) => (x.innerText || '').includes('改名'));
    if (!btn) return false;
    btn.click();
    return true;
  }, mk);
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const inp = document.querySelector('.lg-catrow input.inp');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(inp, '新甲类');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.evaluate(() => {
    // 正在改名的那一行才有输入框，别拿第一行（顺序不一定是它）
    const row = [...document.querySelectorAll('.lg-catrow')].find((x) => x.querySelector('input.inp'));
    const btn = row && [...row.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '存');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1500);
  const listAfterRename = (await rpc('ledger.list', { from: `${ym}-01`, to: `${ym}-28` }))?.data?.items || [];
  ok('159-9 分类改名后流水跟着改', renamed && listAfterRename.some((x) => x.cat === '新甲类'),
    listAfterRename.filter((x) => (x.cat || '').includes('甲类')).map((x) => x.cat).join(','));

  // 删除分类：乙类 → 其他
  // confirm 必须**在点击前**挂上，否则 Playwright 默认直接点「取消」
  p.on('dialog', (d) => void d.accept());
  const dropped = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.lg-catrow')].find((x) => (x.querySelector('.n')?.textContent || '').includes('乙类'));
    const btn = row && [...row.querySelectorAll('button')].find((x) => (x.innerText || '').includes('删掉'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await p.waitForTimeout(1800);
  const afterDrop = (await rpc('ledger.list', { from: `${ym}-01`, to: `${ym}-28` }))?.data?.items || [];
  ok('159-10 删分类后流水归到「其他」', dropped && !afterDrop.some((x) => x.cat === `${mk}乙类`),
    afterDrop.filter((x) => (x.note || '').includes('打车')).map((x) => x.cat).join(','));

  // 收尾：删掉测试账
  const rest = (await rpc('ledger.list', { from: `${ym}-01`, to: `${ym}-28` }))?.data?.items || [];
  for (const x of rest) {
    if ((x.cat || '').includes(mk) || (x.note || '').includes('改过的备注') || (x.note || '').includes('打车') || (x.cat || '') === '新甲类') {
      await rpc('ledger.delete', { id: x.id });
    }
  }

  console.log('\n页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '无'));
  console.log(`\n套件结果：${pass} 通过 / ${fails.length} 失败`);
  await b.close().catch(() => {});
})();
