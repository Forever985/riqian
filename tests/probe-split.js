const { run } = require('./_probe');

run(async (P) => {
  P.say('回到「今天」页并切到 Markdown');
  await P.go('today');
  await P.eval(() => {
    const b = document.querySelector('[data-act="toggle-source"]');
    if (b && b.textContent !== 'MD') b.click();
    return true;
  });
  await P.sleep(900);

  const snap = () => P.eval(() => {
    const sp = document.querySelector('.md-split');
    if (!sp) return { found: false };
    const ta = sp.querySelector('textarea');
    return {
      found: true,
      cols: getComputedStyle(sp).gridTemplateColumns,
      host: Math.round(sp.getBoundingClientRect().width),
      textarea: Math.round(ta.getBoundingClientRect().width),
      var: getComputedStyle(document.documentElement).getPropertyValue('--mdsplit').trim()
        || getComputedStyle(sp).getPropertyValue('--mdsplit').trim(),
    };
  });

  P.say('初始');
  P.out(await snap());

  for (const v of ['30%', '70%']) {
    P.say(`--mdsplit = ${v}`);
    await P.eval((x) => document.documentElement.style.setProperty('--mdsplit', x), v);
    await P.sleep(250);
    P.out(await snap());
  }

  P.say('还原成 50%');
  await P.eval(() => document.documentElement.style.setProperty('--mdsplit', '50%'));
  await P.sleep(200);
  P.out(await snap());
});