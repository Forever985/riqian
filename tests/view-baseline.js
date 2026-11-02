/*
 * view-baseline.js —— 笔记 / 待办两个页面的结构快照（重构前后逐字对比）
 *
 * 为什么用它：重构的要求是「行为完全不变」。肉眼看不出「少了一个 style、
 * 缩进差 2px、按钮顺序换了」，而这些都是用户能感觉到的回归。
 * 所以把每个状态下的 DOM 摘成一段确定性文本，前后各跑一次，逐字比。
 *
 * 摘什么（踩过的坑）：
 *   - **内联 style 必须摘**。笔记本缩进 paddingLeft、色点 background、优先级色条
 *     全是行内算出来的，只比 class 会漏掉它们。
 *   - **data-* 属性必须摘**。拖动手柄靠 data-dragkey / data-act 定位，
 *     探针和用户都靠它。
 *   - **文本按 DOM 顺序拼**，不用 innerText —— innerText 受 CSS 影响（display:none
 *     会被吞掉），同一份 DOM 换个布局就可能不同，反而掩盖真实差异。
 *
 * 关键纪律：**每个状态前先 reload**。
 * 上一轮做账本 A/B 时两次采样之间数据被别的探针改了，报了 32 处假差异。
 * reload 保证每个状态都从同一份初始 state 出发（React 状态、localStorage 都不残留）。
 *
 * 只读：只点导航、排序、视图切换，绝不新建/删除/编辑。
 *
 * 用法：
 *   CDP_PORT=57060 node view-baseline.js before
 *   CDP_PORT=57060 node view-baseline.js after
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const stage = process.argv[2] || 'before';
const outDir = path.join(__dirname, 'shots');
fs.mkdirSync(outDir, { recursive: true });

/**
 * 把一棵 DOM 子树摘成确定性文本。
 *
 * 每行形如：
 *   div.todo-row.dragging[data-dragkey=abc][style=opacity:0.5] "已完成 3"
 * 文本只取**直接子文本节点**，避免同一句话在每个祖先上重复出现。
 */
function domSig() {
  const MAX = 2600;                 // 任一路径的节点上限，防止爆炸
  const out = [];
  const root = document.querySelector('#root') || document.body;
  if (!root) return ['<no root>'];

  const walk = (el, depth) => {
    if (out.length >= MAX) return;
    if (!(el instanceof Element)) return;

    // 跳过纯装饰 / 不可见结构的噪声：svg 内部细节太多，只记一层
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;

    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).sort().join('.');
    const attrs = [];
    for (const a of ['data-dragkey', 'data-act', 'data-nav', 'data-sort', 'data-acc', 'title',
      'draggable', 'disabled', 'placeholder', 'type', 'value']) {
      const v = el.getAttribute(a);
      if (v !== null && v !== '') attrs.push(`${a}=${v}`);
    }
    /*
     * style 只留「影响视觉或布局」的属性。React 有时会写 transform（FLIP 动画残留），
     * 它是时间相关的，必须剔掉 —— 否则每次跑都不同，diff 全是噪声。
     */
    const raw = el.getAttribute('style') || '';
    if (raw) {
      const keep = raw.split(';').map((s) => s.trim()).filter(Boolean)
        .filter((s) => !/^transform|^transition|^--railw/.test(s));
      if (keep.length) attrs.push('style=' + keep.join(';'));
    }
    // 输入框的当前值也算状态
    if (el instanceof HTMLInputElement && el.type !== 'password') {
      if (el.value) attrs.push(`v=${el.value}`);
    }

    // 直接子文本
    let own = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) own += (n.nodeValue || '');
    }
    own = own.replace(/\s+/g, ' ').trim();

    out.push('  '.repeat(Math.min(depth, 30)) + tag + (cls ? '.' + cls : '')
      + (attrs.length ? '[' + attrs.join('][') + ']' : '')
      + (own ? ` "${own}"` : ''));

    if (tag === 'svg') return;      // svg 内部不展开
    for (const c of el.children) walk(c, depth + 1);
  };

  walk(root, 0);
  if (out.length >= MAX) out.push(`<truncated at ${MAX}>`);
  return out;
}

/** 切到某个页面并等它画完 */
async function gotoView(p, nav) {
  await p.evaluate(() => { document.querySelectorAll('.mask').forEach(() => {}); });
  const ok = await p.evaluate((k) => {
    const b = document.querySelector(`.nav button[data-nav="${k}"]`);
    if (!b) return false;
    b.click();
    return true;
  }, nav);
  await p.waitForTimeout(1400);
  return ok;
}

