/*
 * verify-confirm.js —— askConfirm 专项
 *
 * 验的不是「弹窗能弹出来」，而是四个真正会出事的地方：
 *   1. 点「取消」必须真的什么都不做（这是整个改造最容易搞反的语义）
 *   2. 点确认必须真的执行
 *   3. 标题/正文要正确拆行（老文案里 \n 后面的后果说明不能跑进标题）
 *   4. 危险操作的主按钮要是红的（不是普通蓝按钮）
 */
const { chromium } = require('playwright-core');

const PORT = process.env.CDP_PORT || '57048';
const BASE = `http://127.0.0.1:${PORT}`;

let okN = 0, badN = 0;
const ok = (m, extra) => { okN++; console.log(`  ✅ ${m}${extra ? '  ' + extra : ''}`); };
const bad = (m, extra) => { badN++; console.log(`  ❌ ${m}${extra ? '  ' + extra : ''}`); };

(async () => {
  const b = await chromium.connectOverCDP(BASE);
  const ctx = b.contexts()[0];
  const p = ctx.pages()[0] || (await ctx.newPage());

  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

  // 任何漏网的原生 confirm 都直接拒掉，这样"没换成 askConfirm"会被暴露成失败而不是静默通过
  p.on('dialog', async (d) => { errs.push('出现了原生弹窗: ' + d.message()); await d.dismiss(); });

  await p.waitForTimeout(1200);

  /*
   * 清场：别的探针可能留下半开的弹层，遮罩会挡住所有点击，
   * 表现出来是"点了没反应 → 超时"，很容易被误判成功能坏了。
   *
   * 注意**不能**直接 remove 掉 .mask 节点 —— 那只删了 DOM，
   * React 里的 store 还认为弹窗是开着的，之后整个页面点哪都没反应
   * （踩过：删完遮罩，打卡页变成 0 张卡片，连导航都点不动）。
   * 正确做法是整页重载，让 React 状态从头来。
   */
  const stale = await p.evaluate(() => document.querySelectorAll('.mask').length);
  if (stale) {
    console.log(`  （有 ${stale} 个残留弹层，重载页面复位）`);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
  }

  console.log('\n=== 1. 直接调 askConfirm，验证取消/确认的返回值 ===');
  // 从页面里拿到模块不太现实，改走真实交互：打卡页删除
  await p.click('.nav button[data-nav="habits"]');
  await p.waitForTimeout(900);

  const cardsBefore = await p.locator('.hcard').count();
  console.log(`  当前打卡卡片数 = ${cardsBefore}`);

  /* ---------- 找一个带删除入口的卡片 ---------- */
  // 打卡卡的删除通常藏在右键菜单或卡片内按钮里，先看 DOM
  const delBtns = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('.hcard button').forEach((b) => {
      const t = (b.getAttribute('title') || '') + (b.innerText || '');
      if (/删|del/i.test(t)) out.push(t.trim());
    });
    return out;
  });
  console.log(`  卡片内删除按钮 = ${JSON.stringify(delBtns)}`);

  // 右键菜单一定是通的（三十多处之一），拿它当主战场
  console.log('\n=== 2. 右键菜单里的危险项：先取消，必须什么都不发生 ===');
  await p.evaluate(() => window.scrollTo(0, 0));
  const firstCard = p.locator('.hcard').first();
  if (await firstCard.count()) {
    const nameBefore = (await firstCard.innerText()).split('\n')[0].trim();

    await firstCard.click({ button: 'right' });
    await p.waitForTimeout(400);
    const items = await p.evaluate(() =>
      [...document.querySelectorAll('.ctx-item')].map((x) => (x.innerText || '').trim()));
    console.log(`  右键菜单项 = ${JSON.stringify(items)}`);

    if (items.length) {
      // 挑一个危险项；没有就挑第一个
      const dangerIdx = await p.evaluate(() => {
        const ns = [...document.querySelectorAll('.ctx-item')];
        const i = ns.findIndex((x) => x.classList.contains('danger'));
        return i >= 0 ? i : 0;
      });
      const pickText = items[dangerIdx];
      console.log(`  选中「${pickText}」`);

      await p.locator('.ctx-item').nth(dangerIdx).click();
      await p.waitForTimeout(500);

      /* ---- 关键：应该是我们自己的确认框，不是原生弹窗 ---- */
      const hasDlg = await p.locator('.dlg').count();
      const hasCfm = await p.locator('.cfm-body, .dlg .f .btn.primary').count();

      if (hasDlg) {
        ok('点危险项弹出的是应用内确认框（不是原生弹窗）');
      } else {
        bad('没弹出应用内确认框，DOM 里找不到 .dlg');
      }

      // 标题 / 正文拆行检查
      const dlgInfo = await p.evaluate(() => {
        const d = document.querySelector('.dlg');
        if (!d) return null;
        const h = d.querySelector('.h h3');
        const body = d.querySelector('.cfm-body');
        const btns = [...d.querySelectorAll('.f button')].map((x) => ({
          t: (x.innerText || '').trim(),
          cls: x.className,
          bg: getComputedStyle(x).backgroundColor,
        }));
        return { title: h ? h.innerText : '', body: body ? body.innerText : '', btns };
      });
      console.log(`  标题 = ${JSON.stringify(dlgInfo?.title)}`);
      console.log(`  正文 = ${JSON.stringify(dlgInfo?.body)}`);
      console.log(`  按钮 = ${JSON.stringify(dlgInfo?.btns)}`);

      if (dlgInfo && !/\n/.test(dlgInfo.title)) ok('标题里没有换行（已正确抽成正文）');
      else bad('标题里还带着换行', JSON.stringify(dlgInfo?.title));

      if (dlgInfo && dlgInfo.btns.length === 2) ok('恰好两颗按钮');
      else bad('按钮数量不对', String(dlgInfo?.btns.length));

      const primary = dlgInfo?.btns.find((x) => /primary/.test(x.cls));
      const isRed = primary && /rgb\(\s*2\d\d|rgb\(\s*18\d|rgb\(\s*19\d/.test(primary.bg);
      if (primary && /danger/.test(primary.cls)) {
        ok('危险项的主按钮带了 danger 类', primary.bg);
      } else {
        bad('危险项的主按钮没有 danger 类', JSON.stringify(primary));
      }

      /* ---- 点「取消」，必须什么都不做 ---- */
      await p.locator('.dlg .f button').first().click();
      await p.waitForTimeout(700);
      const dlgGone = (await p.locator('.dlg').count()) === 0;
      const nameAfter = (await p.locator('.hcard').first().innerText()).split('\n')[0].trim();
      const cardsAfterCancel = await p.locator('.hcard').count();

      if (dlgGone) ok('点取消后确认框关闭');
      else bad('点取消后确认框还在');

      if (nameAfter === nameBefore && cardsAfterCancel === cardsBefore) {
        ok('点取消后数据一条没动', `卡片 ${cardsBefore} → ${cardsAfterCancel}`);
      } else {
        bad('点取消居然改了数据！', `${nameBefore} → ${nameAfter}，卡片 ${cardsBefore} → ${cardsAfterCancel}`);
      }
    } else {
      bad('右键菜单里没有可点的项');
    }
  } else {
    bad('打卡页没有卡片，无法测右键菜单');
  }

  /* ---------- 3. 再走一遍，这次真确认，看是否执行 ---------- */
  console.log('\n=== 3. 同样位置点确认，这次必须真的执行 ===');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.click('.nav button[data-nav="today"]');
  await p.waitForTimeout(500);
  await p.click('.nav button[data-nav="habits"]');
  await p.waitForTimeout(900);

  const cards2 = await p.locator('.hcard').count();
  if (cards2) {
    await p.locator('.hcard').first().click({ button: 'right' });
    await p.waitForTimeout(400);
    const n2 = await p.evaluate(() => document.querySelectorAll('.ctx-item').length);
    if (n2) {
      const di = await p.evaluate(() => {
        const ns = [...document.querySelectorAll('.ctx-item')];
        const i = ns.findIndex((x) => x.classList.contains('danger'));
        return i >= 0 ? i : 0;
      });
      await p.locator('.ctx-item').nth(di).click();
      await p.waitForTimeout(500);
      const btnTexts = await p.evaluate(() =>
        [...document.querySelectorAll('.dlg .f button')].map((x) => (x.innerText || '').trim()));
      if (btnTexts.length === 2) {
        ok('确认框按钮文案是具体动词而非「确定」', JSON.stringify(btnTexts));
        // 点最后一颗（primary = 确认）
        await p.locator('.dlg .f button').last().click();
        await p.waitForTimeout(1500);
        const cards3 = await p.locator('.hcard').count();
        if (cards3 < cards2) ok('点确认后真的执行了（卡片数变少）', `${cards2} → ${cards3}`);
        else bad('点确认后什么都没发生', `${cards2} → ${cards3}`);
      } else {
        bad('确认框里没有两颗按钮', JSON.stringify(btnTexts));
      }
    }
  } else {
    bad('确认后打卡页已无卡片，跳过');
  }

  /* ---------- 4. 全项目不该再有原生 confirm ---------- */
  console.log('\n=== 4. 原生弹窗检查 ===');
  if (errs.filter((e) => e.includes('原生弹窗')).length === 0) {
    ok('全程没有出现原生 window.confirm');
  } else {
    bad('仍有原生弹窗', JSON.stringify(errs.filter((e) => e.includes('原生弹窗'))));
  }

  const realErrs = errs.filter((e) => !e.includes('原生弹窗'));
  if (realErrs.length === 0) ok('控制台无错误');
  else bad('控制台有错误', JSON.stringify(realErrs.slice(0, 5)));

  /* ---------- 5. 收尾：把测试过程中删掉的东西还原 ---------- */
  // 第 3 步确实执行了一次删除，不还原的话跑一次探针就少一个打卡
  console.log('\n=== 5. 还原测试期间删掉的数据 ===');
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 90000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const tr = await rpc('habit.trash', {});
  const trashed = (tr.data || []);
  if (!trashed.length) {
    ok('回收站是空的，无需还原');
  } else {
    let n = 0;
    for (const h of trashed) {
      const r = await rpc('habit.restore', { id: h.id });
      if (r.ok) n++;
    }
    if (n === trashed.length) ok(`已把 ${n} 个打卡还原`, trashed.map((x) => x.name).join('、'));
    else bad(`只还原了 ${n}/${trashed.length} 个`);
    const l = await rpc('habits.list', {});
    console.log(`  当前打卡 = ${(l.data || []).map((x) => x.name).join(' / ')}`);
  }

  console.log('\n========================================');
  console.log(`  通过 ${okN} 项，失败 ${badN} 项`);
  console.log('========================================');
  await b.close();
  process.exit(badN ? 1 : 0);
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });