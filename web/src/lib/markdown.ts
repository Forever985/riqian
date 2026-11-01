/** 极简 Markdown → HTML（Typora 式即时预览用，够用就好） */
import { imgUrl } from './media';

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
