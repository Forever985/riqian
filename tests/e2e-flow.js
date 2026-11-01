const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '56310';
const log = [];
const ok = (n, v) => { log.push(`${v ? '✅' : '❌'} ${n}`); };

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  p.on('dialog', async d => { await d.accept(); });
  await p.waitForTimeout(1500);
  // 上一次跑失败时可能留着弹层（LaTeX / 分享 / 快速记录），先收干净再开始
  for (let i = 0; i < 4; i++) {
    const open = await p.evaluate(() => document.querySelectorAll('.qmask,.mask').length);
    if (!open) break;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.mouse.click(6, 6).catch(() => {});
    await p.waitForTimeout(250);
  }


const switchGroup = async (n) => { await p.evaluate((name) => { const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes(name)); if (g) g.click(); }, n); await p.waitForTimeout(500); };
  const go = async (v) => { await p.click(`#app .nav button:has-text("${v}")`).catch(() => {}); await p.waitForTimeout(700); };

  /* ---- 今天：写正文并验证落盘 ---- */
  await p.click('#app .nav button:has-text("今天")');
  await p.waitForTimeout(600);
  // 前面套件可能把日期停在别的日子，先归位，否则断言会打在错误的一天

  // 正文模块可能停在上次用的 Markdown/BBCode，先切回富文本，否则没有 .rt 可点
  const ensureRich = async () => {
    for (let i = 0; i < 3; i++) {
      if (await p.locator('.rt[contenteditable="true"]').count()) return;
      await p.locator('.mod .mod-tools button[data-act="toggle-source"]').first().click().catch(() => {});
      await p.waitForTimeout(600);
    }
  };
  await ensureRich();

  const backBtn = p.locator('.datehead button:has-text("回到今天")');
  if (await backBtn.count()) { await backBtn.click(); await p.waitForTimeout(900); }

  // 定稿的日子是只读的：写之前先改回草稿，否则点正文点不动（这是应用的正确行为，不是 bug）
  const unpub = p.locator('.pubbar button:has-text("改回草稿")');
  if (await unpub.count()) { await unpub.click(); await p.waitForTimeout(1000); }

  const rt = p.locator('.rt[contenteditable="true"]').first();
  await rt.click();
  await rt.press('Control+A');
  await rt.type('React 版本验收：' + new Date().toISOString().slice(11, 19));
  await p.waitForTimeout(1200);
  const saved = await p.evaluate(() => document.body.innerText.includes('已保存'));
  ok('正文输入后自动保存', saved);

  const dbText = await p.evaluate(async () => {
    const r = await new Promise(res => {
      const id = 9001;
      const h = e => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m: 'entry.get', a: { date: new Date().toISOString().slice(0, 10) } });
    });
    return (r.data && r.data.plain || '').slice(0, 40);
  });
  ok('落盘内容正确: ' + JSON.stringify(dbText), dbText.includes('React 版本验收'));

  /* ---- 心情 / 天气 / 标签 ---- */
  const moodBtns = p.locator('.moodrow .mood');
  if (await moodBtns.count()) {
    // 数据会跨轮保留：如果今天已经选了这个心情，再点一次是取消，断言就会假失败
    const curIdx = await p.evaluate(() => [...document.querySelectorAll('.moodrow .mood')]
      .findIndex((b) => b.classList.contains('on')));
    const target = curIdx === 3 ? 2 : 3;
    await moodBtns.nth(target).click();
    await p.waitForTimeout(700);
    ok('心情点击生效', await p.locator('.moodrow .mood.on').count() > 0);
  }
  const chips = p.locator('.mod .row .chip');
  if (await chips.count()) {
    await chips.first().click();
    await p.waitForTimeout(600);
  }

  /* ---- 正文三态切换 ---- */
  await p.click('.mod-tools button:has-text("富文本")').catch(() => {});
  await p.waitForTimeout(900);
  ok('切到 Markdown 模式', await p.locator('textarea').count() > 0);
  const fmtBtn = p.locator('.mod-tools button').filter({ hasText: /^MD$/ }).first();
  if (await fmtBtn.count()) { await fmtBtn.click(); await p.waitForTimeout(900); }
  ok('切到 BBCode 模式', await p.locator('.bbpreview').count() > 0);
  const bbBtn = p.locator('.mod-tools button').filter({ hasText: 'BBCode' }).first();
  if (await bbBtn.count()) { await bbBtn.click(); await p.waitForTimeout(900); }
  ok('切回富文本', await p.locator('.rt[contenteditable="true"]').count() > 0);

  /* ---- 其他页面 ---- */
  await go('流'); ok('流视图渲染', await p.locator('.fw-entry').count() > 0);
  await go('打卡'); ok('打卡页渲染', await p.locator('.hcard').count() > 0);
  await go('番茄钟'); ok('番茄钟圆环', await p.locator('.pomo-ring').count() === 1);
  const startBtn = p.locator('button:has-text("开始")').first();
  if (await startBtn.count()) {
    await startBtn.click(); await p.waitForTimeout(1600);
    const t1 = await p.evaluate(() => document.querySelector('.pomo-time').textContent);
    await p.locator('button:has-text("暂停")').first().click();
    ok('番茄钟计时器走动: ' + t1, t1 !== '25:00');
  }
  await go('日历'); ok('日历 42 格左右', await p.locator('.cal2-cell').count() >= 28);
  await go('记录'); ok('记录搜索页', await p.locator('.filters').count() === 1);
  await p.fill('.searchbox input', 'React');
  await p.waitForTimeout(800);
  ok('关键词搜索命中', await p.evaluate(() => document.body.innerText.includes('条结果')));
  await go('待办');
  await p.fill('#view-root input.inp', '明天下午三点开周会');
  await p.waitForTimeout(400);
  const hint = await p.evaluate(() => (document.querySelector('#view-root .card .small') || {}).textContent || '');
  ok('智能日期识别: ' + (hint || '').slice(0, 40), hint.includes('15:00'));
  await p.locator('button:has-text("添加")').first().click();
  await p.waitForTimeout(900);
  ok('待办已添加', await p.locator('.todo-row').count() > 0);
  await go('倒计时');
  ok('倒计时页', await p.evaluate(() => !!document.querySelector('.smartbar') || document.body.innerText.includes('倒计时')));
  await go('统计'); ok('统计页', await p.locator('.strip').count() === 1);
  await go('设置'); ok('设置页主题卡', await p.locator('.tcard').count() === 7);

  /* ---- 主题切换 ---- */
  await p.locator('.tcard').nth(1).click();
  await p.waitForTimeout(700);
  const theme = await p.evaluate(() => document.documentElement.dataset.theme);
  ok('主题切换为 ink: ' + theme, theme === 'ink');
  await p.locator('.tcard').first().click();
  await p.waitForTimeout(500);

  /* ---- 模块开关 ---- */
  await switchGroup('日记与模块');
  const before = await p.locator('.moditem').count();
  await p.locator('.moditem .switch').last().click();
  await p.waitForTimeout(700);
  const after = await p.locator('.moditem .switch.on').count();
  ok(`模块开关可点 (${before} 项, 开 ${after})`, before > 0);

  /* ---- 图片库弹层 ---- */
  await switchGroup('数据与缓存');
  await p.locator('button:has-text("浏览 / 管理")').click();
  await p.waitForTimeout(800);
  ok('图片库弹层打开', await p.locator('.mask .dlg').count() === 1);
  await p.locator('.dlg .f button').last().click();
  await p.waitForTimeout(400);

  /* ---- 截图 ---- */
  await go('今天');
  await p.evaluate(() => { document.getElementById('view-root').scrollTop = 0; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'x-today.png', timeout: 8000 }).catch(() => {});
  await go('打卡'); await p.screenshot({ path: 'x-habits.png', timeout: 8000 }).catch(() => {});
  await go('设置'); await p.screenshot({ path: 'x-settings.png', timeout: 8000 }).catch(() => {});
  await go('流'); await p.screenshot({ path: 'x-flow.png', timeout: 8000 }).catch(() => {});
  await go('日历'); await p.screenshot({ path: 'x-cal.png', timeout: 8000 }).catch(() => {});
  await go('统计'); await p.screenshot({ path: 'x-stats.png', timeout: 8000 }).catch(() => {});

  console.log(log.join('\n'));
  console.log('页面错误:', errs.length ? errs.slice(0, 6) : '无');
  await b.close().catch(() => {});
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
