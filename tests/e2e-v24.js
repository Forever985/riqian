/*
 * e2e-v24：选项卡三件事（172 加号面板 / 173 标签标题带日期且同日去重 / 175 横向滚动 + 拖动排序）
 *
 * 这三条在 v12.3 是手工探针验的，没有固化 —— 这里补上，以后改 Tabs.tsx 有回归兜底。
 *
 * 两个必须知道的坑：
 * 1. 拖动排序 **不能用 Playwright 的 mouse.move/down/up**。那是 HTML5 原生 drag
 *    （draggable=true + dragstart/dragover/drop），Playwright 的鼠标模拟在 WebView2 里
 *    完全触发不了，测出来永远是「顺序没变」的假绿。必须手动派发 DragEvent。
 * 2. 会在真实配置里开关 tabMode、写 settings.tabs。跑前记下原值，跑完恢复，
 *    否则用户的界面被你改成选项卡模式了。
 */
const { chromium } = require('playwright-core');

let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const port = process.argv[2] || '57001';
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 71000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  /* 恢复现场用：先记原值 */
  const boot0 = await rpc('bootstrap', {});
  const origTabMode = String(boot0?.data?.settings?.tabMode ?? '0');
  const origTabs = String(boot0?.data?.settings?.tabs ?? '');

  const rail = () => p.evaluate(() => {
    const r = document.querySelector('.tabs-rail');
    if (!r) return null;
    return {
      sw: r.scrollWidth, cw: r.clientWidth, left: Math.round(r.scrollLeft),
      cls: r.parentElement.className.trim(),
      keys: [...r.querySelectorAll('[data-tab]')].map((x) => x.getAttribute('data-tab')),
    };
  });

  try {
    /* ---------- 进选项卡模式 ---------- */
    await rpc('setting.set', { k: 'tabMode', v: '1' });
    await rpc('setting.set', { k: 'tabs', v: '' });
    /*
     * 改了 settings 之后必须让前端重新 bootstrap 才能读到新值（store 不会自动同步后端）。
     * 这里用 reload：界面是 NavigateToString，reload 后仍是同一份内联 HTML，实测可用。
     * 早先注释里写「reload 会变 about:blank」是错的 —— 那是指直接 p.goto() 到空地址。
     */
    await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(2600);

    const hasRail = await p.evaluate(() => !!document.querySelector('.tabs-rail, [data-tab]'));
    ok('172-0 选项卡模式下有标签条', hasRail, hasRail ? '' : '找不到 .tabs-rail 也没 [data-tab]');
    if (!hasRail) throw new Error('标签条不存在，后续全部无法进行（可能是 tabMode 没生效）');

    /* ---------- 172 加号面板 ---------- */
    const addBtn = await p.$('.tab-new');
    ok('172-1 标签条右边有加号按钮（.tab-new）', !!addBtn);
    if (addBtn) {
      await addBtn.click();
      await p.waitForTimeout(600);
      const panel = await p.evaluate(() => {
        const d = document.querySelector('.tabadd');
        if (!d) return null;
        return {
          quick: [...d.querySelectorAll('.tabadd-quick .btn')].map((x) => (x.innerText || '').trim()),
          pages: [...d.querySelectorAll('.tabadd-pages .chip')].map((x) => (x.innerText || '').trim()),
          dateInput: !!d.querySelector('#tabadd-date'),
          hasRecent: !!d.querySelector('.tabadd-list'),
        };
      });
      ok('172-2 点加号弹出面板，给的是「今天/昨天/前天」而不是只再开一个今天',
        !!panel && panel.quick.length === 3 && panel.quick.some((t) => t.includes('今天')),
        panel ? JSON.stringify(panel.quick) : '面板不存在');
      ok('172-3 面板里能挑任意一天（日期输入框）', !!panel && panel.dateInput);
      ok('172-4 面板里能直接打开某个页面（>3 个页面入口）', !!panel && panel.pages.length > 3,
        panel ? `${panel.pages.length} 个` : '');

      /* 点「昨天」应该真的开出新标签，且标题是「昨天」不是「今天」 */
      const before = (await rail()).keys;
      await p.evaluate(() => {
        const btns = [...document.querySelectorAll('.tabadd-quick .btn')];
        const y = btns.find((x) => (x.innerText || '').trim() === '昨天') || btns[1];
        if (y) y.click();
      });
      await p.waitForTimeout(1200);
      const after = await rail();
      const addedKey = after.keys.find((k) => !before.includes(k));
      const addedTitle = await p.evaluate((k) => {
        const el = document.querySelector(`[data-tab="${k}"] .tt`);
        return el ? (el.innerText || '').trim() : '';
      }, addedKey || '');
      ok('172-5 点「昨天」真的开出一个新标签', !!addedKey, `新标签=${addedKey || '无'} (之前 ${before.length} 个)`);
      ok('173-1 新标签标题写的是日期，不是所有日记都叫「今天」',
        addedKey ? addedKey !== 'today' && /昨天|月|周/.test(addedTitle) : false,
        `key="${addedKey}" 标题="${addedTitle}"`);

      /* ---------- 173 同一天只开一个 ---------- */
      await p.click('.tab-new');
      await p.waitForTimeout(400);
      const n1 = (await rail()).keys.length;
      await p.evaluate(() => {
        const btns = [...document.querySelectorAll('.tabadd-quick .btn')];
        const y = btns.find((x) => (x.innerText || '').trim() === '昨天') || btns[1];
        if (y) y.click();
      });
      await p.waitForTimeout(1200);
      const r2 = await rail();
      ok('173-2 同一个日期点两次不会开出两个标签（去重）',
        r2.keys.length === n1 && new Set(r2.keys).size === r2.keys.length,
        `之前 ${n1} 个，之后 ${r2.keys.length} 个，去重后 ${new Set(r2.keys).size}`);
    }

    /* ---------- 175 横向滚动 ---------- */
    /* 开够标签逼出溢出：14 是 MAX_TABS，加号一直点会挤掉最早的 */
    for (let i = 0; i < 13; i++) {
      const has = await p.$('.tab-new');
      if (!has) break;
      await p.evaluate((off) => {
        const btn = document.querySelector('.tab-new');
        if (btn) btn.click();
      }, i);
      await p.waitForTimeout(200);
      const inp = await p.$('.tabadd-date input');
      if (inp) {
        const d = new Date(Date.now() - (i + 3) * 86400000);
        const ymd = d.toISOString().slice(0, 10);
        await inp.fill(ymd);
        const go = await p.$('.tabadd-date .btn.primary');
        if (go) { await go.click(); await p.waitForTimeout(350); }
        else await p.keyboard.press('Escape').catch(() => {});
      }
    }
    await p.waitForTimeout(800);
    const wide = await rail();
    ok('175-1 标签多了以后容器会横向溢出（而不是把页面撑宽）',
      !!wide && wide.sw > wide.cw + 1,
      wide ? `scrollWidth ${wide.sw} vs clientWidth ${wide.cw}` : '标签条不存在');

    if (wide && wide.sw > wide.cw + 1) {
      /* 甩回最左，两端渐变应该只在右侧出现 */
      await p.evaluate(() => { document.querySelector('.tabs-rail').scrollLeft = 0; });
      await p.waitForTimeout(500);
      const atLeft = await rail();
      ok('175-2 在最左端时只有右边渐变提示（还有内容没露出来）',
        atLeft.cls.includes('can-r') && !atLeft.cls.includes('can-l'),
        `class="${atLeft.cls}"`);

      /* 滚轮纵向 → 横向 */
      await p.hover('.tabs-rail');
      await p.mouse.wheel(0, 180);
      await p.waitForTimeout(500);
      const afterWheel = await rail();
      ok('175-3 滚轮上下滚能让标签条横向移动（不用按住 shift）',
        afterWheel.left > 0,
        `scrollLeft ${atLeft.left} → ${afterWheel.left}`);
      ok('175-4 滚到中间时左右两端都有渐变',
        afterWheel.cls.includes('can-l') && afterWheel.cls.includes('can-r'),
        `class="${afterWheel.cls}"`);

      /* ---------- 175 拖动排序（必须原生 DragEvent） ---------- */
      await p.evaluate(() => { document.querySelector('.tabs-rail').scrollLeft = 0; });
      await p.waitForTimeout(400);
      const orderBefore = (await rail()).keys;
      const dragged = await p.evaluate(() => {
        const tabs = [...document.querySelectorAll('.tabs-rail .tab')];
        if (tabs.length < 3) return null;
        const src = tabs[0], dst = tabs[2];
        const dt = new DataTransfer();
        const mk = (type) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
        src.dispatchEvent(mk('dragstart'));
        dst.dispatchEvent(mk('dragover'));
        dst.dispatchEvent(mk('drop'));
        src.dispatchEvent(mk('dragend'));
        return { src: src.getAttribute('data-tab'), dst: dst.getAttribute('data-tab') };
      });
      await p.waitForTimeout(1200);
      const orderAfter = (await rail()).keys;
      ok('175-5 拖动能换位置（拖动派发 DragEvent，不是鼠标模拟）',
        !!dragged && JSON.stringify(orderBefore) !== JSON.stringify(orderAfter),
        dragged ? `${dragged.src} → ${dragged.dst} 位置，顺序变了=${JSON.stringify(orderBefore) !== JSON.stringify(orderAfter)}` : '标签不足 3 个');

      /* 顺序要落库，否则重开软件就白拖了 */
      const saved = await rpc('bootstrap', {});
      const raw = saved?.data?.settings?.tabs;
      let savedKeys = [];
      try { savedKeys = (typeof raw === 'string' ? JSON.parse(raw) : raw || []).map((x) => x.key); } catch { savedKeys = []; }
      ok('175-6 拖完的顺序写进了 settings.tabs（重开软件还记得）',
        savedKeys.length > 0 && JSON.stringify(savedKeys) === JSON.stringify(orderAfter),
        `落库 ${savedKeys.length} 个：${JSON.stringify(savedKeys.slice(0, 3))} / 界面：${JSON.stringify(orderAfter.slice(0, 3))}`);

      /* 上限：一直开也不能无限涨 */
      ok('175-7 标签总数有上限（不会无限堆积）', orderAfter.length <= 14,
        `当前 ${orderAfter.length} 个`);
    }
  } finally {
    /* ---------- 恢复现场 ---------- */
    await rpc('setting.set', { k: 'tabMode', v: origTabMode }).catch(() => {});
    await rpc('setting.set', { k: 'tabs', v: origTabs }).catch(() => {});
    await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(2200);
    console.log('\n  已恢复 tabMode=' + origTabMode + '，tabs 原值已写回');
    console.log('  页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '无'));
    ok('无页面报错', errs.length === 0, errs.slice(0, 2).join(' | '));
    console.log(`\n套件结果：${pass} 通过 / ${fails.length} 失败  （共 ${pass + fails.length} 项）`);
    if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
    await b.close().catch(() => {});
  }
})();