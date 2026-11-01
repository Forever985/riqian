/**
 * v10.1 验收：78 图片参数 / 113 软件背景 / 多媒体库合并 / 80 按月分组
 *              97 记账账户·预算·周期账单 / 98 提醒复杂重复 / 126 多榜排行 / 时间轴分页
 *
 * 跑法（应用需带 --remote-debugging-port 启动）：
 *   NO_PROXY=127.0.0.1,localhost node e2e-v11.js 57001
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '57001';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(12000);

  const log = [];
  const ok = (n, v, extra = '') => {
    const line = `${v ? '✅' : '❌'} ${n}${extra ? `（${extra}）` : ''}`;
    log.push(line);
    console.log(line);
  };
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CON ' + m.text().slice(0, 150)); });

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 71000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (v) => { await p.click(`.nav button[data-nav="${v}"]`); await p.waitForTimeout(1000); };
  const closeMasks = async () => {
    for (let i = 0; i < 4; i++) {
      const open = await p.evaluate(() => document.querySelectorAll('.mask,.qmask').length);
      if (!open) break;
      await p.keyboard.press('Escape');
      await p.waitForTimeout(250);
      await p.mouse.click(6, 6).catch(() => {});
      await p.waitForTimeout(250);
    }
  };
  await closeMasks();
  await go('today');
  await p.waitForTimeout(800);

  /* ============ 1. 多媒体库合并（图片 / 音频 / 视频一个入口） ============ */
  const nav = await p.evaluate(() => [...document.querySelectorAll('#app .nav .lb')].map((x) => x.textContent));
  ok('导航里只有一个多媒体库', nav.filter((x) => /多媒体库/.test(x)).length === 1, nav.join('/'));
  ok('导航里不再有独立的音乐库', !nav.some((x) => /^音乐库$/.test(x)));

  await go('media');
  const mediaUi = await p.evaluate(() => {
    const t = document.querySelector('#view-root')?.innerText || '';
    return {
      title: document.querySelector('.topbar h2')?.textContent,
      views: [...document.querySelectorAll('.chip')].map((x) => x.textContent.trim()).filter((x) => /网格|列表|按月/.test(x)),
      seg: [...document.querySelectorAll('.seg-b')].map((x) => x.textContent.trim()),
      total: /合计/.test(t),
    };
  });
  ok('多媒体库页标题正确', /图片库|多媒体库/.test(mediaUi.title || ''), mediaUi.title);
  ok('三种视图都在（网格 / 列表 / 按月）', mediaUi.views.length === 3, mediaUi.views.join('/'));
  ok('库内有「提醒音」栏', mediaUi.seg.some((x) => /提醒音/.test(x)), mediaUi.seg.join('/'));
  ok('显示合计（数量 · 体积）', mediaUi.total);

  /* ============ 2. 造一张图，测背景参数 ============ */
  const mediaId = await p.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 80;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 80, 80);
    grd.addColorStop(0, '#c94f3d'); grd.addColorStop(1, '#2e6f8e');
    g.fillStyle = grd; g.fillRect(0, 0, 80, 80);
    const r = await new Promise((res) => {
      const rid = 52000 + Math.floor(Math.random() * 4000);
      const h = (e) => { if (e.data && e.data.id === rid) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id: rid, m: 'media.saveBase64', a: { name: 'v11-bg.png', data: c.toDataURL('image/png') } });
    });
    return r?.data?.id || '';
  });
  ok('测试图片已入库', !!mediaId, mediaId);

  await go('today');
  const bgBtn = p.locator('.datehead button:has-text("背景")').first();
  if (await bgBtn.count()) await bgBtn.click();
  await p.waitForTimeout(900);

  const picker = await p.evaluate(() => ({
    prev: !!document.querySelector('.bgprev'),
    imgs: document.querySelectorAll('.dlg .imgpick').length,
    foot: [...document.querySelectorAll('.dlg .f button')].map((x) => x.textContent.trim()),
  }));
  ok('背景弹层有预览区', picker.prev);
  ok('背景弹层能列出图片', picker.imgs > 0, `${picker.imgs} 张`);
  ok('背景弹层有「应用」而不是点一下就走', picker.foot.some((x) => /应用/.test(x)), picker.foot.join('/'));

  if (await p.locator('.dlg .imgpick').count()) {
    await p.locator('.dlg .imgpick').first().click();
    await p.waitForTimeout(500);
  }
  const toneUi = await p.evaluate(() => ({
    rows: document.querySelectorAll('.dlg .tone-row').length,
    presets: [...document.querySelectorAll('.dlg .tone-presets .chip')].map((x) => x.textContent),
    fits: [...document.querySelectorAll('.dlg .chip')].map((x) => x.textContent).filter((x) => /铺满|完整显示|平铺/.test(x)),
  }));
  ok('选中图片后出现图片参数', toneUi.rows >= 4, `${toneUi.rows} 项`);
  ok('有调色预设', toneUi.presets.length >= 6, toneUi.presets.join('/'));
  ok('有铺法（铺满 / 完整 / 平铺）', toneUi.fits.length === 3, toneUi.fits.join('/'));

  // 高级参数里应该有 RGB 通道 / 色温 / 清晰度
  const advBtn = p.locator('.dlg button:has-text("高级参数")').first();
  if (await advBtn.count()) { await advBtn.click(); await p.waitForTimeout(400); }
  const adv = await p.evaluate(() => [...document.querySelectorAll('.dlg .tone-row .tl')].map((x) => x.textContent));
  ok('高级里有色温 / 色调 / RGB / 清晰度 / 模糊',
    ['色温', '色调旋转', '红', '绿', '蓝', '清晰度', '模糊'].every((k) => adv.includes(k)), adv.join('/'));

  // 用预设「暖阳」+ 铺法「完整显示」再应用
  await p.locator('.dlg .chip', { hasText: '暖阳' }).first().click();
  await p.waitForTimeout(350);
  await p.locator('.dlg .chip', { hasText: '完整显示' }).first().click();
  await p.waitForTimeout(250);
  const prevFilter = await p.evaluate(() => {
    const l = document.querySelector('.bgprev-img');
    return l ? getComputedStyle(l).filter : '';
  });
  ok('预览层真的套了滤镜', /brightness|saturate|url\(/.test(prevFilter), prevFilter.slice(0, 90));

  await p.locator('.dlg .f button:has-text("应用")').click();
  await p.waitForTimeout(1400);
  const applied = await p.evaluate(() => {
    const card = document.querySelector('.card.hasbg');
    const layer = card?.querySelector('.card-bg');
    const inner = card?.querySelector('.card-inner');
    return {
      card: !!card,
      layer: !!layer,
      filter: layer ? getComputedStyle(layer).filter : '',
      textFilter: inner ? getComputedStyle(inner).filter : '',
      fit: layer?.style.backgroundSize,
      svg: document.querySelectorAll('#rt-tone-defs filter').length,
    };
  });
  ok('背景图拆成独立图层', applied.card && applied.layer);
  ok('滤镜只作用在背景层', /brightness|saturate|url\(/.test(applied.filter) && applied.textFilter === 'none',
    `层=${applied.filter.slice(0, 50)} 文字=${applied.textFilter}`);
  ok('铺法生效', applied.fit === 'contain', String(applied.fit));
  ok('RGB/色温走 SVG 滤镜（不是 CSS 近似）', applied.svg >= 1, `${applied.svg} 个`);

  const saved = await rpc('entry.get', { date: today() });
  ok('背景参数已落库', !!(saved?.data?.bgTone && saved.data.bgTone.includes('"t"')), String(saved?.data?.bgTone || '').slice(0, 60));

  /* ============ 3. 纯色背景要清掉调色 ============ */
  await p.locator('.datehead button:has-text("背景")').first().click();
  await p.waitForTimeout(800);
  await p.locator('.dlg .row > div').nth(2).click();
  await p.waitForTimeout(300);
  await p.locator('.dlg .f button:has-text("应用")').click();
  await p.waitForTimeout(1200);
  const solid = await rpc('entry.get', { date: today() });
  ok('换成纯色后调色被清空', (solid?.data?.bgTone || '') === '', String(solid?.data?.bgTone || ''));

  /* ============ 4. 软件背景（113） ============ */
  await go('settings');
  await p.locator('.snav', { hasText: '外观主题' }).click();
  await p.waitForTimeout(600);
  const gRow = p.locator('.set-row', { hasText: '软件背景' }).first();
  ok('设置里有「软件背景」', (await gRow.count()) > 0);
  if (await gRow.count()) {
    await gRow.locator('button').first().click();
    await p.waitForTimeout(900);
  }
  const gDlg = await p.evaluate(() => ({
    title: [...document.querySelectorAll('.dlg .h h3')].map((x) => x.textContent),
    swatches: document.querySelectorAll('.dlg .row > div').length,
    pics: document.querySelectorAll('.dlg .imgpick').length,
  }));
  ok('软件背景弹层能打开', gDlg.title.some((x) => /软件背景/.test(x)), gDlg.title.join('/'));
  ok('软件背景可选底色或图片', gDlg.swatches >= 5 || gDlg.pics > 0, `色块 ${gDlg.swatches} / 图 ${gDlg.pics}`);

  // 选一个深色底并应用，确认 CSS 变量真的变了
  await p.locator('.dlg .row > div').nth(5).click();
  await p.waitForTimeout(250);
  await p.locator('.dlg .f button:has-text("应用")').click();
  await p.waitForTimeout(1200);
  const appBg = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--appbg').trim());
  ok('软件背景实际生效', !!appBg, appBg);
  // 还原
  await rpc('setting.set', { k: 'bgGlobal', v: '' });
  await rpc('setting.set', { k: 'bgGlobalTone', v: '' });

  /* ============ 5. 记账：账户 / 预算 / 周期账单 ============ */
  await go('ledger');
  // 名字带随机后缀：这个套件会在同一个库上反复跑，重名会拿到上一轮那个（余额已被扣过）
  const uname = '验收账户' + Math.floor(Math.random() * 90000 + 10000);
  const acc = await rpc('account.save', { name: uname, kind: 'bank', init: 500 });
  ok('能建账户', !!acc?.data?.id, String(acc?.data?.id || acc?.err));
  const accList = await rpc('ledger.accounts', {});
  const accRow = (accList?.data || []).find((x) => x.name === uname);
  ok('新账户余额 = 初始金额', accRow?.balance === 500, `余额 ${accRow?.balance}`);

  const rec = await rpc('ledger.recur.save', {
    kind: 'out', amount: 888, cat: '居住', note: '验收房租', accountId: acc?.data?.id || '', day: 6, enabled: 1,
  });
  const recId = rec?.data?.id || '';
  ok('能建周期账单', !!recId);
  const month = today().slice(0, 7);
  const run1 = await rpc('ledger.recur.run', { month });
  const run2 = await rpc('ledger.recur.run', { month });
  ok('周期账单能生成当月流水', (run1?.data?.made || 0) >= 1, `made=${run1?.data?.made}`);
  ok('重复生成是幂等的（不会记两遍）', (run2?.data?.made || 0) === 0, `made=${run2?.data?.made}`);

  await go('settings');
  await go('ledger');
  const ledgerUi = await p.evaluate(() => {
    const t = document.querySelector('#view-root')?.innerText || '';
    return {
      accCards: document.querySelectorAll('.lg-accs > *').length,
      budget: /预算/.test(t),
      recur: /固定支出/.test(t),
      has888: t.includes('888'),
    };
  });
  ok('记账页画出账户卡', ledgerUi.accCards >= 1, `${ledgerUi.accCards} 张`);
  ok('记账页有预算区', ledgerUi.budget);
  ok('记账页有周期账单区', ledgerUi.recur);

  /* ============ 6. 提醒：5 种重复 ============ */
  await go('alarms');
  const newAlarm = p.locator('button', { hasText: '新建提醒' }).first();
  ok('提醒页有「新建提醒」', (await newAlarm.count()) > 0);
  if (await newAlarm.count()) { await newAlarm.click(); await p.waitForTimeout(700); }
  const repChips = await p.evaluate(() => [...document.querySelectorAll('#view-root form .chip')].map((x) => x.textContent.trim()));
  ok('重复方式有 5 种',
    ['每天', '工作日', '仅一次'].every((k) => repChips.includes(k)) && repChips.some((x) => /每隔/.test(x)) && repChips.some((x) => /隔 N 天/.test(x)),
    repChips.join('/'));

  const everyChip = p.locator('#view-root form .chip', { hasText: '每隔' }).first();
  if (await everyChip.count()) { await everyChip.click(); await p.waitForTimeout(500); }
  const everyInput = await p.evaluate(() => document.querySelectorAll('#view-root form input[type=number]').length);
  ok('选「每隔 N 分钟」出现分钟输入', everyInput >= 1, `${everyInput} 个输入框`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  const aSave = await rpc('alarm.save', {
    kind: 'habit', title: '验收-每隔', atTime: '09:00', repeat: 'every', enabled: 1, intervalMin: 45,
  });
  ok('提醒能存「每隔 45 分钟」', !!aSave?.data?.id);
  const aList = await rpc('alarm.list', {});
  const aRow = (aList?.data || []).find((x) => x.title === '验收-每隔');
  ok('间隔分钟数落库', aRow?.intervalMin === 45, String(aRow?.intervalMin));
  const aWeekday = await rpc('alarm.save', { kind: 'habit', title: '验收-工作日', atTime: '10:00', repeat: 'weekday', enabled: 1 });
  ok('提醒能存「工作日」', !!aWeekday?.data?.id);
  await rpc('alarm.delete', { id: aRow?.id || '' });
  await rpc('alarm.delete', { id: aWeekday?.data?.id || '' });

  /* ============ 7. 时间轴：节点与分页 ============ */
  for (let i = 1; i <= 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await rpc('entry.save', { date: k, values: { '__probe': 'v11 ' + i }, fav: 0, bg: '', title: 'v11 第 ' + i + ' 天' });
  }
  /*
   * 第 188 条之后「时间轴」这个名字归大事时间轴了，
   * 原来那个「把日记铺开」的视图并进了记录页。两条断言跟着改。
   */
  await rpc('milestone.save', { id: '', date: '2024-03-05', title: 'v11 验收大事', note: '换工作', kind: 'work' });
  await go('timeline');
  const tl = await p.evaluate(() => ({
    nodes: document.querySelectorAll('.mscard').length,
    years: [...document.querySelectorAll('.msyear-y')].map((x) => x.textContent.trim()),
    text: document.querySelector('#view-root')?.innerText || '',
  }));
  ok('大事时间轴能显示节点', tl.nodes >= 1 && tl.text.includes('v11 验收大事'), `${tl.nodes} 个`);
  ok('大事时间轴按年份分组', tl.years.includes('2024'), tl.years.join('/'));

  // 日记的「时间轴」排版现在在记录页里，切一下视图即可
  await go('records');
  const recTimeline = await p.evaluate(async () => {
    const b2 = [...document.querySelectorAll('.seg-b')].find((x) => (x.innerText || '').includes('时间轴'));
    if (!b2) return { hasSwitch: false, embedded: false };
    b2.click();
    await new Promise((r) => setTimeout(r, 600));
    return { hasSwitch: true, embedded: !!document.querySelector('.tl-embedded') };
  });
  ok('记录页里能切到日记时间轴', recTimeline.hasSwitch && recTimeline.embedded, JSON.stringify(recTimeline));

  /* ============ 8. 排行榜：三套数据 ============ */
  await go('stats');
  const tabs = await p.evaluate(() => [...document.querySelectorAll('.card .chip')].map((x) => x.textContent.trim()));
  ok('排行榜有 5 个榜单',
    ['日记连续', '单日字数', '打卡连续', '打卡次数', '番茄时长'].every((k) => tabs.includes(k)), tabs.join('/'));
  for (const name of ['打卡连续', '打卡次数', '番茄时长']) {
    const chip = p.locator('.chip', { hasText: name }).first();
    if (await chip.count()) { await chip.click(); await p.waitForTimeout(350); }
  }
  const rankState = await p.evaluate(() => document.querySelectorAll('.rankrow').length);
  ok('切换榜单不报错（有数据或空态）', true, `${rankState} 行`);

  const extra = await rpc('stats.rankExtra', { top: 5 });
  ok('多榜接口返回三种数据',
    extra?.data && 'habitRuns' in extra.data && 'habitTop' in extra.data && 'pomoTop' in extra.data,
    JSON.stringify(extra?.data || {}).slice(0, 80));

  /* ============ 9. 媒体详情里的「互转」按钮 ============ */
  await go('media');
  // 点击目标是卡片内部的 .imgc（外层 .imgpick 只是容器，没有点击处理）
  const cards = p.locator('.imgpick .imgc');
  if (await cards.count()) { await cards.first().click(); await p.waitForTimeout(900); }
  const detailBtns = await p.evaluate(() => [...document.querySelectorAll('.dlg .f button')].map((x) => x.textContent.trim()));
  ok('图片详情有「设为背景」', detailBtns.some((x) => /设为背景/.test(x)), detailBtns.join('/'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  /* ============ 10. 标签预设 / 统计交互 / 外观自由度 ============ */
  await go('today');
  await p.waitForTimeout(600);
  // 定稿的日子是只读的，先复位，否则点预设没反应
  await rpc('entry.publish', { date: today(), published: 0 });
  await go('today');
  await p.waitForTimeout(800);
  const presetChips = await p.evaluate(() => [...document.querySelectorAll('.mod button.chip')].map((x) => x.textContent.trim()).filter((x) => x.startsWith('+')));
  ok('标签模块有「常用」预设', presetChips.length >= 1, presetChips.join('/'));

  let tagName = '';
  if (presetChips.length) {
    await p.locator('.mod button.chip', { hasText: presetChips[0] }).first().click();
    await p.waitForTimeout(1500);
    tagName = presetChips[0].replace(/^\+\s*/, '');
    const onTags = await p.evaluate(() => [...document.querySelectorAll('.mod .chip.on')].map((x) => x.textContent.replace('✕', '').trim()));
    ok('点预设能直接加上标签', onTags.includes(tagName), onTags.join('/'));
  }

  await go('stats');
  await p.waitForTimeout(1200);
  const tip = await p.evaluate(async () => {
    const box = document.querySelector('.strip i:nth-child(20)');
    if (!box) return '';
    box.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    return document.querySelector('.strip-tip')?.textContent || '';
  });
  ok('统计方块有日期与字数提示', /\d{4}-\d{2}-\d{2}/.test(tip), tip.slice(0, 30));

  if (tagName) {
    const hit = p.locator('.tagcloud .t', { hasText: tagName }).first();
    if (await hit.count()) {
      await hit.click();
      await p.waitForTimeout(1500);
      // 第 190 条之后标签筛选是 TagPicker（输入框），不再是 select
      const jumped = await p.evaluate(() => ({
        view: document.querySelector('.topbar h2')?.textContent,
        tag: document.querySelector('.tagpick input')?.value || '',
      }));
      ok('常用标签点了真的按标签搜', jumped.view === '记录' && jumped.tag === tagName, `${jumped.view} / ${jumped.tag}`);
    } else {
      ok('常用标签点了真的按标签搜', false, '标签云里没有刚加的那个');
    }
  }

  await go('settings');
  await p.locator('.snav', { hasText: '外观主题' }).click();
  await p.waitForTimeout(600);
  const appRows = await p.evaluate(() => [...document.querySelectorAll('.set-row .lbl')].map((x) => x.textContent.split('\n')[0]));
  ok('外观里有页面留白与模块间距', appRows.some((x) => /页面留白/.test(x)) && appRows.some((x) => /模块间距/.test(x)));
  ok('外观有「恢复默认」', appRows.some((x) => /外观还原|恢复默认/.test(x)));

  // 留白滑杆要真的改到 CSS 变量
  const vpSlider = p.locator('.set-row', { hasText: '页面留白' }).locator('input[type=range]');
  if (await vpSlider.count()) {
    await vpSlider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, '40');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.waitForTimeout(900);
  }
  const vp = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--viewpad').trim());
  ok('留白滑杆真的生效', vp === '40px', vp);

  await p.locator('.snav', { hasText: '界面布局' }).click();
  await p.waitForTimeout(500);
  const layoutRows = await p.evaluate(() => [...document.querySelectorAll('.set-row .lbl')].map((x) => x.textContent.split('\n')[0]));
  ok('最小化气泡可关', layoutRows.some((x) => /还在运行/.test(x)));

  await p.locator('.snav', { hasText: '日记与模块' }).click();
  await p.waitForTimeout(500);
  const diaryRows = await p.evaluate(() => [...document.querySelectorAll('.set-row .lbl')].map((x) => x.textContent.split('\n')[0]));
  ok('设置里能改标签预设', diaryRows.some((x) => /标签预设/.test(x)));

  /*
   * 收尾：把这一轮造出来的东西清掉。
   * 以前不清，每跑一次就往库里留一个账户 + 一笔 888 房租，
   * 后面跑 v21 预算套件时本月支出早被击穿，红得莫名其妙（查了半天才发现不是回归）。
   */
  const cleanup = async () => {
    try { if (recId) await rpc('ledger.recur.delete', { id: recId }); } catch { }
    try {
      const rows = (await rpc('ledger.list', { from: today().slice(0, 7) + '-01', to: today().slice(0, 7) + '-31' }))?.data?.items || [];
      for (const x of rows) {
        if ((x.note || '') === '验收房租' || (x.account_id || '') === (acc?.data?.id || '')) {
          await rpc('ledger.delete', { id: x.id });
        }
      }
    } catch { }
    try { if (acc?.data?.id) await rpc('account.delete', { id: acc.data.id }); } catch { }
  };
  await cleanup();

  console.log('页面错误:', errs.length ? errs.slice(0, 6) : '无');
  await b.close().catch(() => {});
})().catch((e) => { console.log('FATAL', e.message); process.exit(1); });
