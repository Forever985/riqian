/**
 * 第 154 条：媒体库框选 + 拖动。
 *
 * 验证清单：
 *  a) 整理模式点开后，.marqwrap[data-picking="1"] 出现
 *  b) 在空白处按住拖 → .marq 出现，松手后 sel 数量 > 0
 *  c) 点一下空白（位移 < 4px）→ sel 归零
 *  d) Shift 拖 → 在原有基础上追加
 *  e) 卡片只在整理模式下 draggable
 */
const { run } = require('./_probe');

run(async (P, page) => {
  await page.keyboard.press('Escape').catch(() => {});
  await P.sleep(400);

  P.say('打开多媒体库');
  P.out(await P.eval(() => {
    const nav = document.querySelector('.nav button[data-nav="media"]');
    if (nav) { nav.click(); return 'nav'; }
    const b = document.querySelector('[data-act="open-media"]');
    if (b) { b.click(); return 'act'; }
    return { err: '找不到入口', navs: Array.from(document.querySelectorAll('.nav button')).map((x) => x.textContent) };
  }));
  await P.sleep(1600);

  // 视图可能是上次留下的「按月」（月份一折叠就没有卡片），先强制切回网格
  P.say('强制切到网格视图');
  P.out(await P.eval(() => {
    const b = document.querySelector('[data-view="grid"]');
    if (!b) return { err: '没有视图按钮' };
    b.click();
    return { ok: true };
  }));
  await P.sleep(900);

  P.say('检查未进整理模式时不能拖动（防重复导入）');
  P.out(await P.eval(() => ({
    cards: document.querySelectorAll('.marqwrap [data-selid]').length,
    draggable: document.querySelectorAll('.marqwrap [data-selid][draggable="true"]').length,
    picking: document.querySelector('.marqwrap')?.getAttribute('data-picking') || null,
  })));

  P.say('确保处于整理模式（按钮文字是幂等的，别把已开的又关掉）');
  P.out(await P.eval(() => {
    const b = document.querySelector('[data-act="pickmode"]');
    if (!b) return { err: '没有 pickmode 按钮' };
    const on = /完成/.test(b.textContent || '');
    if (!on) b.click();
    return { wasOn: on, clicked: !on };
  }));
  await P.sleep(500);

  P.say('整理模式下的容器状态');
  P.out(await P.eval(() => {
    const w = document.querySelector('.marqwrap');
    return {
      hasWrap: !!w,
      picking: w ? w.getAttribute('data-picking') : null,
      items: document.querySelectorAll('.marqwrap [data-selid]').length,
      draggable: document.querySelectorAll('.marqwrap [data-selid][draggable="true"]').length,
    };
  }));

  const geo = await P.eval(() => {
    const w = document.querySelector('.marqwrap');
    if (!w) return null;
    const nodes = Array.from(document.querySelectorAll('.marqwrap [data-selid]'));
    if (!nodes.length) return null;
    const rr = w.getBoundingClientRect();
    const f = nodes[0].getBoundingClientRect();
    const l = nodes[nodes.length - 1].getBoundingClientRect();

    // 找一个真正的空白起手点：卡片之间的 gap 或容器边缘都算。
    // 直接拿 wrap 左上角是不行的 —— 网格排满时那个点就落在第一张卡片上，
    // mousedown 会被卡片自己吃掉（这是设计如此，不是 bug）。
    let blank = null;
    outer:
    for (let y = Math.ceil(rr.top) + 2; y < rr.bottom - 2; y += 2) {
      for (let x = Math.ceil(rr.left) + 2; x < rr.right - 2; x += 2) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (el.closest('[data-selid]')) continue;
        if (el.closest('button,a,input,select,textarea,label')) continue;
        blank = { x, y };
        break outer;
      }
    }

    return {
      wrap: { l: rr.left, t: rr.top, w: rr.width, h: rr.height },
      first: { l: f.left, t: f.top, w: f.width, h: f.height },
      last: { l: l.left, t: l.top, w: l.width, h: l.height },
      blank,
    };
  });
  P.out(geo);
  if (!geo || !geo.wrap) { console.log('  ✗ 没有可框的容器'); return; }

  if (!geo.blank) { console.log('  ✗ 找不到空白起手点（网格被卡片铺满了）'); return; }
  const sx = geo.blank.x;
  const sy = geo.blank.y;
  const ex = geo.first.l + geo.first.w * 1.6;
  const ey = geo.first.t + geo.first.h * 1.6;

  P.say('按下 → 小幅移动，确认 .marq 出现');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy + 40, { steps: 6 });
  P.out(await P.eval(() => {
    const m = document.querySelector('.marq');
    if (!m) return { hasMarq: false };
    const r = m.getBoundingClientRect();
    return { hasMarq: true, size: `${Math.round(r.width)}x${Math.round(r.height)}` };
  }));

  P.say('拖到第一排右侧，看实时选中');
  await page.mouse.move(ex, ey, { steps: 12 });
  await P.sleep(200);
  P.out(await P.eval(() => {
    const m = document.querySelector('.marq');
    const r = m ? m.getBoundingClientRect() : null;
    return {
      marq: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : null,
      picked: document.querySelectorAll('.marqwrap .imgpick.picked').length,
      checked: document.querySelectorAll('.marqwrap .pickbox.on').length,
    };
  }));
  await page.mouse.up();
  await P.sleep(300);

  P.say('松手后');
  P.out(await P.eval(() => {
    const bulk = document.querySelector('.lg-bulk');
    return {
      marqGone: !document.querySelector('.marq'),
      picked: document.querySelectorAll('.marqwrap .imgpick.picked').length,
      bulk: bulk ? bulk.textContent.replace(/\s+/g, ' ').slice(0, 50) : '无批量条',
    };
  }));

  P.say('点空白（位移 0）应清空');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.up();
  await P.sleep(350);
  P.out(await P.eval(() => ({
    picked: document.querySelectorAll('.marqwrap .imgpick.picked').length,
    bulk: (document.querySelector('.lg-bulk') || {}).textContent?.replace(/\s+/g, ' ').slice(0, 34),
  })));

  P.say('Shift 追加：先框第一格，再 Shift 框末格，应是并集');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(geo.first.l + geo.first.w * 0.7, geo.first.t + geo.first.h * 0.7, { steps: 8 });
  await page.mouse.up();
  await P.sleep(300);
  const n1 = await P.eval(() => document.querySelectorAll('.marqwrap .imgpick.picked').length);

  await page.keyboard.down('Shift');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(geo.last.l + geo.last.w, geo.last.t + geo.last.h, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await P.sleep(350);
  P.out(await P.eval((prev) => ({
    firstPass: prev,
    afterShift: document.querySelectorAll('.marqwrap .imgpick.picked').length,
    total: document.querySelectorAll('.marqwrap [data-selid]').length,
  }), n1));

  P.say('整理模式关掉后，框选应失效、draggable 应移除');
  await P.eval(() => { document.querySelector('[data-act="pickmode"]')?.click(); return 1; });
  await P.sleep(400);
  P.out(await P.eval(() => ({
    picking: document.querySelector('.marqwrap')?.getAttribute('data-picking') || null,
    draggable: document.querySelectorAll('.marqwrap [data-selid][draggable="true"]').length,
    picked: document.querySelectorAll('.marqwrap .imgpick.picked').length,
  })));
});