/* 储蓄罐界面点击链路：新建 → 套预设 → 建好 → 卡片出现 */
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(20000);
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 73000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => (await rpc(m, a)).data;

  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(1400);
  await p.click('.nav button:has-text("记账本")');
  await p.waitForTimeout(900);

  /* 点「新建储蓄罐」 */
  const opened = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '新建储蓄罐');
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log('点开新建对话框:', opened);
  await p.waitForTimeout(500);

  /* 对话框里应该出现预设 chip */
  const chips = await p.evaluate(() => [...document.querySelectorAll('.dlg .chip')].map((x) => x.textContent));
  console.log('对话框 chip:', JSON.stringify(chips));

  /* 套 52 周预设 */
  const picked = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.dlg .chip')].find((x) => (x.textContent || '').indexOf('52 周') >= 0);
    if (!c) return false;
    c.click();
    return true;
  });
  console.log('套 52 周预设:', picked);
  await p.waitForTimeout(400);

  const fields = await p.evaluate(() => {
    const ins = [...document.querySelectorAll('.dlg input.inp')];
    return ins.map((i) => ({ ph: i.placeholder, v: i.value }));
  });
  console.log('表单被填:', JSON.stringify(fields));

  /* 建好 */
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.dlg .f button')].find((x) => (x.textContent || '').trim() === '建好');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1100);

  const cards = await p.evaluate(() => [...document.querySelectorAll('.jar')].map((c) => ({
    t: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    bar: (c.querySelector('.jar-bar i') || {}).style?.width,
  })));
  console.log('卡片:', JSON.stringify(cards, null, 1));

  /* 点卡片开明细 */
  await p.evaluate(() => { const c = document.querySelector('.jar'); if (c) c.click(); });
  await p.waitForTimeout(700);
  const dlgTitle = await p.evaluate(() => (document.querySelector('.dlg .h h3') || {}).textContent || '(没开)');
  console.log('点卡片打开的对话框:', dlgTitle);
  const dsum = await p.evaluate(() => {
    const e = document.querySelector('.jar-dsum');
    return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  console.log('明细摘要:', dsum);

  /* 右键卡片 */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const box = await p.evaluate(() => {
    const c = document.querySelector('.jar');
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 30 };
  });
  if (box) {
    await p.mouse.click(box.x, box.y, { button: 'right' });
    await p.waitForTimeout(400);
    const menu = await p.evaluate(() => [...document.querySelectorAll('.ctxmenu .ctx-t')].map((x) => x.textContent));
    console.log('右键菜单:', JSON.stringify(menu));
  }

  /* 清理 */
  const lst = await call('jar.list', {});
  for (const j of lst.jars || []) {
    if (j.name.indexOf('探针') === 0 || j.name.indexOf('52 周') >= 0 || true) {
      const dt = await call('jar.detail', { id: j.id });
      for (const it of dt.items || []) await call('jar.removeItem', { id: it.id });
      await call('jar.delete', { id: j.id });
    }
  }
  await p.keyboard.press('Escape');
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
