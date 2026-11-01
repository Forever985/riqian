/**
 * 第 179 条：背景轮换 + 模块级背景。
 *
 * 原文：「发现背景确实可以添加，但尚未能轮换。每个模块功能也似乎没有看到可以
 * 设置模块功能背景的地方」。
 *
 * 两件事分开做：
 *
 * 1）轮换 —— 用户挑一组图，隔 N 秒换一张。
 *    为什么不用 `setInterval` 直接改 `settings.bgGlobal`：
 *      写库是异步的，每换一张都落一次盘，一天下来把 changes 表刷满；
 *      而且设置页里那个「背景」值会一直抖，用户以为自己被改了东西。
 *    所以轮换只活在前端内存里，`bgRotate` 存的是「间隔秒数 + 图池」，
 *    当前显示第几张完全不落库。
 *
 * 2）模块背景 —— 挂在 modules.config 上（已有字段，不用建表）。
 *    为什么用 config 而不是 settings：模块是会被删的，
 *    删了之后它的背景配置该跟着走，不能被留在 settings 里变成垃圾。
 */
import { useEffect } from 'react';
import { useStore } from '../store';
import { imgUrl } from '../lib/media';

/** bgRotateList 里存的是媒体 id 数组（JSON），bgRotate 是间隔秒数，0 = 不轮换 */
export interface RotateCfg {
  /** 秒 */
  sec: number;
  /** 图池，媒体 id */
  ids: string[];
}

export function parseRotate(sec: unknown, list: unknown): RotateCfg {
  const n = Number(sec) || 0;
  let ids: string[] = [];
  if (typeof list === 'string' && list) {
    try {
      const v = JSON.parse(list);
      if (Array.isArray(v)) ids = v.filter((x): x is string => typeof x === 'string' && !!x);
    } catch { ids = []; }
  }
  return { sec: n > 0 ? Math.max(5, Math.min(3600, n)) : 0, ids };
}

/**
 * 轮换器：挂在 App 上，全局唯一。
 *
 * 换图时**只动一个 DOM 属性**，不 setState —— 苹果机的老 WebView2 上，
 * 每秒 setState 一次会把整个应用重渲染，滚动都能看出来卡。
 * 这里直接改 <div class="gbg"> 的 backgroundImage，配合 CSS 的淡入，
 * 视觉上是平滑过渡，代价接近零。
 */
export function useBgRotate(): void {
  const sec = useStore((s) => String(s.settings.bgRotate || '0'));
  const list = useStore((s) => String(s.settings.bgRotateList || ''));

  useEffect(() => {
    const cfg = parseRotate(sec, list);
    if (!cfg.sec || cfg.ids.length < 2) return;

    let i = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>('.gbg');
      if (!el) return;
      i = (i + 1) % cfg.ids.length;
      const src = imgUrl(cfg.ids[i]);
      if (!src) return;
      el.style.backgroundImage = `url('${src}')`;
      /* 淡入：先降透明度再回来，比直接换图少了那种"啪"一下的突兀 */
      el.animate(
        [{ opacity: 0.35 }, { opacity: 1 }],
        { duration: 700, easing: 'ease-out' },
      );
    };

    const t = window.setInterval(tick, cfg.sec * 1000);
    return () => window.clearInterval(t);
  }, [sec, list]);
}

/* ---------------- 模块级背景 ---------------- */

export interface ModuleBg {
  /** 媒体 id 或 #色值，空 = 不设 */
  src: string;
  /** 压暗程度 0–0.9 */
  veil: number;
  /** 透明程度 0–0.9：让卡片底色透出来，图不会把内容盖死 */
  alpha: number;
}

export const MOD_BG_EMPTY: ModuleBg = { src: '', veil: 0.18, alpha: 0.35 };

/** 从 modules.config（一个 JSON 字符串）里读模块背景 */
export function readModuleBg(config: unknown): ModuleBg {
  if (typeof config !== 'string' || !config) return { ...MOD_BG_EMPTY };
  try {
    const o = JSON.parse(config) as { bg?: Partial<ModuleBg> };
    const b = o?.bg;
    if (!b || typeof b.src !== 'string' || !b.src) return { ...MOD_BG_EMPTY };
    return {
      src: b.src,
      veil: typeof b.veil === 'number' ? b.veil : MOD_BG_EMPTY.veil,
      alpha: typeof b.alpha === 'number' ? b.alpha : MOD_BG_EMPTY.alpha,
    };
  } catch {
    return { ...MOD_BG_EMPTY };
  }
}

/**
 * 把模块背景写回 config。
 *
 * 必须**合并**而不是覆盖：config 里还有别的模块自己的参数（比如打卡模块的
 * 目标值、待办模块显示哪几个清单），整份盖掉等于把那些设置清了。
 */
export function writeModuleBg(config: unknown, bg: ModuleBg): string {
  let o: Record<string, unknown> = {};
  if (typeof config === 'string' && config) {
    try {
      const v = JSON.parse(config);
      if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
    } catch { o = {}; }
  }
  if (!bg.src) delete o.bg;
  else o.bg = bg;
  return JSON.stringify(o);
}

/**
 * 模块背景层要用的内联样式。
 *
 * 用伪元素做不到（内联样式写不了 ::before），所以调用方要在卡片里
 * 塞一个绝对定位的子 div，卡片本身 position:relative + overflow:hidden。
 */
export function moduleBgStyle(bg: ModuleBg): React.CSSProperties {
  const src = bg.src.startsWith('#') ? '' : imgUrl(bg.src);
  if (bg.src.startsWith('#')) {
    return {
      position: 'absolute',
      inset: 0,
      background: bg.src,
      opacity: 1 - bg.alpha,
      pointerEvents: 'none',
      zIndex: 0,
      borderRadius: 'inherit',
    };
  }
  if (!src) return { display: 'none' };
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: `url('${src}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    opacity: 1 - bg.alpha,
    pointerEvents: 'none',
    zIndex: 0,
    borderRadius: 'inherit',
  };
}

/** 压暗蒙层：图太亮时文字看不清，单独一层半透明黑 */
export function veilStyle(bg: ModuleBg): React.CSSProperties {
  if (!bg.src || bg.veil <= 0) return { display: 'none' };
  return {
    position: 'absolute',
    inset: 0,
    background: `rgba(0,0,0,${bg.veil})`,
    pointerEvents: 'none',
    zIndex: 1,
    borderRadius: 'inherit',
  };
}