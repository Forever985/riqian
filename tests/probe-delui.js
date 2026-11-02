const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(12000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 74000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const t = new Date().toISOString().slice(0,10);
  const a1 = await rpc('pomodoro.add', { minutes: 30, kind: 'focus', task: 'UI删测试A' });
  const a2 = await rpc('pomodoro.add', { minutes: 20, kind: 'focus', task: 'UI删测试B' });
  await p.waitForTimeout(500);

  // 进番茄页开明细
  await p.evaluate(() => { const n = document.querySelector('.nav button[data-nav="pomodoro"]'); if (n) n.click(); });
  await p.waitForTimeout(1800);
  const btn = await p.$('[data-act="pomo-day"]');
  console.log('番茄页有「看明细」入口 =', !!btn);
  if (btn) {
    await btn.click();
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.mask .dlg .pdd-row')];
      return {
        dlgs: document.querySelectorAll('.mask .dlg').length,
        rows: rows.length,
        delBtns: document.querySelectorAll('.pdd-del').length,
        delBtnIds: [...document.querySelectorAll('.pdd-del')].map(x => x.getAttribute('data-pomo-id')).filter(Boolean).length,
        summary: (document.querySelector('.pdd-sum')?.innerText || '').replace(/\s+/g,' ').trim(),
      };
    });
    console.log('明细弹层 =', JSON.stringify(info, null, 1));

    // 点第一个删除
    const before = info.rows;
    await p.evaluate(() => { const x = document.querySelector('.pdd-del'); if (x) x.click(); });
    await p.waitForTimeout(1600);
    const after = await p.evaluate(() => ({
      rows: document.querySelectorAll('.mask .dlg .pdd-row').length,
      summary: (document.querySelector('.pdd-sum')?.innerText || '').replace(/\s+/g,' ').trim(),
    }));
    console.log('删一颗: 行数', before, '→', after.rows, ' 合计区:', after.summary);
    await p.keyboard.press('Escape').catch(()=>{});
  }

  // 清干净
  for (const r of [a1, a2]) if (r?.data?.id) await rpc('pomodoro.delete', { id: r.data.id });
  const dEnd = await rpc('pomo.day', { date: t });
  console.log('清完剩余:', dEnd.data.count, '条');
  console.log('页面错误:', errs.join(' | ') || '无');
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
