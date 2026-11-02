import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useStore } from '../store';
import { api } from '../api';
import { useT } from '../lib/i18n';
import { Icon } from './Icons';

/* ---------------- 可撤回的提示（第 237 条） ---------------- */

/**
 * 一条「还没来得及真正执行」的动作。
 *
 * 关键设计：`run()` 是**推迟执行**的副作用，`undo()` 是「假装没发生过」的界面复原。
 * 用户点「撤回」→ 直接丢掉 run()，压根不执行，所以不需要写回滚逻辑。
 * 这比「先改了再改回去」可靠得多 —— 后者一旦中间态被存盘，回滚就会留下痕迹。
 */
export interface ToastAction {
  /** 按钮文字，比如「撤回」 */
  label: string;
  /** 超时或手动关掉时执行 */
  run: () => void | Promise<void>;
  /** 点撤回时执行，只负责把界面恢复成动作发生前的样子 */
  undo?: () => void | Promise<void>;
}

/* 待执行的动作挂在模块级。理由：Toast 每次 re-render 都会重建闭包，
 * 存 state 里读到的多半是旧值；模块级变量天然只有一份。 */
let pendingAction: ToastAction | null = null;

export function takePendingToastAction(): ToastAction | null {
  const a = pendingAction;
  pendingAction = null;
  return a;
}

/** 把动作挂到「下一条 toast」上，然后照常 toast(msg) */
export function setPendingToastAction(a: ToastAction | null) {
  pendingAction = a;
}

/* ---------------- 顶部栏：用 portal 挂到 .main 里的固定槽位 ---------------- */

export function Topbar({ title, sub, right, lock }: {
  title: string;
  sub?: string;
  right?: ReactNode;
  /**
   * 第 31 / 75 条：这一页能整体加锁的话，把 scope 传进来，
   * 顶栏右侧会自动挂一把小锁 —— 点了就加锁 / 解锁，不用再跑到设置页。
   *
   * 为什么把入口放顶栏而不是各页自己塞按钮：
   * 用户原话是「针对待办、倒计时设置密码」，但当时界面上一个入口都没有，
   * 只能去「设置 → 安全与密码」猜。每页都自己写一遍按钮必然会漏，
   * 也不会有统一的「这一页现在锁着没有」的状态显示。这里一处解决。
   */
  lock?: { scope: string; label?: string };
}) {
  const slot = typeof document !== 'undefined' ? document.getElementById('topbar-slot') : null;
  /*
   * 第 56 条：标题在这里统一过一遍翻译。
   *
   * 29 个页面都在调用 Topbar，如果每个页面自己写 t('统计')，
   * 一是要改 29 个文件，二是必然漏几个 —— 漏掉的那页在英文界面下就是中文标题。
   * 在 Topbar 内部翻一次，所有页面（包括以后新加的）自动生效。
   * sub 也顺手过一遍：它通常是「回顾 2026-11-02」这类短句，
   * 整句没译文就原样返回，不会变成半截英文。
   */
  const t = useT();
  const node = (
    <>
      <h2>{t(title)}</h2>
      {sub ? <span className="sub">{t(sub)}</span> : null}
      <span className="sp" />
      {right}
      {lock ? <LockChip scope={lock.scope} label={lock.label || title} /> : null}
    </>
  );
  return slot ? createPortal(node, slot) : null;
}

/**
 * 顶栏上那把锁。
 *
 * 三种状态要说清楚，否则用户不知道自己在看什么：
 *   没锁     → 空心锁图标，点了加锁
 *   锁着     → 实心 / 高亮锁，点了去掉锁（不是「解锁一次」，是彻底不要这把锁）
 *   闪一下   → 刚解锁的几分钟内，显示「临时解锁中」，点一下立刻重新锁上
 */
function LockChip({ scope, label }: { scope: string; label: string }) {
  const vault = useStore((s) => s.vault);
  const reloadVault = useStore((s) => s.reloadVault);
  const toast = useStore((s) => s.toast);
  const rule = (vault?.rules ?? []).find((r) => r.scope === scope && !r.target);

  const onClick = async () => {
    try {
      if (rule) {
        await api.vault.remove(rule.id);
        await reloadVault();
        toast(`「${label}」的锁已去掉`);
      } else {
        // 动态 import：Lock.tsx 反过来依赖本文件的 Dialog / askText，
        // 静态 import 会成环，WebView2 里表现为运行时 undefined
        const { askProtect } = await import('./Lock');
        const ok = await askProtect(scope, '', label);
        toast(ok ? `已给「${label}」加锁` : '没加锁');
      }
    } catch (e) {
      toast('操作失败：' + (e as Error).message);
    }
  };

  return (
    <button
      className={`btn sm ghost topbar-lock ${rule ? 'on' : ''}`}
      data-act="topbar-lock"
      data-locked={rule ? '1' : '0'}
      title={rule ? '这一页加过锁 · 点一下去掉' : '给这一页加锁：之后进来要先输密码'}
      onClick={() => void onClick()}
    >
      <Icon name={rule ? 'lock' : 'unlock'} size={13} />
      <span className="lb">{rule ? '已加锁' : '加锁'}</span>
    </button>
  );
}

/* ---------------- 弹层 ---------------- */

