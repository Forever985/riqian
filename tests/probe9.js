const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(10000);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yKey = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
  await p.click('#app .nav button[title^="日历"]'); await p.waitForTimeout(1000);
  const cells = await p.evaluate(() => [...document.querySelectorAll('.cal2-cell:not(.other)')].map(c => c.title));
  console.log('count', cells.length, 'first', cells[0], 'last', cells[cells.length-1]);
  const idx = await p.evaluate((d) => [...document.querySelectorAll('.cal2-cell:not(.other)')].findIndex(c => (c.title||'').startsWith(d)), yKey);
  console.log('idx', idx, 'target', yKey);
  if (idx >= 0) {
    await p.locator('.cal2-cell:not(.other)').nth(idx).dblclick();
    await p.waitForTimeout(1600);
  }
  console.log(await p.evaluate(() => ({
    h2: document.querySelector('.topbar h2')?.textContent,
    sub: document.querySelector('.topbar .sub')?.textContent,
    head: document.querySelector('.datehead .d1')?.textContent,
    tabs: [...document.querySelectorAll('.tabs .tab')].map(t=>t.textContent.replace('✕','')).slice(0,6),
    active: document.querySelector('.tabs .tab.on')?.textContent,
  })));
  await b.close().catch(()=>{});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
