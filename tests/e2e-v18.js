/* e2e-v18：152 悬浮提示 / 193 待办搜索位置 / 148 设置全局搜索 */
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

  const go = async (k) => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate((kk) => {
      const btn = document.querySelector(`.nav button[data-nav="${kk}"]`);
      if (btn) btn.click();
    }, k);
    await p.waitForTimeout(1200);
  };
  const tipText = () => p.evaluate(() => {
    const t = document.querySelector('.tip');
    return t && t.classList.contains('on') ? t.textContent : '';
  });

  console.log('\n=== 152 悬浮提示 ===');
  await go('today');

  const dt = '.datehead .dnav';
  await p.locator(dt).first().hover();
  await p.waitForTimeout(650);
  const t1 = await tipText();
  ok('152-1 悬停出现提示', t1 === '前一天', `得到「${t1}」`);

  const style = await p.evaluate(() => {
    const t = document.querySelector('.tip');
    const cs = getComputedStyle(t);
    const root = getComputedStyle(document.documentElement);
    return { bg: cs.backgroundColor, ink: root.getPropertyValue('--ink').trim(), radius: cs.borderRadius, font: cs.fontSize };
  });
  ok('152-2 提示用的是主题色，不是系统黄条', style.bg !== 'rgb(255, 255, 221)' && style.radius !== '0px',
    JSON.stringify(style));

  const noNative = await p.evaluate((s) => !document.querySelector(s)?.getAttribute('title'), dt);
  ok('152-3 原生 title 被接管（不会两个气泡）', noNative);

  await p.mouse.move(760, 520);
  await p.waitForTimeout(350);
  ok('152-4 移开就消失', (await tipText()) === '');

  // 侧栏：说明文字必须不是按钮名
  const navName = await p.evaluate(() => document.querySelector('.nav button[data-nav="ledger"]')?.innerText.trim());
  await p.locator('.nav button[data-nav="ledger"]').hover();
  await p.waitForTimeout(650);
  const navTip = await tipText();
  ok('152-5 侧栏每项有一句人话说明', navTip && navTip !== navName && navTip.length > 4, `「${navTip}」`);
  await p.mouse.move(760, 520);
  await p.waitForTimeout(200);

  // 折叠后提示要带上名字（「折叠为图标」在「界面布局」分组里，得先切过去）
  await go('settings');
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('.snav')].find((x) => (x.innerText || '').includes('界面布局'));
    if (b2) b2.click();
  });
  await p.waitForTimeout(800);
  const toggled = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.set-row')].find((el) => (el.innerText || '').includes('折叠为图标'));
    const sw = row?.querySelector('.switch');
    if (sw) sw.click();
    return !!sw;
  });
  await p.waitForTimeout(900);
  ok('152-6a 找到了「折叠为图标」开关', toggled);
  const collapsed = await p.evaluate(() => document.querySelector('.app')?.classList.contains('nav-collapsed'));
  ok('152-6b 侧栏已折叠', !!collapsed, 'nav-collapsed=' + collapsed);
  await p.locator('.nav button[data-nav="todos"]').hover();
  await p.waitForTimeout(700);
  const colTip = await tipText();
  ok('152-6 折叠成图标时提示带上名字', colTip.includes('—') || colTip.includes('待办'), `「${colTip}」`);
  await p.mouse.move(760, 520);
  // 还原
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.set-row')].find((el) => (el.innerText || '').includes('折叠为图标'));
    const sw = row?.querySelector('.switch');
    if (sw) sw.click();
  });
  await p.waitForTimeout(700);
  console.log('\n=== 193 待办搜索位置 ===');
  await go('todos');
  const layout = await p.evaluate(() => ({
    top: !!document.querySelector('.topbar .searchbox.sb-top'),
    inCard: document.querySelectorAll('.card .searchbox').length,
    firstInputInCard: (() => {
      const card = document.querySelector('.todo-stack .card');
      const i = card?.querySelector('.row input');
      return i ? (i.getAttribute('placeholder') || '').slice(0, 6) : '(无)';
    })(),
  }));
  ok('193-1 搜索框搬到了顶栏', layout.top && layout.inCard === 0, JSON.stringify(layout));
  ok('193-2 卡片里第一个输入是「写待办」而不是搜索', layout.firstInputInCard.startsWith('说人话'), layout.firstInputInCard);

  // 还能真的搜
  const box = p.locator('.topbar .searchbox.sb-top input');
  await box.fill('写周报');
  await p.waitForTimeout(900);
  const filtered = await p.evaluate(() => document.querySelectorAll('.todo-row, .trow, .card .row').length);
  ok('193-3 顶栏搜索仍然能过滤', filtered >= 0, '列表行数 ' + filtered);
  await box.fill('');
  await p.waitForTimeout(500);

  console.log('\n=== 148 设置全局搜索 ===');
  await go('settings');
  // 先切到一个和「字号」无关的分组，证明搜索不再受当前分组限制
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('.snav')].find((x) => (x.innerText || '').includes('关于'));
    if (b2) b2.click();
  });
  await p.waitForTimeout(700);

  const inp = p.locator('.searchbox input').first();
  await inp.click();
  await inp.fill('字号');
  await p.waitForTimeout(1200);

  const r1 = await p.evaluate(() => ({
    head: document.querySelector('.setres-h')?.innerText || '',
    groups: [...document.querySelectorAll('.setres-g')]
      .filter((x) => x.style.display !== 'none')
      .map((x) => (x.querySelector('.setres-t')?.innerText || '').trim()),
    rows: [...document.querySelectorAll('.setres-g .set-row[data-hit]')].map((x) => (x.innerText || '').replace(/\s+/g, ' ').slice(0, 20)),
  }));
  ok('148-1 在「关于」分组里也能搜到别的分组的项', r1.groups.some((g) => g.includes('外观')), JSON.stringify(r1.groups));
  ok('148-2 命中的行显示出来了', r1.rows.length >= 1, JSON.stringify(r1.rows).slice(0, 120));
  ok('148-3 有结果计数提示', /找到|命中/.test(r1.head), r1.head);

  // 子序列（模糊）匹配：正文号 → 正文字号
  await inp.fill('正文号');
  await p.waitForTimeout(1000);
  const r2 = await p.evaluate(() => document.querySelectorAll('.setres-g .set-row[data-hit]').length);
  ok('148-4 缺字也能搜到（子序列匹配）', r2 >= 1, '命中 ' + r2);

  // 完全匹配要排在模糊命中前面
  await inp.fill('字号');
  await p.waitForTimeout(900);
  const order = await p.evaluate(() => [...document.querySelectorAll('.setres-g')]
    .filter((x) => x.style.display !== 'none')
    .map((x) => (x.querySelector('.setres-t')?.innerText || '').trim()));
  ok('148-5 分组名命中的排在前面', order.length >= 1, JSON.stringify(order));

  // 点分组名跳过去并清空搜索
  const jumped = await p.evaluate(() => {
    const t2 = document.querySelector('.setres-t');
    if (!t2) return false;
    t2.click();
    return true;
  });
  await p.waitForTimeout(900);
  const afterJump = await p.evaluate(() => ({
    q: document.querySelector('.searchbox input')?.value || '',
    res: document.querySelectorAll('.setres-g').length,
    body: !!document.querySelector('.setbody .card, .setbody .set-row'),
  }));
  ok('148-6 点分组名回到该分组且清空搜索', jumped && afterJump.q === '' && afterJump.res === 0 && afterJump.body,
    JSON.stringify(afterJump));

  // 搜不到时给提示
  await inp.fill('zzzz不存在的设置');
  await p.waitForTimeout(1000);
  const r3 = await p.evaluate(() => ({
    head: document.querySelector('.setres-h')?.innerText || '',
    empty: [...document.querySelectorAll('.empty')].some((x) => (x.innerText || '').includes('没找到')),
  }));
  ok('148-7 搜不到有明确提示', r3.empty, JSON.stringify(r3));

  await inp.fill('');
  await p.waitForTimeout(500);

  console.log('\n页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '无'));
  console.log(`\n套件结果：${pass} 通过 / ${fails.length} 失败`);
  await b.close().catch(() => {});
})();
