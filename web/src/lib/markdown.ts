/** 极简 Markdown → HTML（Typora 式即时预览用，够用就好） */
import { imgUrl } from './media';
import { bbInline } from './bbcode';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

export function mdToHtml(md: string): string {
  if (!md) return '';
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  let inQuote = false;

  const inline = (src: string) => {
    let s = esc(src);
    /*
     * #144：一个输入框里同时认两种写法。
     *
     * 用户原话：「我希望一个输入框，无须切换就能同时用」。原来的做法是
     * rich / md / bb 三选一，切过去等于换一份内容 —— 想粘一段论坛里的
     * BBCode 进 Markdown 日记，得先切模式，回来还得再切回来。
     *
     * 这里在**转义之后、Markdown 之前**先把 BBCode 标签换成 HTML。
     * 顺序很关键：BBCode 的 `[b]` 里可能含 `*`，先跑 Markdown 会把
     * `[b]*粗斜*[/b]` 搅成一团；先换掉标签，里面的内容再走 Markdown 就正好。
     */
    s = bbInline(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, href: string) => {
      const url = href.startsWith('http') || href.startsWith('file') ? href : imgUrl(href);
      return `<img src="${url}" alt="${alt}">`;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    return s;
  };

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      closeList(); closeQuote();
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { out.push('<pre><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }

    if (/^\s*$/.test(line)) { closeList(); closeQuote(); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { closeList(); closeQuote(); out.push('<hr>'); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList(); closeQuote();
      const lv = Math.min(h[1].length + 1, 5);
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }

    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`<p>${inline(q[1])}</p>`);
      continue;
    }
    closeQuote();

    const li = line.match(/^\s*[-*+]\s+(.*)$/);
    if (li) {
      closeQuote();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      closeQuote();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeQuote();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
