/**
 * 第 88 条：导入 / 自定义图标组。
 *
 * 用户原话：「也要允许用户自由选择组件组，或者导入组件组，或者自定义某个 icon」。
 * 自由选择那部分由内置六套解决；这里解决后两件：
 *
 *   ① 导入一整组（一份 JSON，语义名 → svg 内层）
 *   ② 只改某几个（用内部收集的单枚覆盖合并进去）
 *
 * 为什么把解析单独放一个文件：这里最容易出问题 —— 用户手上的素材形态千奇百怪
 * （别人给的图标包、iconify 的 JSON、自己从 Figma 导的 svg），
 * 解析逻辑跟 UI 混在一起，改一次就得动设置页。分开之后只在这里兼容各种形状。
 */

export interface IconPack {
  name: string;
  viewBox: string;
  icons: Record<string, string>;
}

/** 图标组 JSON 有多大。单文件应用靠 settings 存，太小没关系，太大要拦一下 */
export const PACK_SIZE_LIMIT = 512 * 1024;

/**
 * 从一段 svg 文本里拆出 viewBox 和内层图形。
 *
 * 之所以要拆：图标组件是按「内层 set 进 svg」渲染的（这样 stroke / fill 能跟着主题色走），
 * 直接把整段 <svg> 塞进去会得到嵌套 svg，尺寸和颜色都不听使唤。
 */
export function svgToBody(raw: string): { viewBox: string; body: string } {
  const src = String(raw || '').trim();
  const m = /<svg\b[^>]*>/i.exec(src);
  if (!m) throw new Error('没找到 <svg> 标签，确认一下选的是 svg 文件或粘的是 svg 源码');
  const head = m[0];
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(head);
  const w = /width\s*=\s*["']([\d.]+)/i.exec(head);
  const h = /height\s*=\s*["']([\d.]+)/i.exec(head);
  let inner = src.slice((m.index ?? 0) + head.length);
  inner = inner.replace(/<\/svg>\s*$/i, '').trim();
  if (!inner) throw new Error('这个 svg 里是空的');
  // 没写 viewBox 的 svg（不少设计工具导出的就是这种）就拿宽高拼一个，
  // 否则图标会按 24×24 视口被裁掉一大块
  const viewBox = vb?.[1] || (w && h ? `0 0 ${w[1]} ${h[1]}` : '0 0 24 24');
  return { viewBox, body: inner };
}

/**
 * 解析用户给的图标组 JSON。兼容三种常见形状：
 *
 *   A. 本应用格式      { name, viewBox, icons: { pen: '<path .../>' } }
 *   B. iconify 原始    { prefix, icons: { pen: { body: '<path .../>' } }, width, height }
 *   C. 裸映射          { pen: '<path .../>', calendar: '...' }
 *
 * C 认的人最多（手写最快），但分不清「这一层是图标名」还是「这一层是字段名」，
 * 所以先按 A/B 试，都不像才当 C 处理。
 */
export function parseIconPack(raw: string): IconPack {
  const src = String(raw || '').trim();
  if (!src) throw new Error('还没粘贴内容');

  let o: unknown;
  try {
    o = JSON.parse(src);
  } catch {
    throw new Error('不是合法 JSON（少逗号、用了单引号、或者混了注释都会这样）');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('顶层得是一个对象');

  const rec = o as Record<string, unknown>;
  const iconsIn = rec.icons;
  const icons: Record<string, string> = {};
  let viewBox = '';
  let name = '';

  if (iconsIn && typeof iconsIn === 'object' && !Array.isArray(iconsIn)) {
    // A / B
    name = typeof rec.name === 'string' ? rec.name : '';
    viewBox = typeof rec.viewBox === 'string' ? rec.viewBox : '';
    if (!viewBox) {
      const w = typeof rec.width === 'number' || typeof rec.width === 'string' ? Number(rec.width) : NaN;
      const h = typeof rec.height === 'number' || typeof rec.height === 'string' ? Number(rec.height) : NaN;
      if (w > 0 && h > 0) viewBox = `0 0 ${w} ${h}`;
    }
    for (const [k, v] of Object.entries(iconsIn as Record<string, unknown>)) {
      if (typeof v === 'string') { icons[k] = v; continue; }
      if (v && typeof v === 'object') {
        const body = (v as Record<string, unknown>).body;
        if (typeof body === 'string') icons[k] = body;
      }
    }
  } else {
    // C：裸映射。整段里只要有任意一个值是字符串、且长得像 svg 片段就认
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'string' && (v.includes('<') || v.trim())) icons[k] = v;
    }
  }

  // 值可能是整段 <svg>，统一拆成内层，并顺手校准 viewBox
  let vb = viewBox || '';
  for (const [k, v] of Object.entries(icons)) {
    if (/<svg\b/i.test(v)) {
      const r = svgToBody(v);
      icons[k] = r.body;
      if (!vb) vb = r.viewBox;
    }
  }

  const kept = Object.fromEntries(Object.entries(icons).filter(([, v]) => !!v.trim()));
  const count = Object.keys(kept).length;
  if (!count) throw new Error('里面没解析出任何图标（键是图标名，值是 <path> 之类的图形）');

  return {
    name: name || '我的图标组',
    viewBox: vb || '0 0 24 24',
    icons: kept,
  };
}

/** 把一枚图标并进已有的组里（「自定义某个 icon」用这个） */
export function withOneIcon(pack: IconPack | null, iconName: string, raw: string): IconPack {
  const { viewBox, body } = svgToBody(raw);
  const base: IconPack = pack ?? { name: '我的图标组', viewBox, icons: {} };
  // 只有原来没定过视口时才跟着这一枚走 —— 一组图标理应共用同一个视口
  const nextViewBox = Object.keys(base.icons).length ? base.viewBox : viewBox;
  return { ...base, viewBox: nextViewBox, icons: { ...base.icons, [iconName]: body } };
}

/** 读成字符串时顺手把 BOM 去掉，Windows 记事本存的文件都带 */
export function readPackFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || '').replace(/^\uFEFF/, ''));
    fr.onerror = () => reject(new Error('读取失败'));
    fr.readAsText(f, 'utf-8');
  });
}

/** 存进 settings 之前的体检：太大、或者一枚都没覆盖到，就别写进去 */
export function checkPack(pack: IconPack): string {
  const size = JSON.stringify(pack).length;
  if (size > PACK_SIZE_LIMIT) {
    return `这个图标组太大了（${Math.round(size / 1024)} KB），上限 ${PACK_SIZE_LIMIT / 1024} KB`;
  }
  if (!Object.keys(pack.icons).length) return '一枚图标都没有，导入也没效果';
  return '';
}