export function Dialog({
  title, wide, onClose, footer, children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dlg ${wide ? 'wide' : ''}`}>
        <div className="h">
          <h3>{title}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="b">{children}</div>
        {footer === false ? null : <div className="f">{footer ?? <button className="btn" onClick={onClose}>关闭</button>}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- askText：Promise 化的输入框 ---------------- */

interface PromptState {
  open: boolean;
  title: string;
  def: string;
  ph: string;
  resolve: ((v: string | null) => void) | null;
  ask: (title: string, def?: string, ph?: string) => Promise<string | null>;
  finish: (v: string | null) => void;
}

const usePrompt = create<PromptState>()((set, get) => ({
  open: false,
  title: '',
  def: '',
  ph: '',
  resolve: null,
  ask: (title, def = '', ph = '') => new Promise<string | null>((resolve) => {
    set({ open: true, title, def, ph, resolve });
  }),
  finish: (v) => {
    const r = get().resolve;
    set({ open: false, resolve: null });
    r?.(v);
  },
}));

export const askText = (title: string, def = '', ph = '') => usePrompt.getState().ask(title, def, ph);

export function PromptHost() {
  const { open, title, def, ph, finish } = usePrompt();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 30);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;
  return (
    <Dialog
      title={title}
      onClose={() => finish(null)}
      footer={<>
        <button className="btn" onClick={() => finish(null)}>取消</button>
        <button className="btn primary" onClick={() => finish(ref.current?.value ?? '')}>确定</button>
      </>}
    >
      <input
        ref={ref}
        className="inp"
        defaultValue={def}
        placeholder={ph}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') finish(null);
        }}
      />
    </Dialog>
  );
}

/* ---------------- 轻提示 ---------------- */

/**
 * 第 52 条：提示条必须能手动关掉，自动消失时间也要能设。
 * 之前是 1900ms 硬编码 + 不可关闭，用户刚看清就被收走，或者挡住了下面的按钮只能干等。
 *
 * 第 237 条：还要能「撤回」。用户原话：「点了叉之后非常干净利落的没有了。
 * 而且直接没有了，怎么说呢，这不太好，没给人反悔的时间，而且万一误触呢。」
 *
 * 撤回的做法：toast 不自己执行动作，只显示一句「已隐藏 天气 · 撤回」，
 * 真正的动作由调用方在**用户点了撤回/超时没点**时决定。
 * 这样「撤销」不是把数据改回去，而是压根还没改 —— 比事后回滚可靠得多。
 */
export function Toast() {
  const msg = useStore((s) => s.toastMsg);
  const seq = useStore((s) => s.toastSeq);
  const msSetting = useStore((s) => s.settings.toastMs);
  const [visible, setVisible] = useState(false);
  const actionRef = useRef<ToastAction | null>(null);
  const [actLabel, setActLabel] = useState('');
  const [actionKey, setActionKey] = useState(0);

  /*
   * 第 156 条：空值不能当成「不自动消失」。
   * 老库 / 导入的设置里 toastMs 可能是空字符串，`Number('')` 是 0，
   * 于是一条提示挂在那儿永远不走，用户只能一个个点 ✕。
   * 只有明确的 '0' 才是「不自动消失」。
   */
  const rawMs = String(msSetting ?? '').trim();
  const ms = rawMs === '' ? 2600 : Math.max(0, Number(rawMs) || 0);

  useEffect(() => {
    // 读「这次」带没带动作。带动作的提示多给 2.5 秒，否则用户来不及反应就没了
    const a = takePendingToastAction();
    actionRef.current = a;
    setActLabel(a?.label || '');
    setActionKey((k) => k + 1);
    if (!msg) return;
    setVisible(true);
    if (!ms || ms <= 0) return;           // 0 = 不自动消失
    const wait = ms + (a ? 2500 : 0);
    const t = setTimeout(() => {
      // 超时没点撤回 → 这时才真正执行
      const pending = actionRef.current;
      actionRef.current = null;
      setVisible(false);
      if (pending) void pending.run();
    }, wait);
    return () => clearTimeout(t);
  }, [msg, seq, ms]);

  const undo = () => {
    // 必须先取再清空。这里曾经写成 takePendingToastAction()，
    // 但模块级那份在 useEffect 里早就被取走了，拿到 null，
    // 结果「撤回」按钮点了界面毫无反应 —— 动作被丢了，界面却没复原。
    const pending = actionRef.current;
    actionRef.current = null;             // 丢掉，等于什么都没发生
    setVisible(false);
    // 被丢弃的动作自己会负责把界面恢复（比如把模块画回来）
    if (pending) void pending.undo?.();
  };

  return (
    <div className={`toast ${visible ? 'show' : ''}`} id="toast" role="status">
      <span className="tx">{msg}</span>
      {actLabel ? (
        <button key={actionKey} className="tx-undo" title="撤销这一步" onClick={undo}>
          {actLabel}
        </button>
      ) : null}
      <button
        className="tx-x"
        title="关掉（Esc）"
        onClick={() => {
          // 手动关掉 ≠ 撤回：动作照常执行，只是把提示收走
          const pending = actionRef.current;
          actionRef.current = null;
          setVisible(false);
          if (pending) void pending.run();
        }}
      >✕</button>
    </div>
  );
}
