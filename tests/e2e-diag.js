/* e2e-diag：本轮新增的诊断/日志/AI 网关（只测改动面，不跑全量回归）
 *
 * 覆盖：
 *   1. diag.* 接口存在且返回形状对
 *   2. 前后端日志通道双向通（写进去能读出来）
 *   3. 日志脱敏（密码/答案不能落盘）
 *   4. 设置页的诊断面板真的渲染出来、能读到日志
 *   5. AI 网关能开、能调、能关（HTTP 实测）
 *   6. RpcCatalog 清单与真实分发一致（自检无 WARN）
 */
const { chromium } = require('playwright-core');
const http = require('http');

let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

const get = (port, path, token) => new Promise((res) => {
  const req = http.request(
    { host: '127.0.0.1', port, path, method: 'GET', headers: token ? { 'X-Token': token } : {} },
    (r) => { let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res(JSON.parse(s)); } catch { res({ raw: s }); } }); });
  req.on('error', (e) => res({ err: e.message }));
  req.end();
});

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 63000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (k) => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate((kk) => { const btn = document.querySelector(`.nav button[data-nav="${kk}"]`); if (btn) btn.click(); }, k);
    await p.waitForTimeout(1200);
  };

  const stamp = 'diagtest' + String(Date.now()).slice(-5);
  console.log('\n=== 诊断 / 日志 / AI 网关 ===');

  /* ---------- 1. diag 接口形状 ---------- */
  const ping = await rpc('diag.ping', { msg: 'ping-' + stamp });
  ok('diag.ping 返回 ok', ping && ping.ok === true, JSON.stringify(ping).slice(0, 120));
  ok('diag.ping 带日志目录', !!(ping.data && ping.data.dir), JSON.stringify(ping.data || {}).slice(0, 120));

  const stats = await rpc('diag.stats', {});
  const st = stats.data && stats.data.stats;
  ok('diag.stats 返回统计', !!(st && typeof st.total === 'number'), JSON.stringify(st || {}).slice(0, 160));
  ok('diag.stats 计数结构完整',
    !!(st && ['trace', 'info', 'warn', 'error', 'fatal', 'writeFailures', 'files'].every((k) => k in st)));
  ok('diag.stats 带环境快照', !!(stats.data && /版本=/.test(stats.data.env || '')), (stats.data && stats.data.env || '').slice(0, 100));
  ok('日志目录存在 .log 文件', !!(st && st.files && st.files.length >= 1), JSON.stringify((st && st.files) || []).slice(0, 160));

  /* ---------- 2. 前端 → 宿主 通道 ---------- */
  const rep = await rpc('diag.frontend', { level: 'error', src: 'e2e', msg: 'E2E上报-' + stamp, stack: 'at fake (x.js:1:1)' });
  ok('diag.frontend 接受上报', rep && rep.ok === true);

  const tail = await rpc('diag.logs', { lines: 400 });
  const text = (tail.data && tail.data.text) || '';
  ok('日志里能读回刚才那行', text.includes('E2E上报-' + stamp));
  ok('日志里带堆栈帧', text.includes('at fake (x.js:1:1)'));
  ok('日志行格式正确（时间 级别 作用域 | 正文）',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} (TRC|INF|WRN|ERR|FTL) \S+ \| /m.test(text),
    (text.split('\n').find((l) => l.includes(stamp)) || '').slice(0, 120));

  const act = await rpc('diag.action', { what: 'e2e动作-' + stamp });
  ok('diag.action 记录用户动作', act && act.ok === true);
  const tail2 = (await rpc('diag.logs', { lines: 400 })).data.text || '';
  ok('动作能读回来', tail2.includes('e2e动作-' + stamp));

  /* ---------- 3. 脱敏 ---------- */
  // 方法名和参数只在 Trace 级别才记（Info 下只记耗时和异常），所以先切 Trace。
  // 这个设计是有意的：默认 Info 时日志量能小一个数量级，排障才临时开 Trace。
  await rpc('diag.config', { level: 'Trace' });
  await p.waitForTimeout(200);

  // 定位「这一次」的那行：参数值会被脱敏，没法用唯一标记去 grep，
  // 所以数一下调用前有几行，调用后取第 n+1 行。
  const cntVault = (t) => t.split('\n').filter((l) => l.includes('vault.qa.verify')).length;
  const beforeCnt = cntVault((await rpc('diag.logs', { lines: 800 })).data.text || '');

  await rpc('vault.qa.verify', { q: 'redact-' + stamp, a: 'superanswer999' }).catch(() => null);
  await p.waitForTimeout(500);

  const tail3 = (await rpc('diag.logs', { lines: 800 })).data.text || '';
  const vlines = tail3.split('\n').filter((l) => l.includes('vault.qa.verify'));
  const vline = vlines.length > beforeCnt ? vlines[beforeCnt] : '';

  ok('找到本次的调用记录', vline.length > 0, `before=${beforeCnt} now=${vlines.length}`);
  // vault.* 是「整体脱敏」：键名留下（要知道传了哪几个参数），值全抹 ——
  // 密保问题本身也是隐私（「我第一只宠物叫什么」这种），不该落盘。
  ok('参数键名保留（排障要知道传了什么）', vline.includes('"q"') && vline.includes('"a"'), vline.slice(0, 160));
  ok('RPC 参数日志里密码/答案被抹成 ***', !vline.includes('superanswer999'), '仍能看到答案原文：' + vline.slice(0, 160));
  ok('RPC 参数日志保留了方法名', /vault\.qa\.verify/.test(tail3), 'Trace 下应记下调用方法');

  // 反过来验一次：普通方法（记账账户）不该被整体脱敏，否则排障全瞎
  await rpc('ledger.accounts', {}).catch(() => null);
  await p.waitForTimeout(400);
  const tail4 = (await rpc('diag.logs', { lines: 800 })).data.text || '';
  const accLine = tail4.split('\n').filter((l) => l.includes('ledger.accounts')).pop() || '';
  ok('普通方法参数不被过度脱敏',
    accLine === '' || !/"\*\*\*"/.test(accLine) || accLine.includes('{}'),
    '记账账户的参数不该被抹：' + accLine.slice(0, 160));

  await rpc('diag.config', { level: 'Info' });

  /* ---------- 4. 日志级别可调 ---------- */
  const cfg0 = await rpc('diag.config', {});
  ok('diag.config 读当前配置', !!(cfg0.data && cfg0.data.level), JSON.stringify(cfg0.data || {}).slice(0, 120));
  const cfg1 = await rpc('diag.config', { level: 'Trace' });
  ok('diag.config 能改级别', cfg1.data && cfg1.data.level === 'Trace', JSON.stringify(cfg1.data || {}));
  const cfg2 = await rpc('diag.config', { level: 'Info' });
  ok('diag.config 能改回来', cfg2.data && cfg2.data.level === 'Info');
  const cfg3 = await rpc('diag.config', { keepDays: 7 });
  ok('diag.config 能改保留天数', cfg3.data && cfg3.data.keepDays === 7, JSON.stringify(cfg3.data || {}));
  await rpc('diag.config', { keepDays: 14 });

  /* ---------- 5. 方法清单 ---------- */
  const mk = await rpc('diag.methods', {});
  const ml = mk.data || {};
  ok('diag.methods 返回清单', ml.ok === true && Array.isArray(ml.methods), JSON.stringify(ml).slice(0, 120));
  ok('diag.methods 数量合理（>200）', ml.returned >= 200, 'returned=' + ml.returned);
  ok('diag.methods 标出写操作', Array.isArray(ml.writes) && ml.writes.length > 0, 'writes=' + (ml.writes || []).length);
  ok('diag.methods 带分组', Array.isArray(ml.groups) && ml.groups.length > 3, JSON.stringify(ml.groups || []).slice(0, 160));

  const one = await rpc('diag.method', { name: 'entry.save' });
  const d1 = one.data || {};
  ok('diag.method 查得到方法', d1.ok === true && d1.name === 'entry.save', JSON.stringify(d1).slice(0, 120));
  ok('diag.method 带描述/参数/分组', !!(d1.desc && d1.args !== undefined && d1.group), JSON.stringify(d1).slice(0, 160));
  ok('diag.method 带调用示例', !!d1.callExample, JSON.stringify(d1.callExample || '').slice(0, 120));

  const bogus = await rpc('diag.method', { name: 'no.such.method' });
  ok('diag.method 对不存在的方法给出建议而不是崩',
    !!(bogus.data && (bogus.data.suggest || bogus.data.ok === false)), JSON.stringify(bogus.data || {}).slice(0, 140));

  /* ---------- 6. 界面：设置 → 数据 → 诊断日志 ---------- */
  await go('settings');
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('button,.seg-b,.settings-tab')].find((x) => /数据/.test(x.textContent || ''));
    if (t) t.click();
  });
  await p.waitForTimeout(900);

  const hasCard = await p.evaluate(() => [...document.querySelectorAll('h3')].some((h) => /诊断日志/.test(h.textContent || '')));
  ok('设置页出现「诊断日志」卡片', hasCard);

  const opened = await p.evaluate(() => {
    const d = [...document.querySelectorAll('details')].find((x) => /诊断日志|出问题时/.test(x.textContent || ''));
    if (d) { d.open = true; return true; }
    return false;
  });
  await p.waitForTimeout(1100);
  ok('诊断面板能展开', opened);

  const panel = await p.evaluate(() => {
    const el = document.querySelector('.diag');
    if (!el) return null;
    const pre = el.querySelector('.diag-body');
    const cs = pre ? getComputedStyle(pre) : null;
    return {
      stats: el.querySelectorAll('.diag-stat').length,
      chips: [...el.querySelectorAll('.chip')].map((c) => (c.textContent || '').trim()),
      bodyLen: pre ? (pre.textContent || '').length : 0,
      bodyH: pre ? pre.clientHeight : 0,
      mono: cs ? /mono|Consolas|Cascadia/i.test(cs.fontFamily) : false,
      wrap: cs ? cs.whiteSpace : '',
    };
  });
  ok('统计条渲染（>=4 格）', panel && panel.stats >= 4, JSON.stringify(panel));
  ok('工具条按钮齐全（只看问题/刷新/自检/复制/导出）',
    panel && ['只看问题', '自检', '复制', '导出'].every((k) => panel.chips.some((c) => c.includes(k))),
    JSON.stringify((panel && panel.chips) || []));
  ok('日志正文非空', panel && panel.bodyLen > 100, 'len=' + (panel && panel.bodyLen));
  ok('日志区高度受限（不会撑爆页面）', panel && panel.bodyH > 200 && panel.bodyH < 500, 'h=' + (panel && panel.bodyH));
  ok('日志用等宽字体', panel && panel.mono === true);

  /* 只看问题 筛选 */
  const btnIssue = await p.$('.diag-bar .chip:has-text("只看问题")');
  if (btnIssue) {
    const before = await p.evaluate(() => (document.querySelector('.diag-body') || {}).textContent || '');
    await btnIssue.click();
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => (document.querySelector('.diag-body') || {}).textContent || '');
    ok('「只看问题」改变了内容', before.length !== after.length || before !== after);
    ok('「只看问题」滤掉了 INF 行', !/ INF /.test(after) || after.length < before.length, 'after含INF=' + / INF /.test(after));
    await btnIssue.click();
    await p.waitForTimeout(500);
  } else { ok('「只看问题」按钮可点', false); }

  /* 自检按钮：应写入一条新日志 */
  const beforePing = (await rpc('diag.logs', { lines: 200 })).data.text || '';
  const btnPing = await p.$('.diag-bar .chip:has-text("自检")');
  if (btnPing) {
    await btnPing.click();
    await p.waitForTimeout(1200);
    const afterPing = (await rpc('diag.logs', { lines: 200 })).data.text || '';
    ok('「自检」写入了新日志', afterPing.includes('这是一条测试日志') && afterPing !== beforePing);
  } else { ok('「自检」按钮可点', false); }

  /* ---------- 7. AI 网关 ---------- */
  const apiOn = await rpc('diag.api', { on: '1' });
  const dOn = apiOn.data || {};
  ok('网关能开启', dOn.ok === true && dOn.running === true, JSON.stringify(dOn).slice(0, 160));
  ok('网关拿到端口', typeof dOn.port === 'number' && dOn.port > 0, 'port=' + dOn.port);
  ok('网关生成 token', typeof dOn.token === 'string' && dOn.token.length >= 20, 'len=' + (dOn.token || '').length);
  ok('网关给了说明书路径', /debug-api\.json$/.test(dOn.info || ''), dOn.info || '');

  if (dOn.running && dOn.port) {
    const h = await get(dOn.port, '/health');
    ok('/health 免 token 可访问', h.ok === true && h.app === '日签', JSON.stringify(h).slice(0, 140));

    const noTok = await get(dOn.port, '/methods');
    ok('/methods 不带 token 被拒（401）', noTok.ok === false || noTok.raw !== undefined, JSON.stringify(noTok).slice(0, 120));

    const withTok = await get(dOn.port, '/methods', dOn.token);
    ok('/methods 带 token 能拿到清单', withTok.ok === true && withTok.catalogued >= 200, JSON.stringify(withTok).slice(0, 140));

    const logs = await get(dOn.port, '/logs?lines=50', dOn.token);
    ok('/logs 能读到日志', logs.ok === true && typeof logs.text === 'string', JSON.stringify(logs).slice(0, 120));

    const stt = await get(dOn.port, '/stats', dOn.token);
    ok('/stats 返回统计', stt.ok === true && !!(stt.stats && stt.stats.dir), JSON.stringify(stt).slice(0, 120));

    const badTok = await get(dOn.port, '/methods', 'wrongtoken');
    ok('错误 token 被拒', badTok.ok !== true, JSON.stringify(badTok).slice(0, 120));
  }

  const apiOff = await rpc('diag.api', { on: '0' });
  const dOff = apiOff.data || {};
  ok('网关能关闭', dOff.ok === true && dOff.running === false, JSON.stringify(dOff).slice(0, 140));
  if (dOff.port) {
    const dead = await get(dOff.port, '/health');
    ok('关闭后端口不再响应', !!dead.err, JSON.stringify(dead).slice(0, 100));
  }

  /* ---------- 8. 页面无报错 ---------- */
  ok('全程无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(`\n通过 ${pass}，失败 ${fails.length}`);
  if (fails.length) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exitCode = 1; }
  await b.close().catch(() => {});
})();