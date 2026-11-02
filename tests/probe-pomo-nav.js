const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);
  const navs = await p.evaluate(() => [...document.querySelectorAll('.nav button')].map((x) => ({
    txt: (x.textContent || '').trim().replace(/\s+/g, ' '),
    nav: x.getAttribute('data-nav'),
  })));
  console.log(JSON.stringify(navs, null, 0));

  const okGo = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.nav button')].find((x) => (x.getAttribute('data-nav') || '') === 'pomodoro');
    if (!b) return false;
    b.click();
    return true;
  });
  await p.waitForTimeout(1800);
  const r = await p.evaluate(() => ({
    hasPanel: !!document.querySelector('.pi-heat-cols'),
    title: (document.querySelector('.main h2') || {}).textContent || '',
    liveCount: document.querySelectorAll('.seg-b').length,
  }));
  console.log('跳转到番茄钟:', okGo, JSON.stringify(r));
  console.log(okGo && r.hasPanel ? 'PASS 番茄页洞察面板还在' : 'FAIL');
  await b.close();
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
