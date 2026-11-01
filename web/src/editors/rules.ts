/**
 * 输入即格式化的规则表（第 73 条重做）。
 *
 * 用户的要求是「Markdown / BBCode / LaTeX 不应该冲突，应该都能用并且同时生效」。
 * 所以这里不是三套模式，而是一张表：同一次输入里，哪种标记写完就认哪种。
 *
 *   **粗**  *斜*  ~~删~~  `码`  [b]粗[/b]  [i]斜[/i]  [u]下[/u]  [s]删[/s]
 *   [code]码[/code]  [color=#c00]红[/color]  [size=4]大[/size]
 *   $x^2$  [latex]x^2[/latex]   [文字](https://…)
 *   # 标题   - 列表   1. 有序   > 引用
 *
 * 两条纪律：
 * 1. **只认完整的标记**。`**粗` 没闭合就一直是文字，绝不半路动手。
 * 2. **宁可少转，不可转错**。所以 `$…$` 要过 looksLikeTex，`*…*` 要避开 `**`。
 */
import { texNodeHtml } from '../lib/latex';

const span = (html: string): Node => {
  const box = document.createElement('span');
  box.innerHTML = html;
  return box.firstChild || document.createTextNode('');
};

/** 递归解析一段纯文本里的行内标记，返回可直接塞进 DOM 的碎片 */
export function parseInline(src: string, depth = 0): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (!src) return frag;
  if (depth > 3) { frag.appendChild(document.createTextNode(src)); return frag; }

  let rest = src;
  let guard = 0;

  while (rest && guard++ < 200) {
    const hit = firstInline(rest);
    if (!hit) break;
    if (hit.start > 0) frag.appendChild(document.createTextNode(rest.slice(0, hit.start)));
    frag.appendChild(hit.node);
    rest = rest.slice(hit.end);
  }
  if (rest) frag.appendChild(document.createTextNode(rest));
  return frag;
}

/** 用解析结果重建一个元素的子节点（清掉原有的纯文本） */
function fill(el: HTMLElement, text: string) {
  el.textContent = '';
  el.appendChild(parseInline(text, 1));
  return el;
}

/**
 * $…$ 到底是不是公式。
 *
 * 日记里「$5 到 $10」比公式常见得多，所以纯数字、纯金额一律不当公式；
 * 必须带点数学味（运算符、上下标、反斜杠命令、字母夹数字）才认。
 */
function looksLikeTex(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^[\d.,\s]+$/.test(t)) return false;                       // 5 / 1,200 / 3.14
  if (/[$\u4e00-\u9fa5]/.test(t)) return false;                  // 里面有美元号或汉字
  return /\\[a-zA-Z]+/.test(t)                                   // \alpha
    || /[\^_{}=+\-*/<>]/.test(t)                                 // x^2 / a+b / E=mc^2
    || /[a-zA-Z]\s*\\?[a-zA-Z]*\s*\d/.test(t)                    // x2 / a1
    || /\d\s*[a-zA-Z]/.test(t);                                  // 2x
}

interface InlinePat {
  re: RegExp;
  /** m[1] 是内容；返回要插入的节点 */
  build: (m: string[]) => Node | null;
}

const INLINE: InlinePat[] = [
  // —— 符号型 ——
  { re: /\*\*([^\n]{1,600}?)\*\*/, build: (m) => fill(document.createElement('strong'), m[1]) },
  { re: /~~([^\n]{1,600}?)~~/, build: (m) => fill(document.createElement('s'), m[1]) },
  { re: /`([^`\n]{1,400}?)`/, build: (m) => { const c = document.createElement('code'); c.textContent = m[1]; return c; } },

  // —— BBCode ——
  { re: /\[b\]([\s\S]{1,600}?)\[\/b\]/i, build: (m) => fill(document.createElement('strong'), m[1]) },
  { re: /\[i\]([\s\S]{1,600}?)\[\/i\]/i, build: (m) => fill(document.createElement('em'), m[1]) },
  { re: /\[u\]([\s\S]{1,600}?)\[\/u\]/i, build: (m) => fill(document.createElement('u'), m[1]) },
  { re: /\[s\]([\s\S]{1,600}?)\[\/s\]/i, build: (m) => fill(document.createElement('s'), m[1]) },
  { re: /\[code\]([\s\S]{1,600}?)\[\/code\]/i, build: (m) => { const c = document.createElement('code'); c.textContent = m[1]; return c; } },
  {
    re: /\[color=(#?[0-9a-zA-Z]{1,12})\]([\s\S]{1,600}?)\[\/color\]/i,
    build: (m) => {
      const s = document.createElement('span');
      s.style.color = m[1].startsWith('#') ? m[1] : `#${m[1]}`;
      return fill(s, m[2]);
    },
  },
  {
    re: /\[size=([1-7])\]([\s\S]{1,600}?)\[\/size\]/i,
    build: (m) => {
      const s = document.createElement('span');
      // BBCode 的 1–7 号 → 相对字号
      s.style.fontSize = `${[0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75][Number(m[1]) - 1] || 1}em`;
      return fill(s, m[2]);
    },
  },

  // —— 公式 ——
  { re: /\[latex\]([\s\S]{1,800}?)\[\/latex\]/i, build: (m) => span(texNodeHtml(m[1].trim(), false)) },
  { re: /\$\$([\s\S]{1,800}?)\$\$/, build: (m) => (looksLikeTex(m[1]) ? span(texNodeHtml(m[1].trim(), true)) : null) },
  { re: /\$([^$\n]{1,600}?)\$/, build: (m) => (looksLikeTex(m[1]) ? span(texNodeHtml(m[1].trim(), false)) : null) },

  // —— 链接 ——
  {
    re: /\[([^\]\n]{1,200}?)\]\((https?:\/\/[^)\s]{1,600})\)/,
    build: (m) => {
      const a = document.createElement('a');
      a.href = m[2];
      a.textContent = m[1];
      return a;
    },
  },

  // —— 单星号斜体放最后，且前后不能再是星号 ——
  { re: /(?<![*\w])\*([^*\n]{1,600}?)\*(?!\*)/, build: (m) => fill(document.createElement('em'), m[1]) },
];

/** 在字符串里找**最靠左**的一处完整标记 */
function firstInline(src: string): { start: number; end: number; node: Node } | null {
  let best: { start: number; end: number; node: Node } | null = null;
  for (const p of INLINE) {
    p.re.lastIndex = 0;
    const m = p.re.exec(src);
    if (!m) continue;
    if (best && m.index >= best.start) continue;
    let node: Node | null = null;
    try { node = p.build(m); } catch { node = null; }
    if (!node) continue;
    best = { start: m.index, end: m.index + m[0].length, node };
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 打字时用的「末尾锚定」匹配：只有标记刚刚打完（结尾正好是闭合符）才触发 */
/* ------------------------------------------------------------------ */

export interface TrailHit {
  /** 在文本节点里的起始下标 */
  start: number;
  /** 结束下标（= 光标位置） */
  end: number;
  node: Node;
}

const TRAIL: { re: RegExp; build: (m: RegExpMatchArray) => Node | null }[] = [
  { re: /\*\*([^\n]{1,600}?)\*\*$/, build: (m) => fill(document.createElement('strong'), m[1]) },
  { re: /~~([^\n]{1,600}?)~~$/, build: (m) => fill(document.createElement('s'), m[1]) },
  { re: /`([^`\n]{1,400}?)`$/, build: (m) => { const c = document.createElement('code'); c.textContent = m[1]; return c; } },

  { re: /\[b\]([\s\S]{1,600}?)\[\/b\]$/i, build: (m) => fill(document.createElement('strong'), m[1]) },
  { re: /\[i\]([\s\S]{1,600}?)\[\/i\]$/i, build: (m) => fill(document.createElement('em'), m[1]) },
  { re: /\[u\]([\s\S]{1,600}?)\[\/u\]$/i, build: (m) => fill(document.createElement('u'), m[1]) },
  { re: /\[s\]([\s\S]{1,600}?)\[\/s\]$/i, build: (m) => fill(document.createElement('s'), m[1]) },
  { re: /\[code\]([\s\S]{1,600}?)\[\/code\]$/i, build: (m) => { const c = document.createElement('code'); c.textContent = m[1]; return c; } },

  {
    re: /\[color=(#?[0-9a-zA-Z]{1,12})\]([\s\S]{1,600}?)\[\/color\]$/i,
    build: (m) => {
      const s = document.createElement('span');
      s.style.color = m[1].startsWith('#') ? m[1] : `#${m[1]}`;
      return fill(s, m[2]);
    },
  },
  {
    re: /\[size=([1-7])\]([\s\S]{1,600}?)\[\/size\]$/i,
    build: (m) => {
      const s = document.createElement('span');
      s.style.fontSize = `${[0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75][Number(m[1]) - 1] || 1}em`;
      return fill(s, m[2]);
    },
  },

  { re: /\[latex\]([\s\S]{1,800}?)\[\/latex\]$/i, build: (m) => span(texNodeHtml(m[1].trim(), false)) },
  { re: /\$\$([\s\S]{1,800}?)\$\$$/, build: (m) => (looksLikeTex(m[1]) ? span(texNodeHtml(m[1].trim(), true)) : null) },
  { re: /\$([^$\n]{1,600}?)\$$/, build: (m) => (looksLikeTex(m[1]) ? span(texNodeHtml(m[1].trim(), false)) : null) },

  {
    re: /\[([^\]\n]{1,200}?)\]\((https?:\/\/[^)\s]{1,600})\)$/,
    build: (m) => {
      const a = document.createElement('a');
      a.href = m[2];
      a.textContent = m[1];
      return a;
    },
  },

  // 单星号最后；`(?<![*\w])` 保证不会把 `**x**` 拆成两个斜体
  { re: /(?<![*\w])\*([^*\n]{1,600}?)\*$/, build: (m) => fill(document.createElement('em'), m[1]) },
];

/**
 * 检查光标前那截文字，看末尾是不是刚写完一个完整标记。
 * @param head 从光标所在文本节点开头到光标的字符串
 */
export function matchTrailing(head: string): TrailHit | null {
  // 只扫最后一段，长文档每次输入都全文跑正则没必要
  const win = head.slice(-800);
  const base = head.length - win.length;

  for (const t of TRAIL) {
    const m = win.match(t.re);
    if (!m || !m[0]) continue;
    let node: Node | null = null;
    try { node = t.build(m); } catch { node = null; }
    if (!node) continue;
    const start = base + (m.index ?? 0);
    return { start, end: head.length, node };
  }
  return null;
}

/* ---------------- 行首快捷 ---------------- */

export type BlockKind = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'quote';

export interface BlockHit {
  kind: BlockKind;
  /** 要连同后面一起删掉的字符数（`# ` 是 2） */
  prefixLen: number;
  /** 有序列表的起始号 */
  startAt?: number;
}

const BLOCK_SPECS: { re: RegExp; kind: BlockKind; ol?: boolean }[] = [
  { re: /^(#{1,6})[ \u3000]/, kind: 'h1' },
  { re: /^[-*+][ \u3000]/, kind: 'ul' },
  { re: /^(\d{1,3})[.)][ \u3000]/, kind: 'ol', ol: true },
  { re: /^>[ \u3000]/, kind: 'quote' },
];

/**
 * 行首快捷（`# ` / `- ` / `1. ` / `> ` 变成块级结构）。
 *
 * 只认「这一刻正好在段首」的情况：调用方保证光标前面除了前缀没有别的内容，
 * 否则用户把光标挪回段中间改字时会莫名其妙变标题。
 *
 * 注意 `\u00a0`：段落末尾敲空格时 Chromium 插的是不换行空格，
 * 正则里只写半角空格会永远匹配不上（这个坑踩过一次，表现是「行首快捷完全没反应」）。
 */
export function matchLineStart(text: string): BlockHit | null {
  const t = text.replace(/\u00a0/g, ' ');
  for (const sp of BLOCK_SPECS) {
    const m = t.match(sp.re);
    if (!m) continue;
    if (sp.kind === 'h1') {
      const n = m[1].length;
      return { kind: `h${n}` as BlockKind, prefixLen: n + 1 };
    }
    if (sp.ol) return { kind: 'ol', prefixLen: m[0].length, startAt: Number(m[1]) };
    return { kind: sp.kind, prefixLen: m[0].length };
  }
  return null;
}
