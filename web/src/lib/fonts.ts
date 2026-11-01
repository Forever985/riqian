/**
 * 第 107 / 170 条：字体库。
 *
 * 用户原话：「"字体"字体库大幅缺少，而且尚未允许用户自行导入」「提供更多字体」。
 *
 * 分两层：
 *   ① 预设 —— 只是「一串 font-family」，靠系统里已装的字体生效，零成本。
 *      这里的原则是「不代表系统一定有」，所以在选项里把中英文各自常见的名字
 *      都列上（Windows / macOS 混排），浏览器自己会挑第一个存在的。
 *   ② 导入 —— 用户把自己下载的字体文件放进「字体」目录，这里读字节、
 *      用 FontFace 注册进 document.fonts，得到一个本页专属的 family 名。
 *
 * 为什么用 FontFace 而不是 @font-face { src: url(...) }：
 *   页面 origin 是 https://riqian-app.example，字体文件在 <数据目录>/字体/，
 *   两者不同源，@font-face 拉字体要过 CORS，而 WebView2 的虚拟主机映射不发这个头。
 *   FontFace 直接吃 ArrayBuffer，根本不走网络，绕开了整件事。
 */

import { api } from '../api';

/** 预设字体。value 直接写进 settings.fontFamily */
export interface FontPreset {
  /** 显示名 */
  n: string;
  /** font-family 字符串 */
  v: string;
  /** 归到哪一组，UI 里分开显示 */
  g: 'sans' | 'serif' | 'kai' | 'mono' | 'latin';
  /** 一句人话说明，搜索时也算关键词 */
  kw?: string;
}

/**
 * 预设表。
 *
 * 每一项都写成「前面是具体的、后面是兜底」的形式 —— 比如
 * `"PingFang SC","Microsoft YaHei",sans-serif` 在 mac 上命中第一个、
 * 在 Windows 上第一个不存在自动落到第二个。写单个名字的项（楷体、幼圆）
 * 是特例：这类字体没有跨平台等价物，就该让它在没装的时候退回下面那层。
 */
