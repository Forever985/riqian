/* #235 右键菜单覆盖探针：草稿箱 / 时间轴 / 提醒
   验证：右键能弹出菜单、菜单项数量合理、点第一项真的发生事情。 */
const { chromium } = require('playwright-core');

const pass = [], fail = [];
const ok = (n, c, extra = '') => (c ? pass.push(n) : fail.push(n + (extra ? ' → ' + extra : '')));

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(1500);

  const go = async (nav) => {
    await p.evaluate((n) => {
      const bs = [...document.querySelectorAll('.nav button')];
      const t = bs.find((x) => x.getAttribute('data-nav') === n);
      if (t) t.click();
    }, nav);
    await p.waitForTimeout(900);
  };

  // 在指定选择器上右键，返回菜单文本行
  const rightClick = async (sel, nth = 0) => {
    await p.evaluate(([s, i]) => {
      const el = document.querySelectorAll(s)[i];
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + Math.min(40, r.width / 2)),
        clientY: Math.round(r.top + Math.min(20, r.height / 2)),
      }));
    }, [sel, nth]);
    await p.waitForTimeout(400);
    return await p.evaluate(() => {
      const m = document.querySelector('.ctxmenu');
      if (!m) return null;
      return [...m.querySelectorAll('.ctx-t')].map((e) => e.textContent.trim());
    });
  };

  const closeMenu = async () => {
    await p.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await p.keyboard.press('Escape').catch(() => {});
    await p.waitForTimeout(250);
  };

  // ── 1. 草稿箱 ────────────────────────────────
  await go('drafts');
  const hasDraftRow = await p.evaluate(() => document.querySelectorAll('.draft-row').length);
  if (hasDraftRow > 0) {
    const lines = await rightClick('.draft-row', 0);
    ok('草稿行右键弹出菜单', Array.isArray(lines) && lines.length >= 4, JSON.stringify(lines));
    if (lines) {
      ok('草稿菜单含「打开继续写」', lines.some((t) => t.includes('继续写')), JSON.stringify(lines));
      ok('草稿菜单含「移到回收站」', lines.some((t) => t.includes('回收站')), JSON.stringify(lines));
    }
    await closeMenu();
    const gone = await p.evaluate(() => !document.querySelector('.ctxmenu'));
    ok('按 Esc / 点空白能关掉菜单', gone);
  } else {
    ok('草稿行右键弹出菜单', false, '页面上没有 .draft-row，无法测');
  }

  // ── 2. 时间轴 ────────────────────────────────
  await go('timeline');
  const msCount = await p.evaluate(() => document.querySelectorAll('.mscard').length);
  if (msCount > 0) {
    const lines = await rightClick('.mscard', 0);
    ok('大事卡片右键弹出菜单', Array.isArray(lines) && lines.length >= 4, JSON.stringify(lines));
    if (lines) ok('大事菜单含「删掉这一条」', lines.some((t) => t.includes('删掉')), JSON.stringify(lines));
    await closeMenu();

    const yLines = await rightClick('.msyear-h', 0);
    ok('年份标题右键弹出菜单', Array.isArray(yLines) && yLines.length >= 2, JSON.stringify(yLines));
    if (yLines) {
      // 关键：不能出现点了没反应的假动作
      const fake = yLines.filter((t) => t.includes('看') && t.includes('每个月'));
      ok('年份菜单没有假动作（不写做不到的事）', fake.length === 0, JSON.stringify(fake));
      ok('年份菜单含「记一件大事」', yLines.some((t) => t.includes('记一件大事')), JSON.stringify(yLines));
    }
    await closeMenu();
  } else {
    ok('大事卡片右键弹出菜单', false, '页面上没有 .mscard，无法测');
  }

  // ── 3. 提醒 ──────────────────────────────────
  await go('alarms');
  const alCount = await p.evaluate(() => document.querySelectorAll('.al-row').length);
  if (alCount > 0) {
    const lines = await rightClick('.al-row', 0);
    ok('提醒行右键弹出菜单', Array.isArray(lines) && lines.length >= 4, JSON.stringify(lines));
    if (lines) {
      ok('提醒菜单含「推迟」', lines.some((t) => t.includes('推迟')), JSON.stringify(lines));
      ok('提醒菜单含「复制一个」', lines.some((t) => t.includes('复制')), JSON.stringify(lines));
    }
    await closeMenu();
  } else {
    ok('提醒行右键弹出菜单', false, '页面上没有 .al-row，无法测');
  }

  console.log('\n通过 ' + pass.length + ' / ' + (pass.length + fail.length));
  pass.forEach((n) => console.log('  PASS ' + n));
  fail.forEach((n) => console.log('  FAIL ' + n));
  await b.close().catch(() => {});
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });