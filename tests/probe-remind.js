/**
 * 打卡提醒探针（第 98 条）。
 *
 * 关键前提：habit.remindCheck 是**只读**的（不消耗额度），
 * 所以验「最多 5 次」不能靠在循环里狂调 —— 那样永远都是第 1 次。
 * 正确做法是直接写 meta 里的计数器，模拟"已经响过 N 次"。
 */
const { chromium } = require('playwright-core');

let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fails.push(name); console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57011'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(20000);

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 76000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);
  const call = async (m, a) => (await rpc(m, a)).data;
  const setMeta = (k, v) => call('setting.set', { k, v: String(v) });

  const boot = await call('bootstrap', {});
  const s0 = boot.settings || {};
  const orig = {
    habitRemindOn: s0.habitRemindOn, habitRemindAt: s0.habitRemindAt,
    habitRemindLead: s0.habitRemindLead, habitRemindEvery: s0.habitRemindEvery,
    habitRemindHow: s0.habitRemindHow,
  };

  const clear = async () => {
    await setMeta('habitRemindLast', '');
    await setMeta('habitRemindAt2', '');
    await setMeta('habitRemindN', '0');
  };
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  /* 先确认有习惯可打 —— 没有习惯的话 pending=0，永远不会响 */
  const habits = await call('habits.list', {});
  console.log('习惯数:', (habits || []).length);
  if (!(habits || []).length) {
    console.log('（没有习惯，无法验提醒 —— 先建一个）');
    await call('habit.add', { name: '探针习惯', type: 'check', goal: 1, unit: '', color: '' });
  }

  const pv0 = await call('habit.remindPreview', {});
  console.log('待打卡项:', pv0.count, JSON.stringify(pv0.names));

  await setMeta('habitRemindOn', '1');
  await setMeta('habitRemindEvery', '0');
  await setMeta('habitRemindHow', 'sound');
  await clear();

  /* ---------- ① 提前量 ----------
     对照实验要用「当前时间」当基准，不能写死 23:59 ——
     早上 10 点跑的话，23:59−4h=19:59 还没到，本来就不该响，
     那样测出来永远是 false，看着像功能坏了，其实是探针的假设错了。
     做法：设定时刻取「现在 +30 分钟」，
       lead=0   → 到点时刻在未来，不该响
       lead=60  → 到点时刻 = 现在−30 分钟，已经过了，该响 */
  const later = new Date(Date.now() + 30 * 60 * 1000);
  const atHHMM = pad(later.getHours()) + ':' + pad(later.getMinutes());
  console.log('现在 ' + new Date().toTimeString().slice(0,5) + '，设定时刻 ' + atHHMM);
  await setMeta('habitRemindAt', atHHMM);
  await setMeta('habitRemindLead', '0');
  const noLead = await call('habit.remindCheck', {});
  await setMeta('habitRemindLead', '60');
  const withLead = await call('habit.remindCheck', {});
  console.log('无提前量:', JSON.stringify(noLead));
  console.log('有提前量:', JSON.stringify(withLead));
  ok('无提前量时 23:59 还没到点', noLead.fire === false, JSON.stringify(noLead));
  ok('提前 240 分钟后到点该响', withLead.fire === true, JSON.stringify(withLead));
  ok('返回第几次', withLead.nth === 1, 'nth=' + withLead.nth);
  ok('every=0 时上限为 1', withLead.max === 1, 'max=' + withLead.max);
  ok('带回提醒方式', withLead.how === 'sound', 'how=' + withLead.how);

  /* ---------- ② 次数用完后不再响 ---------- */
  await setMeta('habitRemindEvery', '5');
  await setMeta('habitRemindLast', todayKey);
  await setMeta('habitRemindN', '5');
  const exhausted = await call('habit.remindCheck', {});
  ok('已经响 5 次后不再响', exhausted.fire === false, JSON.stringify(exhausted));

  const pvEx = await call('habit.remindPreview', {});
  ok('预览如实说已用满', pvEx.todayTimes === 5 && pvEx.maxTimes === 5,
    'todayTimes=' + pvEx.todayTimes + ' maxTimes=' + pvEx.maxTimes);
  ok('预览给出不响的理由', /5 次/.test(pvEx.why || ''), pvEx.why || '(空)');

  /* ---------- ③ 间隔未到不响 ---------- */
  await setMeta('habitRemindN', '1');
  const nowTs = `${todayKey}T${pad(today.getHours())}:${pad(today.getMinutes())}:${pad(today.getSeconds())}`;
  await setMeta('habitRemindAt2', nowTs);
  const tooSoon = await call('habit.remindCheck', {});
  ok('刚响过 1 分钟、间隔 5 分钟时不响', tooSoon.fire === false, JSON.stringify(tooSoon));

  /* 把上次时刻推到 6 分钟前，就该响了 */
  const d6 = new Date(Date.now() - 6 * 60 * 1000);
  await setMeta('habitRemindAt2',
    `${todayKey}T${pad(d6.getHours())}:${pad(d6.getMinutes())}:${pad(d6.getSeconds())}`);
  const afterGap = await call('habit.remindCheck', {});
  ok('过了 6 分钟后该响', afterGap.fire === true, JSON.stringify(afterGap));
  ok('这是第 2 次', afterGap.nth === 2, 'nth=' + afterGap.nth);

  /* ---------- ④ 提前量把到点时刻算对了 ---------- */
  const pv = await call('habit.remindPreview', {});
  console.log('预览:', JSON.stringify({ lead: pv.lead, every: pv.every, fireAt: pv.fireAt, maxTimes: pv.maxTimes }));
  /* 响铃时刻表 = (设定时刻 − lead) 起步，每 every 分钟一次，共 5 次 */
  const startMin = later.getHours() * 60 + later.getMinutes() - 60;
  const hhmm = (m) => pad(Math.floor(((m % 1440) + 1440) % 1440 / 60)) + ':' + pad(((m % 60) + 60) % 60);
  ok('响铃时刻表从「设定时刻 − 提前量」起步、每 5 分钟一次、共 5 次',
    pv.fireAt[0] === hhmm(startMin) && pv.fireAt[1] === hhmm(startMin + 5) && pv.fireAt.length === 5,
    JSON.stringify(pv.fireAt) + ' 期望起点 ' + hhmm(startMin));

  /* ---------- 恢复现场 ---------- */
  await clear();
  await setMeta('habitRemindEvery', '0');
  await setMeta('habitRemindLead', '0');
  for (const k of Object.keys(orig)) {
    if (orig[k] !== undefined) await setMeta(k, orig[k]);
  }
  console.log('已恢复原设置:', JSON.stringify(orig));

  console.log('\n通过 ' + pass + ' / 失败 ' + fails.length);
  if (fails.length) console.log('失败项: ' + fails.join(' | '));
  await b.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
