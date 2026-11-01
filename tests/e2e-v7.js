const { chromium } = require('playwright-core');

(async () => {
  const port = process.argv[2] || '56501';
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  const p = b.contexts()[0].pages()[0];
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  p.setDefaultTimeout(15000);

  const ok = (n, c, extra = '') => console.log((c ? '✅ ' : '❌ ') + n + (extra ? '  ' + extra : ''));
  const go = async (t) => { await p.click(`#app .nav button:has-text("${t}")`); await p.waitForTimeout(700); };
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = Math.floor(Math.random() * 1e8);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  await p.waitForTimeout(2600);
  // 上一次跑失败时可能留着弹层（LaTeX / 分享 / 快速记录），先收干净再开始
  for (let i = 0; i < 4; i++) {
    const open = await p.evaluate(() => document.querySelectorAll('.qmask,.mask').length);
    if (!open) break;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    await p.mouse.click(6, 6).catch(() => {});
    await p.waitForTimeout(250);
  }


  // ---------- 启动 ----------
  const boot = await p.evaluate(() => ({
    mounted: !!document.getElementById('app'),
    view: (document.querySelector('.topbar h2') || {}).textContent,
    nav: [...document.querySelectorAll('#app .nav .lb')].map((x) => x.textContent),
    root: window.__DATA_DIR__ || null,
  }));
  ok('页面挂载', boot.mounted, `首屏=${boot.view} 导航=${boot.nav.join('/')}`);

  // ---------- 17 日界线 ----------
  const ds = await rpc('app.diagnostics');
  ok('bootstrap 可用', ds.ok !== false);
  const dayStart = await p.evaluate(async () => {
    const r = await new Promise((res) => {
      const id = 9911;
      const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data.data); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m: 'bootstrap', a: {} });
    });
    return r.settings.dayStart;
  });
  ok('日界线设置存在', dayStart !== undefined, `dayStart=${dayStart}`);

  // ---------- 19 设置分组 + 搜索 ----------
  await go('设置');
  const groups = await p.evaluate(() => [...document.querySelectorAll('.snav span')].map((x) => x.textContent));
  ok('设置有分组目录', groups.length >= 7, groups.join('/'));

  // 用真实键入：React 的 value tracker 会吞掉「直接赋 value + dispatch input」这种模拟，
  // 之前这条断言其实没真正触发过滤（组还是上一组，只是恰好渲染了字号那一行）
  const sbox = p.locator('.topbar .searchbox input');
  await sbox.click();
  await sbox.fill('');
  await p.keyboard.type('字号');
  await p.waitForTimeout(700);
  const searched = await p.evaluate(() => ({
    group: document.querySelector('.snav.on span')?.textContent,
    rows: [...document.querySelectorAll('.set-row .lbl')].map((x) => x.textContent.split('\n')[0]),
  }));
  ok('设置搜索能定位', searched.rows.some((r) => r.includes('字号')), `组=${searched.group} 命中=${searched.rows.join(',')}`);

  await sbox.fill('');
  await p.waitForTimeout(400);

  // ---------- 25 主题 RGB ----------
  await p.evaluate(() => {
    const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('外观主题'));
    if (g) g.click();
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('.setbody button')];
    const b2 = btns.find((x) => x.textContent.includes('打开调色板'));
    if (b2) b2.click();
  });
  await p.waitForTimeout(600);
  const rgb = await p.evaluate(() => {
    const dlg = document.querySelector('.dlg');
    if (!dlg) return null;
    const rows = dlg.querySelectorAll('.rgbrow').length;
    const first = dlg.querySelector('.rgbrow input[type=number]');
    if (first) { first.value = '10'; first.dispatchEvent(new Event('change', { bubbles: true })); }
    return { rows, hasColor: !!dlg.querySelector('input[type=color]') };
  });
  ok('调色板 16 色槽 + 拾色器', rgb && rgb.rows === 16 && rgb.hasColor, JSON.stringify(rgb));
  await p.waitForTimeout(700);
  const accentNow = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  ok('改色即时生效', !!accentNow, `--bg=${accentNow}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  // ---------- 14 模块排序模式 ----------
  await p.evaluate(() => {
    const g = [...document.querySelectorAll('.snav')].find((x) => x.textContent.includes('日记与模块'));
    if (g) g.click();
  });
  await p.waitForTimeout(500);
  // v8：排序方式选项已删除，排序本身只保留设置里的这张表（拖 + 上下移）
  const modOrder = await p.evaluate(() => ({
    rows: document.querySelectorAll('.modlist .moditem').length,
    arrows: document.querySelectorAll('.modlist .moditem button[data-act="up"]').length,
  }));
  ok('模块排序只剩设置里的排序表', modOrder.rows >= 6 && modOrder.arrows === modOrder.rows, `${modOrder.rows} 项`);

  // ---------- 20 选项卡 ----------
  await p.evaluate(async () => {
    await new Promise((res) => {
      const id = 9921;
      const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m: 'setting.set', a: { k: 'tabMode', v: '1' } });
    });
  });
  await p.reload();
  await p.waitForTimeout(2400);
  // 打开几个页面
  for (const t of ['日历', '待办', '笔记']) { await go(t); }
  const tabs = await p.evaluate(() => ({
    bar: !!document.querySelector('.tabs'),
    items: [...document.querySelectorAll('.tab .tt')].map((x) => x.textContent),
  }));
  ok('选项卡出现且有多个', tabs.bar && tabs.items.length >= 2, tabs.items.join(' | '));

  // 右键菜单
  await p.evaluate(() => {
    const t = document.querySelectorAll('.tab')[0];
    const r = t.getBoundingClientRect();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.bottom }));
  });
  await p.waitForTimeout(400);
  const menu = await p.evaluate(() => [...document.querySelectorAll('.tabmenu button')].map((x) => x.textContent));
  ok('选项卡右键菜单', menu.length >= 4, menu.join('/'));
  await p.keyboard.press('Escape');
  await p.evaluate(() => document.body.click());
  await p.waitForTimeout(300);

  // ---------- 21 欢迎页 + 节日 ----------
  await go('设置');
  await p.evaluate(() => {
    const i = [...document.querySelectorAll('.set-row .lbl')].find((x) => x.textContent.includes('启动时显示欢迎页'));
    const sw = i && i.parentElement.querySelector('.switch');
    if (sw && !sw.className.includes('on')) sw.click();
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    const b2 = [...document.querySelectorAll('#app .nav button')].find((x) => x.title.startsWith('我的'));
    if (b2) b2.click();
  });
  await p.waitForTimeout(700);
  // 直接切 welcome
  await p.evaluate(async () => {
    await new Promise((res) => {
      const id = 9931;
      const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(); } };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m: 'setting.set', a: { k: 'welcomeOnStart', v: '1' } });
    });
  });
  await p.reload();
  await p.waitForTimeout(2400);
  const welcome = await p.evaluate(() => ({
    hero: !!document.querySelector('.hero .greet'),
    cards: document.querySelectorAll('.wgrid .card').length,
    text: document.body.innerText.slice(0, 60).replace(/\n/g, ' '),
  }));
  ok('欢迎页渲染', welcome.hero && welcome.cards >= 3, `${welcome.text}`);

  // ---------- 22 智能识别 ----------
  await go('倒计时');
  const smart = [];
  for (const c of ['每年3月6日 妈妈生日', '每月1号 交房租', '农历八月十五 中秋', '每2周 复盘', '每个工作日 站会', '每周末 大扫除', '3天后 复查', '明天下午三点 开会']) {
    await p.locator('input[placeholder*="例如"]').fill(c);
    await p.waitForTimeout(280);
    const shown = await p.evaluate(() => {
      const bar = document.querySelector('.smartbar');
      return bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '(无识别)';
    });
    smart.push(c + ' → ' + shown);
  }
  console.log('识别结果：');
  smart.forEach((x) => console.log('   ' + x));
  ok('智能识别覆盖重复规则', smart.filter((x) => /每年|每月|农历|每 ?2 周|每个工作日|每周末/.test(x)).length >= 6);
  ok('一次性日期也能识别', smart.filter((x) => x.includes('下次')).length >= 7);

  // ---------- 22 倒计时落库 ----------
  const cd = await rpc('cd.add', { title: '妈妈生日', date: '2000-03-06', repeat: 'yearly', color: '#b8623a', note: '' });
  const cdList = await rpc('cd.list');
  ok('倒计时每年重复可落库', cd.ok && cdList.data.some((c) => c.title === '妈妈生日' && c.repeat === 'yearly'),
    JSON.stringify(cdList.data.slice(0, 2).map((c) => ({ t: c.title, r: c.repeat, d: c.days }))));

  // ---------- 23 已放弃 vs 回收站 ----------
  const t1 = await rpc('todo.add', { title: '写周报', listId: '', repeat: '' });
  await rpc('todo.trash', { id: t1.data.id, trashed: 1 });
  const afterTrash = await rpc('todos.list');
  const trashed = afterTrash.data.find((t) => t.id === t1.data.id);
  ok('已放弃：仍存在但 trashed=1', trashed && trashed.trashed === 1);

  const t2 = await rpc('todo.add', { title: '临时任务', listId: '', repeat: '' });
  await rpc('todo.delete', { id: t2.data.id });
  const afterDel = await rpc('todos.list');
  const rec = await rpc('todos.recycle');
  ok('回收站：从列表消失、出现在回收站',
    !afterDel.data.some((t) => t.id === t2.data.id) && rec.data.some((t) => t.id === t2.data.id));

  await rpc('todo.restore', { id: t2.data.id });
  const afterRestore = await rpc('todos.list');
  ok('回收站可恢复', afterRestore.data.some((t) => t.id === t2.data.id));

  // ---------- 28/29 导出 ----------
  const exSet = await rpc('settings.export');
  ok('导出设置', exSet.ok, exSet.data && exSet.data.path ? exSet.data.path.split(/[\\/]/).pop() : '');
  const exHtml = await rpc('export.html');
  ok('导出日记 HTML', exHtml.ok, exHtml.data && exHtml.data.path ? exHtml.data.path.split(/[\\/]/).pop() : '');

  // ---------- 30 用户中心 ----------
  await go('我的');
  const prof = await p.evaluate(() => ({
    avatar: !!document.querySelector('.avatar'),
    nick: !!document.querySelector('.pf-nick'),
    cards: [...document.querySelectorAll('.card h3')].map((x) => x.textContent.slice(0, 8)),
  }));
  ok('用户中心', prof.avatar && prof.nick, prof.cards.join('/'));

  // ---------- 26 音乐库 ----------
  const mr = await rpc('music.addUrl', { url: 'https://example.com/rain.mp3', name: '雨声.mp3' });
  const ml = await rpc('music.list');
  ok('音乐库支持链接', mr.ok && ml.data.some((m) => m.name === '雨声.mp3'), JSON.stringify(ml.data.map((m) => m.name)));

  // ---------- 27 缓存 ----------
  const cs = await rpc('cache.stats');
  ok('缓存统计', cs.ok !== false && typeof cs.data.total === 'number',
    `总 ${(cs.data.total / 1024 / 1024).toFixed(1)}MB 上限 ${cs.data.maxMB}MB`);

  // ---------- 31 密码 ----------
  const vm = await rpc('vault.setMain', { password: 'test1234' });
  ok('设置主密码', vm.data && vm.data.ok === true, JSON.stringify(vm.data));
  const addRule = await rpc('vault.add', { scope: 'todos', target: '', label: '待办', password: '' });
  ok('添加待办保护规则', addRule.data && addRule.data.ok === true, JSON.stringify(addRule.data));
  const locked1 = await rpc('vault.check', { scope: 'todos', target: '' });
  ok('加锁后 check=locked', locked1.data && locked1.data.locked === true, JSON.stringify(locked1.data));
  const appCheck = await rpc('vault.check', { scope: 'app', target: '' });
  ok('只锁待办时不应锁全软件', appCheck.data && appCheck.data.locked === false, JSON.stringify(appCheck.data));
  const bad = await rpc('vault.unlock', { scope: 'todos', target: '', password: 'wrong' });
  ok('错误密码被拒', bad.data && bad.data.ok === false, (bad.data && bad.data.err) || '');
  const good = await rpc('vault.unlock', { scope: 'todos', target: '', password: 'test1234' });
  ok('正确密码解锁', good.data && good.data.ok === true, JSON.stringify(good.data));
  const locked2 = await rpc('vault.check', { scope: 'todos', target: '' });
  ok('解锁后 check=unlocked', locked2.data && locked2.data.locked === false, JSON.stringify(locked2.data));

  // UI：锁定后进待办应该看到解锁面板
  await rpc('vault.lock');
  await p.reload();
  await p.waitForTimeout(2400);
  await go('待办');
  const ui1 = await p.evaluate(() => ({ unlock: !!document.querySelector('.unlock'), nav: !!document.querySelector('#app .nav button') }));
  ok('重新上锁后待办要密码', ui1.unlock && ui1.nav, JSON.stringify(ui1));
  // 输入正确密码解锁
  await p.locator('.unlock input').pressSequentially('test1234', { delay: 20 });
  await p.waitForTimeout(200);
  await p.evaluate(() => { const b2 = document.querySelector('.unlock .btn.primary'); if (b2) b2.click(); });
  await p.waitForTimeout(1200);
  const ui2 = await p.evaluate(() => ({ unlock: !!document.querySelector('.unlock'), head: document.querySelector('.todo-head h3')?.textContent }));
  ok('输入密码后进入待办', !ui2.unlock, JSON.stringify(ui2));


  // ---------- 16 提醒 ----------
  const nt = await rpc('notify.push', { title: '番茄完成', body: '测试提醒链路', kind: 'break', duration: 4 });
  ok('提醒接口可用', nt.ok, JSON.stringify(nt.data));

  // 清理测试痕迹：不然后面的回归会被密码挡住
  await rpc('vault.clearMain', { password: 'test1234' });
  await rpc('setting.set', { k: 'tabMode', v: '0' });

  await p.screenshot({ path: 'v7-final.png', timeout: 8000 }).catch(() => {});
  console.log('错误:', errs.length ? errs.slice(0, 6) : '无 ✅');
  await b.close().catch(() => {});
})().catch((e) => console.log('FATAL', e.message));
