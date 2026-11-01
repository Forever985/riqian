/**
 * 富文本编辑内核（第 73 条重做）。
 *
 * 与前四版最大的区别：**完全不用 execCommand。**
 *
 * 之前每一版都死在同一个地方 —— execCommand 插完内容后浏览器会自己重设光标，
 * 我们在它之后设的选区被它盖掉，结果「标签转出来了，但后面的字被吞进标签里」。
 * 现在改成纯 Range 操作（deleteContents + insertNode + setStartAfter），
 * 浏览器在 input 事件派发完之后不会再插手，选区就稳了。
 *
 * 另外两件必须自己做的事：
 * 1. **撤销栈**。手改 DOM 会污染浏览器原生 undo 记录，Ctrl+Z 会恢复出结构错乱的中间态，
 *    所以拦截 historyUndo/historyRedo，走我们自己的快照栈。
 * 2. **输入法保护**。中文 IME 组字期间绝不动 DOM，上屏之后再补一次规则检查。
 */
import { caretOffset, isCaretIn, blockOf, setCaretOffset, offsetInBlock } from './caret';
import { matchTrailing, matchLineStart, type BlockKind } from './rules';

/* ------------------------------------------------------------------ */
/* 快照 / 撤销                                                         */
/* ------------------------------------------------------------------ */

interface Snap { html: string; caret: number }

function snapOf(root: HTMLElement): Snap {
  return { html: root.innerHTML, caret: Math.max(0, caretOffset(root)) };
}

function restoreSnap(root: HTMLElement, s: Snap) {
  root.innerHTML = s.html;
  root.focus({ preventScroll: true });
  setCaretOffset(root, s.caret);
}

class History {
  private undo: Snap[] = [];
  private redo: Snap[] = [];
  /** 当前（最新）状态 */
  private cur: Snap | null = null;
  /** 这一轮连续输入开始之前的那个状态 —— 撤销要回到它 */
  private pending: Snap | null = null;
  private timer: number | null = null;

  reset(s: Snap) {
    this.flushTimer(false);
    this.undo = [];
    this.redo = [];
    this.cur = s;
    this.pending = null;
  }

  /**
   * 记录一个**变更之后**的状态。
   *
   * 撤销要退回的是「变更之前」的样子，所以这里缓存的是这次 note 之前的旧状态。
   * - 普通打字：400ms 内的连续输入合并成一个撤销点（不然每敲一个字都要按一次 Ctrl+Z）
   * - force（格式化 / 回车）：立刻单独成一个撤销点，撤销就该退回「标记还没转换」那一刻
   */
  note(s: Snap, force = false) {
    if (!this.cur) { this.cur = s; return; }
    const before = this.cur;
    this.cur = s;
    this.redo = [];

    if (force) {
      this.flushTimer(false);
      if (this.pending) { this.push(this.pending); this.pending = null; }
      this.push(before);
      return;
    }

    if (!this.pending) this.pending = before;
    this.flushTimer(false);
    this.timer = window.setTimeout(() => this.commit(), 400);
  }

  private flushTimer(commit: boolean) {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (commit) this.commit();
  }

  private push(s: Snap) {
    const top = this.undo[this.undo.length - 1];
    if (top && top.html === s.html) return;
    this.undo.push(s);
    if (this.undo.length > 200) this.undo.shift();
  }

  private commit() {
    if (!this.pending) return;
    this.push(this.pending);
    this.pending = null;
  }

  /**
   * 把「马上就要被我们改掉的状态」先按进撤销栈。
   *
   * 输入即格式化是在 input 事件里**当场改 DOM** 的，等 emit 时再快照，
   * 拍到的已经是转换之后的样子 —— 撤销就只能退到「标记还没打完」的中间态
   * （用户会看到少一个星号的怪东西）。所以动手之前先单独记一笔。
   */
  markBefore(s: Snap) {
    this.flushTimer(false);
    if (this.pending) { this.push(this.pending); this.pending = null; }
    this.push(s);
    this.cur = s;
    this.timer = null;
  }

  undoOnce(root: HTMLElement): boolean {
    // 先把还没落栈的那一段收掉，否则刚打完就按 Ctrl+Z 什么也不会发生
    this.flushTimer(true);
    if (!this.undo.length) return false;
    const now = snapOf(root);
    const prev = this.undo.pop()!;
    this.redo.push(now);
    restoreSnap(root, prev);
    this.cur = prev;
    this.pending = null;
    return true;
  }

  redoOnce(root: HTMLElement): boolean {
    const next = this.redo.pop();
    if (!next) return false;
    this.undo.push(snapOf(root));
    restoreSnap(root, next);
    this.cur = next;
    this.pending = null;
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 光标落点                                                            */
/* ------------------------------------------------------------------ */

/**
 * 把光标放到某个**文本节点**上。
 *
 * 为什么非要多绕这一层：
 * `range.setStartAfter(el)` / `range.setStart(p, 0)` 设的是「元素之间」的位置，
 * 光标看着在那儿，但接下来打的字会被浏览器塞回上一个文本节点 ——
 * 也就是「**粗体**」转换完接着打的字全变成粗体、回车后的字全挤回上一段。
 * 前四版就是栽在这个细节上。放一个空文本节点当锚点，插入位置就确定了。
 * 空文本节点不会进 innerHTML，也不会影响排版。
 */
function applyRange(r: Range) {
  const sel = window.getSelection();
  if (!sel) return;
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** 光标放到 node 之后（紧跟的那个文本节点开头） */
function caretAfterNode(node: Node) {
  const parent = node.parentNode;
  if (!parent) return;
  let t = node.nextSibling;
  if (!t || t.nodeType !== Node.TEXT_NODE) {
    /*
     * 这里必须放一个**非空**的文本节点。
     *
     * 试过空文本节点和 range.setStartAfter：光标看着在标签外面，
     * 但 Chromium 在真正插入字符前会把选区规范化到最近的文本节点，
     * 于是「**粗**」转完再打的字全变成粗体 —— 用户看到的正是「字被吞进标签里」。
     * 放一个零宽空格 (`\u200b`) 就能把插入点钉在标签外面，
     * 存库前再统一剥掉（见 sanitize），内容里不会留脏字符。
     */
    t = document.createTextNode('\u200b');
    parent.insertBefore(t, node.nextSibling);
    caretAt(t as Text, 1);
    return;
  }
  // 空文本节点也会被浏览器并进前一个节点，同样得用零宽字符占位
  if (!t.nodeValue) {
    t.nodeValue = '\u200b';
    caretAt(t as Text, 1);
    return;
  }
  caretAt(t as Text, 0);
}

function caretAt(t: Text, offset: number) {
  const r = document.createRange();
  r.setStart(t, offset);
  applyRange(r);
}

/** 光标放到元素内容的开头 */
function caretToStart(el: HTMLElement) {
  // 浏览器留下的占位 <br> 要先清掉，否则打第一个字之后末尾会多一个空行
  if (el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR') el.textContent = '';
  const t = document.createTextNode('\u200b');
  // 空元素里没有文本节点，光标会掉到整个编辑区末尾 —— 塞个零宽字符钉住
  el.insertBefore(t, el.firstChild);
  caretAt(t, 1);
}

/* ------------------------------------------------------------------ */
/* 单个行内标记就地转换                                                */
/* ------------------------------------------------------------------ */

function replaceTrailing(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.nodeValue || '';
  const pos = range.startOffset;
  if (pos < 2) return false;

  const hit = matchTrailing(text.slice(0, pos));
  if (!hit) return false;
  // 正则都是 `$` 锚定的，命中区间的终点必然就是光标；对不上说明判断错了，宁可不转
  if (hit.end !== pos) return false;

  try {
    const r = document.createRange();
    r.setStart(node as Text, hit.start);
    r.setEnd(node as Text, hit.end);
    r.deleteContents();
    r.insertNode(hit.node);

    // 光标放到新节点**之后**的文本位置上 —— 这一步是前四版没做对的地方
    caretAfterNode(hit.node);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 行首快捷                                                            */
/* ------------------------------------------------------------------ */

function makeBlock(kind: BlockKind, startAt?: number): HTMLElement {
  if (kind === 'ul' || kind === 'ol') {
    const list = document.createElement(kind);
    if (kind === 'ol' && startAt && startAt > 1) list.setAttribute('start', String(startAt));
    list.appendChild(document.createElement('li'));
    return list;
  }
  if (kind === 'quote') return document.createElement('blockquote');
  return document.createElement(kind);
}

function applyLineStart(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;
  if (!root.contains(range.startContainer)) return false;

  const block = blockOf(range.startContainer, root);
  if (block === root) return false;
  // 已经在目标结构里就别再套一层
  if (/^(H[1-6]|LI|BLOCKQUOTE)$/.test(block.tagName)) return false;

  /*
   * 段首可能留着光标锚点 `\u200b`（空段落时放进去钉光标的），
   * 它会让 "textContent 以 # 开头" 这个判断永远失败 —— 行首快捷会「完全没反应」。
   * 所以算文本和算偏移时都要把它扣掉。
   */
  const rawFull = block.textContent || '';
  const lead = (rawFull.match(/^\u200b+/) || [''])[0].length;
  const full = rawFull.slice(lead);
  const hit = matchLineStart(full);
  if (!hit) return false;

  // 光标必须正好停在前缀后面：否则用户是把光标挪回段首改字，不能突然变标题
  const posInBlock = offsetInBlock(root, block) - lead;
  if (posInBlock !== hit.prefixLen) return false;

  try {
    // 先精确地只切掉前缀，切下来的东西不是前缀就原样放回去（跨节点等异常情况）
    const cut = document.createRange();
    cut.setStart(block, 0);
    cut.setEnd(range.startContainer, range.startOffset);
    const grabbed = cut.extractContents();
    const got = (grabbed.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '')
      .trim();
    if (got !== full.slice(0, hit.prefixLen).replace(/\u00a0/g, ' ').trim()) {
      block.insertBefore(grabbed, block.firstChild);
      return false;
    }

    const made = makeBlock(hit.kind, hit.startAt);
    const holder = made.tagName === 'UL' || made.tagName === 'OL'
      ? made.firstElementChild as HTMLElement
      : made;
    while (block.firstChild) holder.appendChild(block.firstChild);
    block.replaceWith(made);

    // 光标必须直接锚在目标元素上。
    // 用「全文偏移 - 前缀长度」算出来的位置，在块变空时找不到文本节点，
    // 会掉到整个编辑区末尾 —— 后面打的字就全丢了。
    caretToStart(holder);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 回车分段                                                            */
/* ------------------------------------------------------------------ */

export function splitBlock(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return false;

  let block = blockOf(range.startContainer, root);

  // 裸文本（历史数据）先包一层，否则新段落会被插到编辑区外面
  if (block === root) {
    const p = document.createElement('p');
    const keep = document.createRange();
    keep.selectNodeContents(root);
    p.appendChild(keep.extractContents());
    root.appendChild(p);
    block = p;
  }

  const tag = block.tagName;
  // 零宽锚点不是空白字符，trim() 去不掉 —— 不先剥掉的话「空段落」永远判成非空
  const text = (block.textContent || '').replace(/\u200b/g, '').trim();

  // 空标题回车 → 退回普通段落（不然只能一直写标题）
  if (/^H[1-6]$/.test(tag) && !text) {
    const p = document.createElement('p');
    block.replaceWith(p);
    caretToStart(p);
    return true;
  }

  // 空引用 / 空列表项回车 → 脱出来
  if ((tag === 'BLOCKQUOTE' || tag === 'LI') && !text) {
    const p = document.createElement('p');
    if (tag === 'LI') {
      const list = block.parentElement;
      const parent = list && list.parentElement;
      if (list && parent) {
        // 列表只剩这一项就把列表整个换掉，避免留下空 ul
        if (list.children.length === 1) list.replaceWith(p);
        else { block.remove(); parent.insertBefore(p, list.nextSibling); }
      } else {
        block.replaceWith(p);
      }
    } else {
      block.replaceWith(p);
    }
    caretToStart(p);
    return true;
  }

  try {
    const tail = document.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(block, block.childNodes.length);
    const moved = tail.extractContents();

    // 标题后面接的是普通段落，不是又一个标题；引用里则继续引用
    const nextTag = tag === 'LI' ? 'li' : tag === 'BLOCKQUOTE' ? 'blockquote' : 'p';
    const np = document.createElement(nextTag);
    if ((moved.textContent || '').trim()) np.appendChild(moved);

    const host = block.parentElement || root;
    host.insertBefore(np, block.nextSibling);

    caretToStart(np);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 粘贴：只收纯文本                                                    */
/* ------------------------------------------------------------------ */

/**
 * 全选删除后浏览器会留下一串空块（`<p></p><p></p><h1></h1>`），
 * 用户看到的是好几个空行，还会让「最后一个块」的判断出错。
 * 全空时归一成一个干净段落 —— 只在删除操作后调用，不影响正常回车留空行。
 */
function tidyEmpty(root: HTMLElement): boolean {
  const kids = Array.from(root.children);
  if (kids.length <= 1) return false;
  for (const k of kids) {
    if ((k.textContent || '').replace(/\u200b/g, '').trim()) return false;
  }
  root.textContent = '';
  const p = document.createElement('p');
  root.appendChild(p);
  caretToStart(p);
  return true;
}

function pastePlain(text: string): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const root = (document.activeElement as HTMLElement) || null;
  if (!root) return false;

  try {
    // 第一段就地插入；多行的话剩下的按段落追加
    const first = lines[0];
    if (first) document.execCommand('insertText', false, first);
    for (let i = 1; i < lines.length; i++) {
      if (!splitBlock(root)) break;
      if (lines[i]) document.execCommand('insertText', false, lines[i]);
    }
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 内核入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 存库前把「光标锚点」剥掉。
 *
 * `\u200b` 只存在于 DOM 里（用来把插入点钉在格式标签外面），
 * 存进数据库、导出、分享渲染的一律是干净 HTML。
 */
function sanitize(html: string): string {
  return html.indexOf('\u200b') === -1 ? html : html.replace(/\u200b/g, '');
}

export interface EngineOpts {
  /** 拿到真正的可编辑元素 */
  root: () => HTMLElement | null;
  /** 内容变化往上抛 */
  emit: (html: string) => void;
  /** 输入即格式化开关 */
  live: () => boolean;
  /** 单行模式（小标题）：回车即失焦 */
  singleLine?: boolean;
  /** 第一次拿到元素时做一次快照 */
}

export function createEngine(opts: EngineOpts) {
  const hist = new History();
  let composing = false;
  let ready = false;
  let disposed = false;
  let lastHtml = '';

  const el = () => opts.root();

  function emit(force = false) {
    const root = el();
    if (!root || disposed) return;
    lastHtml = sanitize(root.innerHTML);
    opts.emit(lastHtml);
    hist.note(snapOf(root), force);
  }

  /**
   * 只上报内容，不动撤销栈。
   * 撤销/重做本身不是「新的编辑」，走 note 会把刚存好的 redo 清空 ——
   * 表现是 Ctrl+Y 永远没反应。
   */
  function emitRaw() {
    const root = el();
    if (!root || disposed) return;
    lastHtml = sanitize(root.innerHTML);
    opts.emit(lastHtml);
  }

  function liveFix(): boolean {
    const root = el();
    if (!root || !opts.live()) return false;
    if (composing) return false;
    if (!isCaretIn(root)) return false;

    // 先块级（`# ` 要先变成标题），再行内 —— 顺序反了的话
    // `# **粗**` 会先吃成 strong，块级正则就匹配不到行首了
    let changed = false;
    try { changed = applyLineStart(root) || changed; } catch { /* 忽略 */ }
    try { changed = replaceTrailing(root) || changed; } catch { /* 忽略 */ }
    return changed;
  }

  /*
   * 撤销/重做只走 keydown 一条路。
   * 之前 keydown 和 beforeinput 都接了一遍，按一次 Ctrl+Z 会撤销两步 ——
   * 表现是「撤销之后文字少了一个字符」，比不撤销还吓人。
   */
  const onBeforeInput = (_e: InputEvent) => { /* 预留：暂不处理 */ };

  const onInput = (e: InputEvent) => {
    if (disposed) return;
    const root = el();
    if (!root) return;

    if (composing || (e as InputEvent).isComposing) { emit(); return; }

    // 全选删空之后归一，否则残留的空块会一直留在正文里
    if ((e.inputType || '').startsWith('delete') && tidyEmpty(root)) { emit(true); return; }

    // 规则会就地改 DOM，先把改之前的样子记进撤销栈
    const pre = opts.live() && !composing ? snapOf(root) : null;
    const changed = liveFix();
    if (changed && pre) hist.markBefore(pre);

    // 结构化改动（格式转换/删除/粘贴）立刻单独成一个撤销点，不跟打字合并
    const structural = changed || e.inputType === 'deleteByCut' || e.inputType === 'insertFromPaste';
    emit(structural);
  };

  const onCompositionStart = () => { composing = true; };

  const onCompositionEnd = () => {
    composing = false;
    // 上屏之后再补一次：某些输入法在组字结束时才把最后一个符号交给页面
    window.setTimeout(() => {
      if (disposed) return;
      const root = el();
      if (!root) return;
      if (liveFix()) emit(true);
    }, 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const root = el();
    if (!root) return;
    if (e.isComposing || composing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      if (opts.singleLine) { e.preventDefault(); root.blur(); return; }
      // 公式节点、链接内部按回车交给浏览器
      const node = window.getSelection()?.anchorNode;
      if (node && (node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement)?.closest('.tex')) return;
      if (splitBlock(root)) { e.preventDefault(); emit(true); }
      return;
    }

    // Ctrl/Cmd + Z / Y 有原生 beforeinput，但 WebView2 里不一定都派发，做个后备
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (e.repeat) return;
      e.preventDefault();
      if (hist.undoOnce(root)) emitRaw();
      return;
    }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      if (hist.redoOnce(root)) emitRaw();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    // 剪贴板里只有图片（截图）时交给浏览器默认处理
    if (!text) return;
    e.preventDefault();
    if (pastePlain(text)) emit(true);
  };

  const onBlur = () => { emit(true); };

  /*
   * 键盘监听挂在 document 上，而不是编辑器元素上。
   *
   * 一开始是绑元素的 —— 日记里没问题，但笔记页的编辑器会被 React 重建
   * （条件渲染 + 加锁包装），绑定随旧元素一起丢了，表现是「笔记里 Ctrl+Z 没反应」，
   * 而且是**静默**失效：原生撤销还在，用户以为撤销了，其实只退掉半个字。
   * 挂 document 上按 target 归属分发，谁被重建都不影响。
   */
  const onDocKey = (e: KeyboardEvent) => {
    const root = el();
    if (!root) return;
    const t = e.target as Node | null;
    if (!t || !root.contains(t)) return;
    onKeyDown(e);
  };

  const bind = (root: HTMLElement) => {
    root.addEventListener('beforeinput', onBeforeInput as EventListener);
    root.addEventListener('input', onInput as EventListener);
    root.addEventListener('compositionstart', onCompositionStart);
    root.addEventListener('compositionend', onCompositionEnd);
    document.addEventListener('keydown', onDocKey, true);
    root.addEventListener('paste', onPaste as EventListener);
    root.addEventListener('blur', onBlur);
    ready = true;
    hist.reset(snapOf(root));
    lastHtml = root.innerHTML;
  };

  const unbind = (root: HTMLElement) => {
    disposed = true;
    root.removeEventListener('beforeinput', onBeforeInput as EventListener);
    root.removeEventListener('input', onInput as EventListener);
    root.removeEventListener('compositionstart', onCompositionStart);
    root.removeEventListener('compositionend', onCompositionEnd);
    document.removeEventListener('keydown', onDocKey, true);
    root.removeEventListener('paste', onPaste as EventListener);
    root.removeEventListener('blur', onBlur);
  };

  return {
    bind, unbind,
    /** 外部换了内容（切日期、切模块）时重置历史，别让 Ctrl+Z 跳回别的日子 */
    resetHistory() {
      const root = el();
      if (root) hist.reset(snapOf(root));
    },
    get ready() { return ready; },
    get lastHtml() { return lastHtml; },
  };
}
