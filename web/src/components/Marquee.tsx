/**
 * 第 154 条：鼠标框选（marquee）。
 *
 * 用户原话：「发现没有删除功能、批量选中等。最好还要有拖动、框选功能。」
 * 删除和批量改动已经做过了，缺的是「像资源管理器那样按住空白处拉一个框」。
 *
 * 几个刻意的设计选择：
 *
 * 1. 坐标一律用 client 空间。
 *    容器本身会滚动（网格 58vh、列表 58vh），要是拿 scrollTop 折算内容坐标，
 *    一旦拖到边缘自动滚动，算出来的框就会跟鼠标脱节。用 client 空间 +
 *    每次 move 重新取一次 item 的 getBoundingClientRect，滚动后自动就是对的。
 *
 * 2. 只在「空白处」起手。
 *    落在卡片上的 mousedown 要留给卡片自己（点开、勾选、右键、拖动），
 *    这里一旦抢走，用户就再也点不开一张图了。
 *
 * 3. 实时预览，而不是松手才生效。
 *    资源管理器就是边拉边亮。为了能「取消」，按下时先存一份基数（base），
 *    每次 move 都从 base 重算，松手才真正落到 state 上。
 *
 * 4. 位移小于 4px 当作「点了空白」→ 清空选择。
 *    这是资源管理器的行为，顺手就有，不用另外记规则。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface MarqueeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Opts {
  /** 只有整理模式下才允许框选；平时拖动应该是选文字 */
  enabled: boolean;
  /** 框选范围（不会超出它去找元素），同时作为定位基准 */
  rootRef: React.RefObject<HTMLElement | null>;
  /** 这些元素参与命中判定，属性值是 id */
  itemAttr?: string;
  /** 预览 + 最终提交都走这里；mode=preview 时不要落库，只更新界面 */
  onSelect: (ids: string[], mode: 'preview' | 'commit' | 'clear') => void;
  /** 当前已选，按下时拿来做基数（Shift 拖 = 追加） */
  baseIds?: () => string[];
}

const MIN_DRAG = 4;

export function useMarquee({
  enabled, rootRef, itemAttr = 'data-selid', onSelect, baseIds,
}: Opts) {
  const [box, setBox] = useState<MarqueeBox | null>(null);
  const drag = useRef<{
    sx: number; sy: number; ox: number; oy: number; additive: boolean; moved: boolean; last: string[];
  } | null>(null);
  // 回调每次都可能是新函数，用 ref 存着，免得 mousemove 监听被反复重建
  const selectRef = useRef(onSelect);
  const baseRef = useRef(baseIds);
  selectRef.current = onSelect;
  baseRef.current = baseIds;

  const hitTest = useCallback((rect: MarqueeBox): string[] => {
    const root = rootRef.current;
    if (!root) return [];
    const attrs = itemAttr;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(`[${attrs}]`));
    const boxL = rect.x;
    const boxT = rect.y;
    const boxR = rect.x + rect.w;
    const boxB = rect.y + rect.h;
    const out: string[] = [];
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      // 相交就选（不是「完全框住」）—— 资源管理器也是这样，
      // 要求完全框住会让小格子特别好框、大格子永远框不上
      if (r.right < boxL || r.left > boxR || r.bottom < boxT || r.top > boxB) continue;
      const id = el.getAttribute(attrs);
      if (id) out.push(id);
    }
    return out;
  }, [rootRef, itemAttr]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enabled || e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    // 卡片、按钮、输入框自己处理
    if (t.closest(`[${itemAttr}]`)) return;
    if (t.closest('button,a,input,select,textarea,label,[data-nomarq]')) return;
    const root = rootRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    drag.current = {
      sx: e.clientX, sy: e.clientY,
      ox: e.clientX, oy: e.clientY,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      moved: false,
      last: [],
    };
    // 先别急着清空 —— 万一是误点，松手时判定位移不到才清
    void rr;
    e.preventDefault();
  }, [enabled, itemAttr, rootRef]);

  useEffect(() => {
    if (!enabled) return;

    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.ox;
      const dy = e.clientY - d.oy;
      if (!d.moved && Math.abs(dx) < MIN_DRAG && Math.abs(dy) < MIN_DRAG) return;
      d.moved = true;
      const root = rootRef.current;
      if (!root) return;
      const rr = root.getBoundingClientRect();
      // 夹在容器内，别拉出一整屏之外去
      const cx = Math.min(Math.max(e.clientX, rr.left), rr.right);
      const cy = Math.min(Math.max(e.clientY, rr.top), rr.bottom);
      const rect: MarqueeBox = {
        x: Math.min(d.sx, cx), y: Math.min(d.sy, cy),
        w: Math.abs(cx - d.sx), h: Math.abs(cy - d.sy),
      };
      // 转成相对容器的坐标，供那个绝对定位的框用
      setBox({ ...rect, x: rect.x - rr.left, y: rect.y - rr.top });

      const hits = hitTest(rect);
      const base = d.additive ? (baseRef.current?.() || []) : [];
      const merged = Array.from(new Set([...base, ...hits]));
      d.last = merged;
      selectRef.current(merged, 'preview');
    };

    const up = () => {
      const d = drag.current;
      drag.current = null;
      setBox(null);
      if (!d) return;
      if (!d.moved) {
        // 位移不够 = 点了空白 → 清空
        selectRef.current([], 'clear');
        return;
      }
      selectRef.current(d.last, 'commit');
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [enabled, hitTest, rootRef]);

  // 关掉整理模式时立刻收掉残留的框
  useEffect(() => {
    if (!enabled) setBox(null);
  }, [enabled]);

  return { box, onMouseDown };
}