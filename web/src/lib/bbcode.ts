/** BBCode → HTML（论坛模式）。常用标签全覆盖，够日常用。 */
import { imgUrl } from './media';
import { texNodeHtml } from './latex';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

export function bbToHtml(bb: string): string {
  if (!bb) return '';

  // 公式要在转义之前抽走，否则 TeX 里的 < & 会变成实体，KaTeX 渲染出来是错的
  const texes: string[] = [];
  let raw = bb.replace(/\[tex(block)?\]([\s\S]*?)\[\/tex(?:block)?\]/gi,
    (_m, block: string, body: string) => {
      texes.push(texNodeHtml(body.trim(), !!block));
      return `\u0000TEX${texes.length - 1}\u0000`;
    });

  let s = esc(raw).replace(/\r/g, '');

  // 先把代码块抽走，避免里面被其它标签误伤
  const codes: string[] = [];
  s = s.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_m, c: string) => {
    codes.push(c);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  s = s.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
  s = s.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
  s = s.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
  s = s.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>');
  s = s.replace(/\[(?:size=(\d+))\]([\s\S]*?)\[\/size\]/gi,
    (_m, n: string, t: string) => `<span style="font-size:${Math.max(11, Math.min(28, Number(n) * 4))}px">${t}</span>`);
  s = s.replace(/\[color=([#\w]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>');
  s = s.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>');
  s = s.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<p style="text-align:center">$1</p>');
  s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank">$2</a>');
  s = s.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank">$1</a>');
  s = s.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_m, src: string) => {
    const u = /^https?:/i.test(src) ? src : imgUrl(src.trim());
    return `<img src="${u}" alt="">`;
  });
  s = s.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, body: string) => {
    const items = body.split(/\[\*\]/).filter((x) => x.trim()).map((x) => `<li>${x.trim()}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i: string) => `<pre><code>${codes[Number(i)]}</code></pre>`);
  s = s.replace(/\u0000TEX(\d+)\u0000/g, (_m, i: string) => texes[Number(i)]);

  return s.split(/\n{2,}/).map((p) => {
    if (/^\s*<(p|ul|blockquote|pre|h\d|div)/i.test(p.trim())) return p;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export const BB_WRAP: Record<string, [string, string, string]> = {
  b: ['[b]', '[/b]', '粗体'],
  i: ['[i]', '[/i]', '斜体'],
  u: ['[u]', '[/u]', '下划线'],
  s: ['[s]', '[/s]', '删除线'],
  quote: ['[quote]', '[/quote]', '引用内容'],
  code: ['[code]', '[/code]', '代码'],
  center: ['[center]', '[/center]', '居中文字'],
  list: ['[list]\n[*]', '[/list]', '\n[*]第二项'],
  tex: ['[tex]', '[/tex]', 'E=mc^2'],
};
