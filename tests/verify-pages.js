/* 界面级检查：每个页面都切一遍，收集（1）渲染异常（2）控制台错误（3）空白页 */
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const ctx0 = b.contexts()[0];
  const p = ctx0.pages()[0] || (await ctx0.waitForEvent('page'));
  await p.waitForLoadState('domcontentloaded');
  await p.waitForTimeout(2000);

  const consoleErrs = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => consoleErrs.push('PAGEERROR: ' + String(e.message).slice(0, 200)));

  const navs = await p.evaluate(() =>
    [...document.querySelectorAll('.nav button')].map((b) => ({
      nav: b.getAttribute('data-nav'),
      text: (b.textContent || '').trim(),
    })).filter((x) => x.nav));

  console.log('导航项:', navs.length, navs.map((x) => x.nav + '(' + x.text + ')').join(' '));

  const bad = [];
  for (const { nav, text } of navs) {
    await p.evaluate((n) => {
      const t = [...document.querySelectorAll('.nav button')].find((x) => x.getAttribute('data-nav') === n);
      if (t) t.click();
    }, nav);
    await p.waitForTimeout(700);

    const info = await p.evaluate(() => {
      const root = document.querySelector('#root');
      const main = document.querySelector('.wrap') || root;
      const txt = (main ? main.innerText : '').replace(/\s+/g, '');
      // 找可能的「NaN / undefined / null / Infinity」明文
      const body = document.body.innerText || '';
      const suspicious = (body.match(/NaN|undefined个|Infinity|\[object Object\]/g) || []).slice(0, 5);
      return { len: txt.length, suspicious, hasEmpty: !!document.querySelector('.empty') };
    });

    const flag = info.len < 40 ? '⚠️空白' : (info.suspicious.length ? '⚠️可疑文本' : 'ok');
    if (flag !== 'ok') bad.push({ nav, text, ...info, flag });
    console.log('  ' + flag.padEnd(10) + ' ' + nav + ' (' + text + ')  文本长度=' + info.len +
      (info.suspicious.length ? '  可疑: ' + info.suspicious.join(',') : ''));
  }

  console.log('');
  console.log('================ 有问题的页面 ================');
  if (!bad.length) console.log('  无');
  bad.forEach((x) => console.log('  ' + x.flag + ' ' + x.nav + ' → ' + JSON.stringify(x.suspicious)));

  console.log('');
  console.log('================ 控制台错误 ================');
  if (!consoleErrs.length) console.log('  无');
  [...new Set(consoleErrs)].forEach((e) => console.log('  · ' + e));

  await b.close().catch(() => {});
})().catch((e) => { console.log('探针异常：' + e.message); process.exit(2); });