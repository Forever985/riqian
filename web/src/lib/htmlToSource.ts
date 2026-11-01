/**
 * HTML → Markdown / BBCode（第 73 条）。
 *
 * 为什么需要它：以前三种输入方式各存一份内容（values[id] / values[id:md] / values[id:bb]），
 * 从富文本切到 Markdown 时读的是那份"从没写过"的源码 —— 用户看到的就是"一切换就清空"。
 *
 * 现在 HTML 是唯一事实，md / bb 只是它的另一种写法。切过去时，如果那份源码还没写过，
 * 就从 HTML 现场转一份出来，而不是给个空框。
 *
 * 转换是**近似**的：做过格式的段落能保住结构（标题、列表、引用、粗斜体、链接、图片、视频、公式），
 * 但浏览器 execCommand 产生的奇怪嵌套（比如 <b><i><b>）会被压平成最简形式。
 * 这点我认：宁可压平，也不要为了"绝对可逆"把一堆 <span style> 原样塞进 Markdown 里。
 */

const clean = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n');

/** 从 https://riqian.local/abc.png 或绝对路径里取文件名 */
function fileName(src: string): string {
  const s = (src || '').split('?')[0].split('#')[0];
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

/** 媒体 id：优先 data-mid，其次从文件名反推（文件名就是 id.ext） */
function mediaId(el: Element): string {
  const mid = el.getAttribute('data-mid');
  if (mid) return mid;
  const name = fileName(el.getAttribute('src') || '');
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/* ================= HTML → Markdown ================= */

function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\n+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') return '\n';
  // 公式：优先用 data-tex，绝不把 KaTeX 的渲染产物漏进源码
  if (el.classList.contains('tex')) {
    const tex = el.getAttribute('data-tex') || '';
    const block = el.getAttribute('data-block') === '1' || el.getAttribute('data-display') === '1';
    return block ? `\n$$\n${tex}\n$$\n` : `$${tex}$`;
  }
  if (tag === 'img') {
    const name = fileName(el.getAttribute('src') || '');
    const alt = (el.getAttribute('alt') || '').replace(/[\[\]]/g, '');
    return `![${alt || '图片'}](${name || mediaId(el)})`;
  }
  if (tag === 'video') {
    const src = el.getAttribute('src') || '';
    return src ? `\n<video src="${src}" controls preload="metadata"></video>\n` : '';
  }
  if (tag === 'audio') {
    const src = el.getAttribute('src') || '';
    return src ? `\n<audio src="${src}" controls></audio>\n` : '';
  }

  const inner = Array.from(el.childNodes).map(inlineMd).join('');
  switch (tag) {
    case 'strong': case 'b': return inner.trim() ? `**${inner}**` : inner;
    case 'em': case 'i': return inner.trim() ? `*${inner}*` : inner;
    case 's': case 'del': case 'strike': return inner.trim() ? `~~${inner}~~` : inner;
    case 'u': return `<u>${inner}</u>`;
    case 'code': return inner.includes('`') ? `\`\` ${inner} \`\`` : `\`${inner}\``;
    case 'a': {
      const href = el.getAttribute('href') || '';
      return href ? `[${inner || href}](${href})` : inner;
    }
    case 'mark': return `==${inner}==`;
    default: return inner;
  }
}

function blockMd(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent || '').trim();
    return t ? t : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const pad = '  '.repeat(depth);

  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const lv = Number(tag[1]);
      return `${'#'.repeat(lv)} ${inlineMd(el).trim()}`;
    }
    case 'blockquote': {
      const body = childrenMd(el, depth);
      return body.split('\n').map((l) => `> ${l}`).join('\n');
    }
    case 'ul': case 'ol': {
      const ordered = tag === 'ol';
      let n = 1;
      return Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li) => {
          const mark = ordered ? `${n++}. ` : '- ';
          const own = inlineMd(li).trim();
          const nested = Array.from(li.children)
            .filter((c) => ['ul', 'ol'].includes(c.tagName.toLowerCase()))
            .map((c) => blockMd(c, depth + 1))
            .join('\n');
          return `${pad}${mark}${own}${nested ? `\n${nested}` : ''}`;
        })
        .join('\n');
    }
    case 'pre': {
      const code = el.textContent || '';
      const lang = el.getAttribute('data-lang') || '';
      return `\`\`\`${lang}\n${code.replace(/\n$/, '')}\n\`\`\``;
    }
    case 'hr': return '---';
    case 'br': return '';
    case 'div': case 'p': case 'section': case 'article': {
      return childrenMd(el, depth);
    }
    case 'table': {
      // 表格不硬转成 Markdown 语法（容易错），原样留 HTML：Markdown 允许内嵌 HTML
      return el.outerHTML;
    }
    default: return inlineMd(el);
  }
}

