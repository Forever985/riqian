/**
 * v8 验收：34–43 条
 * 34 欢迎页绑到 LOGO  35 托盘可配置  36/37 排序收进设置  38 密码提示与密保
 * 39 分享  40 总结  41 快捷键与快速记录  42 设计参考（无断言）  43 LaTeX
 */
const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '57001';
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
    const id = 60000 + Math.floor(Math.random() * 30000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const go = async (t) => {
    await p.click(`#app .nav button:has-text("${t}")`);
    await p.waitForTimeout(900);
  };
  const toastText = () => p.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');

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


  // 前面套件/手工探测可能把日期停在别的日子，先归位到今天，否则断言会打在错误的一天
  const backToday = async () => {
    // 先在侧栏点「今天」，否则上一套把界面停在别的页时，这里根本找不到日期栏
    await p.click('#app .nav button:has-text("今天")').catch(() => {});
    await p.waitForTimeout(600);
    const btn = p.locator('.datehead button:has-text("回到今天")');
    if (await btn.count()) { await btn.click(); await p.waitForTimeout(900); }
  };
  await backToday();

  // 定稿的日子是只读的：写之前先改回草稿，否则点正文点不动（这是应用的正确行为，不是 bug）

  // 正文模块可能停在上次用的 Markdown/BBCode，先切回富文本，否则没有 .rt 可点
  const ensureRich = async () => {
    for (let i = 0; i < 3; i++) {
      if (await p.locator('.rt[contenteditable="true"]').count()) return;
      await p.locator('.mod .mod-tools button[data-act="toggle-source"]').first().click().catch(() => {});
      await p.waitForTimeout(600);
    }
  };
  await ensureRich();

  const unpub = p.locator('.pubbar button:has-text("改回草稿")');
  if (await unpub.count()) { await unpub.click(); await p.waitForTimeout(1000); }



  // 上一次跑失败时可能留着浮层（快速记录 / 命令面板），先把界面收干净
  for (let i = 0; i < 3; i++) {
    if (!(await p.locator('.qmask').count())) break;
    await p.mouse.click(6, 6);
    await p.waitForTimeout(300);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  }

  // 上一次跑可能把「总结默认 7 天」改成 14 天，这里从设置界面复位
  // （设置会记住是预期行为，但测试要可重复；顺便验一下这一项确实在设置里）
  await go('设置');
  await p.locator('.snav', { hasText: '分享与总结' }).click();
  await p.waitForTimeout(600);
  const daysInput = p.locator('.set-row:has-text("默认跨度") input[type=number]');
  await daysInput.fill('7');
  await daysInput.blur();
  await p.waitForTimeout(900);

  /* ============ 34. LOGO = 首页 ============ */
  await go('今天');
  await p.click('#brand-home');
  await p.waitForTimeout(900);
  const home = await p.evaluate(() => ({
    hero: !!document.querySelector('.welcome .hero'),
    title: document.querySelector('.topbar h2')?.textContent,
    tip: document.querySelector('#brand-home')?.getAttribute('title'),
  }));
  ok('点左上角 LOGO 回到首页', home.hero && home.title === '今天', `title=${home.tip}`);

  /* ============ 39. 分享 ============ */
  await go('今天');
  await p.click('.datehead button:has-text("分享")');
  await p.waitForTimeout(1800);
  const shareUi = await p.evaluate(() => ({
    img: !!document.querySelector('.share-prev img'),
    preview: (document.querySelector('.share-prev img') || {}).src?.slice(0, 22),
    styles: document.querySelectorAll('.share-sw').length,
    sizes: document.querySelectorAll('.share .chip').length,
  }));
  ok('分享卡片生成预览', shareUi.img && shareUi.styles === 4, `${shareUi.styles} 版式 / ${shareUi.sizes} 尺寸`);

  await p.click('.dlg .f .btn.primary');            // 保存图片
  await p.waitForTimeout(1800);
  const savToast = await toastText();
  ok('分享图片已落盘', savToast.includes('已保存'), savToast);

  // 换版式后预览会重绘
  await p.locator('.share-sw').nth(2).click();
  await p.waitForTimeout(900);
  const inkPreview = await p.evaluate(() => document.querySelector('.share-prev img')?.src?.length || 0);
  ok('切换版式会重绘卡片', inkPreview > 1000);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  /* ============ 43. LaTeX ============ */
  await go('今天');
  const texBefore = await p.evaluate(() => document.querySelectorAll('.mod .tex').length);
  await p.locator('.mod .mod-tools button[data-act="insert-latex"]').first().click();
  await p.waitForTimeout(600);
  await p.fill('.dlg textarea', '\\int_0^1 x^2\\,dx=\\frac{1}{3}');
  await p.waitForTimeout(400);
  const previewOk = await p.evaluate(() => !!document.querySelector('.tex-preview .katex'));
  // 按钮在 TeX 非法/为空时是禁用的，点了也等于没点 —— 之前脚本就是这样把弹窗留在那儿的
  await p.locator('.dlg .f .btn.primary').waitFor({ state: 'visible' });
  await p.waitForFunction(() => {
    const b = document.querySelector('.dlg .f .btn.primary');
    return !!b && !b.disabled;
  }, null, { timeout: 5000 });
  await p.click('.dlg .f .btn.primary');             // 插入
  await p.waitForTimeout(1000);
  ok('插入后弹窗自动关闭', (await p.evaluate(() => document.querySelectorAll('.mask').length)) === 0);
  const texAfter = await p.evaluate(() => ({
    n: document.querySelectorAll('.mod .tex').length,
    katex: !!document.querySelector('.mod .tex .katex'),
    tex: document.querySelector('.mod .tex')?.getAttribute('data-tex'),
  }));
  ok('公式弹窗能实时预览', previewOk);
  ok('富文本插入公式并渲染', texAfter.n === texBefore + 1 && texAfter.katex, `data-tex=${texAfter.tex}`);

  // 落库：等自动保存
  await p.click('body', { position: { x: 5, y: 5 } }).catch(() => {});
  await p.waitForTimeout(1400);
  const saved = await rpc('entry.get', { date: today() });
  ok('公式随日记写进库', JSON.stringify(saved.values || {}).includes('data-tex'));

  // Markdown 的 $...$
  await p.locator('.mod .mod-tools button[data-act="toggle-source"]').first().click();
  await p.waitForTimeout(900);
  const mdBox = p.locator('.mod textarea').first();
  await mdBox.fill('质能方程：$E=mc^2$，以及\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$');
  await p.waitForTimeout(900);
  const mdTex = await p.evaluate(() => document.querySelectorAll('.mod .tex .katex').length);
  ok('Markdown 的 $…$ / $$…$$ 都能出图', mdTex >= 2, `${mdTex} 个公式`);
  // 切回富文本
  await p.locator('.mod .mod-tools button[data-act="toggle-source"]').first().click();
  await p.waitForTimeout(500);
  await p.locator('.mod .mod-tools button[data-act="toggle-source"]').first().click();
  await p.waitForTimeout(600);

  /* ============ 40. 总结 ============ */
  await go('总结');
  const daySum = await p.evaluate(() => ({
    kpis: document.querySelectorAll('.sum-kpis div').length,
    head: document.querySelector('.sum-d')?.textContent,
    hasQuoteOrBody: !!(document.querySelector('.sum-quote') || document.querySelector('.sum-body')),
  }));
  ok('一日总结渲染', daySum.kpis === 5 && !!daySum.head, `${daySum.head} / ${daySum.kpis} 项指标`);

  await p.click('.review-bar .chip:has-text("近几日总结")');
  await p.waitForTimeout(1200);
  const r7 = await p.evaluate(() => ({
    bars: document.querySelectorAll('.sum-bars .sb').length,
    head: document.querySelector('.sum-d')?.textContent,
  }));
  ok('近几日总结按默认 7 天生成', r7.bars === 7, `${r7.head} · ${r7.bars} 根柱`);

  await p.fill('.review-bar input[type=number]', '14');
  await p.waitForTimeout(1300);
  const r14 = await p.evaluate(() => document.querySelectorAll('.sum-bars .sb').length);
  ok('总结跨度可以自由调节', r14 === 14, `14 → ${r14} 根柱`);

  const before = (await rpc('summary.list', {})) || [];
  await p.click('.sum-foot button:has-text("留存这版")');
  await p.waitForTimeout(700);
  await p.click('.dlg .f .btn.primary');            // askText 确定
  await p.waitForTimeout(1500);
  const after = (await rpc('summary.list', {})) || [];
  ok('总结可以留存', after.length === before.length + 1, `${before.length} → ${after.length}`);

  const histRow = await p.evaluate(() => ({
    rows: document.querySelectorAll('.sum-hist').length,
    share: [...document.querySelectorAll('.sum-foot button')].some((b) => b.textContent.includes('分享')),
  }));
  ok('总结可分享 · 历史列表可见', histRow.share && histRow.rows >= 1, `${histRow.rows} 条留存`);

  // 打开留存 & 删除
  await p.locator('.sum-hist .h-main').first().click();
  await p.waitForTimeout(800);
  const viewer = await p.evaluate(() => !!document.querySelector('.sum-view h1'));
  ok('留存可以回看', viewer);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.locator('.sum-hist').first().locator('button[data-act="del"]').click();
  await p.waitForTimeout(1200);
  const afterDel = (await rpc('summary.list', {})) || [];
  ok('留存可以删除（不动日记）', afterDel.length === before.length, `${after.length} → ${afterDel.length}`);

  /* ============ 38. 密码提示 / 密保 / 找回 ============ */
  const hint = '常用的那串 + 生日月份';
  await rpc('vault.hint', { hint });
  const vs1 = await rpc('vault.status', {});
  ok('密码提示已保存', vs1.hint === hint, vs1.hint);

  const qaAns = ['王', '蓝色'];
  const qaSave = await rpc('vault.qa.save', {
    list: [
      { question: '小学班主任姓什么', answer: qaAns[0] },
      { question: '第一辆自行车什么颜色', answer: qaAns[1] },
    ],
  });
  const qaList = (await rpc('vault.qa.list', {})) || [];
  ok('密保问题已保存', qaSave.ok && qaList.length === 2, qaList.map((x) => x.question).join(' / '));

  const qaWrong = await rpc('vault.qa.verify', { answers: ['李', qaAns[1]] });
  ok('密保答案错一个就不放行', qaWrong.ok === false && qaWrong.matched === 1, JSON.stringify(qaWrong));
  const qaRight = await rpc('vault.qa.verify', { answers: qaAns });
  ok('密保全对可以通过', qaRight.ok === true, `${qaRight.matched}/${qaRight.total}`);

  const reset = await rpc('vault.qa.reset', { answers: qaAns, password: 'newpass1234' });
  const unlockNew = await rpc('vault.unlock', { scope: 'todos', target: '', password: 'newpass1234' });
  ok('答对密保能重设主密码', reset.ok === true && unlockNew.ok === true);
  // 改回测试用主密码
  const back = await rpc('vault.qa.reset', { answers: qaAns, password: 'test1234' });
  ok('能再把密码改回来', back.ok === true);

  // 解锁面板上要能看到提示与找回入口
  await rpc('vault.add', { scope: 'countdown', target: '', label: '倒计时', password: '' });
  await rpc('vault.lock', {});
  await go('我的');            // 这个页面会 reloadVault，把新规则同步进 store
  await p.waitForTimeout(800);
  await go('倒计时');
  const lockUi = await p.evaluate(() => ({
    hint: document.querySelector('.unlock-hint')?.textContent || '',
    forgot: [...document.querySelectorAll('.linkbtn')].some((b) => b.textContent.includes('密保')),
  }));
  ok('解锁面板显示提示与找回入口', lockUi.hint.includes('生日月份') && lockUi.forgot, lockUi.hint);
  await p.click('.linkbtn:has-text("密保")');
  await p.waitForTimeout(700);
  const forgotUi = await p.evaluate(() => ({
    dlg: !!document.querySelector('.dlg'),
    qs: document.querySelectorAll('.dlg .inp').length,
  }));
  ok('忘记密码弹层列出密保问题', forgotUi.dlg && forgotUi.qs >= 2, `${forgotUi.qs} 个输入框`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  // 清理：解锁并删掉倒计时规则
  await rpc('vault.unlock', { scope: 'countdown', target: '', password: 'test1234' });
  const vs2 = await rpc('vault.status', {});
  for (const r of (vs2.rules || []).filter((x) => x.scope === 'countdown')) await rpc('vault.remove', { id: r.id });
  await go('我的');
  await p.waitForTimeout(700);

  /* ============ 41. 快捷键 ============ */
  const hk = await rpc('shell.hotkeyState', {});
  ok('全局热键已注册', hk.registered >= 5, `registered=${hk.registered}`);

  await go('设置');
  await p.locator('.snav', { hasText: '快捷键' }).click();
  await p.waitForTimeout(700);
  const rec = p.locator('.keyrec').first();
  await rec.click();
  await p.keyboard.press('Control+Alt+Y');
  await p.waitForTimeout(500);
  const recTxt = await rec.textContent();
  ok('快捷键可以录制', /Ctrl\+Alt\+Y/i.test(recTxt || ''), recTxt);

  await p.click('button:has-text("保存并生效")');
  await p.waitForTimeout(1500);
  const applyToast = await toastText();
  const failBox = await p.evaluate(() => document.querySelectorAll('.hotkey-fail').length);
  ok('录制后能生效', failBox === 0, applyToast);

  // 改回默认的组合
  await rec.click();
  await p.keyboard.press('Control+Alt+J');
  await p.waitForTimeout(300);
  await p.click('button:has-text("保存并生效")');
  await p.waitForTimeout(1200);

  /* 老板键（隐藏 / 伪装）—— 立刻恢复，免得后面的点击落在隐藏窗口上 */
  const boss1 = await rpc('boss.toggle', {});
  await p.waitForTimeout(900);
  const bossState = await rpc('shell.hotkeyState', {});
  ok('老板键能进入隐形模式', boss1.on === true && bossState.boss === true);
  const boss2 = await rpc('boss.toggle', {});
  await p.waitForTimeout(900);
  ok('老板键能回来', boss2.on === false);

  /* ============ 35. 托盘与窗口 ============ */
  await p.locator('.snav', { hasText: '托盘与窗口' }).click();
  await p.waitForTimeout(700);
  const trayUi = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.set-row')];
    const orbRow = rows.find((r) => r.textContent.includes('悬浮小 logo'));
    return {
      items: document.querySelectorAll('.tray-item').length,
      on: document.querySelectorAll('.tray-item.on').length,
      iconModes: rows.some((r) => r.textContent.includes('图标显示')),
      orbSwitch: !!(orbRow && orbRow.querySelector('.switch')),
    };
  });
  ok('托盘菜单可逐项配置', trayUi.items >= 10 && trayUi.on >= 5 && trayUi.orbSwitch, `${trayUi.on}/${trayUi.items} 项`);

  await p.locator('.set-row:has-text("悬浮小 logo") .switch').click();
  await p.waitForTimeout(1000);
  const orbOn = await rpc('shell.hotkeyState', {});
  ok('右下角小 logo 能开启', orbOn.orb === true);
  await p.locator('.set-row:has-text("悬浮小 logo") .switch').click();
  await p.waitForTimeout(800);
  const orbOff = await rpc('shell.hotkeyState', {});
  ok('小 logo 能关掉', orbOff.orb === false);

  /* ============ 41b. 快速记录 / 命令面板 ============ */
  await p.evaluate(() => window.__HOST_CMD__ && window.__HOST_CMD__('quick:note'));
  await p.waitForTimeout(700);
  const qp = await p.evaluate(() => ({ open: !!document.querySelector('.qpanel'), input: !!document.querySelector('.qpanel .qinput') }));
  ok('宿主命令能唤起快速记录', qp.open && qp.input);

  const noteTitle = 'e2e 快速笔记 ' + Date.now();
  await p.fill('.qpanel .qinput', noteTitle);
  await p.click('.qpanel .qfoot .btn.primary');
  await p.waitForTimeout(1200);
  const notes = (await rpc('notes.list', { limit: 10 })) || [];
  ok('快速笔记写进备忘录', notes.some((n) => (n.title || '').includes('e2e 快速笔记')), `${notes.length} 条笔记`);

  await p.keyboard.press('Control+k');
  await p.waitForTimeout(600);
  const pal = await p.evaluate(() => ({ open: !!document.querySelector('.qpalette'), rows: document.querySelectorAll('.qrow').length }));
  ok('Ctrl+K 打开命令面板', pal.open && pal.rows >= 10, `${pal.rows} 项`);
  // 用页面名过滤（输「日记」会命中「快速写日记」这个动作，不是跳页，别混在一起测）
  await p.fill('.qsearch input', '日历');
  await p.waitForTimeout(400);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  const afterPal = await p.evaluate(() => document.querySelector('.topbar h2')?.textContent);
  ok('命令面板能跳页', afterPal === '日历', afterPal);
  await p.keyboard.press('Escape');

  /* ============ 34b. 侧栏/模块排序入口（36/37 的界面侧） ============ */
  await go('设置');
  const orderUi = await p.evaluate(() => {
    const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('界面布局'));
    if (g) g.click();
    return true;
  });
  await p.waitForTimeout(600);
  const navEditor = await p.evaluate(() => ({
    rows: document.querySelectorAll('.orderlist .orow').length,
    arrows: document.querySelectorAll('.orderlist .orow button[data-act="down"]').length,
  }));
  ok('导航顺序只在设置里调', orderUi && navEditor.rows >= 10 && navEditor.arrows === navEditor.rows, `${navEditor.rows} 项`);

  console.log('页面错误:', errs.length ? errs.slice(0, 8) : '无');
  const pass = log.filter((l) => l.startsWith('✅')).length;
  console.log(`\n合计 ${pass}/${log.length} 通过`);
  await b.close().catch(() => {});
})().catch((e) => {
  console.log(log.join('\n'));
  console.log('FATAL', e.message);
  process.exit(1);
});
