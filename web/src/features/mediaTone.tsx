/**
 * 图片参数（调色）。
 *
 * 这一版把参数从 4 个扩到 11 个（第 78 条）：亮度、对比度、饱和度、不透明度、
 * 色温、色调、红/绿/蓝通道、清晰度、模糊。另外给"当背景用"补了三项布局参数。
 *
 * 两个关键实现选择：
 * 1. RGB 通道和色温**不能**用 CSS filter 凑 —— brightness/hue-rotate 只会整体变亮变色，
 *    调不出"偏红"或"偏冷"。这里生成 SVG feColorMatrix 真算矩阵，CSS 里只负责亮度/对比度/饱和度/模糊。
 * 2. 锐化 CSS 没有，用 feConvolveMatrix 卷积核真锐化，不是拿 contrast 假装。
 *
 * 生成的滤镜按参数缓存，同一组参数全应用共用一个 <filter>，不会每张图塞一个。
 */
import { useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog } from '../components/ui';
import { imgUrl } from '../lib/media';
import type { MediaItem } from '../types';

export interface Tone {
  /** 亮度 0–2，1 = 原样 */
  b: number;
  /** 对比度 0–2 */
  c: number;
  /** 饱和度 0–2 */
  s: number;
  /** 不透明度 0–1 */
  o: number;
  /** 色温 -1（冷）– 1（暖） */
  w: number;
  /** 色调旋转 0–360 度 */
  h: number;
  /** 红 / 绿 / 蓝通道增益 0–2 */
  r: number;
  g: number;
  bl: number;
  /** 清晰度（真锐化）0–1 */
  sh: number;
  /** 模糊 0–12 px */
  blur: number;
}

