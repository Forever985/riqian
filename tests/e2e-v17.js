const { chromium } = require('playwright-core');

/**
 * v17：可读性地基审计（第 177 / 183 条）
 *
 * 做法：铺一张很花的模拟背景图（黑白网格 + 高饱和色块），
 * 然后逐页扫描所有可交互元素，把「背景几乎全透明」的挑出来 ——
 * 那些就是压在图上看不见的控件。
 *
 * 这不是"看着还行"就过的检查，是给出确切数量和位置。
 */
(async () => {
  const port = process.argv[2] || '57001';
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);

  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));

  let pass = 0, fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  ✓', name); }
    else { fail++; console.log('  ✗', name, String(extra).slice(0, 300)); }
  };

  const go = async (v) => { await p.click(`.nav button[data-nav="${v}"]`); await p.waitForTimeout(1100); };
  await p.keyboard.press('Escape').catch(() => {});

  /* 铺一张极端背景：黑白相间的棋盘 + 高饱和色带，任何透明的地方都会露馅 */
  await p.evaluate(() => {
    document.documentElement.setAttribute('data-appbg', '');
    // 真实场景里 --appbg 会被设成 transparent，.app 才透出背景图；
    // 不设的话 .app 的实色底会把模拟层盖住，测出来的「有背景」其实是假的
    document.documentElement.style.setProperty('--appbg', 'transparent');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <defs><pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse">
        <rect width="60" height="60" fill="#ffffff"/>
        <rect width="30" height="30" fill="#111111"/>
        <rect x="30" y="30" width="30" height="30" fill="#111111"/>
      </pattern></defs>
      <rect width="240" height="240" fill="url(#p)"/>
      <rect y="180" width="240" height="60" fill="#ff0066" opacity=".8"/>
    </svg>`;
    let layer = document.getElementById('__audit_bg');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = '__audit_bg';
      layer.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;background-size:240px 240px';
      document.body.appendChild(layer);
    }
    layer.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  });
  await p.waitForTimeout(500);

  /** 扫描当前页面：哪些可交互元素是可读的 */
  const audit = () => p.evaluate(() => {
    const sel = 'button, a, .chip, .inp, input, select, textarea, [role="button"]';
    const items = [...document.querySelectorAll(sel)];
    const bad = [];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
      const bg = cs.backgroundColor || '';
      // 往上最多找 8 层（card > card-inner > mod > toolbar 这种深度也要算进去）
      // 取 alpha
      let a = 1;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map((x) => Number(x.trim()));
        a = parts.length >= 4 ? parts[3] : 1;
      } else if (bg === 'transparent') a = 0;
      const blur = cs.backdropFilter && cs.backdropFilter !== 'none';
      // 实心父容器也算「有底」：往上找 3 层，看有没有 alpha 足够高的底
      let parentSolid = false;
      let node = el.parentElement;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const pcs = getComputedStyle(node);
        const pbg = pcs.backgroundColor || '';
        const pm = pbg.match(/rgba?\(([^)]+)\)/);
        let pa = 1;
        if (pm) {
          const parts = pm[1].split(',').map((x) => Number(x.trim()));
          pa = parts.length >= 4 ? parts[3] : 1;
        }
        if (pa >= 0.8) { parentSolid = true; break; }
      }
      if (a < 0.5 && !blur && !parentSolid) {
        bad.push({
          cls: (el.className || '').toString().slice(0, 42),
          tag: el.tagName.toLowerCase(),
          txt: (el.innerText || '').trim().slice(0, 14),
          a: Number(a.toFixed(2)),
          y: Math.round(r.top),
        });
      }
    }
    return { total: items.length, bad };
  });

  const pages = [
    ['today', '今天'], ['todos', '待办'], ['notes', '笔记'],
    ['records', '记录'], ['settings', '设置'], ['ledger', '记账本'],
    ['timeline', '时间轴'], ['stats', '统计'], ['calendar', '日历'],
  ];

  let worst = { page: '', n: 0 };
  for (const [v, name] of pages) {
    await go(v);
    await p.waitForTimeout(700);
    const r = await audit();
    if (r.bad.length > worst.n) worst = { page: name, n: r.bad.length };
    ok(`${name}：无「透明底不可读」控件`, r.bad.length === 0, `${r.bad.length} 个 → ` + JSON.stringify(r.bad.slice(0, 4)));
  }

  /* 几个关键框架元素必须实底 */
  const keyChecks = await p.evaluate(() => {
    const alpha = (el) => {
      if (!el) return -1;
      const bg = getComputedStyle(el).backgroundColor || '';
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) return bg === 'transparent' ? 0 : 1;
      const parts = m[1].split(',').map((x) => Number(x.trim()));
      return parts.length >= 4 ? parts[3] : 1;
    };
    return {
      topbar: alpha(document.querySelector('.topbar')),
      side: alpha(document.querySelector('.side')),
      rail: alpha(document.querySelector('.rail')),
      setnav: alpha(document.querySelector('.setnav')),
    };
  });
  ok('顶栏是实底', keyChecks.topbar >= 0.9, JSON.stringify(keyChecks));
  ok('侧栏是实底', keyChecks.side >= 0.9, JSON.stringify(keyChecks));

  // 待办页 / 设置页各回去看一眼子导航
  await go('todos');
  await p.waitForTimeout(600);
  const railA = await p.evaluate(() => {
    const el = document.querySelector('.rail');
    if (!el) return -1;
    const m = (getComputedStyle(el).backgroundColor || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(',').map((x) => Number(x.trim()));
    return parts.length >= 4 ? parts[3] : 1;
  });
  ok('待办子导航是实底（177）', railA >= 0.9, `alpha=${railA}`);

  await go('settings');
  await p.waitForTimeout(600);
  const setnavA = await p.evaluate(() => {
    const el = document.querySelector('.setnav');
    if (!el) return -1;
    const m = (getComputedStyle(el).backgroundColor || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(',').map((x) => Number(x.trim()));
    return parts.length >= 4 ? parts[3] : 1;
  });
  ok('设置子导航是实底', setnavA >= 0.9, `alpha=${setnavA}`);

  /* 卡片背景图上的控件（183）—— 给今天的主卡片临时加背景图 */
  await go('today');
  await p.waitForTimeout(800);
  const cardOk = await p.evaluate(() => {
    const card = document.querySelector('.card');
    if (!card) return { ok: false, reason: 'no card' };
    card.classList.add('hasbg');
    if (!card.querySelector('.card-bg')) {
      const bg = document.createElement('div');
      bg.className = 'card-bg';
      bg.style.cssText = 'position:absolute;inset:0;z-index:0;background-image:repeating-linear-gradient(45deg,#000 0 8px,#fff 8px 16px)';
      card.insertBefore(bg, card.firstChild);
      const veil = document.createElement('div');
      veil.className = 'card-bg-veil';
      veil.style.cssText = 'position:absolute;inset:0;z-index:1;background:transparent';
      card.insertBefore(veil, bg.nextSibling);
      const inner = card.querySelector('.card-inner');
      if (!inner) {
        const wrap = document.createElement('div');
        wrap.className = 'card-inner';
        while (card.lastChild && card.lastChild !== veil) wrap.insertBefore(card.lastChild, wrap.firstChild);
        card.appendChild(wrap);
      }
    }
    const btns = [...card.querySelectorAll('.btn.ghost, .mod-tools button, .toolbar')];
    if (!btns.length) return { ok: false, reason: 'no ghost btn in card', n: 0 };
    const solid = btns.filter((el) => {
      const cs = getComputedStyle(el);
      const m = (cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
      let a = 1;
      if (m) { const q = m[1].split(',').map((x) => Number(x.trim())); a = q.length >= 4 ? q[3] : 1; }
      else a = (cs.backgroundColor === 'transparent' ? 0 : 1);
      return a >= 0.5 || (cs.backdropFilter && cs.backdropFilter !== 'none');
    });
    return { ok: solid.length === btns.length, n: btns.length, solid: solid.length };
  });
  ok('卡片背景图上的控件有玻璃底（183）', cardOk.ok, JSON.stringify(cardOk));

  await p.screenshot({ path: 'bg-audit.png' }).catch(() => {});

  ok('无页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  // 清掉注入
  await p.evaluate(() => {
    document.getElementById('__audit_bg')?.remove();
    document.documentElement.removeAttribute('data-appbg');
    document.documentElement.style.removeProperty('--appbg');
  });

  console.log(`\nv17 审计：${pass} 通过 / ${fail} 失败 · 最差页面「${worst.page}」${worst.n} 个透明控件`);
  await b.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
