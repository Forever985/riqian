const { run } = require('./_probe');

run(async (P, page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await P.sleep(400);
  await P.go('settings');
  await P.sleep(600);

  const search = async (kw) => {
    await P.eval(() => {
      const inp = document.querySelector('.searchbox input');
      if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    });
    await page.click('.searchbox input');
    await page.keyboard.press('Control+a');
    await page.keyboard.type(kw);
    await P.sleep(800);
    const r = await P.eval(() => {
      const rows = Array.from(document.querySelectorAll('.set-row[data-hit]'));
      return {
        n: rows.length,
        top: rows
          .map((r) => ({
            t: (r.querySelector('.lbl')?.textContent || '').slice(0, 16),
            fs: Number(r.getAttribute('data-fs')),
          }))
          .sort((a, b) => a.fs - b.fs)
          .slice(0, 4),
      };
    });
    console.log(`  「${kw}」→ ${r.n} 行，最精确的几行：`);
    r.top.forEach((x) => console.log(`     [${x.fs}] ${x.t}`));
    return r;
  };

  P.say('拼音全拼：daohang');
  await search('daohang');
  P.say('拼音首字母：sz');      // 设置
  await search('sz');
  P.say('完全匹配优先：字号');
  await search('字号');
  P.say('部分匹配：宽度');
  await search('宽度');

  P.say('清空');
  await P.eval(() => document.querySelector('.sb-clear')?.click());
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});