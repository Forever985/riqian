const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(10000);
  const rpc = (m,a) => p.evaluate(([mm,aa]) => new Promise(res => {
    const id = 62000 + Math.floor(Math.random()*20000);
    const h = e => { if (e.data && e.data.id===id) { window.chrome.webview.removeEventListener('message',h); res(e.data); } };
    window.chrome.webview.addEventListener('message',h);
    window.chrome.webview.postMessage({id, m:mm, a:aa||{}});
  }), [m,a]);
  await p.click('#app .nav button[title^="打卡"]');
  await p.waitForTimeout(1000);
  const info = await p.evaluate(() => ({
    cards: document.querySelectorAll('.hcard').length,
    notes: document.querySelectorAll('.hcard .hnote input').length,
    ph: document.querySelector('.hcard .hnote input')?.placeholder,
  }));
  console.log('ui', info);
  const inp = p.locator('.hcard .hnote input').first();
  if (await inp.count()) {
    await inp.click();
    await inp.fill('探针备注 5 公里');
    await p.waitForTimeout(400);
    await p.keyboard.press('Tab');
    await p.waitForTimeout(1500);
  }
  console.log('rpc', JSON.stringify(await rpc('habit.notes', { date: new Date().toISOString().slice(0,10) })));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
