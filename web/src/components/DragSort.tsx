/**
 * 列表拖动排序（第 84 / 93 条）。
 *
 * 两件事：
 * 1. 拖放本身用 HTML5 DnD（桌面端最稳，触屏不在考虑范围）。
 * 2. **放下之后的位移用 FLIP 动画补**。浏览器重排是瞬时的，直接换 DOM 顺序会"啪"一下跳过去；
 *    FLIP 先算出每项的新旧位置差，再让它从旧位置滑到新位置 —— 这就是"流畅无缝"的来源，
 *    也不用为了动画去改数据结构。
 *
 * 为什么不用"跟手拖影 + 实时让位"：那套要接管 pointer 事件、自己算占位，
 * 在滚动容器里很容易和滚动手势打架。DnD + FLIP 的组合视觉上够顺，代码也好维护。
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface DragItemProps {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  /** 拖起的那一项 / 悬停的目标项，用来加 .dragging / .drop-target */
  className: string;
  'data-dragkey': string;
}

/**
 * @param keys     当前顺序的 key（和渲染一致）
 * @param onReorder (从, 到) => 持久化；调用前组件会自动做一次位置快照
 * @param disabled 禁用拖动
 * @param axis     排列方向。卡片/列表是竖向（默认）；选项卡条这种横着排的要传 'x'，
 *                 否则 FLIP 只算 top —— 横向元素 top 全都一样，算出来是 0，看不到补间动画。
 * @param onMoveTo 第 220 条：跨组拖动。传了它，drop 走这条路而不是 onReorder，
 *                 调用方自己决定「从 A 组的第 3 项搬到 B 组的第 1 项」怎么落库。
 *                 不传就还是老行为（同组内重排），老调用点一行都不用改。
 */
export function useDragSort<T extends HTMLElement = HTMLDivElement>(opts: {
  keys: string[];
  onReorder: (from: number, to: number) => void | Promise<void>;
  disabled?: boolean;
  axis?: 'y' | 'x';
  /**
   * 每个 key 属于哪个组（笔记的多层目录、文件夹树用它）。
   * 只在不传 onMoveTo 时用于「跨组不许 drop」的判断；
   * 传了 onMoveTo 时原样交给它，由调用方决定。
   */
  groupOf?: (key: string) => string;
  onMoveTo?: (from: { key: string; group: string }, to: { key: string; group: string }) => void | Promise<void>;
}) {
  const { keys, onReorder, disabled, axis = 'y', groupOf, onMoveTo } = opts;
  const [dragKey, setDragKey] = useState('');
  const [overKey, setOverKey] = useState('');
  /**
   * 同步的"正在拖谁"。不能只靠上面的 state：dragstart 里 setState 是异步的，
   * 紧接着的 dragover 读到的还是旧值，会直接 return、不 preventDefault ——
   * 于是 drop 根本不触发（打卡那次拖动没反应就是这么来的）。
   */
  const dragKeyRef = useRef('');
  const boxRef = useRef<T | null>(null);
  const tops = useRef<Map<string, number>>(new Map());

  /** 记录当前位置（必须在数据变化之前调） */
  const snapshot = useCallback(() => {
    const map = new Map<string, number>();
    boxRef.current?.querySelectorAll<HTMLElement>('[data-dragkey]').forEach((el) => {
      const k = el.getAttribute('data-dragkey');
      if (!k) return;
      const r = el.getBoundingClientRect();
      map.set(k, axis === 'x' ? r.left : r.top);
    });
    tops.current = map;
  }, [axis]);

  // 数据变了：拿旧位置和新位置比，先平移回去再过渡到 0
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || tops.current.size === 0) return;
    box.querySelectorAll<HTMLElement>('[data-dragkey]').forEach((el) => {
      const k = el.getAttribute('data-dragkey') || '';
      const before = tops.current.get(k);
      if (before == null) return;
      const r = el.getBoundingClientRect();
      const delta = before - (axis === 'x' ? r.left : r.top);
      if (Math.abs(delta) < 1) return;
      const prop = axis === 'x' ? 'translateX' : 'translateY';
      el.style.transition = 'none';
      el.style.transform = `${prop}(${delta}px)`;
      // 下一帧再放开，否则浏览器会把两帧合成一帧，看不到动画
      requestAnimationFrame(() => {
        el.style.transition = 'transform .22s cubic-bezier(.2,.7,.3,1)';
        el.style.transform = '';
      });
    });
    tops.current = new Map();
  });

  const props = (i: number): DragItemProps => {
    const key = keys[i] || '';
    return {
      draggable: !disabled && !!key,
      onDragStart: (e) => {
        snapshot();
        dragKeyRef.current = key;
        setDragKey(key);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox 不 setData 就不触发 drag，WebView2 也照做更稳
        e.dataTransfer.setData('text/plain', String(i));
      },
      onDragOver: (e) => {
        if (!dragKeyRef.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overKey !== key) setOverKey(key);
      },
      onDragLeave: () => { if (overKey === key) setOverKey(''); },
      onDrop: (e) => {
        e.preventDefault();
        const fromKey = dragKeyRef.current;
        const from = keys.indexOf(fromKey);
        dragKeyRef.current = '';
        const to = i;
        setDragKey('');
        setOverKey('');

        /* 第 220 条：跨组搬运。目录可以无限嵌套之后，「拖进另一个文件夹」是一等公民，
           所以给了 onMoveTo 就把原始信息交出去，不再假装它是一次同组重排。 */
        if (onMoveTo && fromKey && fromKey !== key) {
          const fg = groupOf ? groupOf(fromKey) : '';
          const tg = groupOf ? groupOf(key) : '';
          snapshot();
          void onMoveTo({ key: fromKey, group: fg }, { key, group: tg });
          return;
        }

        if (from < 0 || from === to) return;
        snapshot();
        void onReorder(from, to);
      },
      onDragEnd: () => { dragKeyRef.current = ''; setDragKey(''); setOverKey(''); },
      className: [
        dragKey === key ? 'dragging' : '',
        overKey === key && dragKey !== key ? 'drop-target' : '',
      ].filter(Boolean).join(' '),
      'data-dragkey': key,
    };
  };

  return { boxRef, props, draggingKey: dragKey };
}
