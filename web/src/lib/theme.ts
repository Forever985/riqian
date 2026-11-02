import type { Settings } from '../types';
import { api } from '../api';
import { applyCursor } from './cursor';
import { setDayStart, setTimezone, setHour12, setDateFormat, setLang } from './date';
import { ensureImportedFont, importFileOf, loadedImported, syncImportedFont } from './fonts';

export const THEMES = [
  { k: 'paper', n: '纸质', c: ['#f4f1e9', '#fffdf8', '#b8623a'] },
  { k: 'ink', n: '墨黑', c: ['#14130f', '#1e1c18', '#dd8a5c'] },
  { k: 'night', n: '深夜蓝', c: ['#0e1421', '#16203a', '#6ea8ff'] },
  { k: 'forest', n: '森林', c: ['#eef2e9', '#fbfdf8', '#3f7d4e'] },
  { k: 'rose', n: '玫瑰', c: ['#f9eef0', '#fffbfc', '#b04a6b'] },
  { k: 'mono', n: '极简灰', c: ['#f2f2f0', '#ffffff', '#4a4a48'] },
  { k: 'semi', n: 'Semi', c: ['#f2f3f5', '#ffffff', '#0064fa'] },
] as const;

/** 老版本存的 light/dark 要映射到新主题名，否则整套 CSS 变量都取不到 */
const THEME_ALIAS: Record<string, string> = { light: 'paper', dark: 'ink', auto: 'paper' };
const THEME_ALL = THEMES.map((t) => t.k) as readonly string[];

export function normalizeTheme(t?: string): string {
  const k = THEME_ALIAS[t || ''] || t || 'paper';
  /*
   * #241：`pack:<id>` 是「装来的主题包」占的槽名，不是内置主题。
   * 早先这里一律回退到 paper，结果装了主题包毫无反应 ——
   * 值存进去了，但 applyAppearance 读的是 normalize 之后的名字，
   * 于是 `themeCustom['pack:xxx']` 那一条永远取不到，页面永远停在 paper。
   *
   * 现在原样保留：`html.dataset.theme` 会变成 "pack:xxx"，
   * CSS 里没有这个选择器，所有变量落到 :root/paper 那套出厂值；
   * 紧接着 applyAppearance 用内联 style 覆盖成包里那 16 个颜色
   * （内联优先级最高，压得住 :root 的规则）。这正是"覆盖"该有的顺序。
   */
  if (k.startsWith(THEME_PACK_PREFIX)) return k;
  return THEME_ALL.includes(k) ? k : 'paper';
}

/** 主题包槽名前缀，和 lib/extensions.ts 里的 THEME_KEY_PREFIX 必须一致 */
export const THEME_PACK_PREFIX = 'pack:';

/* ================= RGB 自定义 ================= */

/** 可调的 16 个色槽，按「背景 → 文字 → 强调 → 语义」从外到内分组，便于查找 */
export const COLOR_SLOTS: { key: string; label: string; group: string }[] = [
  { key: 'bg', label: '页面底色', group: '背景' },
  { key: 'side', label: '侧边栏', group: '背景' },
  { key: 'panel', label: '卡片 / 面板', group: '背景' },
  { key: 'panel2', label: '次级面板', group: '背景' },
  { key: 'ink', label: '正文', group: '文字' },
  { key: 'ink2', label: '次要文字', group: '文字' },
  { key: 'ink3', label: '弱化文字', group: '文字' },
  { key: 'line', label: '分隔线', group: '线条' },
  { key: 'line2', label: '浅分隔线', group: '线条' },
  { key: 'accent', label: '主色', group: '强调' },
  { key: 'accent2', label: '主色（深）', group: '强调' },
  { key: 'accentSoft', label: '主色浅底', group: '强调' },
  { key: 'ok', label: '成功', group: '语义' },
  { key: 'warn', label: '警告', group: '语义' },
  { key: 'bad', label: '危险', group: '语义' },
  { key: 'blue', label: '链接 / 信息', group: '语义' },
];

export type ThemeColors = Record<string, string>;

/** 各主题的出厂值：改坏了能一键还原，也是「复制当前」的来源 */
export const THEME_DEFAULTS: Record<string, ThemeColors> = {
  paper: {
    bg: '#f4f1e9', side: '#ede8dd', panel: '#fffdf8', panel2: '#faf7f0',
    ink: '#26221d', ink2: '#6d6459', ink3: '#9c9386', line: '#e4ddce', line2: '#efe9dc',
    accent: '#b8623a', accent2: '#8e4726', accentSoft: '#f6e6dc',
    ok: '#5f8256', warn: '#b8863a', bad: '#b3483f', blue: '#4a7396',
  },
  ink: {
    bg: '#14130f', side: '#191712', panel: '#1e1c18', panel2: '#242119',
    ink: '#ece6da', ink2: '#a99f90', ink3: '#7a7264', line: '#332f28', line2: '#2a2721',
    accent: '#dd8a5c', accent2: '#f0a377', accentSoft: '#392a20',
    ok: '#8fae82', warn: '#cfa565', bad: '#d3716a', blue: '#7ba3c4',
  },
  night: {
    bg: '#0e1421', side: '#111a2b', panel: '#16203a', panel2: '#1b2742',
    ink: '#e6edf8', ink2: '#9aa8c0', ink3: '#6f7c93', line: '#243149', line2: '#1d2841',
    accent: '#6ea8ff', accent2: '#9cc4ff', accentSoft: '#1b2b4a',
    ok: '#6fbf94', warn: '#d9b06a', bad: '#d16d6d', blue: '#6ea8ff',
  },
  forest: {
    bg: '#eef2e9', side: '#e7eddf', panel: '#fbfdf8', panel2: '#f4f8ee',
    ink: '#22271f', ink2: '#5f6b57', ink3: '#8b9683', line: '#dbe4d1', line2: '#e6ecdd',
    accent: '#3f7d4e', accent2: '#2e5f3a', accentSoft: '#e2eede',
    ok: '#3f7d4e', warn: '#b08838', bad: '#b0503f', blue: '#4a7396',
  },
  rose: {
    bg: '#f9eef0', side: '#f4e3e7', panel: '#fffbfc', panel2: '#fdf3f5',
    ink: '#2a2022', ink2: '#6f5b60', ink3: '#9d868c', line: '#eed9de', line2: '#f5e6e9',
    accent: '#b04a6b', accent2: '#8c3350', accentSoft: '#f7e0e7',
    ok: '#5f8256', warn: '#b8863a', bad: '#b3483f', blue: '#4a7396',
  },
  mono: {
    bg: '#f2f2f0', side: '#ebebe8', panel: '#ffffff', panel2: '#f7f7f5',
    ink: '#1e1e1c', ink2: '#5f5f5b', ink3: '#8e8e88', line: '#e0e0dc', line2: '#ecece8',
    accent: '#4a4a48', accent2: '#2c2c2a', accentSoft: '#ebebe8',
    ok: '#557a52', warn: '#a8802f', bad: '#a8463f', blue: '#4a6f96',
  },
  /* 字节 Semi Design 的默认色板：品牌蓝 #0064FA + 冷灰阶，白卡片分层靠描边不靠投影 */
  semi: {
    bg: '#f2f3f5', side: '#ffffff', panel: '#ffffff', panel2: '#f7f8fa',
    ink: '#1c1f23', ink2: '#646a73', ink3: '#8f959e', line: '#e5e6eb', line2: '#f0f1f3',
    accent: '#0064fa', accent2: '#004fc4', accentSoft: '#e8f1ff',
    ok: '#00b42a', warn: '#ff7d00', bad: '#f53f3f', blue: '#0064fa',
  },
};

export function parseCustom(raw?: string): Record<string, ThemeColors> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o ? (o as Record<string, ThemeColors>) : {};
  } catch { return {}; }
}

export function applyAppearance(s: Settings) {
  const html = document.documentElement;
  /*
   * 第 56 条：语言在函数最前面就定下来。
   *
   * 下面多处要用它（导航宽度、`<html lang>`、日期词表），
   * 所以必须**先声明再用** —— 早先这三处各写一遍 `String(s.language || ...)`，
   * 改成提到函数顶部一个变量，免得某处漏了兜底值。
   */
  const lang = String(s.language || 'zh-Hans');
  const theme = normalizeTheme(s.theme);
  html.dataset.theme = theme;
  html.dataset.round = (s.round as string) || 'soft';
  html.dataset.density = (s.density as string) || 'normal';
  // 第 76 条：留白与模块间距可自己调。0 = 交给「疏密」三档决定，
  // 所以设成 0 时要 removeProperty，否则内联值会盖住 density 的规则。
  const vp = Number(s.viewPad) || 0;
  if (vp > 0) html.style.setProperty('--viewpad', `${vp}px`); else html.style.removeProperty('--viewpad');
  const gp = Number(s.modGap) || 0;
  if (gp > 0) html.style.setProperty('--modgap', `${gp}px`); else html.style.removeProperty('--modgap');
  html.style.setProperty('--fs', `${Number(s.fontSize) || 16}px`);
  const density = s.density as string;
  html.style.setProperty('--lh', String(Number(s.lineHeight) || (density === 'compact' ? 1.7 : density === 'loose' ? 2.05 : 1.85)));
  /*
   * 第 56 条：导航宽度要跟着语言放宽。
   *
   * 德语是最长的：Einstellungen / Erinnerungen / Tastenkürzel，
   * 在 218px 里全被 `nowrap + ellipsis` 切成「Einstellunge…」。
   * 所以德语默认用 248px。
   *
   * **只在用户没手动调过时才放宽**（218 就是默认值，等于没调过）：
   * 用户拖过宽度说明他有自己的偏好，德语长了 30px 也该由他自己拖，
   * 不该被语言切换悄悄改回去。
   */
  const navW = Number(s.navWidth) || 218;
  const deWide = lang.startsWith('de') && navW === 218;
  html.style.setProperty('--navw', `${deWide ? 248 : navW}px`);
  // v10：内容宽度 / 字体 也能自定义（第 76 条）
  /*
   * 第 153 条：用户说「最大化后导航栏右侧有很大空隙，而且是写死的」。
   *
   * 根因就是这个 --pagew：默认 1080，而 2560×1440 最大化之后可用宽度有两千多，
   * 两边各留几百像素空白，还是 `margin:0 auto` 居中的 —— 用户原话「这完全丧失了
   * 中间空白的功能」。而往右边拖宽又只是把应用再往右挤，空白不吞没。
   *
   * 现在三档：
   *   full  （新默认）铺满整个可用宽度，一点死白都不留 —— 用户要的就是这个
   *   auto  跟随窗口但收在 1600（宽屏写长文时行不至于拉到 2500px）
   *   数字  固定像素，想卡住行宽的人继续用
   * 老用户存着 pageWidth=1080 的照样按数字走，不会突然变形。
   */
  const pw = String(s.pageWidth ?? 'full').trim();
  if (!pw || pw === 'full') html.style.setProperty('--pagew', '100%');
  else if (pw === 'auto') html.style.setProperty('--pagew', '1600px');
  else html.style.setProperty('--pagew', `${Number(pw) || 1080}px`);
  // 全局背景（113）：填色值就直接铺；图片留给后续，先把"能设"这件事落地
  // 全局背景：色值直接当底色；图片（媒体 id）则让 .app 透明，
  // 由 App 里那层 .gbg 显示图片 —— 这样图只铺"墙"，不会盖住卡片内容
  const bg = String(s.bgGlobal || '').trim();
  if (bg.startsWith('#')) html.style.setProperty('--appbg', bg);
  else if (bg) html.style.setProperty('--appbg', 'transparent');
  else html.style.removeProperty('--appbg');
  /*
   * 第 177 / 183 条：给「铺了图片背景」这件事留一个全局标记。
   * 图铺上去之后页面是透明的，正文、子导航、各种按钮全直接压在图上看不清 ——
   * 有了这个属性，CSS 才能在**只在有图时**给内容区补一层底，不影响纯色主题。
   */
  html.toggleAttribute('data-appbg', !!bg && !bg.startsWith('#'));
  const font = String(s.fontFamily || '').trim();
  /*
   * 兜底字体栈要跟着语言走。
   *
   * ⚠️ 这里有个坑：`html.style.setProperty('--font', ...)` 是**内联样式**，
   * 优先级高于任何 CSS 选择器。所以 styles.css 里那两条
   *     html[lang="ja"]{--font:...}  /  html[lang="de"]{--font:...}
   * 在内联值存在时**一行都不生效** —— 实测过，日语界面拿到的还是微软雅黑。
   *
   * 为什么日语不能用微软雅黑：它对假名有一套"中文字形"的写法
   * （比如 直 / 骨 / 今 的钩和撇），日本人一眼就看得出是中文排版软件。
   * 德语不需要特殊字形，但 Segoe UI Variable 的字宽更均匀，
   * 长复合词在窄栏里不容易挤成一坨。
   *
   * 顺序：用户自己选的字体 > 按语言给的推荐栈。
   * 用户显式选过就别抢他的 —— 那条设置的意义就是"我要用这个"。
   */
  const fallbackFont = lang.startsWith('ja')
    ? '-apple-system,BlinkMacSystemFont,"Yu Gothic UI","Meiryo","Hiragino Kaku Gothic ProN","Noto Sans JP","Segoe UI",sans-serif'
    : lang.startsWith('de')
      ? '-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI","Helvetica Neue",Arial,sans-serif'
      : '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
  html.style.setProperty('--font', font || fallbackFont);
  /*
   * 第 107 / 170 条：用户导入的字体是 FontFace 注册进来的，注册是异步的。
   * 这里不能 await（applyAppearance 是同步的、被 React effect 每帧可能调），
   * 所以先按字符串设上 —— 没注册好时浏览器会自动落到后面那个兜底 family，
   * 不至于白屏或方块。注册完成后再调一次 applyAppearance 让渲染对齐。
   * 幂等：已经注册过的，loadImportedFont 会立刻返回 true，不会重复读文件。
   */
  if (font.includes('Rq:')) {
    const file = importFileOf(font);
    if (file && !loadedImported(file)) {
      void ensureImportedFont(font).then((did) => {
        // did 为 false 表示要么本来就加载好了，要么加载失败。
        // 失败就保持兜底，不重刷 —— 免得用户看到一次无意义的闪动。
        if (did) syncImportedFont(font);
      });
    }
  }

  // 第 222 条：鼠标指针皮肤。'auto' / 空 → 完全不接管，交回系统
  applyCursor(String(s.cursorStyle || ''));

  /*
   * 第 17 / 106 / 171 条：这三项原来只在设置页写库，没人读，等于摆设。
   * 现在统一在 applyAppearance 里灌进 lib/date.ts 的模块级变量，
   * 之后 todayKey() / nowHM() 等全部自动跟随。改设置后要重新调一次。
   */
  setDayStart(Number(s.dayStart) || 0);
  setTimezone(s.timezone as string | undefined);
  setHour12(String(s.timeFormat ?? '24'));
  setDateFormat(s.dateFormat as string | undefined);
  /*
   * 第 56 条：语言也要灌进去。
   *
   * date.ts 只维护「今天/昨天/前天」三个词，不从 i18n 引 —— 那样会形成
   * i18n → store → date → i18n 的循环，而这种循环编译期不报错、运行时才
   * undefined。详见 date.ts 顶部那段注释。
   *
   * 顺序上必须在 setDateFormat 之后：fmtDate 会同时看 DATE_FMT 和 LANG
   * （德语在用户没手选顺序时用「日月年+点号」，而不是中文的「年月日」）。
   */
  setLang(String(s.language || 'zh-Hans'));

  /*
   * 第 56 条：`<html lang>` 必须跟着语言走，不能只在 React 里换字符串。
   *
   * 浏览器的这几件事全靠这个属性：
   *   · 自动断行 / 连字符（`hyphens:auto` 只对声明了 lang 的元素生效）
   *   · 字体回退顺序（日文假名会优先挑到日文字体，而不是中文字体里那套假名）
   *   · 朗读器发音
   * CSS 里 `html[lang^="de"]` 那几条 UI 适配规则也依赖它。
   *
   * 用 zh-Hans / ja / de 这些标准标签，不要写 "zh-CN" —— 我们支持的是
   * 简体这一支，让浏览器按 Hans 挑字形。
   */
  if (html.getAttribute('lang') !== lang) html.setAttribute('lang', lang);

  // RGB 自定义：把当前主题的覆盖值写进内联变量（优先级高于主题选择器的规则）
  const custom = parseCustom(s.themeCustom as string | undefined)[theme] || {};
  const all = COLOR_SLOTS.map((x) => x.key);
  for (const key of all) {
    const v = custom[key];
    if (v) html.style.setProperty(`--${key}`, v);
    else html.style.removeProperty(`--${key}`);
  }

  /*
   * 第 195 / 164 条：把皮肤色同步给窗口外壳。
   * 标题栏、边框、托盘右键菜单都在原生那一侧，CSS 管不到；
   * 这里读一遍算好的变量推过去，宿主用 DWM 属性把标题栏染成同色系。
   */
  try {
    const cs = getComputedStyle(html);
    const pick = (k: string) => cs.getPropertyValue(k).trim();
    const bg = pick('--bg');
    let lum = 1;
    const hex = /#([0-9a-f]{6})/i.exec(bg);
    if (hex) {
      const n = parseInt(hex[1], 16);
      lum = (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
    } else {
      const rgb = /rgba?\(([^)]+)\)/.exec(bg);
      if (rgb) {
        const p = rgb[1].split(',').map((x) => Number(x.trim()));
        lum = (p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114) / 255;
      }
    }
    void api.app.chrome({
      panel: pick('--panel'),
      ink: pick('--ink'),
      line: pick('--line'),
      accent: pick('--accent'),
      dark: lum < 0.55 ? 1 : 0,
    }).catch(() => null);
  } catch { /* 纯浏览器里跑（没有宿主）时忽略 */ }
}

export function parseFeatures(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o ? o as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function featureOn(settings: Settings, flag?: string): boolean {
  if (!flag) return true;
  const f = parseFeatures(settings.features as string | undefined);
  return f[flag] !== '0';
}

/** #rrggbb → {r,g,b}，用于把色板拆成三个数字框 */
export function hex2rgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgb2hex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
