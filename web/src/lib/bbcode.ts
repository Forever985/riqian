/** BBCode → HTML（论坛模式）。常用标签全覆盖，够日常用。 */
import { imgUrl } from './media';
import { texNodeHtml } from './latex';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/**
 * #144：在一行（或一段）已转义文本里就地识别 BBCode **行内**标签。
 *
 * 抽出来是为了让 Markdown 编辑器和 BBCode 编辑器共用同一张对照表 ——
 * 一个输入框里同时能写 `**粗体**` 和 `[b]粗体[/b]`，用户不用先选模式。
 *
 * 只处理行内标签（粗斜下划线删除线、字号、颜色、链接）。
 * 块级标签（quote / list / code / center）由 bbToHtml 自己按块处理，
 * 放进这里会把段落结构搅乱。
 */
export function bbInline(s: string): string {
  return s
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
    .replace(/\[(?:size=(\d+))\]([\s\S]*?)\[\/size\]/gi,
      (_m, n: string, t: string) => `<span style="font-size:${Math.max(11, Math.min(28, Number(n) * 4))}px">${t}</span>`)
    .replace(/\[color=([#\w]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>')
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank">$2</a>')
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank">$1</a>');
}

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

  /*
   * 行内标签走和 Markdown 编辑器共用的那张表（bbInline），
   * 保证「同一个 [b]粗体[/b] 在两种编辑器里渲染结果一致」——
   * 两处各写一份正则，改了一处忘了另一处，用户就会遇到"同样的写法在这里是粗体、那里是字面量"。
   */
  s = bbInline(s);
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

/**
 * #144：一个输入框同时认两种写法。
 *
 * Markdown 编辑器和 BBCode 编辑器的差别本来只在「块级语法」：
 * 行内那些（粗斜删除线、字号颜色链接）两套语法其实一一对应。
 * 所以合成一个渲染管道：
 *   · 行内：BBCode 标签先换掉，剩下交给 Markdown（bbInline 已经嵌在 mdToHtml 里）
 *   · 块级：`[quote]` / `[list]` / `[code]` / `[center]` 先各自换成对应 HTML 块，
 *          再让 Markdown 处理中间的普通段落
 *
 * 为什么不是"检测到 BBCode 就走 bbToHtml、否则走 mdToHtml"：
 * 用户经常一段里混着写（从论坛粘一段带 [b] 的，后面接着用 ** 强调）。
 * 二选一的检测在这种输入下必然丢一半格式。
 */
export function mixedToHtml(src: string, mdRender: (s: string) => string): string {
  if (!src) return '';
  const blocks: string[] = [];

  // 块级 BBCode 先抽走，占位成 \u0002Bn\u0002，避免被 Markdown 当普通段落
  let pre = src.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_m, c: string) => {
    blocks.push(`<pre><code>${esc(c)}</code></pre>`);
    return `\u0002B${blocks.length - 1}\u0002`;
  });
  pre = pre.replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, (_m, c: string) => {
    blocks.push(`<blockquote>${mdRender(c.trim())}</blockquote>`);
    return `\u0002B${blocks.length - 1}\u0002`;
  });
  pre = pre.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, (_m, c: string) => {
    blocks.push(`<p style="text-align:center">${mdRender(c.trim())}</p>`);
    return `\u0002B${blocks.length - 1}\u0002`;
  });
  pre = pre.replace(/\[list\]([\s\S]*?)\[\/list\]/gi, (_m, body: string) => {
    const items = body.split(/\[\*\]/).map((x) => x.trim()).filter(Boolean);
    blocks.push(`<ul>${items.map((x) => `<li>${mdRender(x)}</li>`).join('')}</ul>`);
    return `\u0002B${blocks.length - 1}\u0002`;
  });

  /*
   * 占位符单独成段时要包一层 <p>，否则 Markdown 会把它当裸文本塞进段落，
   * 结果 <pre> 跑到 <p> 里面 —— 块级元素嵌在段落里，浏览器会强行拆开，版面就乱了。
   */
  const html = mdRender(pre).replace(/\u0002B(\d+)\u0002/g, (_m, i: string) => blocks[Number(i)] ?? '');
  return html;
}
