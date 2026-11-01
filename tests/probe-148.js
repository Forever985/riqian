const { run } = require('./_probe');

run(async (P, page) => {
  P.say('CDP 就绪');
  P.out(await P.eval(() => document.title));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await P.sleep(400);

  P.say('第 148 条：设置搜索 —— 拼音 shezhi');
  await P.go('settings');
  await P.eval(() => {
    const inp = document.querySelector('.searchbox input');
    if (!inp) return 'no-input';
    inp.focus();
    return 'ok';
  });
  await page.keyboard.type('shezhi');
  await P.sleep(900);
  P.out(await P.eval(() => {
    const rows = Array.from(document.querySelectorAll('.set-row[data-hit]'));
    return {
      n: rows.length,
      heads: Array.from(document.querySelectorAll('.setres-g')).map((g) => ({
        name: g.querySelector('.setres-t span')?.textContent,
        rows: g.querySelectorAll('.set-row[data-hit]').length,
        display: getComputedStyle(g).display,
      })).filter((x) => x.rows > 0 || x.display !== 'none').slice(0, 8),
      first3: rows.slice(0, 3).map((r) => ({
        t: r.querySelector('.lbl')?.textContent?.slice(0, 20),
        fs: r.getAttribute('data-fs'),
      })),
    };
  }));

  P.say('第 148 条：首字母 dhkd（导航宽度）');
  await P.eval(() => {
    const inp = document.querySelector('.searchbox input');
    if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.keyboard.press('Control+a').catch(() => {});
  await page.keyboard.type('dhkd');
  await P.sleep(900);
  P.out(await P.eval(() => {
    const rows = Array.from(document.querySelectorAll('.set-row[data-hit]'));
    return {
      n: rows.length,
      first5: rows.slice(0, 5).map((r) => ({
        t: r.querySelector('.lbl')?.textContent?.slice(0, 18),
        fs: r.getAttribute('data-fs'),
      })),
    };
  }));

  P.say('第 148 条：部分查询「宽度」—— 完全/开头命中的该排前面');
  await page.keyboard.press('Control+a').catch(() => {});
  await page.keyboard.type('宽度');
  await P.sleep(900);
  P.out(await P.eval(() => {
    const rows = Array.from(document.querySelectorAll('.set-row[data-hit]'));
    return rows.slice(0, 8).map((r) => ({
      t: r.querySelector('.lbl')?.textContent?.slice(0, 18),
      fs: r.getAttribute('data-fs'),
      order: getComputedStyle(r).order,
    }));
  }));

  P.say('清空恢复');
  await P.eval(() => {
    const c = document.querySelector('.sb-clear');
    if (c) c.click();
    return true;
  });
  await P.sleep(400);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});