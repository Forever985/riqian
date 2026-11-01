const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(10000);
  const rpc = (m,a) => p.evaluate(([mm,aa]) => new Promise(res => {
    const id = 64000 + Math.floor(Math.random()*15000);
    const h = e => { if (e.data && e.data.id===id) { window.chrome.webview.removeEventListener('message',h); res(e.data); } };
    window.chrome.webview.addEventListener('message',h);
    window.chrome.webview.postMessage({id, m:mm, a:aa||{}});
  }), [m,a]);
  await p.click('#app .nav button[title^="打卡"]'); await p.waitForTimeout(1200);
  const inp = p.locator('.hcard .hnote input').nth(1);
  console.log('count', await p.locator('.hcard .hnote input').count());
  await inp.click();
  await p.keyboard.type('键盘输入 3 公里');
  await p.waitForTimeout(300);
  // 手动触发 blur
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.waitForTimeout(1500);
  console.log('notes', JSON.stringify((await rpc('habit.notes', { date: new Date().toISOString().slice(0,10) })).data));
  console.log('value now', await inp.inputValue().catch(()=>'(gone)'));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
