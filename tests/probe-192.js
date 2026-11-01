// #192 现场实测：验证「每月最后一个周四」能被识别、能落库、后端推进的日子是周四。
//
// 两件事不能用 P.eval 做：
//   1. 里面 await RPC —— P.eval 走 page.evaluate，返回 Promise 时它不等，直接当同步值，
//      表现是「8 秒超时 + 页面被挂起」。这里改用 P.page.evaluate。
//   2. 识别提示要精确定位，不能用「含每月/每年的文本」——那样会抓到 placeholder 说明。
const { run } = require('./_probe.js');

// 智能输入框没写 type 属性（e.type 只是 DOM 默认值），所以不能写 input[type=text]
const SMART = /例如|每月|每年/;

run(async (P) => {
  P.say('进倒计时页');
  if (!(await P.go('countdown'))) return;
  await P.sleep(700);

  const found = await P.eval((src) => {
    const re = new RegExp(src);
    const inp = [...document.querySelectorAll('#view-root input')].find((e) => re.test(e.placeholder || ''));
    return { has: !!inp, ph: inp ? inp.placeholder.slice(0, 24) : '' };
  }, SMART.source, '找智能输入框');
  P.out(found);
  if (!found || !found.has) { console.log('  ✗ 没找到智能输入框（页面结构变了？）'); process.exitCode = 1; return; }

  /* ---------- ① 识别提示 ---------- */
  async function typeSmart(text, wantHint = true) {
    return P.eval(({ src, text, wantHint }) => {
      const re = new RegExp(src);
      const inp = [...document.querySelectorAll('#view-root input')].find((e) => re.test(e.placeholder || ''));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, text);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise((res) => setTimeout(() => {
        if (!wantHint) { res({ hint: '' }); return; }
        /*
         * 识别结果挂在 `.chip.on` 上（Countdown.tsx 第 131 行：{smart.hint ? <span className="chip on">…}）。
         * 千万别按「含每月/每年的文本」去扫——卡片标题里那句
         * 「可以直接说「每年3月6日 妈妈生日」」也是这个形状，
         * 抓到它就会显示「识别成功」，实际什么都没识别。
         */
        const chip = document.querySelector('#view-root .chip.on');
        res({
          hint: chip ? (chip.textContent || '').trim() : '',
          hasChip: !!chip,
        });
      }, 340));
    }, { src: SMART.source, text, wantHint }, `输入「${text}」`);
  }

  P.say('识别提示（新规则）');
  for (const t of ['每月最后一个周四 交房租', '每月第2个周二 复盘', '每月最后一天 交水电']) {
    const r = await typeSmart(t);
    console.log(`  「${t}」→ ${r.hint || '(未识别)'}`);
  }

  /* ---------- ② 走真实 RPC，让后端算 nextDate ---------- */
  P.say('RPC：加一条 monthly-weekday:-1:4，读回 days / nextDate');
  const rpc = await P.page.evaluate(async () => {
    const call = (m, a) => new Promise((res) => {
      const id = Math.floor(Math.random() * 1e9);
      const h = (ev) => {
        const d = ev.data;
        if (d && d.id === id) { window.chrome.webview.removeEventListener('message', h); res(d); }
      };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m, a });
      setTimeout(() => { window.chrome.webview.removeEventListener('message', h); res({ timeout: true }); }, 6000);
    });

    const title = '__t192__' + Date.now();
    const add = await call('cd.add', { title, date: '2026-11-26', repeat: 'monthly-weekday:-1:4', color: '', note: '' });
    const list = await call('cd.list', {});
    const mine = (list.data || []).find((x) => x.title === title);
    if (mine) await call('cd.remove', { id: mine.id });
    return { ok: add && add.ok, nextDate: mine ? mine.nextDate : null, days: mine ? mine.days : null, repeat: mine ? mine.repeat : null };
  });

  console.log(`  后端 nextDate = ${rpc.nextDate}，days = ${rpc.days}，repeat 存的是 ${JSON.stringify(rpc.repeat)}`);
  const d = rpc.nextDate ? new Date(rpc.nextDate + 'T00:00:00') : null;
  const isThu = !!d && d.getDay() === 4;
  console.log(isThu ? '  ✓ 是周四' : '  ✗ 不是周四');

  P.say('再验「第 2 个周二」——参数必须真的被用上，不能固定返回最后一个周四');
  const rpc2 = await P.page.evaluate(async () => {
    const call = (m, a) => new Promise((res) => {
      const id = Math.floor(Math.random() * 1e9);
      const h = (ev) => {
        const dd = ev.data;
        if (dd && dd.id === id) { window.chrome.webview.removeEventListener('message', h); res(dd); }
      };
      window.chrome.webview.addEventListener('message', h);
      window.chrome.webview.postMessage({ id, m, a });
      setTimeout(() => { window.chrome.webview.removeEventListener('message', h); res({ timeout: true }); }, 6000);
    });
    const title = '__t192b__' + Date.now();
    await call('cd.add', { title, date: '2026-11-10', repeat: 'monthly-weekday:2:2', color: '', note: '' });
    const list = await call('cd.list', {});
    const mine = (list.data || []).find((x) => x.title === title);
    if (mine) await call('cd.remove', { id: mine.id });
    return { nextDate: mine ? mine.nextDate : null };
  });
  const d2 = rpc2.nextDate ? new Date(rpc2.nextDate + 'T00:00:00') : null;
  console.log(`  第2个周二 → ${rpc2.nextDate}，是周二=${!!d2 && d2.getDay() === 2}`);
  const distinct = !!(d2 && rpc.nextDate && rpc.nextDate !== rpc2.nextDate);

  await typeSmart('', false);

  const allOk = isThu && !!d2 && d2.getDay() === 2 && distinct;
  console.log(allOk
    ? '\n✓ PASS：识别 + 后端推进都对，且两条规则算出不同日子'
    : '\n✗ FAIL');
  if (!allOk) process.exitCode = 1;
});