function childrenMd(el: Element, depth = 0): string {
  const parts: string[] = [];
  let buf = '';
  Array.from(el.childNodes).forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const t = (n as HTMLElement).tagName.toLowerCase();
      // 'p' 必须算块级：漏了它，几段文字会被拼成一行（`第一行第二行`）
      const isBlock = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'div', 'table'].includes(t);
      if (isBlock) {
        if (buf.trim()) { parts.push(buf.trim()); buf = ''; }
        parts.push(blockMd(n, depth));
        return;
      }
    }
    buf += inlineMd(n);
  });
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean).join('\n\n');
}

/** HTML → Markdown */
export function htmlToMd(html: string): string {
  if (!html || !html.trim()) return '';
  const box = document.createElement('div');
  box.innerHTML = html;
  return clean(childrenMd(box)).replace(/\n{3,}/g, '\n\n').trim();
}

/* ================= HTML → BBCode ================= */

function inlineBb(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\n+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') return '\n';
  if (el.classList.contains('tex')) {
    const tex = el.getAttribute('data-tex') || '';
    const block = el.getAttribute('data-block') === '1' || el.getAttribute('data-display') === '1';
    return block ? `\n[latex]${tex}[/latex]\n` : `[latex]${tex}[/latex]`;
  }
  if (tag === 'img') return `[img]${mediaId(el)}[/img]`;
  if (tag === 'video') return `[video]${mediaId(el)}[/video]`;
  if (tag === 'audio') return `[audio]${mediaId(el)}[/audio]`;

  const inner = Array.from(el.childNodes).map(inlineBb).join('');
  switch (tag) {
    case 'strong': case 'b': return inner.trim() ? `[b]${inner}[/b]` : inner;
    case 'em': case 'i': return inner.trim() ? `[i]${inner}[/i]` : inner;
    case 'u': return inner.trim() ? `[u]${inner}[/u]` : inner;
    case 's': case 'del': case 'strike': return inner.trim() ? `[s]${inner}[/s]` : inner;
    case 'code': return `[code]${inner}[/code]`;
    case 'a': {
      const href = el.getAttribute('href') || '';
      return href ? `[url=${href}]${inner || href}[/url]` : inner;
    }
    case 'mark': return `[color=#c9a227]${inner}[/color]`;
    default: return inner;
  }
}

function blockBb(node: Node, depth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const pad = '  '.repeat(depth);

  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return `[size=${[0, 5, 4, 3, 2, 2, 2][Number(tag[1])] || 3}][b]${inlineBb(el).trim()}[/b][/size]`;
    case 'blockquote': {
      const body = childrenBb(el, depth);
      return `[quote]${body}[/quote]`;
    }
    case 'ul': case 'ol': {
      const items = Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === 'li')
        .map((li) => `${pad}[*]${inlineBb(li).trim()}`)
        .join('\n');
      return tag === 'ol' ? `[list=1]\n${items}\n[/list]` : `[list]\n${items}\n[/list]`;
    }
    case 'pre': return `[code]${el.textContent || ''}[/code]`;
    case 'hr': return '[hr]';
    case 'div': case 'p': case 'section': case 'article': return childrenBb(el, depth);
    case 'table': return `[table]${el.textContent || ''}[/table]`;
    default: return inlineBb(el);
  }
}

function childrenBb(el: Element, depth = 0): string {
  const parts: string[] = [];
  let buf = '';
  Array.from(el.childNodes).forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const t = (n as HTMLElement).tagName.toLowerCase();
      // 'p' 必须算块级：漏了它，几段文字会被拼成一行（`第一行第二行`）
      const isBlock = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'div', 'table'].includes(t);
      if (isBlock) {
        if (buf.trim()) { parts.push(buf.trim()); buf = ''; }
        parts.push(blockBb(n, depth));
        return;
      }
    }
    buf += inlineBb(n);
  });
  if (buf.trim()) parts.push(buf.trim());
  return parts.filter(Boolean).join('\n\n');
}

/** HTML → BBCode */
export function htmlToBb(html: string): string {
  if (!html || !html.trim()) return '';
  const box = document.createElement('div');
  box.innerHTML = html;
  return clean(childrenBb(box)).replace(/\n{3,}/g, '\n\n').trim();
}
