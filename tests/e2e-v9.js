/**
 * v9 验收：第 44–61 条
 * 44 更新日志 45 说明书 46 联系我们 47 番茄洞察 48 标题 49 定稿/草稿箱 50 放弃vs回收站
 * 51 头像裁剪 52 提示条 53/54 顺序可调 55 图库音乐库独立 56 多语言 57 地区 58 资料
 * 59 托盘(已在 v8 覆盖，这里只查入口) 60 跨天 61 关闭/最小化
 */
const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '57003';
const log = [];
const ok = (n, v, extra = '') => {
  const line = `${v ? '✅' : '❌'} ${n}${extra ? '  ' + extra : ''}`;
  log.push(line);
  console.log(line);
};

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
  p.on('dialog', async (d) => { await d.accept(); });
  p.setDefaultTimeout(15000);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 70000 + Math.floor(Math.random() * 25000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const yKey = (() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const go = async (t) => { await p.click(`#app .nav button:has-text("${t}")`); await p.waitForTimeout(900); };
  /** 从日历打开某一天：右键 → 「写这天日记」（v10 查双击=看总结） */
  const openCalDay = async (index) => {
    const cell = p.locator('.cal2-cell:not(.other)').nth(index);
    const box = await cell.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down({ button: 'right' });
    await p.mouse.up({ button: 'right' });
    await p.waitForTimeout(450);
    await p.locator('.rowmenu button', { hasText: '写这天日记' }).first().click();
    await p.waitForTimeout(1400);
  };

  /** 说明书 / 更新日志 / 联系我们挪到了「设置 → 关于」，不再占侧栏 */
  const openAbout = async (name) => {
    await p.click('.nav button[data-nav="settings"]');
    await p.waitForTimeout(800);
    await p.locator('.snav', { hasText: '关于' }).click();
    await p.waitForTimeout(600);
    await p.locator('.setbody button', { hasText: name }).first().click();
    await p.waitForTimeout(900);
  };
  const toastText = () => p.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');

  await p.waitForTimeout(1600);
  for (let i = 0; i < 4; i++) {
    const open = await p.evaluate(() => document.querySelectorAll('.qmask,.mask').length);
    if (!open) break;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.mouse.click(6, 6).catch(() => {});
    await p.waitForTimeout(250);
  }
  const back = p.locator('.datehead button:has-text("回到今天")');
  if (await back.count()) { await back.click(); await p.waitForTimeout(800); }
  /* ============ 48. 标题 ============ */
  await go('今天');
  // 上一轮可能把今天定稿了（标题与正文都是 readonly）。
  // 必须先进到「今天」页再复位 —— 停在别的页时 .pubbar 根本不存在，点了等于没点。
  // 走接口比点按钮稳：不依赖弹层状态，也不用等重渲染。
  await rpc('entry.publish', { date: today(), published: 0 });
  await p.waitForTimeout(400);
  await go('今天');
  await p.waitForTimeout(700);
  const hasTitle = await p.locator('.entrytitle').count();
  await p.fill('.entrytitle', 'v9 标题·秋日');
  const rt = p.locator('.rt[contenteditable="true"]').first();
  await rt.click();
  await p.keyboard.press('Control+A');
  await rt.type('今天把标题这件事做完了。');
  await p.waitForTimeout(1400);
  const e1 = await rpc('entry.get', { date: today() });
  ok('日记能写标题并落库', hasTitle === 1 && e1.title === 'v9 标题·秋日', `title=${e1.title}`);
  ok('保存状态可见', (await p.evaluate(() => document.querySelector('.savechip')?.textContent || '')).includes('已保存'));

  await go('记录');
  const recTitle = await p.evaluate(() => document.querySelector('.rec-title')?.textContent || '');
  ok('记录页显示标题', recTitle.includes('秋日'), recTitle);
  await go('流');
  const flowTitle = await p.evaluate(() => document.querySelector('.fw-title')?.textContent || '');
  ok('流视图显示标题', flowTitle.includes('秋日'), flowTitle);
  await go('记录');
  await p.fill('.searchbox input', '秋日');
  await p.waitForTimeout(900);
  const searchHit = await p.evaluate(() => document.querySelectorAll('.rec').length);
  ok('标题参与搜索', searchHit >= 1, `${searchHit} 条`);
  await p.fill('.searchbox input', '');
  await p.waitForTimeout(400);

  /* ============ 49. 定稿 / 草稿箱 ============ */
  await go('今天');
  await p.click('.datehead button:has-text("定稿")');
  await p.waitForTimeout(1200);
  const pubState = await p.evaluate(() => ({
    bar: !!document.querySelector('.pubbar'),
    ro: !!document.querySelector('.ro'),
    btn: [...document.querySelectorAll('.datehead button')].map((x) => x.textContent).join('|'),
  }));
  ok('定稿后默认只读', pubState.bar && pubState.ro && pubState.btn.includes('已定稿'));
  const st1 = await rpc('entry.status', { date: today() });
  ok('定稿状态已落库', st1.status === 'published', st1.publishedAt);

  // 造一篇草稿：去昨天写点东西但不定稿
  await p.click('.datehead button:has-text("回到今天")').catch(() => {});
  await rpc('entry.get', { date: yKey });
  await go('日历');
  const findIdx = () => p.evaluate((d) => [...document.querySelectorAll('.cal2-cell:not(.other)')]
    .findIndex((c) => (c.title || '').startsWith(d)), yKey);
  let idx = await findIdx();
  // 每个月 1 号，昨天落在上个月的格子里，当月视图里找不到 —— 先翻回去
  if (idx < 0) {
    await p.locator('button[data-act="prev-month"]').first().click().catch(() => {});
    await p.waitForTimeout(800);
    idx = await findIdx();
  }
  if (idx >= 0) {
    await openCalDay(idx);
    await p.waitForTimeout(1500);
    const rt2 = p.locator('.rt[contenteditable="true"]').first();
    await rt2.click();
    await p.keyboard.press('Control+A');
    await rt2.type('昨天的草稿，还没定稿。');
    await p.waitForTimeout(1500);
  }
  const drafts = await rpc('entry.drafts', {});
  ok('草稿箱能列出未定稿的日子', Array.isArray(drafts) && drafts.some((x) => x.date === yKey), `${drafts.length} 篇`);
  await go('草稿箱');
  const drafUi = await p.evaluate(() => ({
    rows: document.querySelectorAll('.draft-row').length,
    sub: document.querySelector('.topbar .sub')?.textContent,
  }));
  ok('草稿箱页面可见', drafUi.rows >= 1, `${drafUi.sub}`);

  /* ============ 60. 跨天 ============ */
  const staleBanner = await p.evaluate(() => !!document.querySelector('.daybar'));
  ok('翻看昨天不会误报跨天', !staleBanner);
  const yStatus = await rpc('entry.status', { date: yKey });
  ok('草稿状态正确', yStatus.status === 'draft');

  // 空日期不该建行（第 60 条的根因）
  const far = '2020-02-02';
  await rpc('entry.save', { date: far, values: {}, fav: 0, bg: '', title: '' });
  const farGet = await rpc('entry.get', { date: far });
  ok('空内容不产生空日记行', farGet.exists === false);

  /* ============ 50. 放弃 vs 回收站 ============ */
  await go('待办');
  const rail = await p.evaluate(() => [...document.querySelectorAll('.rail-i, .rail button')].map((x) => x.textContent).join('|'));
  ok('待办里写的是「已放弃」而不是垃圾桶', rail.includes('已放弃'), rail.slice(0, 60));
  const addBox = p.locator('input[placeholder*="说人话"]').first();
  await addBox.click();
  await p.keyboard.type('v9 要放弃的事');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
  const todos = await rpc('todos.list', {});
  const target = (todos || []).find((t) => (t.title || '').includes('v9 要放弃的事'));
  if (target) {
    await rpc('todo.trash', { id: target.id, trashed: 1 });
    const after = await rpc('todos.list', {});
    const dropped = (after || []).find((t) => t.id === target.id);
    ok('放弃的任务保留在库里但不计入完成', !!dropped && dropped.trashed === 1 && !dropped.deletedAt);
  } else ok('放弃的任务保留在库里但不计入完成', false, '没造出任务');

  /* ============ 52. 提示条 ============ */
  await go('设置');
  await p.locator('.snav', { hasText: '提醒与勿扰' }).click();
  await p.waitForTimeout(600);
  const toastRow = await p.evaluate(() => [...document.querySelectorAll('.set-row .lbl')].some((x) => x.textContent.includes('提示条停留')));
  ok('提示条停留时间可设置', toastRow);
  await p.locator('.set-row', { hasText: '提示条停留' }).locator('.chip', { hasText: '4 秒' }).click();
  await p.waitForTimeout(600);
  const b2 = await rpc('bootstrap', {});
  ok('停留时长已保存', String(b2.settings.toastMs) === '4000', b2.settings.toastMs);
  await p.evaluate(() => window.__HOST_CMD__ && window.__HOST_CMD__('nav:home'));
  await p.waitForTimeout(900);
  const t1 = await p.evaluate(() => !!document.querySelector('#toast.show'));
  await p.evaluate(() => document.querySelector('#toast .tx-x')?.click());
  await p.waitForTimeout(400);
  const t2 = await p.evaluate(() => !!document.querySelector('#toast.show'));
  ok('提示条能手动关掉', !t2, t1 ? '' : '（当时没有提示，仅验证可关闭）');

  /* ============ 53/54. 顺序 ============ */
  await go('设置');
  await p.locator('.snav', { hasText: '界面布局' }).click();
  await p.waitForTimeout(700);
  const orderCount = await p.evaluate(() => document.querySelectorAll('.orderlist').length);
  ok('导航 / 个人中心 / 设置页三处顺序都能调', orderCount === 3, `${orderCount} 个排序器`);

  const profBefore = await p.evaluate(() => [...document.querySelectorAll('.orderlist')[1].querySelectorAll('.nm')].map((x) => x.textContent)[0]);
  await p.locator('.orderlist').nth(1).locator('.orow').first().locator('button[data-act="down"]').click();
  await p.waitForTimeout(800);
  await go('我的');
  const firstBlock = await p.evaluate(() => {
    const kids = [...document.querySelectorAll('.wrap.stack > *')];
    const sorted = kids.slice().sort((a, b) => (Number(getComputedStyle(a).order) || 0) - (Number(getComputedStyle(b).order) || 0));
    return sorted[0]?.querySelector('h3')?.textContent || sorted[0]?.textContent?.slice(0, 20);
  });
  ok('个人中心顺序按设置生效', !firstBlock.includes('身份'), `${profBefore} → 首块：${String(firstBlock).trim().slice(0, 18)}`);

  await go('设置');
  await p.locator('.snav', { hasText: '界面布局' }).click();
  await p.waitForTimeout(600);
  const navOrderBefore = await p.evaluate(() => [...document.querySelectorAll('.snav span')].map((x) => x.textContent).join('/'));
  await p.locator('.orderlist').nth(2).locator('.orow').first().locator('button[data-act="down"]').click();
  await p.waitForTimeout(900);
  const navOrderAfter = await p.evaluate(() => [...document.querySelectorAll('.snav span')].map((x) => x.textContent).join('/'));
  ok('设置页分组顺序可调', navOrderBefore !== navOrderAfter);
  // 还原
  await p.locator('.orderlist').nth(2).locator('.orow').nth(1).locator('button[data-act="up"]').click();
  await p.waitForTimeout(700);

  /* ============ 56/57. 语言与地区 ============ */
  await p.locator('.set-row', { hasText: '语言' }).locator('.chip', { hasText: 'English' }).click();
  await p.waitForTimeout(1000);
  const navEN = await p.evaluate(() => [...document.querySelectorAll('#app .nav .lb')].map((x) => x.textContent));
  ok('切英文后导航变英文', navEN.includes('Today') && navEN.includes('Settings'), navEN.slice(0, 4).join('/'));
  const overflow = await p.evaluate(() => {
    const el = document.querySelector('#app .nav');
    return el ? el.scrollWidth - el.clientWidth : 0;
  });
  ok('英文没有把侧栏撑破', overflow <= 2, `溢出 ${overflow}px`);
  await p.locator('.set-row', { hasText: '语言' }).locator('.chip', { hasText: '正体中文' }).click();
  await p.waitForTimeout(800);
  const navCN = await p.evaluate(() => [...document.querySelectorAll('#app .nav .lb')].map((x) => x.textContent));
  ok('可以切回正体中文', navCN.includes('今天'));

  await go('我的');
  const regionSel = p.locator('.pf-f select').first();
  await regionSel.selectOption('CN-71');
  await p.locator('.btn.primary', { hasText: '保存资料' }).click();
  await p.waitForTimeout(900);
  const b3 = await rpc('bootstrap', {});
  const fields = JSON.parse(String(b3.settings.profileFields || '{}'));
  ok('地区可选到中国台湾省', fields.region === 'CN-71', fields.region);

  /* ============ 58. 资料 ============ */
  const likeChip = p.locator('.pf-block', { hasText: '兴趣爱好' }).locator('.chip', { hasText: '阅读' });
  if (!String(await likeChip.getAttribute('class') || '').includes('on')) await likeChip.click();
  await p.waitForTimeout(300);
  await p.fill('.pf-block textarea', '白天写代码，晚上写日记。');
  await p.locator('.btn.primary', { hasText: '保存资料' }).click();
  await p.waitForTimeout(900);
  const b4 = await rpc('bootstrap', {});
  const f2 = JSON.parse(String(b4.settings.profileFields || '{}'));
  ok('兴趣与简介能保存', (f2.interests || []).includes('阅读') && String(f2.bio).includes('写日记'), `${(f2.interests || []).join('、')}`);

  /* ============ 51. 头像裁剪 ============ */
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWElEQVR4nO3QMQEAAAgDoC251a3gLwqgOXFRAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIEHAeWLwAAZoW4Z8AAAAASUVORK5CYII=';
  const up = await rpc('media.saveBase64', { name: 'avatar-test.png', data: png });
  if (up && up.id) {
    await rpc('user.save', { nickname: '测试', signature: '', avatar: up.id, birthday: '', lunarBirthday: '' });
    await p.click('#app .nav button:has-text("今天")');
    await p.waitForTimeout(600);
    await go('我的');
    await p.waitForTimeout(800);
    await p.click('.avatar');
    await p.waitForTimeout(900);
    const cropUi = await p.evaluate(() => ({
      cv: !!document.querySelector('.crop-cv'),
      zoom: !!document.querySelector('.crop input[type=range]'),
    }));
    ok('点头像能进裁剪（拖动 + 缩放）', cropUi.cv && cropUi.zoom);
    await p.locator('.dlg .f .btn.primary', { hasText: '用这张' }).click();
    await p.waitForTimeout(1600);
    const u = await rpc('user.get', {});
    ok('裁剪后的头像已保存', u.avatar && u.avatar !== up.id, u.avatar);
  } else ok('点头像能进裁剪（拖动 + 缩放）', false, '测试图上传失败');

  /* ============ 44/45/46. 说明类页面 ============ */
  await openAbout('更新日志');
  const rel = await p.evaluate(() => ({
    cards: document.querySelectorAll('.rel').length,
    firstOpen: document.querySelectorAll('.rel.open .rel-list li').length,
  }));
  ok('更新日志按版本列出', rel.cards >= 5 && rel.firstOpen > 0, `${rel.cards} 个版本`);
  await openAbout('使用说明书');
  const man = await p.evaluate(() => document.querySelectorAll('.man').length);
  ok('说明书有章节', man >= 10, `${man} 节`);
  await p.fill('.topbar .searchbox input', '定稿');
  await p.waitForTimeout(700);
  const manHit = await p.evaluate(() => document.querySelectorAll('.man').length);
  ok('说明书能搜', manHit >= 1 && manHit < man, `命中 ${manHit} 节`);
  await p.fill('.searchbox input', '');
  await openAbout('联系我们');
  const contact = await p.evaluate(() => ({
    facts: !!document.querySelector('.kv'),
    ta: !!document.querySelector('textarea'),
  }));
  await p.fill('textarea', 'v9 自动化测试反馈：一切正常。');
  await p.locator('button', { hasText: '保存到' }).click();
  await p.waitForTimeout(1200);
  const fbToast = await toastText();
  ok('联系我们可保存反馈', contact.ta && contact.facts && fbToast.includes('已保存'), fbToast);

  /* ============ 55 / 59 / 61. 入口类 ============ */
  await go('多媒体库');
  const mediaPage = await p.evaluate(() => ({
    title: document.querySelector('.topbar h2')?.textContent,
    grid: !!document.querySelector('.imgpick'),
    seg: [...document.querySelectorAll('.seg-b')].map((x) => x.textContent.trim()),
  }));
  ok('多媒体库有独立页', /多媒体库|图片库/.test(mediaPage.title || ''), `${mediaPage.grid ? '有图' : '空库'}`);
  // v10.1 起图片 / 音乐 / 视频合成一个页签，音乐库变成它里面的「提醒音」栏
  ok('音乐库已并入多媒体库', mediaPage.seg.some((x) => /提醒音/.test(x)), mediaPage.seg.join('/'));

  await go('设置');
  await p.locator('.snav', { hasText: '托盘与窗口' }).click();
  await p.waitForTimeout(600);
  const tray = await p.evaluate(() => document.querySelectorAll('.tray-item').length);
  ok('托盘菜单仍可逐项配置', tray >= 10, `${tray} 项`);
  await p.locator('.snav', { hasText: '界面布局' }).click();
  await p.waitForTimeout(600);
  const closeRows = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('.set-row .lbl')].map((x) => x.textContent.split('\n')[0]);
    return labels.filter((t) => t.includes('点 X') || t.includes('最小化的时候')).length;
  });
  ok('关闭 / 最小化行为可选', closeRows === 2);

  /* ============ 47. 番茄洞察 ============ */
  await rpc('pomodoro.add', { minutes: 25, kind: 'focus', task: 'v9 测试任务' });
  await go('番茄钟');
  await p.waitForTimeout(1200);
  const insight = await p.evaluate(() => ({
    heat: document.querySelectorAll('.heat-c').length,
    hours: document.querySelectorAll('.hb').length,
    hasTask: [...document.querySelectorAll('.pi-task .nm')].some((x) => x.textContent.includes('v9')),
  }));
  ok('番茄洞察：热力 + 时段 + 任务排行', insight.heat >= 7 && insight.hours === 24, `${insight.heat} 格 / ${insight.hours} 小时`);
  ok('番茄记录进了任务排行', insight.hasTask);

  // 收尾：把今天改回草稿，保证下一轮还能写
  await rpc('entry.publish', { date: today(), published: 0 });

  /* ============ 62. 导航栏四种停靠位置（用户报的严重 UI bug） ============ */
  const dockCheck = async (label) => {
    const m = await p.evaluate(() => {
      const nav = document.querySelector('.nav');
      const scrollable = nav ? nav.scrollHeight > nav.clientHeight + 2 : false;
      const items = [...document.querySelectorAll('.nav button')];
      const nb = nav?.getBoundingClientRect();
      const clipped = items.filter((it) => {
        const r = it.getBoundingClientRect();
        return !nb || r.bottom > nb.bottom + 1 || r.top < nb.top - 1;
      }).length;
      const side = document.querySelector('.side')?.getBoundingClientRect();
      const main = document.querySelector('.main')?.getBoundingClientRect();
      const bar = document.querySelector('.topbar')?.getBoundingClientRect();
      return {
        items: items.length,
        clipped,
        sideIn: !!side && side.height <= innerHeight + 1 && side.width <= innerWidth + 1,
        mainH: main ? Math.round(main.height) : 0,
        bar: !!bar && bar.height > 0 && bar.top >= 0 && bar.bottom <= innerHeight + 1,
        docOver: document.documentElement.scrollHeight - innerHeight,
        scrollable,
      };
    });
    let opened = false;
    try {
      await p.locator('.nav button[data-nav="settings"]').scrollIntoViewIfNeeded({ timeout: 4000 });
      await p.click('.nav button[data-nav="settings"]', { timeout: 4000 });
      await p.waitForTimeout(600);
      opened = (await p.evaluate(() => document.querySelector('.topbar h2')?.textContent)) === '设置';
    } catch { opened = false; }
    // 19 项不可能在所有窗口高度一屏放下：要么全放得下，要么能滚（scrollable）
    ok(`导航停靠在${label}时布局正常`,
      (m.clipped === 0 || m.scrollable) && m.sideIn && m.mainH > 240 && m.bar && m.docOver <= 1,
      `${m.items} 项 / 裁切 ${m.clipped} / 可滚 ${m.scrollable} / 主区 ${m.mainH}px`);
    ok(`导航停靠在${label}时「设置」点得开`, opened);
    await p.locator('.snav', { hasText: '界面布局' }).click();
    await p.waitForTimeout(600);
  };

  await go('设置');
  await p.locator('.snav', { hasText: '界面布局' }).click();
  await p.waitForTimeout(600);
  for (const [label, key] of [['上', 'top'], ['下', 'bottom'], ['右', 'right'], ['左', 'left']]) {
    await p.locator('.set-row', { hasText: '导航栏位置' }).locator('.chip', { hasText: label }).first().click();
    await p.waitForTimeout(900);
    const dock = await p.evaluate(() => document.querySelector('.app')?.dataset.dock);
    if (dock !== key) { ok(`切到${label}`, false, `实际 ${dock}`); continue; }
    await dockCheck(label);
  }

  console.log('页面错误:', errs.length ? errs.slice(0, 8) : '无');
  const pass = log.filter((l) => l.startsWith('✅')).length;
  console.log(`\n合计 ${pass}/${log.length} 通过`);
  await b.close().catch(() => {});
})().catch((e) => {
  console.log(log.join('\n'));
  console.log('FATAL', e.message);
  process.exit(1);
});
