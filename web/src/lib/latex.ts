/**
 * LaTeX 公式：完全离线。
 *
 * 用的是 KaTeX，字体已由 scripts/prep-katex.mjs 转成 data URI 内联到
 * katex.gen.css 里 —— 单文件 HTML + 单 exe，不需要联网、不需要外部资源目录。
 *
 * 存进数据库的是**渲染后的 HTML**（包在 span.tex 里），不是 TeX 源码：
 * 这样流、记录、总结、分享页拿到的都是现成的，不用在每处再挂一个渲染器；
 * 代价是单个公式约 1–2KB，对日记这种量级完全可接受。
 */
import katex from 'katex';
import './katex.gen.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** TeX → HTML。出错时退化成红色代码，不吞掉用户输入。 */
export function texHtml(tex: string, display = false): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'html',
    });
  } catch {
    return `<code class="tex-bad">${esc(tex)}</code>`;
  }
}

/** 编辑器里插入的节点：contenteditable=false 的孤岛，点它可以改公式。 */
export function texNodeHtml(tex: string, display = false): string {
  return `<span class="tex" data-tex="${esc(tex)}" data-display="${display ? '1' : '0'}"`
    + ` contenteditable="false" title="点一下编辑公式">${texHtml(tex, display)}</span>`;
}

/**
 * Markdown 里的 $...$ / $$...$$。
 * 要求开括号后不是空白、闭括号前不是空白，避免把「$5 到 $10」这种价格当成公式；
 * 纯数字内容也放过（价格、金额远比公式常见）。
 */
const INLINE_TEX = /\$(?!\s)([^\n$]{1,400}?)(?<!\s)\$/g;
const BLOCK_TEX = /\$\$([\s\S]{1,2000}?)\$\$/g;

export function renderTexInMarkdown(src: string, format: (s: string) => string): string {
  // 必须在 Markdown 转义之前就把公式抽走：否则 TeX 里的 < & > 会被转成实体，
  // KaTeX 拿到的是 &lt; 而不是 <，公式直接渲染错。
  const keep: string[] = [];
  const hold = (html: string) => { keep.push(html); return `\u0000TEX${keep.length - 1}\u0000`; };

  let s = src.replace(BLOCK_TEX, (_m, body: string) => hold(texNodeHtml(body.trim(), true)));
  s = s.replace(INLINE_TEX, (m, body: string) => {
    if (/^\d+(\.\d+)?$/.test(body)) return m;      // $5$ 这种更像金额，不当公式
    return hold(texNodeHtml(body.trim(), false));
  });

  s = format(s);
  return s.replace(/\u0000TEX(\d+)\u0000/g, (_m, i: string) => keep[Number(i)]);
}

/** 段落里有没有公式（给「插入公式」按钮判断用，也用于给正文加样式类） */
export function hasTex(html: string): boolean {
  return /class="tex"/.test(html || '');
}
