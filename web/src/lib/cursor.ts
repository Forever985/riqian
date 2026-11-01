/**
 * 鼠标指针皮肤（第 222 条）。
 *
 * 为什么不用图片文件：这个应用要打成单文件、离线零网络运行，
 * 指针又是「一换就要全套三枚（箭头 / 手 / 文本）」的东西，
 * 丢三个 png 进去既增加体积、又得考虑 DPI 缩放。所以全部用内联 SVG data-URI，
 * 矢量、任意缩放都清楚，也省掉请求。
 *
 * 每套皮肤给三枚光标：
 *   cur     —— 常态箭头（16~32px 最容易看清，这里统一 24×24 坐标系）
 *   pointer —— 可点（手 / 指）
 *   text    —— 文本输入（I 形竖线）
 *
 * 说明：Windows 上 `cursor:url()` 的自定义指针有个上限 ——
 * 超过 128×128 或者 .cur/.ani 以外的格式，部分系统会忽略并回落成系统箭头。
 * SVG data-URI 在现代 WebView2（Chromium 105+）里是可用的，这也是本项目的最低要求。
 */

export type CursorKey = 'auto' | 'shadow' | 'ring' | 'beam' | 'ink' | 'pixel';

export interface CursorSkin {
  k: CursorKey;
  n: string;
  note: string;
  /** 箭头；空 = 用系统原生，不接管 */
  cur?: string;
  pointer?: string;
  text?: string;
  /** 热点坐标，相对 24×24 坐标系。不填按箭头左上角算 */
  hot?: [number, number];
}

