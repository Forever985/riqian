const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '56312';
const log = [];
const ok = (n, v) => { const line = `${v ? '✅' : '❌'} ${n}`; log.push(line); console.log(line); };

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
  p.on('dialog', async d => { await d.accept(); });
  await p.waitForTimeout(1500);
  // 上一次跑失败时可能留着弹层（LaTeX / 分享 / 快速记录），先收干净再开始
  for (let i = 0; i < 4; i++) {
    const open = await p.evaluate(() => document.querySelectorAll('.qmask,.mask').length);
    if (!open) break;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.mouse.click(6, 6).catch(() => {});
    await p.waitForTimeout(250);
  }


  const go = async (t) => { await p.click(`#app .nav button:has-text("${t}")`); await p.waitForTimeout(800); };

  /* 日历头部排版修复验证 */
  await go('日历');
  const head = await p.evaluate(() => {
    const nav = document.querySelector('.cal2-head .nav');
    return nav ? getComputedStyle(nav).flexDirection : 'none';
  });
  ok('日历头部导航横排: ' + head, head === 'row');
  const cellH = await p.evaluate(() => {
    const c = document.querySelector('.cal2-cell:not(.blank)');
    return c ? Math.round(c.getBoundingClientRect().height) : 0;
  });
  ok('日历格高度合理(' + cellH + 'px)', cellH > 30 && cellH < 110);
  await p.screenshot({ path: 'y-cal.png', timeout: 8000 }).catch(() => {});

  /* 记录页 */
  await go('记录');
  await p.screenshot({ path: 'y-records.png', timeout: 8000 }).catch(() => {});
  const filtersOk = await p.evaluate(() => {
    const f = document.querySelector('.filters');
    if (!f) return 0;
    const r = f.getBoundingClientRect();
    // 所有子项高度是否在同一行
    const kids = [...f.children].map(c => c.getBoundingClientRect());
    return kids.every(k => k.top < r.bottom - 4) ? 1 : 0;
  });
  ok('记录页筛选条单行', filtersOk === 1);

  /* 待办页 */
  await go('待办');
  await p.screenshot({ path: 'y-todos.png', timeout: 8000 }).catch(() => {});
  ok('待办页有输入框', await p.locator('#view-root input.inp').count() > 0);

  /* 倒计时页 */
  await go('倒计时');
  await p.fill('#view-root input.inp >> nth=0', '2027年10月1日 国庆');
  await p.locator('button:has-text("添加")').first().click();
  await p.waitForTimeout(900);
  ok('倒计时添加成功', await p.locator('.cd').count() > 0);
  await p.screenshot({ path: 'y-countdown.png', timeout: 8000 }).catch(() => {});

  /* 流视图内联编辑 */
  await go('流');
  const fw = p.locator('.fw-body').first();
  if (await fw.count()) {
    await fw.click();
    await fw.press('Control+A');
    await fw.type('流水线里直接改。');
    await p.waitForTimeout(1400);
    const html = await p.evaluate(() => {
      const el = document.querySelector('.fw-body');
      return el ? el.innerHTML : '';
    });
    ok('流视图内联编辑生效', html.includes('流水线里直接改'));
  } else ok('流视图有可编辑条目', false);

  /* 打字机 / 焦点开关 */
  await p.locator('button:has-text("打字机")').click();
  await p.waitForTimeout(400);
  ok('打字机模式加了 class', await p.locator('.flow.tw').count() === 1);
  await p.locator('button:has-text("焦点")').click();
  await p.waitForTimeout(400);
  ok('焦点模式加了 class', await p.locator('.flow.focus').count() === 1);

  /* 设置：开启图片模块和引用模块，回今天验证渲染 */
  await go('设置');
  await p.evaluate(() => { const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('日记与模块')); if (g) g.click(); });
  await p.waitForTimeout(600);
  const rows = p.locator('.moditem');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const t = await rows.nth(i).locator('.nm').textContent();
    if (t === '图片' || t === '引用') {
      const sw = rows.nth(i).locator('.switch');
      const on = await sw.getAttribute('class');
      if (!on.includes('on')) { await sw.click(); await p.waitForTimeout(500); }
    }
  }
  await go('今天');
  ok('图片模块渲染', await p.locator('.imgs').count() > 0);
  ok('引用模块渲染', await p.locator('.refcard, .mod .empty').count() > 0);
  await p.evaluate(() => { document.getElementById('view-root').scrollTop = 0; });
  await p.screenshot({ path: 'y-today.png', timeout: 8000 }).catch(() => {});

  /* 模板弹层 */
  await p.locator('button:has-text("模板")').click();
  await p.waitForTimeout(700);
  ok('模板弹层有内置模板', await p.locator('.tpl').count() >= 4);
  await p.screenshot({ path: 'y-tpl.png', timeout: 8000 }).catch(() => {});
  await p.locator('.dlg .f button:has-text("取消")').click();
  await p.waitForTimeout(400);

  /* 历史版本弹层 */
  await p.locator('button:has-text("历史版本")').click();
  await p.waitForTimeout(800);
  ok('历史版本弹层', await p.locator('.dlg .quote-pick, .dlg .empty').count() > 0);
  await p.screenshot({ path: 'y-hist.png', timeout: 8000 }).catch(() => {});
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  /* 背景弹层 */
  await p.locator('button:has-text("背景")').click();
  await p.waitForTimeout(700);
  ok('背景弹层打开', await p.locator('.dlg').count() === 1);
  await p.locator('.dlg .x').click();
  await p.waitForTimeout(300);

  console.log(log.join('\n'));
  console.log('页面错误:', errs.length ? errs.slice(0, 6) : '无');
  await b.close().catch(() => {});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
