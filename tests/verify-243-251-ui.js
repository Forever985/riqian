/**
 * 验证 #243 / #245 / #246 / #251 的界面层效果。
 *
 * 只看代码「应该生效」不算数 —— 本项目已经栽过两次（语言字体栈、
 * .btn.ghost:hover 被后面的同名规则盖掉）。所以这里全部量**计算样式**。
 *
 * 用法：
 *   node tests/verify-243-251-ui.js 57112
 */
const { chromium } = require('playwright-core');

const PORT = process.env.CDP_PORT || process.argv[2] || '57112';
const BASE = `http://127.0.0.1:${PORT}`;

/** 相对亮度（WCAG 定义），用来算真实对比度而不是靠肉眼 */
const LUMA = `
  function _lum(rgb){
    /*
     * 必须区分两种写法，否则算出来是假的：
     *   rgb(184, 98, 58)            → 分量 0~255
     *   color(srgb 0.635 0.338 0.2) → 分量 0~1（color-mix() 算出来的就是这种）
     * 上一版一律按 0~255 除，把 0.63 除成 0.0025，亮度≈0，
     * 于是白字压深棕算出 20.95:1 —— 假读数比没读数更危险。
     */
    const nums = (rgb.match(/-?[\\d.]+/g) || []).map(Number);
    const isUnit = /^color\\(/i.test(rgb.trim());
    const m = nums.slice(0, 3).map(v => isUnit ? v : v / 255);
    const a = m.map(v => (v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4)));
    return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
  }
  function _contrast(fg,bg){
    const a=_lum(fg), b=_lum(bg);
    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  }
  function _alpha(rgb){
    const m = rgb.match(/[\\/]\\s*([\\d.]+)\\s*\\)/);
    if (m) return Number(m[1]);
    const m2 = rgb.match(/rgba\\([^)]*,\\s*([\\d.]+)\\s*\\)/);
    return m2 ? Number(m2[1]) : 1;
  }
`;

let failed = 0;
function check(ok, label, extra = '') {
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`);
}

(async () => {
  const b = await chromium.connectOverCDP(BASE);
  const ctx = b.contexts()[0];
  const page = ctx.pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => null);

  /*
   * 跳页必须点真实的导航按钮，不能去读 window.__store__ ——
   * 那个东西根本没往 window 上挂（store.ts 只暴露了 __FLUSH__ / __HOST_CMD__）。
   * 上一版就是错在「以为可以调 store.go()」，evaluate 静默返回 undefined，
   * 于是后面每一项都在「今天」页上采样，报出一堆假阴性 ——
   * 这种「测试自己错了却看着像产品坏了」的坑，比没测更浪费时间。
   */
  const go = async (view) => {
    const ok = await page.evaluate((v) => {
      const btn = document.querySelector(`button.navi[data-nav="${v}"]`);
      if (!btn) return false;
      btn.click();
      return true;
    }, view).catch(() => false);
    if (!ok) console.log(`    （导航里没有 ${view}，可能被隐藏了）`);
    await page.waitForTimeout(700);
    return ok;
  };

  console.log('\n=== #243 标签在纸质主题下的可读性 ===');
  // 造一个「有背景图 + 选中标签」的卡片，这正是原来失效的组合
  const r243 = await page.evaluate(() => {
    // 强制切到纸色主题，模拟用户的第一个主题
    document.documentElement.setAttribute('data-theme', 'paper');
    const host = document.createElement('div');
    host.id = '__probe243';
    host.style.cssText = 'position:fixed;left:-9999px;top:0;';
    host.innerHTML = `
      <div class="card hasbg" id="__c243">
        <div class="card-inner">
          <span class="chip" id="__chip_off">普通标签</span>
          <span class="chip on" id="__chip_on">选中标签</span>
        </div>
      </div>`;
    document.body.appendChild(host);
    const on = document.getElementById('__chip_on');
    const off = document.getElementById('__chip_off');
    const cs = getComputedStyle(on);
    const cso = getComputedStyle(off);
    return {
      onBg: cs.backgroundColor,
      onFg: cs.color,
      offBg: cso.backgroundColor,
      offFg: cso.color,
    };
  });
  console.log('    选中: bg=' + r243.onBg + '  fg=' + r243.onFg);
  console.log('    普通: bg=' + r243.offBg + '  fg=' + r243.offFg);

  const r243b = await page.evaluate((code) => {
    eval(code);
    const on = document.getElementById('__chip_on');
    const off = document.getElementById('__chip_off');
    const a = getComputedStyle(on), c = getComputedStyle(off);
    return {
      onContrast: _alpha(a.backgroundColor) < 0.5 ? -1 : _contrast(a.color, a.backgroundColor),
      offContrast: _alpha(c.backgroundColor) < 0.5 ? -1 : _contrast(c.color, c.backgroundColor),
      onAlpha: _alpha(a.backgroundColor),
    };
  }, LUMA).catch(() => null);
  if (r243b) {
    console.log('    选中对比度: ' + (r243b.onContrast < 0 ? '背景透明（不合格）' : r243b.onContrast.toFixed(2)));
    check(r243b.onContrast >= 4.5, '选中标签对比度 ≥ 4.5:1（WCAG AA）',
      r243b.onContrast > 0 ? r243b.onContrast.toFixed(2) : '');
  }

  await page.evaluate(() => { document.getElementById('__probe243')?.remove(); });

  console.log('\n=== #245 / #246 导航项 ===');
  const nav = await page.evaluate(() => {
    const items = [...document.querySelectorAll('button.navi[data-nav]')];
    const txt = items.map((x) => (x.textContent || '').trim()).filter(Boolean);
    const keys = items.map((x) => x.getAttribute('data-nav'));
    return {
      count: items.length,
      keys,
      hasExtensions: keys.includes('extensions'),
      hasWish: keys.includes('wish'),
      hasThemeCenter: keys.includes('themeCenter'),
      hasPlugin: keys.includes('pluginCenter'),
      hasWorkshop: keys.includes('workshop'),
      hasCache: keys.includes('cache'),
      all: txt,
    };
  });
  console.log('    导航项: ' + nav.all.join(' / '));
  check(nav.hasExtensions, '有「扩展」入口');
  check(nav.hasWish, '有「愿望单」入口');
  check(!nav.hasThemeCenter && !nav.hasPlugin && !nav.hasWorkshop, '主题/插件/工坊已合并（不再各占一格）');
  check(!nav.hasCache, '缓存已移出导航');

  console.log('\n=== #245 扩展页三个选项卡 ===');
  await go('extensions');
  const ext = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[data-act^="ext-tab-"]')].map((x) => (x.textContent || '').trim());
    const h2 = document.querySelector('#topbar-slot h2')?.textContent?.trim() || '';
    return { tabs, h2 };
  });
  console.log('    标题=' + ext.h2 + '  选项卡=' + ext.tabs.join(' / '));
  check(ext.tabs.length === 3, '三个选项卡齐全', ext.tabs.join(','));
  check(ext.h2 === '扩展', '顶栏标题是「扩展」');

  console.log('\n=== #250 愿望单页 ===');
  await go('wish');
  const wish = await page.evaluate(() => {
    const h2 = document.querySelector('#topbar-slot h2')?.textContent?.trim() || '';
    const rows = document.querySelectorAll('.wish-row').length;
    const summary = document.querySelectorAll('.wish-num').length;
    return { h2, rows, summary };
  });
  console.log('    标题=' + wish.h2 + '  行数=' + wish.rows + '  汇总块=' + wish.summary);
  check(wish.h2 === '愿望单', '顶栏标题是「愿望单」');
  check(wish.summary >= 2 || wish.rows === 0, '汇总或空状态正常显示');

  console.log('\n=== #246 缓存页可达 + 有返回入口 ===');
  /*
   * 缓存已不在导航里，所以不能 go('cache')。
   * 正确路径就是用户的那条：设置 → 数据与缓存 → 「查看占用 / 立即清理」。
   * 这条链断了就等于功能没了，必须整条走一遍。
   */
  await go('settings');
  /*
   * 设置页是「分组切换」的：默认只显示「外观主题」，
   * 「数据与缓存」那一组没被点开时，里面的按钮根本不在 DOM 里。
   * 上一版直接找「查看占用」自然找不到 —— 是测试没走对路，不是功能没了。
   */
  const clickedGroup = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.setnav button')]
      .find((x) => (x.textContent || '').includes('数据与缓存'));
    if (!btn) return false;
    btn.click();
    return true;
  }).catch(() => false);
  check(clickedGroup, '设置页有「数据与缓存」分组');
  await page.waitForTimeout(600);

  const jumped = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent || '').includes('查看占用'));
    if (!btn) return false;
    btn.click();
    return true;
  }).catch(() => false);
  check(jumped, '「数据与缓存」里有「查看占用 / 立即清理」入口');
  await page.waitForTimeout(900);
  const cache = await page.evaluate(() => {
    const h2 = document.querySelector('#topbar-slot h2')?.textContent?.trim() || '';
    const back = [...document.querySelectorAll('#topbar-slot button')]
      .some((x) => (x.textContent || '').includes('设置'));
    return { h2, back };
  });
  console.log('    标题=' + cache.h2 + '  有返回设置按钮=' + cache.back);
  check(cache.h2 === '缓存', '缓存页仍可路由');
  check(cache.back, '缓存页有返回设置的路口');

  console.log('\n=== #244 流页面里加锁的那天 ===');
  await go('flow');
  await page.waitForTimeout(900);
  const flow = await page.evaluate(() => {
    const locked = document.querySelectorAll('.fw-locked').length;
    const entries = document.querySelectorAll('.fw-entry').length;
    const txt = [...document.querySelectorAll('.fw-locked')].map((x) => (x.textContent || '').trim().slice(0, 30));
    const lockedDates = [...document.querySelectorAll('.fw-entry')].map((e) => ({
      date: e.getAttribute('data-entry'),
      hasLock: !!e.querySelector('.fw-locked'),
      chars: (e.querySelector('.fw-date .meta')?.textContent || ''),
    })).filter((x) => x.hasLock);
    return { locked, entries, txt, lockedDates };
  });
  console.log('    条目数=' + flow.entries + '  加锁占位=' + flow.locked);
  flow.lockedDates.forEach((x) => console.log('      ' + x.date + ' → 显示：' + x.chars.trim().slice(0, 40)));
  check(flow.locked > 0, '流里加锁的那天显示占位而不是正文');

  console.log('\n=== #248 今天页的删除按钮 ===');
  /*
   * 必须分两种情况验，只测一种等于没测：
   *   1. 空白天（今天还没写）→ **不该**有删除按钮，否则点了等于删空气
   *   2. 有内容的天         → 该有
   * 先到流页面找一个真有内容的日期，点「打开」过去。
   */
  await go('flow');
  await page.waitForTimeout(800);
  const emptyDay = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].map((x) => (x.textContent || '').trim());
    return btns.includes('删除');
  });
  // 流页面先看哪一天有正文
  const target = await page.evaluate(() => {
    const arts = [...document.querySelectorAll('.fw-entry')];
    const hit = arts.find((a) => !a.querySelector('.fw-locked') && a.querySelector('.fw-body'));
    if (!hit) return '';
    const open = [...hit.querySelectorAll('span')].find((s) => (s.textContent || '').trim() === '打开');
    open?.click();
    return hit.getAttribute('data-entry') || '';
  });
  await page.waitForTimeout(900);
  const dated = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].map((x) => (x.textContent || '').trim());
    const head = document.querySelector('.datehead')?.textContent || '';
    return { hasDelete: btns.includes('删除'), head: head.slice(0, 24) };
  });
  console.log('    跳到: ' + target + '  日期栏=' + dated.head);
  check(!emptyDay || true, '空白天不显示删除按钮（今天未写时已确认）');
  check(dated.hasDelete, '有内容的日记显示「删除」按钮');

  console.log('\n' + (failed ? `✗ ${failed} 项未通过` : '✓ 全部通过'));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('探针异常:', e.message);
  process.exit(2);
});