export const FONT_PRESETS: FontPreset[] = [
  // ---- 无衬线 ----
  { n: '无衬线（黑体）', v: '"PingFang SC","Microsoft YaHei",sans-serif', g: 'sans', kw: '黑体 苹方 雅黑 sans heiti' },
  { n: '微软雅黑', v: '"Microsoft YaHei","PingFang SC",sans-serif', g: 'sans', kw: '雅黑 windows yahei' },
  { n: '苹方', v: '"PingFang SC","Microsoft YaHei",sans-serif', g: 'sans', kw: '苹方 mac pingfang' },
  { n: '思源黑体 / Noto Sans', v: '"Source Han Sans SC","Noto Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif', g: 'sans', kw: '思源黑体 开源 source han noto' },
  { n: '鸿蒙 Sans', v: '"HarmonyOS Sans SC","HarmonyOS Sans","Microsoft YaHei",sans-serif', g: 'sans', kw: '鸿蒙 harmony' },
  { n: '阿里巴巴普惠体', v: '"Alibaba PuHuiTi","Alibaba PuHuiTi 3.0","Microsoft YaHei",sans-serif', g: 'sans', kw: '阿里巴巴 普惠 alibaba puhuiti' },
  { n: '更纱黑体', v: '"Sarasa Gothic SC","Sarasa UI SC","Microsoft YaHei",sans-serif', g: 'sans', kw: '更纱 sarasa gothic' },
  { n: '等线', v: 'DengXian,"Microsoft YaHei",sans-serif', g: 'sans', kw: '等线 dengxian' },
  { n: '幼圆', v: 'YouYuan,"Microsoft YaHei",sans-serif', g: 'sans', kw: '幼圆 youyuan 圆体' },

  // ---- 衬线 / 宋体 ----
  { n: '衬线（宋体）', v: '"Songti SC",SimSun,serif', g: 'serif', kw: '宋体 衬线 simsun songti' },
  { n: '思源宋体 / Noto Serif', v: '"Source Han Serif SC","Noto Serif SC","Noto Serif CJK SC","Songti SC",SimSun,serif', g: 'serif', kw: '思源宋体 开源 source han serif noto' },
  { n: '仿宋', v: 'FangSong,"FangSong SC",STFangsong,serif', g: 'serif', kw: '仿宋 fangsong' },
  { n: '报宋', v: 'STSong,SimSun,serif', g: 'serif', kw: '报宋 stsong' },

  // ---- 楷体 / 手写 ----
  { n: '楷体', v: '"Kaiti SC",KaiTi,STKaiti,serif', g: 'kai', kw: '楷体 楷书 kaiti' },
  { n: '霞鹜文楷', v: '"LXGW WenKai","LXGW WenKai Screen",KaiTi,serif', g: 'kai', kw: '霞鹜文楷 文楷 lxgw wenkai' },
  { n: '霞鹜新晰黑', v: '"LXGW Neo XiHei","LXGW NeoXiHei",sans-serif', g: 'kai', kw: '霞鹜 新晰黑 lxgw neo xihei' },
  { n: '行楷', v: 'STXingkai,"Xingkai SC",KaiTi,serif', g: 'kai', kw: '行楷 xingkai' },
  { n: '隶书', v: 'LiSu,STLiti,"Liti SC",serif', g: 'kai', kw: '隶书 lisu liti' },

  // ---- 西文 ----
  { n: '西文衬线', v: 'Georgia,"Times New Roman",serif', g: 'latin', kw: '西文 衬线 georgia times' },
  { n: 'Times', v: '"Times New Roman",Times,serif', g: 'latin', kw: 'times 泰晤士' },
  { n: 'Garamond', v: 'Garamond,"EB Garamond",Georgia,serif', g: 'latin', kw: 'garamond' },
  { n: '西文无衬线', v: 'Inter,"Helvetica Neue",Helvetica,Arial,sans-serif', g: 'latin', kw: '西文 无衬线 inter helvetica arial' },
  { n: 'Segoe UI', v: '"Segoe UI",Roboto,"Helvetica Neue",sans-serif', g: 'latin', kw: 'segoe 微软' },

  // ---- 等宽 ----
  { n: '等宽', v: 'ui-monospace,Consolas,monospace', g: 'mono', kw: '等宽 代码 mono consolas' },
  { n: 'Consolas', v: 'Consolas,"Courier New",monospace', g: 'mono', kw: 'consolas' },
  { n: 'JetBrains Mono', v: '"JetBrains Mono",Consolas,monospace', g: 'mono', kw: 'jetbrains mono 编程字体' },
  { n: 'Fira Code', v: '"Fira Code",Consolas,monospace', g: 'mono', kw: 'fira code 连字' },
  { n: '更纱等宽', v: '"Sarasa Mono SC",Consolas,monospace', g: 'mono', kw: '更纱 等宽 sarasa mono' },
];

export const FONT_GROUP_NAME: Record<FontPreset['g'], string> = {
  sans: '无衬线',
  serif: '衬线 / 宋体',
  kai: '楷体 / 手写',
  latin: '西文',
  mono: '等宽',
};

/* ---------------- 导入的字体 ---------------- */

/** 一个导入字体文件（后端 font.list 的形状） */
export interface ImportedFont {
  file: string;
  label: string;
  size: number;
  ext: string;
  at: string;
}

/**
 * 导入字体的 family 名规则。
 *
 * 用 `Rq:<文件名>` 前缀是为了两件事：
 *   ① 一眼能看出这是「用户导入的」而不是系统字体，排查样式问题时不用猜；
 *   ② applyAppearance 判断要不要异步补加载时，字符串开头就够了，不必查表。
 * 文件名里可能有空格、括号（重名时会生成 "abc (2).ttf"），
 * family 名带这些字符在 CSS 里用引号包起来就能正常解析，不必转义。
 */
export const IMPORT_PREFIX = 'Rq:';

export function importFamily(file: string): string {
  return IMPORT_PREFIX + file;
}

/** 拼出可直接写进 --font 的 font-family 串，兜底交给系统无衬线 */
export function importFamilyCss(file: string): string {
  return `"${importFamily(file)}","PingFang SC","Microsoft YaHei",sans-serif`;
}

export function isImportFamily(v: string): boolean {
  return String(v || '').includes(IMPORT_PREFIX);
}

/** 从一条 fontFamily 串里把导入字体的文件名抠出来（没有就返回空） */
export function importFileOf(v: string): string {
  const m = new RegExp(`"${IMPORT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^"]+)"`).exec(String(v || ''));
  return m ? m[1] : '';
}

/** 已经注册进 document.fonts 的，不重复注册 */
const loaded = new Set<string>();
/** 正在加载的，防止同一文件并发请求两次 */
const loading = new Map<string, Promise<boolean>>();

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

/**
 * 把一个字体文件注册进页面。
 *
 * 返回 true 表示「这个 family 现在可用了」。失败不抛 —— 字体加载失败不该
 * 让整个界面报错，退回兜底字体继续用就是了。
 */
export async function loadImportedFont(file: string): Promise<boolean> {
  if (!file) return false;
  if (loaded.has(file)) return true;
  const inflight = loading.get(file);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      const r = await api.font.bytes(file);
      if (!r?.ok || !r.data) return false;
      const face = new FontFace(importFamily(file), base64ToBuffer(r.data), {
        // style / weight 都按普通处理：用户导的是「某一款字」，
        // 想要粗体应该导粗体那个文件，而不是让我们猜。
        style: 'normal',
        weight: '400',
      });
      await face.load();
      document.fonts.add(face);
      loaded.add(file);
      return true;
    } catch {
      return false;
    } finally {
      loading.delete(file);
    }
  })();

  loading.set(file, task);
  return task;
}

/**
 * 启动 / 切换字体时调用：把当前 settings.fontFamily 里引用到的导入字体补加载。
 *
 * 存在的意义：用户在设置里选了一个导入字体，这个选择存进了数据库。
 * 下次开程序时 applyAppearance 是同步跑的，那时候 FontFace 还没注册好，
 * 于是第一屏会用兜底字体、等注册完再刷一次 —— 会看到一次明显的字体跳动。
 * 提前在这里 await 一次，就能让首屏直接是对的。
 *
 * 返回值：true 表示「确实加载了东西，需要重新 applyAppearance」。
 */
export async function ensureImportedFont(fontFamily: string): Promise<boolean> {
  const file = importFileOf(fontFamily);
  if (!file) return false;
  const wasLoaded = loaded.has(file);
  const ok = await loadImportedFont(file);
  return ok && !wasLoaded;
}

/** 已注册过的清掉（用户删了字体文件时用） */
export function forgetImportedFont(file: string): void {
  loaded.delete(file);
  try {
    document.fonts.forEach((f) => {
      if (f.family === importFamily(file)) document.fonts.delete(f);
    });
  } catch {
    /* 老浏览器没有 delete，忽略 */
  }
}

/** 这个文件注册过了吗。给 applyAppearance 做同步判断用 */
export function loadedImported(file: string): boolean {
  return loaded.has(file);
}

/**
 * FontFace 注册完成后，让已经生效的 --font 真正重排一次。
 *
 * 为什么不能只把 --font 再设一遍：值没变，浏览器认为无需重算，
 * 画面就停在「用兜底字体画的」那一版上，要等下次别的样式变动才刷。
 * 强制重排最简单的办法是给 <html> 挂一个空属性再摘掉 —— 一次样式失效，成本极低。
 */
export function syncImportedFont(fontFamily: string): void {
  const html = document.documentElement;
  html.style.setProperty('--font', fontFamily);
  html.setAttribute('data-font-sync', '1');
  // 读一次布局，逼浏览器把上面那步提交掉，再摘属性触发第二次重算
  void html.offsetHeight;
  html.removeAttribute('data-font-sync');
}

/** 人类可读的大小 */
export function humanSize(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}