/**
 * #240 拾色器。
 *
 * 为什么不用 `<input type="color">`：它在 WebView2 里会拉起系统模态对话框，
 * 一打开就把画板遮住、还不能边调边看效果 —— 而这恰恰是挑颜色时最需要的。
 * 自己画一个内联面板，拖的时候下面的画布实时跟着变。
 *
 * 模型用 HSV 而不是 RGB：给画板挑颜色，人是先想"要个什么色相"，
 * 再决定深浅浓淡。RGB 三个滑块要凑出一个想要的颜色，纯靠试。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** #rgb / #rrggbb → {h:0-360, s:0-1, v:0-1}。认不出来就给黑色 */
export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { h: 0, s: 0, v: 0 };
  let src = m[1];
  if (src.length === 3) src = src[0] + src[0] + src[1] + src[1] + src[2] + src[2];
  const r = parseInt(src.slice(0, 2), 16) / 255;
  const g = parseInt(src.slice(2, 4), 16) / 255;
  const b = parseInt(src.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

const to2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');

/** HSV → #rrggbb（小写，始终 6 位） */
export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0; let g = 0; let b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return '#' + to2(r + m) + to2(g + m) + to2(b + m);
}

/** 正规化成 #rrggbb 小写；认不出来返回空串（让调用方决定怎么办） */
export function normalizeHex(raw: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(raw || '').trim());
  if (!m) return '';
  let s = m[1].toLowerCase();
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return '#' + s;
}

/* ---------------- 面板 ---------------- */

/**
 * 拖拽取点。
 *
 * 用 pointer capture 而不是监听 window：捕到一个元素之后，手指/鼠标移出面板
 * 也继续收事件，松手时自动释放 —— 这样"拖出边界再拖回来"不会中断。
 */
function useDrag(
  elRef: React.RefObject<HTMLElement | null>,
  onPoint: (x: number, y: number) => void,
  onDone?: () => void,
) {
  const dragging = useRef(false);

  const put = (e: React.PointerEvent | PointerEvent) => {
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onPoint(x, y);
  };

  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      put(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!dragging.current) return;
      put(e);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      onDone?.();
    },
  };
}

export function ColorPicker({
  value, onChange, onCommit, onClose, recent = [],
}: {
  value: string;
  /** 拖的时候持续回调，用来实时预览 */
  onChange: (hex: string) => void;
  /** 松手时才回调一次，用来记"最近用过" */
  onCommit?: (hex: string) => void;
  onClose: () => void;
  recent?: string[];
}) {
  const hsv = hexToHsv(value);
  const [h, setH] = useState(hsv.h);
  const [s, setS] = useState(hsv.s);
  const [v, setV] = useState(hsv.v);
  const [txt, setTxt] = useState(normalizeHex(value) || '#000000');
  const boxRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  /*
   * 外部改了颜色（点调色板、点最近用过）要跟上。
   * 只认 `value` 变化 —— 自己拖动时父组件会回写同一个值，这条不会抖动。
   */
  useEffect(() => {
    const n = hexToHsv(value);
    setH(n.h); setS(n.s); setV(n.v);
    setTxt(normalizeHex(value) || '#000000');
  }, [value]);

  const emit = useCallback((nh: number, ns: number, nv: number, commit: boolean) => {
    const hex = hsvToHex(nh, ns, nv);
    onChange(hex);
    if (commit) onCommit?.(hex);
  }, [onChange, onCommit]);

  const box = useDrag(boxRef, (x, y) => {
    // x → 饱和度，y 从上到下 → 明度从 1 到 0（和所有画图软件一致）
    setS(x);
    setV(1 - y);
    emit(h, x, 1 - y, false);
  }, () => onCommit?.(hsvToHex(h, s, v)));

  const hue = useDrag(hueRef, (x) => {
    const nh = x * 360;
    setH(nh);
    /*
     * 只拖色相时，如果当前色很暗（画板默认笔色 #1f1c18，明度只有 0.12），
     * 出来的永远是"另一种黑" —— 用户拖了半天看不出变化，会以为拾色器坏了。
     *
     * 所以这里兜一个下限：明度或饱和度太低时，把它们抬到"能看出色相"的程度。
     * 只在拖色相条时兜，拖饱和度/明度面板时不动 —— 那边人本来就是在调深浅。
     */
    const nv = Math.max(v, 0.55);
    const ns = Math.max(s, 0.55);
    setS(ns); setV(nv);
    emit(nh, ns, nv, false);
  }, () => onCommit?.(hsvToHex(h, s, v)));

  return (
    <div className="cp" data-act="cp-panel">
      <div className="cp-hd">
        <b>拾色器</b>
        <button className="cp-x" onClick={onClose} title="关闭" data-act="cp-close">×</button>
      </div>

      {/* 饱和度 × 明度 */}
      <div
        ref={boxRef}
        className="cp-board"
        style={{ background: `hsl(${h},100%,50%)` }}
        {...box}
        data-act="cp-board"
      >
        <div className="cp-white" />
        <div className="cp-black" />
        <div
          className="cp-dot"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hsvToHex(h, s, v) }}
        />
      </div>

      {/* 色相 */}
      <div ref={hueRef} className="cp-hue" {...hue} data-act="cp-hue">
        <div className="cp-hue-dot" style={{ left: `${(h / 360) * 100}%` }} />
      </div>

      <div className="cp-row">
        <span className="cp-prev" style={{ background: hsvToHex(h, s, v) }} />
        <input
          className="inp"
          style={{ flex: 1, fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 12 }}
          value={txt}
          onChange={(e) => {
            const t = e.target.value;
            setTxt(t);
            const n = normalizeHex(t);
            if (n) { emit(hexToHsv(n).h, hexToHsv(n).s, hexToHsv(n).v, false); }
          }}
          onBlur={() => {
            const n = normalizeHex(txt);
            if (!n) setTxt(normalizeHex(value) || '#000000');
            else onCommit?.(n);
          }}
          spellCheck={false}
          data-act="cp-hex"
        />
      </div>

      {recent.length > 0 && (
        <div className="cp-recent">
          <span className="small muted">最近</span>
          {recent.slice(0, 8).map((c, i) => (
            <button
              key={c + i}
              className="cp-swatch"
              style={{ background: c }}
              title={c}
              onClick={() => { onChange(c); onCommit?.(c); }}
              data-act="cp-recent"
            />
          ))}
        </div>
      )}
    </div>
  );
}