/** reload 到干净状态，再切到指定视图 */
async function fresh(p, nav) {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);
  return gotoView(p, nav);
}

/** 点一个按钮（按精确文字），返回是否点到 */
async function clickText(p, sel, text) {
  const r = await p.evaluate(([s, t]) => {
    const btn = [...document.querySelectorAll(s)]
      .find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim() === t);
    if (!btn) return false;
    btn.click();
    return true;
  }, [sel, text]);
  await p.waitForTimeout(900);
  return r;
}

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.CDP_PORT || '57060'));
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(20000);

  /*
   * 视口必须固定。上一轮 verify-note-layout 就是被窗口高度坑了：
   * 不同高度下 .notes 列高不同，等比出来的像素值也不一样。
   * 这里统一 1400×1000，前后两次同一个尺子量。
   */
  const client = await p.context().newCDPSession(p);
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  await p.waitForTimeout(600);

  // 专注写会改布局，强制退出，保证测的是常规三栏
  await p.evaluate(() => { try { localStorage.setItem('noteZen', '0'); } catch { } });

  const states = {};
  const snap = async (p, key) => {
    states[key] = await p.evaluate(domSig);
    return states[key].length;
  };

  /* ================= 待办 ================= */
  console.log('\n=== 待办 ===');

  for (const [key, label] of [
    ['todos-全部', '全部'],
    ['todos-今天', '今天'],
    ['todos-收集箱', '收集箱'],
    ['todos-四象限', '四象限'],
    ['todos-已放弃', '已放弃'],
    ['todos-回收站', '回收站'],
  ]) {
    const ok = await fresh(p, 'todos');
    if (!ok) { console.log('  ✗ 切不到 todos'); break; }
    // 左栏按钮用 rail-item
    const hit = await p.evaluate((t) => {
      const btn = [...document.querySelectorAll('.rail .rail-item')]
        .find((x) => (x.querySelector('.nm') || {}).textContent === t);
      if (!btn) return false;
      btn.click();
      return true;
    }, label);
    await p.waitForTimeout(1000);
    const n = await snap(p, key + (hit ? '' : '(未找到)'));
    console.log(`  ${key} 节点 ${n}${hit ? '' : ' ← 按钮没找到'}`);
  }

  // 单清单视图 + 排序方式三种都过一遍
  for (const sortLabel of ['手动', '优先级', '截止日期']) {
    await fresh(p, 'todos');
    // 先点某个清单
    const listHit = await p.evaluate(() => {
      const btn = [...document.querySelectorAll('.rail .rail-item')]
        .find((x) => /ABTEST-清单甲/.test((x.querySelector('.nm') || {}).textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await p.waitForTimeout(900);
    const sh = await clickText(p, '.todo-sortseg .seg-b', sortLabel);
    await p.waitForTimeout(900);
    const n = await snap(p, `todos-清单甲-排序-${sortLabel}${sh ? '' : '(未找到)'}`);
    console.log(`  todos-清单甲-排序-${sortLabel} 节点 ${n}${listHit ? '' : ' ← 清单没找到'}`);
  }

  // 搜索命中
  await fresh(p, 'todos');
  await p.evaluate(() => {
    const inp = document.querySelector('.sb-top input');
    if (!inp) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'ABTEST');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(1100);
  console.log('  todos-搜索 节点', await snap(p, 'todos-搜索'));

  // 右键菜单（第 235 条）—— 这是重构重点之一，必须单独快照
  await fresh(p, 'todos');
  const ctxOK = await p.evaluate(() => {
    const row = document.querySelector('.todo-row');
    if (!row) return false;
    const r = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 8,
    }));
    return true;
  });
  await p.waitForTimeout(800);
  // 只摘菜单本身，别把整页都算进来
  states['todos-右键菜单'] = await p.evaluate(() => {
    const m = document.querySelector('.ctxmenu, .rowmenu, .menu');
    if (!m) return ['<no menu>'];
    return [...m.querySelectorAll('*')].map((el) =>
      el.tagName.toLowerCase()
      + (el.getAttribute('class') ? '.' + el.getAttribute('class').trim().split(/\s+/).sort().join('.') : '')
      + ' "' + (el.childNodes.length === 1 && el.firstChild && el.firstChild.nodeType === 3
        ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '') + '"');
  });
  console.log('  todos-右键菜单 项', states['todos-右键菜单'].length, ctxOK ? '' : ' ← 没找到行');

  /* ================= 笔记 ================= */
  console.log('\n=== 笔记 ===');

  for (const [key, sortLabel] of [
    ['notes-更新时间', '更新时间'],
    ['notes-创建时间', '创建时间'],
    ['notes-名称', '名称'],
    ['notes-篇幅', '篇幅'],
    ['notes-手动', '手动'],
  ]) {
    const ok = await fresh(p, 'notes');
    if (!ok) { console.log('  ✗ 切不到 notes'); break; }
    const hit = await clickText(p, '.sortbar button, .seg-b', sortLabel);
    await p.waitForTimeout(1000);
    const n = await snap(p, key + (hit ? '' : '(未找到)'));
    console.log(`  ${key} 节点 ${n}${hit ? '' : ' ← 排序按钮没找到'}`);
  }

  // 按笔记本筛选（含深层笔记本）
  for (const bk of ['ABTEST-工作', 'ABTEST-工作/项目A', 'ABTEST-生活']) {
    await fresh(p, 'notes');
    const hit = await p.evaluate((name) => {
      const btn = [...document.querySelectorAll('.nbooks .nbook')]
        .find((x) => (x.textContent || '').includes(name));
      if (!btn) return false;
      btn.click();
      return true;
    }, bk);
    await p.waitForTimeout(1000);
    const n = await snap(p, 'notes-笔记本-' + bk.replace('ABTEST-', '') + (hit ? '' : '(未找到)'));
    console.log(`  notes-笔记本-${bk} 节点 ${n}${hit ? '' : ' ← 没找到'}`);
  }

  // 选中一篇笔记（编辑器内容）
  await fresh(p, 'notes');
  const noteHit = await p.evaluate(() => {
    const r = document.querySelector('.nrow');
    if (!r) return false;
    r.click();
    return true;
  });
  await p.waitForTimeout(1800);
  console.log('  notes-编辑器 节点', await snap(p, 'notes-编辑器'), noteHit ? '' : ' ← 没有可点的行');

  // 标签筛选
  await fresh(p, 'notes');
  const tagHit = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.nlist .chip')].find((x) => /标签甲/.test(x.textContent || ''));
    if (!c) return false;
    c.click();
    return true;
  });
  await p.waitForTimeout(1000);
  console.log('  notes-标签筛选 节点', await snap(p, 'notes-标签筛选'), tagHit ? '' : ' ← 标签没找到');

  // 行的「⋯」就地菜单（第 128/230 条，重构时最容易碰坏的地方）
  await fresh(p, 'notes');
  const dotHit = await p.evaluate(() => {
    const b = document.querySelector('.nrow .nbookmenu');
    if (!b) return false;
    b.click();
    return true;
  });
  await p.waitForTimeout(900);
  console.log('  notes-行菜单 节点', await snap(p, 'notes-行菜单'), dotHit ? '' : ' ← ⋯ 没找到');

  // 色点面板
  await fresh(p, 'notes');
  const markHit = await p.evaluate(() => {
    /*
     * NoteDot 渲染的是**没有 class** 的 span（内联样式画圆），
     * 所以只能靠结构定位：.nrow-h 里的第一个 span，且带 cursor:pointer。
     * 写成 .notedot / .ndot 会永远返回 false —— 那不是「功能坏了」，
     * 是选择器错了。这种错最容易让人误判成回归。
     */
    const row = document.querySelector('.nrow .nrow-h');
    if (!row) return false;
    const d = [...row.querySelectorAll('span')]
      .find((s) => s.style.cursor === 'pointer' && s.style.borderRadius === '50%');
    if (!d) return false;
    d.click();
    return true;
  });
  await p.waitForTimeout(900);
  console.log('  notes-色点面板 节点', await snap(p, 'notes-色点面板'), markHit ? '' : ' ← 色点没找到');

  /* ================= 落盘 ================= */
  const file = path.join(outDir, `view-${stage}.json`);
  fs.writeFileSync(file, JSON.stringify(states, null, 1), 'utf8');
  console.log('\n已写入', file);
  console.log('状态数', Object.keys(states).length);
  for (const k of Object.keys(states)) console.log('  -', k, states[k].length, '行');

  await b.close();
})().catch((e) => { console.error('探针崩了:', e); process.exit(2); });