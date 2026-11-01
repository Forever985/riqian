/* e2e-v23：182 年月快跳（微软式）/ 185 专注趋势柱状 + 刻度 / 186 某天专注明细可点开 */
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
    const id = 69000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  /*
   * 收掉所有浮层。界面是 NavigateToString，reload 会变 about:blank 后面全废，
   * 所以只能 Esc + 点关闭叉 + 兜底派发遮罩事件，绝不能刷新。
   *
   * 这几类浮层挂的事件不一样（踩过）：
   *   qmask / Dialog 的 mask 用 onMouseDown，
   *   MonthJump / PomoDayDialog 的 mask 用 onClick，
   *   rowmenu 靠 window 上的 mousedown 捕获监听关（且 target 在菜单内时不关）。
   * 所以兜底要两个事件都派发，rowmenu 还得派到 body 上。
   */
  const clearAll = async () => {
    for (let i = 0; i < 4; i++) {
      const left = await p.evaluate(() => document.querySelectorAll('.qmask,.mask,.rowmenu').length);
      if (!left) return;

      await p.keyboard.press('Escape').catch(() => {});
      await p.waitForTimeout(220);
      if (await p.evaluate(() => !document.querySelectorAll('.qmask,.mask,.rowmenu').length)) return;

      /*
       * 只点「关闭」语义的按钮。
       * 千万别点 `.dlg .f button` 的第一个 —— MonthJump 的页脚第一个是「回到本月」，
       * 一按就把日历翻走，后面断言全错（写完才发现）。
       * 另外 offsetParent 对 fixed 定位恒为 null，判可见得用 getClientRects()。
       */
      await p.evaluate(() => {
        for (const sel of ['.qmask .qclose', '.mask .dlg .x']) {
          const el = document.querySelector(sel);
          if (el && el.getClientRects().length) { el.click(); return; }
        }
      });
      await p.waitForTimeout(240);
      if (await p.evaluate(() => !document.querySelectorAll('.qmask,.mask,.rowmenu').length)) return;

      // 兜底：直接派发到遮罩本身（React 里要 e.target === e.currentTarget 才关）
      await p.evaluate(() => {
        for (const m of document.querySelectorAll('.qmask,.mask')) {
          m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        if (document.querySelector('.rowmenu')) {
          document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
      });
      await p.waitForTimeout(230);
    }
  };

  const go = async (k) => {
    await clearAll();
    await p.evaluate((kk) => { const b2 = document.querySelector(`.nav button[data-nav="${kk}"]`); if (b2) b2.click(); }, k);
    await p.waitForTimeout(1500);
    await clearAll();
  };

  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const today = `${ym}-${pad(d.getDate())}`;
  const todayLabel = today.slice(5);
  const mk = 'v23' + String(Date.now()).slice(-4);

  /* ---------------- 造数据（186 用） ---------------- */
  /*
   * 3 颗：2 颗 focus（不同 task、25 与 55 分钟）+ 1 颗 break（5 分钟）。
   * pomo.day 应该排除 break，所以明细里只该看到 2 条、合计 80 分钟。
   *
   * 现在有了 pomodoro.delete，脚本跑完会把自己造的删干净（见末尾 cleanup），
   * 不会再把测试数据堆进用户的真实库里 —— 之前每跑一次就多 3 条，
   * 「今天合计」被污染成假数字。
   */
  const beforeDay = (await rpc('pomo.day', { date: today }))?.data || {};
  const baseCount = Number(beforeDay.count || 0);
  const baseMinutes = Number(beforeDay.totalMinutes || 0);

  const taskA = `${mk}写代码`;
  const taskB = `${mk}看文档`;
  const ins = [];
  ins.push(await rpc('pomodoro.add', { minutes: 25, kind: 'focus', task: taskA }));
  await p.waitForTimeout(140);
  ins.push(await rpc('pomodoro.add', { minutes: 55, kind: 'focus', task: taskB }));
  await p.waitForTimeout(140);
  ins.push(await rpc('pomodoro.add', { minutes: 5, kind: 'break', task: `${mk}休息` }));
  const added = ins.filter((x) => x && x.data && x.data.ok).length;
  /* 记下本轮的 id，收尾时精确删；不按 task 前缀盲删，万一撞上用户手写的同名任务呢 */
  const myIds = ins.filter((x) => x && x.data && x.data.ok).map((x) => x.data.id);
  console.log('\n  造数据：3 条番茄（2 focus + 1 break），成功 ' + added + ' 条');

  /* ================= 182 年月快跳 ================= */
  console.log('\n=== 182 年月快跳 ===');
  await go('calendar');
  await p.waitForSelector('.cal2-head', { timeout: 10000 }).catch(() => {});

  /*
   * 先把月份归位到当月。ym 是 store 里的全局 state，
   * 上一轮跑到 2019 年的话，下面所有「点到某年某月」的断言起点都是错的。
   */
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.cal2-head button')].find((x) => (x.innerText || '').trim() === '本月');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1300);

  /*
   * 规格要求触发按钮是「标题那样的大字」（.mj-title），
   * 但 CalendarView 调 MonthJump 时没传 variant="title"（CalendarView.tsx:390），
   * 于是走的是 `btn` 分支。这里如实断言规格形态；
   * 断言失败不影响后面——交互一律用 [data-monthjump-trigger] 兜底，
   * 让整轮跑完，好知道其它条到底是好是坏。
   */
  const trigger = await p.evaluate(() => {
    const el = document.querySelector('[data-monthjump-trigger]');
    return {
      exists: !!el,
      cls: el?.className || '',
      isTitle: !!document.querySelector('.cal2-head .mj-title'),
      text: (el?.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  });
  ok('182-1 日历顶栏的月份是可点的大字标题（.mj-title「YYYY 年 M 月」）',
    trigger.exists && trigger.isTitle && /\d{4}\s*年\s*\d{1,2}\s*月/.test(trigger.text),
    `按钮存在=${trigger.exists} 文字="${trigger.text}" class="${trigger.cls}" 是 .mj-title=${trigger.isTitle}`);

  const TRIG = '[data-monthjump-trigger]';
  /*
   * 打开快跳面板。遮罩还盖着的时候直接 p.click 会被拦截（Playwright 会报
   * "element is not stable / intercepts pointer events"），所以先等遮罩收干净。
   * 已经是开着的话就不再戳一次 —— 它是个 toggle，再点就关回去了。
   */
  const openMj = async () => {
    await p.waitForFunction(() => !document.querySelector('.mask'), { timeout: 6000 }).catch(() => {});
    if (await p.evaluate(() => !!document.querySelector('.dlg.mj'))) return true;
    await p.click(TRIG).catch(() => {});
    return p.waitForSelector('.dlg.mj', { timeout: 6000 }).then(() => true).catch(() => false);
  };
  await openMj();
  const opened = await p.waitForSelector('.mask .dlg.mj', { timeout: 6000 }).then(() => true).catch(() => false);
  const decade0 = await p.evaluate(() => (document.querySelector('.dlg.mj .mj-decade')?.innerText || '').replace(/\s+/g, ' ').trim());
  const shape = await p.evaluate(() => ({
    years: document.querySelectorAll('.dlg.mj .mj-y[data-year]').length,
    months: document.querySelectorAll('.dlg.mj .mj-m[data-month]').length,
  }));
  ok('182-2 点月份能打开快跳面板（十年段 + 年份列 + 12 个月格子）',
    opened && /\d{4}\s*[–-]\s*\d{4}/.test(decade0) && shape.years >= 10 && shape.months === 12,
    `打开=${opened} 十年段="${decade0}" 年份=${shape.years} 月份=${shape.months}`);

  /* 往后十年：一次翻十格，不是一个个点 */
  const nextClicked = await p.evaluate(() => {
    const btns = [...(document.querySelector('.dlg.mj .mj-top')?.querySelectorAll('button') || [])];
    const nx = btns.find((x) => (x.getAttribute('title') || '').includes('往后十年'));
    if (!nx) return false;
    nx.click();
    return true;
  });
  await p.waitForTimeout(650);
  const decade1 = await p.evaluate(() => (document.querySelector('.dlg.mj .mj-decade')?.innerText || '').replace(/\s+/g, ' ').trim());
  const n0 = Number((decade0.match(/\d{4}/) || [])[0] || 0);
  const n1 = Number((decade1.match(/\d{4}/) || [])[0] || 0);
  ok('182-3 「往后十年」一次翻一整个十年（跨度大也不用一个个点）',
    nextClicked && n1 === n0 + 10, `${decade0} → ${decade1}`);

  await p.evaluate(() => {
    const btns = [...(document.querySelector('.dlg.mj .mj-top')?.querySelectorAll('button') || [])];
    const pv = btns.find((x) => (x.getAttribute('title') || '').includes('往前十年'));
    if (pv) pv.click();
  });
  await p.waitForTimeout(550);
  const decadeBack = await p.evaluate(() => (document.querySelector('.dlg.mj .mj-decade')?.innerText || '').replace(/\s+/g, ' ').trim());
  ok('182-4 「往前十年」能翻回去', Number((decadeBack.match(/\d{4}/) || [])[0] || 0) === n0, decadeBack);

  /*
   * 点 2021 → 再点 5 月 → 日历顶部变成「2021 年 5 月」、面板自动关闭。
   * 用 data-year / data-month 精确点：月份格子的文字里既有「5 月」也有记录天数，按文字找会错。
   */
  const yearClicked = await p.evaluate(() => {
    const yy = document.querySelector('.dlg.mj .mj-y[data-year="2021"]');
    if (!yy) return false;
    yy.click();
    return true;
  });
  await p.waitForTimeout(550);
  const selYearCls = await p.evaluate(() => document.querySelector('.dlg.mj .mj-y[data-year="2021"]')?.className || '');
  ok('182-5 年份列能选中某一年（2021 带选中态）', yearClicked && /\bon\b/.test(selYearCls),
    `点到=${yearClicked} class="${selYearCls}"`);

  const monthClicked = await p.evaluate(() => {
    const mm = document.querySelector('.dlg.mj .mj-m[data-month="2021-05"]');
    if (!mm) return false;
    mm.click();
    return true;
  });
  await p.waitForTimeout(1700);
  const afterPick = await p.evaluate(() => ({
    title: (document.querySelector('[data-monthjump-trigger]')?.innerText || '').replace(/\s+/g, ' ').trim(),
    /* 认 data-ym 这个契约，别去读 .m / .y 两个视觉 span —— 标题改版后它们没了 */
    ym: document.querySelector('[data-monthjump-trigger]')?.getAttribute('data-ym') || '',
    mask: !!document.querySelector('.mask .dlg.mj'),
  }));
  ok('182-6 点「2021 年 5 月」日历直接跳过去，面板自动关闭',
    monthClicked && afterPick.ym === '2021-05' && !afterPick.mask,
    `当前月="${afterPick.ym}" 期望 "2021-05" 标题="${afterPick.title}" 面板还在=${afterPick.mask}`);

  /* 输入框直接打年份回车 */
  await openMj();
  await p.waitForSelector('.dlg.mj .mj-top input.inp', { timeout: 6000 }).catch(() => {});
  const typedInput = await p.$('.dlg.mj .mj-top input.inp');
  if (typedInput) {
    /*
     * 受控 input（value={typed} + onChange），必须 fill / keyboard.type 让 React 收到真事件；
     * 自己赋 value 再 dispatch input 会被 React 的 value tracker 吞掉（踩过）。
     */
    await typedInput.click();
    await typedInput.fill('2019');
    await p.waitForTimeout(250);
    await typedInput.press('Enter');
  }
  await p.waitForTimeout(1700);
  const afterType = await p.evaluate(() => ({
    ym: document.querySelector('[data-monthjump-trigger]')?.getAttribute('data-ym') || '',
    mask: !!document.querySelector('.mask .dlg.mj'),
  }));
  ok('182-7 输入框打「2019」回车直接跳到 2019 年', !!typedInput && afterType.ym.startsWith('2019-') && !afterType.mask,
    `输入框存在=${!!typedInput} 当前月="${afterType.ym}" 面板还在=${afterType.mask}`);

  /* 回到本月 */
  await openMj();
  await p.waitForSelector('.dlg.mj .f button', { timeout: 6000 }).catch(() => {});
  const backClicked = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.dlg.mj .f button')].find((x) => (x.innerText || '').includes('回到本月'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await p.waitForTimeout(1700);
  const afterBack = await p.evaluate(() => ({
    ym: document.querySelector('[data-monthjump-trigger]')?.getAttribute('data-ym') || '',
    mask: !!document.querySelector('.mask .dlg.mj'),
  }));
  const wantYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  ok('182-8 面板里「回到本月」一步回到当月',
    backClicked && afterBack.ym === wantYm && !afterBack.mask,
    `回到 "${afterBack.ym}"，期望 "${wantYm}"，面板还在=${afterBack.mask}`);

  /*
   * 有记录的月份要打点。这里不假设「库里一定有日记」——
   * 先问后端 stats.calMonths 拿真实月份，再核对界面上 .mj-m.has 的数量是否对得上。
   */
  const monthsApi = (await rpc('stats.calMonths'))?.data || [];
  await openMj();
  await p.waitForTimeout(700);
  /*
   * 面板上同时只显示「当前选中那一年」的 12 个月格子，
   * 所以不能拿整个十年的月份去比（写完才想明白，差点把自己坑了）。
   * 正确做法：先读出面板里选中的是哪一年，再只比那一年的月份。
   */
  const markInfo = await p.evaluate(() => ({
    hasMonths: [...document.querySelectorAll('.dlg.mj .mj-m.has')].map((x) => x.getAttribute('data-month')),
    year: document.querySelector('.dlg.mj .mj-y.on')?.getAttribute('data-year') || '',
    dotYears: [...document.querySelectorAll('.dlg.mj .mj-y:has(i.mj-dot)')].map((x) => x.getAttribute('data-year')),
    decade: (document.querySelector('.dlg.mj .mj-decade')?.innerText || '').replace(/\s+/g, ' ').trim(),
  }));
  const uiYear = markInfo.year;
  const expectThisYear = monthsApi
    .filter((x) => Number(x.days || 0) > 0 && String(x.ym).startsWith(uiYear + '-'))
    .map((x) => x.ym)
    .sort();
  const uiMarks = [...markInfo.hasMonths].sort();
  const missing = expectThisYear.filter((k) => !uiMarks.includes(k));
  const extra = uiMarks.filter((k) => !expectThisYear.includes(k));
  const marksOk = !!uiYear && missing.length === 0 && extra.length === 0;
  ok('182-9 有记录的年月会在面板上打点（.mj-m.has / 年份列 i.mj-dot）',
    marksOk,
    `十年段="${markInfo.decade}" 选中 ${uiYear} 年；界面打点=[${uiMarks.join(',')}]；`
    + `后端 ${uiYear} 年有记录=[${expectThisYear.join(',')}]；漏打=[${missing.join(',')}] 多打=[${extra.join(',')}]；`
    + `年份列带点=[${markInfo.dotYears.join(',')}]`);
  await clearAll();

  /* ================= 185 专注时长趋势 ================= */
  console.log('\n=== 185 专注时长趋势 ===');
  await go('pomodoro');
  await p.waitForSelector('.card h3', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1300);

  /*
   * 「专注时长趋势」这张卡。
   * 刻度只认 text-anchor="end" 的那几个 —— 横轴日期标签也带 .axis-label 类，
   * 不筛 text-anchor 会把 "11-01" 这种当成刻度，断言就假通过了（踩过）。
   */
  const trend = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.card')]
      .find((c) => (c.querySelector('h3')?.innerText || '').includes('专注时长趋势'));
    if (!card) return { found: false };
    return {
      found: true,
      hasSvg: !!card.querySelector('svg.chart'),
      yTicks: [...card.querySelectorAll('text.axis-label[text-anchor="end"]')]
        .map((x) => (x.textContent || '').trim()),
      bars: [...card.querySelectorAll('svg.chart rect.bar')].map((r) => ({
        title: (r.querySelector('title')?.textContent || '').trim(),
        h: Number(r.getAttribute('height') || 0),
      })),
      head: (card.querySelector('h3')?.innerText || '').replace(/\s+/g, ' ').trim(),
      foot: [...card.querySelectorAll('.small.muted')]
        .map((x) => (x.innerText || '').replace(/\s+/g, ' ').trim())
        .find((t) => t.includes('区间合计')) || '',
    };
  });

  ok('185-1 「专注时长趋势」换成了柱状图（svg.chart + rect.bar），不再是折线',
    trend.found && trend.hasSvg && trend.bars.length > 0,
    `卡片=${trend.found} svg=${trend.hasSvg} 柱子=${trend.bars ? trend.bars.length : 0}`);

  const realTicks = (trend.yTicks || []).filter((t) => /\d/.test(t) && t !== '0');
  ok('185-2 左边有可读的刻度文字（不再只能靠柱高瞎猜）', realTicks.length >= 1,
    `刻度=[${(trend.yTicks || []).join(' | ')}]`);

  /*
   * 柱子提示的格式：
   *   需求原文「格式是 1h20m / 45m」，所以严格判 `MM-DD：1h20m` 或 `MM-DD：45m`。
   * 注意整小时会渲染成「2h」（fmtValue 里 `v % 60 ? ... : ''`），也要算合规。
   * 只要有一根柱子不合格式，就说明数值没被格式化干净。
   */
  const filledBars = (trend.bars || []).filter((x) => x.h > 2);
  const goodTitle = /^\d{2}-\d{2}：((\d+h)(\d+m)?|\d+m)$/;
  const badBars = filledBars.filter((x) => !goodTitle.test(x.title));
  ok('185-3 柱子提示是「MM-DD：45m / 1h20m」这种一眼能懂的格式',
    filledBars.length > 0 && badBars.length === 0,
    filledBars.length
      ? `不合规 ${badBars.length}/${filledBars.length} 个，样例「${badBars.slice(0, 3).map((x) => x.title).join('」「')}」`
      : '没有非空柱子（图是空的）');

  /* 今天那根柱子必须真的带分钟数，否则「有图但全 0」也是白搭 */
  const minutesOf = (title) => {
    const s = (title.split('：')[1] || '').trim();
    const hh = /(\d+)h/.exec(s);
    const mm = /(\d+)m/.exec(s);
    return (hh ? Number(hh[1]) * 60 : 0) + (mm ? Number(mm[1]) : 0);
  };
  const todayBar = (trend.bars || []).find((x) => x.title.startsWith(todayLabel + '：'));
  ok('185-4 今天造的番茄确实落进了柱子（不是空图）',
    !!todayBar && minutesOf(todayBar.title) >= 80,
    todayBar ? `今天柱子「${todayBar.title}」解析出 ${minutesOf(todayBar.title)} 分钟，期望 ≥80` : `没找到 ${todayLabel} 那根柱子`);

  ok('185-5 柱子下面有一行「区间合计 · 最高一天」小字',
    /区间合计/.test(trend.foot) && /最高一天/.test(trend.foot), trend.foot || '(没找到)');

  /* ================= 186 某天专注明细 ================= */
  console.log('\n=== 186 某天专注明细 ===');

  /* 先验后端口径：休息段不许计入 */
  const afterDay = (await rpc('pomo.day', { date: today }))?.data || {};
  const dCount = Number(afterDay.count || 0) - baseCount;
  const dMin = Number(afterDay.totalMinutes || 0) - baseMinutes;
  const myItems = (afterDay.items || []).filter((x) => (x.task || '').includes(mk));
  const hasBreakItem = myItems.some((x) => (x.task || '').includes('休息'));
  ok('186-1 pomo.day 排除了休息段（3 条只算 2 条 / 80 分钟）',
    dCount === 2 && dMin === 80 && !hasBreakItem,
    `增量 ${dCount} 颗 / ${dMin} 分钟；明细里出现休息段=${hasBreakItem}`);
  ok('186-2 pomo.day 每条都带「时分 / 任务 / 分钟」',
    myItems.length === 2 && myItems.every((x) => /^\d{2}:\d{2}$/.test(x.hm || '') && x.minutes > 0 && !!x.task),
    JSON.stringify(myItems.map((x) => ({ hm: x.hm, m: x.minutes, t: x.task }))));

  /* --- 番茄页热力：点今天那格开明细 --- */
  await go('pomodoro');
  await p.waitForSelector('.pi-heat-wrap', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1000);

  const heat = await p.evaluate(() => ({
    wrap: !!document.querySelector('.pi-heat-wrap'),
    cols: document.querySelectorAll('.pi-heat-col').length,
    wd: [...document.querySelectorAll('.pi-heat-wd span')].map((x) => (x.innerText || '').trim()).join(''),
    foot: (document.querySelector('.pi-heat-foot')?.innerText || '').replace(/\s+/g, ' ').trim(),
  }));
  ok('186-3 热力改成按周成列（周一~周日表头 + 竖列）',
    heat.wrap && heat.cols > 0 && heat.wd.replace(/\s/g, '') === '一二三四五六日',
    `wrap=${heat.wrap} 列=${heat.cols} 表头="${heat.wd}"`);

  const cellSel = `.heat-c[data-date="${today}"]`;
  const cellExists = await p.$(cellSel);
  ok('186-4 热力每格带 data-date，能精确定位到具体某天', !!cellExists, cellSel);

  if (cellExists) {
    await p.evaluate((s) => { const el = document.querySelector(s); if (el) el.click(); }, cellSel);
    const pddOpen = await p.waitForSelector('.mask .dlg .pdd-sum', { timeout: 8000 }).then(() => true).catch(() => false);
    const pdd = await p.evaluate(() => ({
      title: (document.querySelector('.mask .dlg h3')?.innerText || '').replace(/\s+/g, ' ').trim(),
      sum: (document.querySelector('.mask .dlg .pdd-sum')?.innerText || '').replace(/\s+/g, ' ').trim(),
      rows: [...document.querySelectorAll('.mask .dlg .pdd-row')].map((x) => ({
        t: (x.querySelector('.t')?.innerText || '').trim(),
        n: (x.querySelector('.n')?.innerText || '').trim(),
        b: (x.querySelector('b')?.innerText || '').trim(),
      })),
      bars: document.querySelectorAll('.mask .dlg .pdd-bar').length,
    }));
    const myRows = pdd.rows.filter((x) => x.n.includes(mk));

    ok('186-5 点热力里「今天」那格能开出专注明细弹层',
      pddOpen && /专注明细/.test(pdd.title) && pdd.title.includes(today),
      `打开=${pddOpen} 标题="${pdd.title}"`);

    /*
     * 关键断言：我的 3 条里只该出现 2 条 —— 休息段被排除。
     * 按「带 mk 后缀的行」数，不按总行数：库里别人当天的番茄会让总数对不上。
     */
    ok('186-6 明细里只有我造的 2 条（第 3 条休息段被排除）', myRows.length === 2,
      `我的 ${myRows.length} 条（${myRows.map((x) => x.n).join(',')}），弹层总行 ${pdd.rows.length}`);

    ok('186-7 每条明细能看出「几点 / 做了什么 / 多久」',
      myRows.length === 2 && myRows.every((x) => /^\d{2}:\d{2}$/.test(x.t) && x.n.includes(mk) && /^\d+′$/.test(x.b)),
      JSON.stringify(myRows));

    ok('186-8 弹层顶部有合计 / 番茄 / 平均单颗三块',
      /合计/.test(pdd.sum) && /番茄/.test(pdd.sum) && /平均单颗/.test(pdd.sum), pdd.sum.slice(0, 90));

    ok('186-9 多任务时给了「按任务」对比条', pdd.bars >= 2, `${pdd.bars} 行 .pdd-bar`);

    await clearAll();
  } else {
    for (const n of ['186-5 点热力里「今天」那格能开出专注明细弹层',
      '186-6 明细里只有我造的 2 条（第 3 条休息段被排除）',
      '186-7 每条明细能看出「几点 / 做了什么 / 多久」',
      '186-8 弹层顶部有合计 / 番茄 / 平均单颗三块',
      '186-9 多任务时给了「按任务」对比条']) ok(n, false, '今天那格不存在');
  }

  const heatFoot = await p.evaluate(() => (document.querySelector('.pi-heat-foot')?.innerText || '').replace(/\s+/g, ' ').trim());
  ok('186-10 热力下面写明「N 天有专注 / 合计 / 日均」',
    /天有专注/.test(heatFoot) && /合计/.test(heatFoot) && /日均/.test(heatFoot), heatFoot.slice(0, 100));

  /* --- 日历页侧栏的「专注」按钮 --- */
  await go('calendar');
  await p.waitForSelector('.cal2-cell', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1300);

  /*
   * 先确保选中的是「今天」：选到一个没番茄的日子，侧栏就没有「看明细」，
   * 186-12 会莫名其妙挂掉。用顶栏的「回到今天」而不是点格子，格子可能停在别的月份。
   */
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('#topbar-slot button, .btn')]
      .find((x) => (x.innerText || '').includes('回到今天'));
    if (btn) btn.click();
  });
  await p.waitForTimeout(1600);
  const selDay = await p.evaluate(() => (document.querySelector('.agenda .ad')?.innerText || '').replace(/\s+/g, ' ').trim());
  ok('186-11 日历侧栏能定位回今天', selDay.includes('今天'), selDay);

  const pomoBtn = await p.evaluate(() => {
    const btn = document.querySelector('[data-act="pomo-day"]');
    return { exists: !!btn, text: (btn?.innerText || '').replace(/\s+/g, ' ').trim() };
  });
  ok('186-12 侧栏「专注」一行变成可点的「N 分钟 · N 颗 → 看明细」',
    pomoBtn.exists && /看明细/.test(pomoBtn.text) && /\d+\s*分钟/.test(pomoBtn.text),
    `存在=${pomoBtn.exists} 文字="${pomoBtn.text}"`);

  if (pomoBtn.exists) {
    await p.click('[data-act="pomo-day"]').catch(() => {});
    const open2 = await p.waitForSelector('.mask .dlg .pdd-sum', { timeout: 8000 }).then(() => true).catch(() => false);
    const t2 = await p.evaluate(() => (document.querySelector('.mask .dlg h3')?.innerText || '').replace(/\s+/g, ' ').trim());
    /*
     * p.evaluate 的函数体在页面里跑，拿不到 Node 侧的闭包变量 ——
     * mk 必须显式作为第二个参数传进去，否则就是 ReferenceError（真踩了）。
     */
    const rows2 = await p.evaluate((suffix) => ({
      all: document.querySelectorAll('.mask .dlg .pdd-row').length,
      mine: [...document.querySelectorAll('.mask .dlg .pdd-row .n')]
        .filter((x) => (x.innerText || '').includes(suffix)).length,
    }), mk);
    ok('186-13 点侧栏「看明细」能开出这天的明细（休息段仍被排除）',
      open2 && /专注明细/.test(t2) && rows2.mine === 2,
      `打开=${open2} 标题="${t2}" 我的行=${rows2.mine} 总行=${rows2.all}`);
    await clearAll();
  } else {
    ok('186-13 点侧栏「看明细」能开出这天的明细（休息段仍被排除）', false, '按钮不存在');
  }

  /* --- 右键菜单也有入口 --- */
  const cell = (await p.$('.cal2-cell.today')) || (await p.$('.cal2-cell.sel'));
  if (cell) await cell.click({ button: 'right' }).catch(() => {});
  const menuOpen = await p.waitForSelector('.rowmenu', { timeout: 6000 }).then(() => true).catch(() => false);
  const menuItems = await p.evaluate(() => [...document.querySelectorAll('.rowmenu button')].map((x) => (x.innerText || '').trim()));
  ok('186-14 右键菜单里有「看这天的专注」', menuOpen && menuItems.some((t) => t.includes('看这天的专注')),
    `打开=${menuOpen} 项=[${menuItems.join(' / ')}]`);

  if (menuOpen && menuItems.some((t) => t.includes('看这天的专注'))) {
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('.rowmenu button')].find((x) => (x.innerText || '').includes('看这天的专注'));
      if (btn) btn.click();
    });
    const open3 = await p.waitForSelector('.mask .dlg .pdd-sum', { timeout: 8000 }).then(() => true).catch(() => false);
    ok('186-15 右键「看这天的专注」也能开出明细', open3, `打开=${open3}`);
    await clearAll();
  } else {
    ok('186-15 右键「看这天的专注」也能开出明细', false, '上一步菜单没开到');
  }

  /* ---------------- 收尾 ---------------- */
  /*
   * 番茄记录没有删除接口（全项目搜不到 DELETE FROM pomodoro），RPC 层也没暴露，
   * 所以要「清干净」只能直接改库 —— 那是用户的真实数据文件（E:\日签\riqian.db），
   * 不在测试脚本的权限范围内，擅自删有可能连累同表里的真实记录。
   *
   * 因此这里的做法是：把本轮造了多少条、叫什么名字打出来，交给人决定怎么清。
   * task 一律带 mk 前缀（v23xxxx / pbxxxx），按前缀就能精确找出来。
   */
  await clearAll();
  await go('today');

  /*
   * 收尾清理：把本轮自己造的那几条按 id 删掉。
   * 以前这里只能打印一句「请手工执行 DELETE」，因为番茄没有删除接口；
   * 现在补了 pomodoro.delete，测试**自己收拾干净**，不再让用户的「今天合计」被污染。
   * 按 id 删而不是按 task 前缀 LIKE，避免误伤用户手写的同名任务。
   */
  let removed = 0;
  for (const id of myIds) {
    const r = await rpc('pomodoro.delete', { id }).catch(() => null);
    if (r && r.ok && r.data && r.data.ok) removed++;
    await p.waitForTimeout(80);
  }

  const leftover = (await rpc('pomo.day', { date: today }))?.data || {};
  const mineLeft = (leftover.items || []).filter((x) => (x.task || '').startsWith(mk));
  console.log(`\n  测试数据清理：造了 ${myIds.length} 条，删掉 ${removed} 条，残留 ${mineLeft.length} 条`);
  console.log(`  今天合计回到 ${leftover.totalMinutes} 分钟（跑之前是 ${baseMinutes} 分钟）`);
  ok('测试自己造的数据已经清干净（不污染用户库）',
    mineLeft.length === 0 && Number(leftover.totalMinutes) === baseMinutes,
    `残留 ${mineLeft.length} 条，合计 ${leftover.totalMinutes} 分钟（期望回到 ${baseMinutes}）`);

  console.log('\n页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '无'));
  console.log(`\n套件结果：${pass} 通过 / ${fails.length} 失败  （共 ${pass + fails.length} 项）`);
  if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
  await b.close().catch(() => {});
})().catch((e) => {
  console.log('\n脚本异常: ' + e.message);
  console.log(`\n套件结果：${pass} 通过 / ${fails.length + 1} 失败`);
  process.exitCode = 1;
});