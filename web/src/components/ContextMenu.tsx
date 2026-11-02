/**
 * 右键菜单（第 234 / 235 条）。
 *
 * 用户第 235 条说得挺重：「也不用把所有右键菜单都封死吧，
 * 应该充分释放右键菜单的潜力，而不是粗暴的一刀切全干死。」
 *
 * 之前的做法是到处零散地写 `<div className="rowmenu">`：
 * 有的模块有、有的没有，样式还各写各的。这里抽成一个 hook + 一个渲染器：
 *   - 挂 `onContextMenu={open}` 一处就够，位置和边界收口都在这里
 *   - 菜单项用数据描述，谁想加就在自己的数组里加一行
 *   - 贴着屏幕边缘会自动翻到另一边，不会跑出去看不见
 *
 * 为什么不直接用系统菜单：WebView2 里禁掉了原生菜单（那边是浏览器菜单，
 * 只有「另存为 / 检查」这些，对用户没意义），所以自己画一个。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { askConfirm } from './ui';

export interface MenuItem {
  /** 分隔线 */
  sep?: true;
  /** 普通项 */
  label?: string;
  /** 左边的按键提示（比如 ⌫） */
  hint?: string;
  /** 危险操作：红字 */
  danger?: boolean;
  /** 置灰 */
  disabled?: boolean;
  /** 点之前问一句 */
  confirm?: string;
  /** 确认框里那颗按钮的字（比如「删除」「移到回收站」）。不传就是「确定」 */
  confirmOk?: string;
  onClick?: () => void | Promise<void>;
}

type MenuState = { x: number; y: number; items: MenuItem[] } | null;

/**
 * 右键菜单的状态与定位。
 *
 * 返回的 `open` 直接挂到 onContextMenu 上；
 * `node` 要渲染到组件树里（一般放在最外层 fragment 的最后）。
 */
export function useContextMenu() {
  const [state, setState] = useState<MenuState>(null);
  /** 屏幕上实际落点，等测量完再定，避免先画到错位置再跳 */
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setState(null), []);

  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (!items.length) return;
    setState({ x: e.clientX, y: e.clientY, items });
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  /* 贴着窗口边缘时翻到另一侧 —— 右键屏幕右下角的图，菜单不该跑出屏幕 */
  useLayoutEffect(() => {
    if (!state || !boxRef.current) return;
    const el = boxRef.current;
    const r = el.getBoundingClientRect();
    const pad = 12; // 和 .ctxmenu 的 max-height:calc(100dvh - 24px) 保持一致
    let x = state.x;
    let y = state.y;
    if (x + r.width + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - r.width - pad);
    /*
     * 竖直方向有个坑：菜单可能比视口还高（待办那条 19 项，实测 743px vs 736px 视口）。
     * 那种情况下 `innerHeight - r.height - pad` 是负数，被 Math.max 兜成 pad，
     * 结果菜单从顶部开始往下长，底部照样出界。
     *
     * 而且这一轮量到的 r.height 是"理想高度"：CSS 的 max-height 是之后才把高度压下来的。
     * 所以先按"最终最多能有多高"算一个上限，再夹 y：
     * 剩下的溢出交给 max-height + overflow:auto，位置不会再被算飞。
     */
    const capH = Math.min(r.height, window.innerHeight - pad * 2);
    const maxTop = Math.max(pad, window.innerHeight - pad - capH);
    if (y > maxTop) y = maxTop;
    if (y < pad) y = pad;
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
    // 只跟着「打开」这件事算位置；pos 不进依赖，否则自己触发自己
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* 点别处 / 按 Esc / 滚动都关掉 */
  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && boxRef.current.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onScroll = () => close();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [state, close]);

  const node = state ? (
    <div
      ref={boxRef}
      className="ctxmenu"
      style={{ left: pos.x, top: pos.y }}
      data-ctx
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((it, i) => {
        if (it.sep) return <div className="ctx-sep" key={`sep-${i}`} />;
        return (
          <button
            key={`${it.label}-${i}`}
            type="button"
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            data-ctx-label={it.label}
            onClick={async () => {
              if (it.disabled) return;
              if (it.confirm && !(await askConfirm(it.confirm, it.confirmOk ? { ok: it.confirmOk } : undefined))) return;
              close();
              await it.onClick?.();
            }}
          >
            <span className="ctx-t">{it.label}</span>
            {it.hint ? <span className="ctx-h">{it.hint}</span> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return { open, close, node, isOpen: !!state };
}

/**
 * 全局兜底：没有显式挂右键菜单的地方，右键不再弹浏览器的原生菜单。
 *
 * 第 194 条当初是把右键一刀切禁掉了，用户第 235 条反弹得对 ——
 * 但「禁掉原生菜单」这件事本身是对的（那菜单对我们没意义）。
 * 所以这里只做两件事：拦掉浏览器菜单、在输入框里保留复制粘贴。
 * 各个模块自己要不要右键菜单，由它们自己用 useContextMenu 决定。
 */
export function installContextMenuGuard(): () => void {
  const onCtx = (e: MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    // 已经自己处理过的不重复拦（各自都 preventDefault 了，走不到这里）
    // 输入类控件：交回浏览器，能让用户用系统的拼写检查 / 复制粘贴
    const edit = el.closest('input, textarea, [contenteditable="true"]');
    if (edit && !el.closest('[data-ctx]')) return;
    e.preventDefault();
  };
  document.addEventListener('contextmenu', onCtx, true);
  return () => document.removeEventListener('contextmenu', onCtx, true);
}