/** SVG 源码 → data-URI。用 encodeURIComponent 而不是 base64，源码可读、体积更小 */
function svg(inner: string, opts: { stroke?: boolean } = {}): string {
  const body = opts.stroke === false
    ? inner
    : inner;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(s).replace(/'/g, '%27')}")`;
}

/**
 * 画一枚「指针」形状。
 * @param fill 主体填充
 * @param line 描边（白色描边能让指针在深色背景上也不消失，系统箭头就是这个做法）
 */
function arrow(fill: string, line: string, dx = 0, dy = 0): string {
  // 经典箭头路径：左上角为热点，尖端朝右下
  const d = 'M2 2 L2 18.5 L6.4 14.6 L9.2 20.8 L12.2 19.4 L9.4 13.3 L15.4 13.1 Z';
  return `<g transform="translate(${dx} ${dy})">
    <path d="${d}" fill="${line}" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>
    <path d="${d}" fill="${fill}"/>
  </g>`;
}

/** 手形指针（食指向上） */
function hand(fill: string, line: string): string {
  const d = 'M9 3.2a1.6 1.6 0 0 1 1.6 1.6v6.1h.6V6.2a1.5 1.5 0 0 1 3 0v4.7h.6V7.6a1.4 1.4 0 0 1 2.8 0v6.1c0 3.6-2.2 6.3-5.6 6.3-2.4 0-3.7-1-4.9-2.7l-2.4-3.5a1.5 1.5 0 0 1 2.3-1.9l1.5 1.4V4.8A1.6 1.6 0 0 1 9 3.2Z';
  return `<g>
    <path d="${d}" fill="${line}" stroke="${line}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="${d}" fill="${fill}"/>
  </g>`;
}

/** I 形文本光标 */
function ibeam(fill: string, line: string): string {
  const d = 'M8 3h8v2h-3v14h3v2H8v-2h3V5H8Z';
  return `<g>
    <path d="${d}" fill="${line}" stroke="${line}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="${d}" fill="${fill}"/>
  </g>`;
}

export const CURSORS: CursorSkin[] = [
  {
    k: 'auto',
    n: '系统默认',
    note: '不接管，用 Windows 自己的指针',
  },
  {
    k: 'shadow',
    n: '软阴影箭头',
    note: '深色填充 + 白描边，任何底色上都看得清',
    cur: svg(arrow('#26221d', '#ffffff')),
    pointer: svg(hand('#26221d', '#ffffff')),
    text: svg(ibeam('#26221d', '#ffffff')),
    hot: [2, 2],
  },
  {
    k: 'ring',
    n: '主色圆点',
    note: '箭头换成带圆环的点，强调位置感',
    cur: svg(
      '<circle cx="6" cy="6" r="3.4" fill="#b8623a" stroke="#ffffff" stroke-width="1.6"/>'
      + '<circle cx="6" cy="6" r="1" fill="#ffffff"/>'
      + '<path d="M9 9 L17 17" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round"/>'
      + '<path d="M9 9 L17 17" stroke="#b8623a" stroke-width="1.6" stroke-linecap="round"/>',
    ),
    pointer: svg(hand('#b8623a', '#ffffff')),
    text: svg(ibeam('#b8623a', '#ffffff')),
    hot: [6, 6],
  },
  {
    k: 'beam',
    n: '极细线条',
    note: '只剩一根针尖，看起来最轻',
    cur: svg(
      '<path d="M3 3 L3 17" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>'
      + '<path d="M3 3 L3 17" stroke="#26221d" stroke-width="1.2" stroke-linecap="round"/>'
      + '<path d="M3 3 L10 10" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>'
      + '<path d="M3 3 L10 10" stroke="#26221d" stroke-width="1.2" stroke-linecap="round"/>',
    ),
    pointer: svg(hand('#26221d', '#ffffff')),
    text: svg(ibeam('#26221d', '#ffffff')),
    hot: [3, 3],
  },
  {
    k: 'ink',
    n: '墨色实心',
    note: '实心大箭头，落点最稳，适合深色主题',
    cur: svg(arrow('#f2f2f0', '#141412')),
    pointer: svg(hand('#f2f2f0', '#141412')),
    text: svg(ibeam('#f2f2f0', '#141412')),
    hot: [2, 2],
  },
  {
    k: 'pixel',
    n: '像素风',
    note: '硬边方块箭头，复古感',
    cur: svg(
      '<g shape-rendering="crispEdges">'
      + '<path d="M2 2h2v2H2zM2 4h2v2H2zM2 6h2v2H2zM2 8h2v2H2zM2 10h2v2H2zM2 12h2v2H2zM2 14h2v2H2z'
      + 'M4 4h2v2H4zM4 6h2v2H4zM4 8h2v2H4zM4 10h2v2H4zM4 12h2v2H4z'
      + 'M6 6h2v2H6zM6 8h2v2H6zM6 10h2v2H6zM6 12h2v2H6zM6 14h2v2H6z'
      + 'M8 8h2v2H8zM8 10h2v2H8zM8 12h2v2H8zM8 14h2v2H8zM8 16h2v2H8z'
      + 'M10 10h2v2h-2zM10 12h2v2h-2zM10 14h2v2h-2z"'
      + ' fill="#141412"/>'
      + '</g>',
    ),
    pointer: svg(hand('#141412', '#ffffff')),
    text: svg(ibeam('#141412', '#ffffff')),
    hot: [2, 2],
  },
];

export function cursorOf(k?: string): CursorSkin {
  return CURSORS.find((x) => x.k === k) || CURSORS[0];
}

/**
 * 把皮肤写到 :root 的 CSS 变量上，并挂 `data-cursor` 标记。
 *
 * 关键点：不改名成 `--cur` 之外的任何东西 —— `styles.css` 里挂的兜底规则
 * 只在 `html[data-cursor]` 存在时生效，否则全站仍是浏览器默认行为。
 * 这样「系统默认」这一档是真正的一刀不碰。
 */
export function applyCursor(k?: string) {
  const html = document.documentElement;
  const skin = cursorOf(k);
  if (!skin.cur) {
    html.removeAttribute('data-cursor');
    html.style.removeProperty('--cur');
    html.style.removeProperty('--cur-pointer');
    html.style.removeProperty('--cur-text');
    return;
  }
  const hot = skin.hot || [2, 2];
  const pack = (u?: string) => (u ? `${u} ${hot[0]} ${hot[1]}, auto` : 'auto');
  html.setAttribute('data-cursor', skin.k);
  html.style.setProperty('--cur', pack(skin.cur));
  html.style.setProperty('--cur-pointer', pack(skin.pointer));
  html.style.setProperty('--cur-text', pack(skin.text));
}