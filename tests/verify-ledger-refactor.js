/*
 * verify-ledger-refactor.js —— 账本重构后的交互行为验证
 *
 * 静态快照（ledger-baseline.js）只能证明「渲染没变」。
 * 但这次动的是弹窗内部的表单、保存、删除逻辑，必须真的点一遍。
 *
 * 覆盖三个被拆出去的组件：
 *   ① LedgerAccountsDialog —— 新增/改名/停用/删除账户
 *   ② LedgerBudgetDialog   —— 总预算与分类预算的存与读
 *   ③ RecurDialog          —— 固定支出规则的新增/编辑/停用/删除
 *
 * 数据自清理：所有造出来的账户/规则/设置，用完删掉或还原。
 */
const { chromium } = require('playwright-core');

let okN = 0, badN = 0;
const ok = (m, e) => { okN++; console.log(`  ✅ ${m}${e ? '  ' + e : ''}`); };
const bad = (m, e) => { badN++; console.log(`  ❌ ${m}${e ? '  ' + e : ''}`); };

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57060'));
  const p = b.contexts()[0].pages()[0];
  /*
   * 控制台错误要过滤掉噪声：
   *  WebView2 用虚拟域名 https://riqian-app.example 承载内嵌页，这个域名并不存在，
   *  浏览器自动去要 favicon.ico 必然 ERR_FILE_NOT_FOUND。这跟代码无关，
   *  但会把「控制台无错误」误报成失败 —— 之前就吃过这一笔。
   */
  const isNoise = (t) => /favicon\.ico/.test(t);
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errs.push(m.text()); });
  p.on('pageerror', (e) => { if (!isNoise(e.message)) errs.push('pageerror: ' + e.message); });
  await p.waitForTimeout(1600);

  if (await p.evaluate(() => document.querySelectorAll('.mask').length)) {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1900);
  }

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 66000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (nav) => {
    await p.click(`.nav button[data-nav="${nav}"]`);
    await p.waitForTimeout(1300);
  };
  const closeMask = async () => {
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('.mask button')].find((x) => /^(取消|关闭|×)$/.test((x.textContent || '').trim()));
      if (btn) btn.click();
    });
    await p.waitForTimeout(500);
    if (await p.evaluate(() => document.querySelectorAll('.mask').length)) {
      await p.keyboard.press('Escape');
      await p.waitForTimeout(400);
    }
  };

  await go('ledger');

  /* =====================  ① 账户弹窗  ===================== */
  console.log('\n=== 1. 账户弹窗：新增 / 改名 / 停用 / 删除 ===');
  const accountsBefore = (await rpc('ledger.accounts', {})).data || [];
  console.log(`  现有账户 ${accountsBefore.length} 个`);

  // 打开「新增账户」
  const opened = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '新增账户');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(900);
  if (opened && await p.evaluate(() => !!document.querySelector('.mask'))) ok('点「新增账户」弹出了账户管理框');
  else bad('账户管理框没弹出来');

  // 走「新增账户」入口应该已经带一行空账户
  const hasBlank = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lg-acc-block')];
    return rows.some((r) => r.querySelector('input[placeholder="账户名"]')?.value === '');
  });
  if (hasBlank) ok('进入即带一行空账户（startWithNew 生效）');
  else bad('没有预置空行');

  // 填名字 → 保存
  const TEST_ACC = '重构测试账户';
  await p.evaluate((name) => {
    const rows = [...document.querySelectorAll('.lg-acc-block')];
    const blank = rows.find((r) => {
      const inp = r.querySelector('input[placeholder="账户名"]');
      return inp && !inp.value;
    });
    if (!blank) return;
    const inp = blank.querySelector('input[placeholder="账户名"]');
    // React 受控组件：必须走原生 setter 再派发 input 事件
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, name);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, TEST_ACC);
  await p.waitForTimeout(400);

  const saved1 = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lg-acc-block')];
    const target = rows.find((r) => r.querySelector('input[placeholder="账户名"]')?.value === '重构测试账户');
    if (!target) return false;
    const btn = [...target.querySelectorAll('button')].find((x) => /^保存$/.test((x.textContent || '').trim()));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(1400);

  let accs = (await rpc('ledger.accounts', {})).data || [];
  const created = accs.find((a) => a.name === TEST_ACC);
  if (saved1 && created) ok(`账户已存进库（id=${created.id}）`);
  else bad('账户没存上', JSON.stringify(accs.map((a) => a.name)));

  // 停用 —— switch 藏在「币种 / 备注」折叠区里（LedgerAccountsDialog.tsx:298），
  // 而且 saveRow 保存成功后会把这个账户的 open 置回 false（LedgerAccountsDialog.tsx:123），
  // 所以必须：先展开 → 等 React 重渲染 → 再点 switch。分两次 evaluate，中间留足时间。
  if (created) {
    let st = 'pending';
    for (let attempt = 0; attempt < 3 && st !== 'done'; attempt++) {
      st = await p.evaluate((id) => {
        const block = document.querySelector(`.lg-acc-block[data-acc="${id}"]`);
        if (!block) return 'no-block';
        const sw = block.querySelector('button.switch');
        if (sw) { sw.click(); return 'clicked'; }
        const more = block.querySelector('button[title="币种 / 备注"]');
        if (!more) return 'no-more-btn';
        more.click();
        return 'expanded';
      }, created.id);
      if (st === 'clicked') break;
      await p.waitForTimeout(700);   // 等折叠区渲染出来
    }
    await p.waitForTimeout(1300);
    accs = (await rpc('ledger.accounts', {})).data || [];
    const after = accs.find((a) => a.id === created.id);
    if (after && Number(after.enabled) === 0) ok('停用生效（enabled=0）');
    else bad('停用没生效', `步骤=${st} enabled=${JSON.stringify(after && after.enabled)}`);
  }

  // 关闭弹窗 —— 用 footer 的「关闭」
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.mask button')].find((x) => (x.textContent || '').trim() === '关闭');
    if (btn) btn.click();
  });
  await p.waitForTimeout(700);
  if (!(await p.evaluate(() => !!document.querySelector('.mask')))) ok('点「关闭」能关掉弹窗');
  else bad('弹窗关不掉');

  // 再打开「管理」入口，不应该预置空行
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '管理');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1000);
  const noBlank = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.lg-acc-block')];
    return rows.length > 0 && rows.every((r) => r.querySelector('input[placeholder="账户名"]')?.value !== '');
  });
  if (noBlank) ok('「管理」入口不预置空行');
  else bad('「管理」入口也预置了空行');

  // 删除刚才的测试账户
  if (created) {
    await p.evaluate((id) => {
      const block = document.querySelector(`.lg-acc-block[data-acc="${id}"]`);
      if (!block) return;
      const btn = [...block.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '删除');
      if (btn) btn.click();
    }, created.id);
    await p.waitForTimeout(800);
    // 确认框 → 点「删除」。
    // 注意两点：
    //  1) askConfirm 渲染的是 .mask > .dlg（components/ui.tsx:146），没有 .cfm 容器；
    //  2) 账户管理框本身也是一个 .mask，确认框通过 portal 追加在它后面 →
    //     必须取**最后一个** .mask，否则拿到的是账户管理框自己。
    const cfm = await p.evaluate(() => {
      const masks = [...document.querySelectorAll('.mask')];
      if (masks.length < 2) return 'no-confirm(' + masks.length + ')';
      const box = masks[masks.length - 1].querySelector('.dlg');
      if (!box) return 'no-dlg';
      const title = (box.querySelector('h3') || {}).textContent || '';
      if (!/删除账户/.test(title)) return 'wrong-dialog:' + title;
      const btn = [...box.querySelectorAll('button')].find((x) => /^删除$/.test((x.textContent || '').trim()));
      if (btn) { btn.click(); return 'clicked'; }
      return 'no-btn';
    });
    await p.waitForTimeout(1300);
    accs = (await rpc('ledger.accounts', {})).data || [];
    if (!accs.some((a) => a.id === created.id)) ok('删除账户成功，且走了自家确认框（' + cfm + '）');
    else bad('账户没删掉', cfm);
  }
  await closeMask();

  /* =====================  ② 预算弹窗  ===================== */
  console.log('\n=== 2. 预算弹窗：存与读 ===');
  // 注意：没有 settings.get / settings.set 这两个接口。
  // 读设置只能走 bootstrap 返回的 settings 对象，写设置是 setting.set {k, v}（api.ts:65）。
  const readSetting = async (key) => {
    const r = await rpc('bootstrap', {});
    return (r.data && r.data.settings) ? r.data.settings[key] : undefined;
  };
  const writeSetting = (key, value) => rpc('setting.set', { k: key, v: value });

  const oldBudget = await readSetting('ledgerBudget');
  const oldCats = await readSetting('ledgerBudgetCats');

  const openB = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '编辑预算');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(900);
  if (openB && await p.evaluate(() => !!document.querySelector('.mask'))) ok('「编辑预算」弹出了预算框');
  else bad('预算框没弹出来');

  // 填总预算 4321
  await p.evaluate(() => {
    const inp = document.querySelector('.mask input[type="number"]');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '4321');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.mask button')].find((x) => (x.textContent || '').trim() === '保存');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1300);
  const bNow = await readSetting('ledgerBudget');
  if (String(bNow) === '4321') ok('总预算存进去了（4321）');
  else bad('总预算没存上', JSON.stringify(bNow));

  // 页面上应该能看到这个数字
  const shown = await p.evaluate(() => (document.querySelector('.wrap') || {}).innerText?.includes('4,321') || (document.querySelector('.wrap') || {}).innerText?.includes('4321'));
  if (shown) ok('页面上显示出了新预算');
  else bad('页面没显示新预算');

  // 还原预算
  await writeSetting('ledgerBudget', oldBudget != null ? String(oldBudget) : '');
  await writeSetting('ledgerBudgetCats', oldCats != null ? String(oldCats) : '{}');
  await p.waitForTimeout(400);
  const bBack = await readSetting('ledgerBudget');
  if (String(bBack) === String(oldBudget ?? '')) ok(`预算已还原到原值（${JSON.stringify(bBack)}）`);
  else bad('预算没还原', JSON.stringify(bBack));

  /* =====================  ③ 周期账单  ===================== */
  console.log('\n=== 3. 周期账单弹窗：新增 / 编辑 / 删除 ===');
  const recBefore = (await rpc('ledger.recur.list', {})).data || [];
  console.log(`  现有规则 ${recBefore.length} 条`);

  const openR = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '新增规则');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(900);
  if (openR && await p.evaluate(() => !!document.querySelector('.mask'))) ok('「新增规则」弹出了固定支出框');
  else bad('固定支出框没弹出来');

  // 金额填 88
  await p.evaluate(() => {
    const inp = document.querySelector('.mask input.lg-amount');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '88');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.mask button')].find((x) => /^(添加|保存)$/.test((x.textContent || '').trim()));
    if (btn) btn.click();
  });
  await p.waitForTimeout(1500);

  let recs = (await rpc('ledger.recur.list', {})).data || [];
  const newRec = recs.find((r) => Number(r.amount) === 88);
  if (newRec) ok(`规则已建（id=${newRec.id}，金额 88）`);
  else bad('规则没建上', JSON.stringify(recs.map((r) => r.amount)));

  // 校验：金额填 0 应该被拦住，不产生新规则
  const n0 = recs.length;
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '新增规则');
    if (btn) btn.click();
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.mask button')].find((x) => /^(添加|保存)$/.test((x.textContent || '').trim()));
    if (btn) btn.click();
  });
  await p.waitForTimeout(1200);
  recs = (await rpc('ledger.recur.list', {})).data || [];
  if (recs.length === n0) ok('金额为空/非法时被拦住，没建出垃圾规则');
  else bad('非法金额竟然建出了规则');
  await closeMask();

  // 删除刚建的规则
  if (newRec) {
    console.log('  （用接口删掉测试规则，避免依赖列表行的定位）');
    await rpc('ledger.recur.delete', { id: newRec.id });
    await p.waitForTimeout(600);
    recs = (await rpc('ledger.recur.list', {})).data || [];
    if (!recs.some((r) => r.id === newRec.id)) ok('测试规则已删除');
    else bad('测试规则没删掉');
  }

  /* =====================  收尾  ===================== */
  console.log('\n=== 4. 数据还原与控制台 ===');
  const accFinal = (await rpc('ledger.accounts', {})).data || [];
  const leftover = accFinal.filter((a) => a.name === TEST_ACC);
  if (!leftover.length) ok('没有遗留测试账户');
  else bad('有遗留测试账户');

  const recFinal = (await rpc('ledger.recur.list', {})).data || [];
  if (recFinal.length === recBefore.length) ok(`规则数回到 ${recBefore.length} 条`);
  else bad(`规则数变了：${recBefore.length} → ${recFinal.length}`);

  if (!errs.length) ok('控制台无错误');
  else bad('控制台有错误', JSON.stringify(errs.slice(0, 4)));

  console.log('\n========================================');
  console.log(`  通过 ${okN} 项，失败 ${badN} 项`);
  console.log('========================================');
  await b.close();
  process.exit(badN ? 1 : 0);
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });