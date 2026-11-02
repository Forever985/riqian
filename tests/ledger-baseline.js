/*
 * ledger-baseline.js —— 账本草稿结构快照（重构前后对比用）
 *
 * 思路：把账本页在若干种「状态组合」下渲染出来的 DOM 摘成结构化字符串，
 * 写到 tests/shots/ledger-<阶段>.json。重构后再跑一次，逐字对比。
 *
 * 只读：不新增、不修改、不删除任何账目。只在 UI 上点筛选/排序/展开图表。
 *
 * 用法：
 *   CDP_PORT=57060 node ledger-baseline.js before
 *   CDP_PORT=57060 node ledger-baseline.js after
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const stage = process.argv[2] || 'before';
const outDir = path.join(__dirname, 'shots');
fs.mkdirSync(outDir, { recursive: true });

/** 把一屏账本摘成「可逐字比对」的结构 */
async function snapshot(p) {
  return p.evaluate(() => {
    const txt = (el) => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '');
    const pick = (sel, n = 12) => [...document.querySelectorAll(sel)].slice(0, n).map(txt);

    const root = document.querySelector('.ledger') || document.querySelector('.wrap');
    if (!root) return { err: 'no .ledger / .wrap' };

    // 数字类信息单独摘：合计、余额、总资产、预算
    const nums = [...root.querySelectorAll('*')]
      .filter((e) => e.children.length === 0)
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => /[¥￥$]\s?-?[\d,]+(\.\d+)?/.test(t))
      .slice(0, 40);

    return {
      cls: root.className,
      heading: pick('h1,h2,h3,.card-h,.lg-title', 8),
      cards: document.querySelectorAll('.card').length,
      inputCount: root.querySelectorAll('input').length,
      btnCount: root.querySelectorAll('button').length,
      btnLabels: pick('button', 30),
      rows: document.querySelectorAll('.lg-row,.ledger-row').length,
      nums,
      summary: txt(root).slice(0, 700),
      charts: document.querySelectorAll('canvas').length,
      svgs: root.querySelectorAll('svg').length,
      errors: [...document.querySelectorAll('.err,.warn-box')].map(txt).slice(0, 5),
    };
  });
}

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57060'));
  const p = b.contexts()[0].pages()[0];
  await p.waitForTimeout(1800);

  // 清掉可能残留的弹层
  if (await p.evaluate(() => document.querySelectorAll('.mask').length)) {
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2000);
  }

  await p.click('.nav button[data-nav="ledger"]');
  await p.waitForTimeout(2000);

  const states = {};

  states['默认'] = await snapshot(p);

  // 切「只看收入 / 只看支出」
  for (const [key, label] of [['in', '收入'], ['out', '支出']]) {
    const hit = await p.evaluate((t) => {
      const btn = [...document.querySelectorAll('button,.seg-item,.tab')]
        .find((x) => (x.textContent || '').trim() === t);
      if (btn) { btn.click(); return true; }
      return false;
    }, label);
    await p.waitForTimeout(900);
    states['筛选-' + label + (hit ? '' : '(未找到)')] = await snapshot(p);
    // 切回全部
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button,.seg-item,.tab')]
        .find((x) => (x.textContent || '').trim() === '全部');
      if (btn) btn.click();
    });
    await p.waitForTimeout(700);
  }

  // 排序：按金额
  const sortHit = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button,.seg-item,.tab')]
      .find((x) => /按金额|金额/.test((x.textContent || '').trim()) && (x.textContent || '').length < 8);
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(900);
  states['排序-按金额' + (sortHit ? '' : '(未找到)')] = await snapshot(p);

  // 切回按日期
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button,.seg-item,.tab')]
      .find((x) => /按日期|日期/.test((x.textContent || '').trim()) && (x.textContent || '').length < 8);
    if (btn) btn.click();
  });
  await p.waitForTimeout(700);

  // 展开更多图表
  const moreHit = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /更多|展开/.test(x.textContent || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(1200);
  states['图表展开' + (moreHit ? '' : '(未找到)')] = await snapshot(p);

  // 打开「记一笔」相关面板（账户 / 预算 / 周期账单），只看能不能打开
  for (const label of ['账户', '预算', '周期']) {
    const hit = await p.evaluate((t) => {
      const btn = [...document.querySelectorAll('button')]
        .find((x) => (x.textContent || '').trim().includes(t) && (x.textContent || '').length < 12);
      if (btn) { btn.click(); return true; }
      return false;
    }, label);
    await p.waitForTimeout(1000);
    states['面板-' + label + (hit ? '' : '(未找到)')] = await snapshot(p);
    // 关掉：找取消/关闭
    const closed = await p.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => /取消|关闭/.test((x.textContent || '').trim()));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!closed) {
      // 没关掉就按 Esc
      await p.keyboard.press('Escape');
    }
    await p.waitForTimeout(700);
  }

  const file = path.join(outDir, `ledger-${stage}.json`);
  fs.writeFileSync(file, JSON.stringify(states, null, 1), 'utf8');
  console.log(`已写入 ${file}`);
  console.log('状态数:', Object.keys(states).length, '→', Object.keys(states).join(' | '));

  // 顺带报一下有多少行账目，确保两次跑的是同一份数据
  const meta = await p.evaluate(() => ({
    cards: document.querySelectorAll('.card').length,
    txtLen: (document.querySelector('.wrap') || {}).innerText
      ? document.querySelector('.wrap').innerText.replace(/\s+/g, '').length : 0,
  }));
  console.log('页面基线:', JSON.stringify(meta));

  await b.close();
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });