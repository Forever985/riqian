/* 第 84b/87 条验收：量化静止态/悬停/选中三态的差异，不靠肉眼 */
const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  await p.waitForTimeout(500);

  const r = await p.evaluate(() => {
    const desc = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        shadow: cs.boxShadow === 'none' ? 'none' : 'yes',
        border: cs.borderTopWidth,
      };
    };
    const navOn = document.querySelector('.nav button.on');
    const navOff = document.querySelector('.nav button:not(.on)');
    const snavOn = document.querySelector('.snav.on');
    const snavOff = document.querySelector('.snav:not(.on)');
    return {
      navOn: { txt: (navOn?.innerText || '').trim(), ...desc(navOn) },
      navOff: { txt: (navOff?.innerText || '').trim(), ...desc(navOff) },
      snavOn: { txt: (snavOn?.innerText || '').trim(), ...desc(snavOn) },
      snavOff: { txt: (snavOff?.innerText || '').trim(), ...desc(snavOff) },
      brand: desc(document.querySelector('.brand')),
      ghost: desc(document.querySelector('.btn.ghost')),
      ghostCount: document.querySelectorAll('.btn.ghost').length,
    };
  });

  // 三态是否真的不同（同色 = 区分失败）
  const uniq = (o) => JSON.stringify([o?.bg, o?.shadow]);
  const out = {
    ...r,
    _navOnOff不同: uniq(r.navOn) !== uniq(r.navOff),
    _snavOnOff不同: uniq(r.snavOn) !== uniq(r.snavOff),
    _brand有底: r.brand?.bg !== 'rgba(0, 0, 0, 0)',
    _ghost有边: r.ghost && r.ghost.border !== '0px',
  };
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });