/**
 * 光标 ↔ 纯文本偏移的互相换算（第 73 条重做）。
 *
 * 为什么需要这个：
 * 之前四版「输入即格式化」都栽在同一件事上 —— 改完 DOM 之后光标位置靠猜。
 * 猜错的后果不是「格式没转成功」，而是**把用户后面要打的字吞进标签里**，
 * 那是在毁用户写的东西，比不转严重得多。
 *
 * 正确的做法是：动 DOM 之前先把光标换算成「整段文本里的第 N 个字符」，
 * 动完之后再换算回 DOM 位置。文本偏移是稳定的，DOM 结构变了它也不变。
 */

/** 编辑区里所有文本节点，按文档顺序 */
function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n as Text).nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  let n: Node | null;
  while ((n = walker.nextNode())) out.push(n as Text);
  return out;
}

/**
 * 把 (node, offset) 换算成全文纯文本偏移。
 * node 是元素节点时（光标停在两个元素之间）用 Range 兜底，结果同样准确。
 */
export function pointToOffset(root: HTMLElement, node: Node | null, offset: number): number {
  if (!node) return 0;
  if (!root.contains(node)) return 0;

  if (node.nodeType === Node.TEXT_NODE) {
    let total = 0;
    for (const t of textNodes(root)) {
      if (t === node) return total + Math.min(offset, t.nodeValue?.length ?? 0);
      total += t.nodeValue?.length ?? 0;
    }
    return total;
  }

  // 元素节点 / br 之类：用 Range 数它前面有多少字
  try {
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, Math.min(offset, node.childNodes.length));
    return r.toString().length;
  } catch {
    return 0;
  }
}

/** 当前光标在全文中的偏移；没有选区或选区不在编辑区内时返回 -1 */
export function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return -1;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return -1;
  if (!root.contains(r.startContainer)) return -1;
  return pointToOffset(root, r.startContainer, r.startOffset);
}

/** 把光标放到全文第 offset 个字符处。offset 越界时贴到最近的有效位置。 */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  if (offset < 0) offset = 0;

  let total = 0;
  let target: Text | null = null;
  let rel = 0;

  const all = textNodes(root);
  for (const t of all) {
    const len = t.nodeValue?.length ?? 0;
    if (offset <= total + len) {
      target = t;
      rel = offset - total;
      break;
    }
    total += len;
  }

  const r = document.createRange();
  if (target) {
    r.setStart(target, Math.max(0, Math.min(rel, target.nodeValue?.length ?? 0)));
  } else {
    // 全空（`<p><br></p>`）或者 offset 超出总长：落到编辑区末尾
    r.selectNodeContents(root);
    try { r.collapse(false); } catch { /* 忽略 */ }
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** 光标是否被收起（没有选中一段文字）且落在 root 里 */
export function isCaretIn(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return false;
  const r = sel.getRangeAt(0);
  return r.collapsed && root.contains(r.startContainer);
}

/** 取光标所在的最内层块级容器（p / div / h1-6 / li / blockquote / pre） */
export function blockOf(node: Node | null, root: HTMLElement): HTMLElement {
  let el: HTMLElement | null = node
    ? (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement))
    : null;
  const hit = el?.closest('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre');
  if (hit && root.contains(hit)) return hit as HTMLElement;
  return root;
}

/** 纯文本偏移之外，再提供一个「光标在块内第几个字」的便捷值 */
export function offsetInBlock(root: HTMLElement, block: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount !== 1) return 0;
  const r = sel.getRangeAt(0);
  try {
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(r.startContainer, r.startOffset);
    return before.toString().length;
  } catch {
    return pointToOffset(root, r.startContainer, r.startOffset);
  }
}