export const TONE_ONE: Tone = {
  b: 1, c: 1, s: 1, o: 1, w: 0, h: 0, r: 1, g: 1, bl: 1, sh: 0, blur: 0,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Number(n.toFixed(2));

/** 把后端存的 JSON 读成参数；坏数据 / 空值 / 老版本四参数都退回默认，不让界面白屏 */
export function parseTone(json?: string | null): Tone {
  const out: Tone = { ...TONE_ONE };
  if (!json) return out;
  try {
    const v = JSON.parse(json) as Partial<Record<keyof Tone, unknown>>;
    const num = (x: unknown, lo: number, hi: number, def: number) => {
      const n = Number(x);
      return Number.isFinite(n) ? clamp(n, lo, hi) : def;
    };
    out.b = num(v.b, 0, 2, 1);
    out.c = num(v.c, 0, 2, 1);
    out.s = num(v.s, 0, 2, 1);
    out.o = num(v.o, 0, 1, 1);
    out.w = num(v.w, -1, 1, 0);
    out.h = num(v.h, 0, 360, 0);
    out.r = num(v.r, 0, 2, 1);
    out.g = num(v.g, 0, 2, 1);
    out.bl = num(v.bl, 0, 2, 1);
    out.sh = num(v.sh, 0, 1, 0);
    out.blur = num(v.blur, 0, 12, 0);
  } catch {
    /* 存坏了就当没调过 */
  }
  return out;
}

/* ---------------- SVG 滤镜：RGB / 色温 / 锐化 ---------------- */

const NS = 'http://www.w3.org/2000/svg';
let svgRoot: SVGSVGElement | null = null;
const filterIds = new Map<string, string>();

function ensureRoot(): SVGSVGElement | null {
  if (typeof document === 'undefined') return null;
  if (svgRoot && svgRoot.isConnected) return svgRoot;
  // 页面重挂过之后旧节点就废了，缓存一并清掉，否则会引用到不存在的 filter
  filterIds.clear();
  let el = document.getElementById('rt-tone-defs') as SVGSVGElement | null;
  if (!el) {
    el = document.createElementNS(NS, 'svg') as SVGSVGElement;
    el.setAttribute('id', 'rt-tone-defs');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('width', '0');
    el.setAttribute('height', '0');
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    document.body.appendChild(el);
  }
  svgRoot = el;
  return el;
}

/** 需要 feColorMatrix / feConvolveMatrix 时返回 `url(#id)`，否则 null */
function ensureSvgFilter(t: Tone): string | null {
  const needColor = Math.abs(t.r - 1) > 0.01 || Math.abs(t.g - 1) > 0.01
    || Math.abs(t.bl - 1) > 0.01 || Math.abs(t.w) > 0.01;
  const needSharp = t.sh > 0.02;
  if (!needColor && !needSharp) return null;

  const key = [round2(t.r), round2(t.g), round2(t.bl), round2(t.w), round2(t.sh)].join('_');
  const id = 'rtone-' + key.replace(/[.-]/g, (m) => (m === '.' ? 'd' : 'm'));
  if (filterIds.has(id)) return `url(#${id})`;

  const root = ensureRoot();
  if (!root) return null;

  const f = document.createElementNS(NS, 'filter');
  f.setAttribute('id', id);
  // 默认是 linearRGB，不显式设成 sRGB 的话颜色会整体发灰
  f.setAttribute('color-interpolation-filters', 'sRGB');

  if (needColor) {
    // 色温用 RGB 偏移实现：暖 = 抬红压蓝，冷 = 反之。比 sepia 近似准得多。
    const offR = t.w * 0.055;
    const offB = -t.w * 0.055;
    const m = document.createElementNS(NS, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    m.setAttribute('values', [
      round2(t.r), 0, 0, 0, round2(offR),
      0, round2(t.g), 0, 0, 0,
      0, 0, round2(t.bl), 0, round2(offB),
      0, 0, 0, 1, 0,
    ].join(' '));
    f.appendChild(m);
  }

  if (needSharp) {
    const k = 0.55 * t.sh;
    const c = document.createElementNS(NS, 'feConvolveMatrix');
    c.setAttribute('order', '3');
    c.setAttribute('preserveAlpha', 'true');
    c.setAttribute('kernelMatrix', `0 ${round2(-k)} 0 ${round2(-k)} ${round2(1 + 4 * k)} ${round2(-k)} 0 ${round2(-k)} 0`);
    f.appendChild(c);
  }

  root.appendChild(f);
  filterIds.set(id, id);
  return `url(#${id})`;
}

/** 参数 → CSS filter 字符串；全默认时返回空串（等于不写 filter） */
export function toneFilter(json?: string | null): string {
  const t = parseTone(json);
  const parts: string[] = [];
  if (Math.abs(t.b - 1) > 0.01) parts.push(`brightness(${round2(t.b)})`);
  // 锐化本身会让人觉得"更清楚但更硬"，这里同时补一点对比，避免锐化后发灰
  const contrast = t.c * (1 + 0.16 * t.sh);
  if (Math.abs(contrast - 1) > 0.01) parts.push(`contrast(${round2(contrast)})`);
  if (Math.abs(t.s - 1) > 0.01) parts.push(`saturate(${round2(t.s)})`);
  if (t.h > 0.5) parts.push(`hue-rotate(${Math.round(t.h)}deg)`);
  if (t.blur > 0.1) parts.push(`blur(${round2(t.blur)}px)`);
  const svg = ensureSvgFilter(t);
  if (svg) parts.push(svg);
  if (t.o < 0.99) parts.push(`opacity(${round2(t.o)})`);
  return parts.join(' ');
}

/** 参数是否等于「没调过」 */
export function toneIsFlat(t: Tone): boolean {
  return Math.abs(t.b - 1) < 0.01 && Math.abs(t.c - 1) < 0.01 && Math.abs(t.s - 1) < 0.01
    && t.o > 0.99 && Math.abs(t.w) < 0.01 && t.h < 0.5
    && Math.abs(t.r - 1) < 0.01 && Math.abs(t.g - 1) < 0.01 && Math.abs(t.bl - 1) < 0.01
    && t.sh < 0.02 && t.blur < 0.1;
}

/* ---------------- 背景：调色 + 铺法 + 蒙层 ---------------- */

export type BgFit = 'cover' | 'contain' | 'tile';

export interface BgOpts {
  t: Tone;
  /** 铺满 / 完整显示 / 平铺 */
  fit: BgFit;
  /** 蒙层 0–0.9：把图压暗一点，文字才看得清 */
  veil: number;
}

export const BG_ONE: BgOpts = { t: { ...TONE_ONE }, fit: 'cover', veil: 0 };

/** 读背景参数；兼容"整个 JSON 就是一份 Tone"的旧数据 */
export function parseBg(json?: string | null): BgOpts {
  if (!json) return { t: { ...TONE_ONE }, fit: 'cover', veil: 0 };
  try {
    const v = JSON.parse(json) as { t?: unknown; fit?: unknown; veil?: unknown };
    if (v && typeof v === 'object' && v.t && typeof v.t === 'object') {
      return {
        t: parseTone(JSON.stringify(v.t)),
        fit: v.fit === 'contain' || v.fit === 'tile' ? v.fit : 'cover',
        veil: clamp(Number(v.veil) || 0, 0, 0.9),
      };
    }
  } catch {
    /* 旧数据是扁平 Tone，往下走 */
  }
  return { t: parseTone(json), fit: 'cover', veil: 0 };
}

/** 存回后端；全默认时给空串，省一次无意义的解析 */
export function bgJson(o: BgOpts): string {
  if (toneIsFlat(o.t) && o.fit === 'cover' && o.veil < 0.01) return '';
  return JSON.stringify({
    t: {
      b: round2(o.t.b), c: round2(o.t.c), s: round2(o.t.s), o: round2(o.t.o),
      w: round2(o.t.w), h: Math.round(o.t.h),
      r: round2(o.t.r), g: round2(o.t.g), bl: round2(o.t.bl),
      sh: round2(o.t.sh), blur: round2(o.t.blur),
    },
    fit: o.fit,
    veil: round2(o.veil),
  });
}

/** 背景层的 CSS：只作用在那一层上，绝不套到整张卡片（否则文字会被一起染色） */
export function bgLayerStyle(src: string, o: BgOpts): React.CSSProperties {
  const filter = toneFilter(JSON.stringify(o.t));
  const fit: React.CSSProperties =
    o.fit === 'contain'
      ? { backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }
      : o.fit === 'tile'
        ? { backgroundSize: 'auto', backgroundRepeat: 'repeat' }
        : { backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: `url('${src}')`,
    ...fit,
    filter: filter || undefined,
  };
}

/* ---------------- 预设 ---------------- */

const PRESETS: { n: string; t: Partial<Tone> }[] = [
  { n: '原图', t: {} },
  { n: '黑白', t: { s: 0, c: 1.12 } },
  { n: '暖阳', t: { w: 0.6, b: 1.08, s: 1.12 } },
  { n: '冷调', t: { w: -0.6, c: 1.06, s: 0.94 } },
  { n: '胶片', t: { c: 0.9, s: 0.85, b: 1.05, w: 0.18, sh: 0.15 } },
  { n: '高对比', t: { c: 1.35, sh: 0.45 } },
  { n: '柔光', t: { c: 0.92, b: 1.1, s: 1.05, blur: 0.6 } },
];

/* ---------------- 滑杆组（调色弹层与背景弹层共用） ---------------- */

const CSS = `
.tone-row{display:flex;align-items:center;gap:10px;margin:8px 0}
.tone-row .tl{width:86px;flex:0 0 auto;font-size:12.5px;color:var(--ink2)}
.tone-row input[type=range]{flex:1;accent-color:var(--accent);min-width:0}
.tone-row .tv{width:44px;text-align:right;font-size:12px;color:var(--ink3);font-variant-numeric:tabular-nums}
.tone-sec{margin-top:12px;padding-top:10px;border-top:1px dashed var(--line2)}
.tone-sec:first-child{border-top:0;margin-top:0;padding-top:0}
.tone-h{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink3);margin-bottom:2px}
.tone-h b{font-size:12.5px;color:var(--ink2);font-weight:600}
.tone-presets{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 6px}
`;

export function ToneSliders({
  tone, onChange, groups = 'all',
}: {
  tone: Tone;
  onChange: (t: Tone) => void;
  /** 'all' 全给；'basic' 只给最常用的四项 */
  groups?: 'all' | 'basic';
}) {
  const set = (k: keyof Tone, v: number) => onChange({ ...tone, [k]: v });
  const row = (k: keyof Tone, label: string, min: number, max: number, step: number, fmt?: (v: number) => string) => (
    <div className="tone-row" key={k}>
      <span className="tl">{label}</span>
      <input type="range" min={min} max={max} step={step} value={tone[k]} onChange={(e) => set(k, Number(e.target.value))} />
      <span className="tv">{fmt ? fmt(tone[k]) : tone[k].toFixed(2)}</span>
    </div>
  );

  return (
    <>
      <style>{CSS}</style>
      <div className="tone-presets">
        {PRESETS.map((p) => (
          <button key={p.n} className="chip" onClick={() => onChange({ ...TONE_ONE, ...p.t })}>{p.n}</button>
        ))}
      </div>

      <div className="tone-sec">
        <div className="tone-h"><b>明暗</b><span>1.00 = 原样</span></div>
        {row('b', '亮度', 0, 2, 0.02)}
        {row('c', '对比度', 0, 2, 0.02)}
        {groups === 'all' ? row('sh', '清晰度', 0, 1, 0.02) : null}
      </div>

      <div className="tone-sec">
        <div className="tone-h"><b>颜色</b><span>正数偏暖，负数偏冷</span></div>
        {row('s', '饱和度', 0, 2, 0.02)}
        {row('w', '色温', -1, 1, 0.02)}
        {groups === 'all' ? row('h', '色调旋转', 0, 360, 1, (v) => `${Math.round(v)}°`) : null}
      </div>

      {groups === 'all' ? (
        <div className="tone-sec">
          <div className="tone-h"><b>通道</b><span>调单色，比如只抬红做旧照片</span></div>
          {row('r', '红', 0, 2, 0.02)}
          {row('g', '绿', 0, 2, 0.02)}
          {row('bl', '蓝', 0, 2, 0.02)}
        </div>
      ) : null}

      <div className="tone-sec">
        <div className="tone-h"><b>其他</b></div>
        {row('o', '不透明度', 0, 1, 0.02)}
        {groups === 'all' ? row('blur', '模糊', 0, 12, 0.2, (v) => `${v.toFixed(1)}px`) : null}
      </div>
    </>
  );
}

/* ---------------- 媒体库里的调色弹层 ---------------- */

export function MediaToneDialog({
  item, onClose, onSaved,
}: {
  item: MediaItem;
  onClose: () => void;
  /** 保存成功后由调用方刷新索引 + 重刷列表；回传刚存下的 tone JSON（空串 = 已恢复原图） */
  onSaved: (toneJson: string) => void | Promise<void>;
}) {
  const toast = useStore((s) => s.toast);
  const [tone, setTone] = useState<Tone>(() => parseTone(item.tone));
  const [busy, setBusy] = useState(false);

  const filter = useMemo(() => toneFilter(JSON.stringify(tone)), [tone]);
  const src = imgUrl(item.id) || '';
  const flat = toneIsFlat(tone);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const json = flat ? '' : JSON.stringify({
      b: round2(tone.b), c: round2(tone.c), s: round2(tone.s), o: round2(tone.o),
      w: round2(tone.w), h: Math.round(tone.h),
      r: round2(tone.r), g: round2(tone.g), bl: round2(tone.bl),
      sh: round2(tone.sh), blur: round2(tone.blur),
    });
    try {
      await api.mediaTone(item.id, json);
      await onSaved(json);
      onClose();
    } catch (e) {
      toast('保存调色失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="调整图片"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={() => setTone({ ...TONE_ONE })} disabled={flat}>重置</button>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </>}
    >
      <div style={{ textAlign: 'center', marginBottom: 8, background: 'var(--panel2)', borderRadius: 12, padding: 10 }}>
        {src
          ? <img src={src} alt="" data-tone-live="1" style={{ maxWidth: '100%', maxHeight: '34vh', borderRadius: 10, filter }} />
          : <div className="empty">这张图的文件找不到了，调完也没法显示。</div>}
      </div>
      <div className="small muted" style={{ textAlign: 'center', marginBottom: 6 }}>
        {flat ? '当前是原图，没有调过' : '实时预览 · 保存后所有用到这张图的地方都会跟着变'}
      </div>
      <ToneSliders tone={tone} onChange={setTone} />
    </Dialog>
  );
}
