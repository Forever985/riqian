import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, VIEW_TITLE } from '../store';
import { Icon, type IconName } from './Icons';
import { useDragSort } from './DragSort';
import { shiftDay, shortDateLabel, todayKey, WD, parseKey, fmtMonthDay } from '../lib/date';
import type { EntryListItem, ViewKey } from '../types';

const ICON: Record<string, IconName> = {
  today: 'pen', flow: 'flow', habits: 'check-circle', pomodoro: 'timer', calendar: 'calendar',
  records: 'search', todos: 'todo', countdown: 'hourglass', stats: 'chart', settings: 'sliders',
  notes: 'book', profile: 'user', welcome: 'sparkle', review: 'sparkle',
  drafts: 'archive', media: 'image', music: 'music', manual: 'book', changelog: 'clock', contact: 'question',
};

/** 加号面板里「打开别的页面」的候选（按常用度排，不放设置这种低频的） */
const PAGE_PICKS: ViewKey[] = ['calendar', 'records', 'todos', 'notes', 'flow', 'habits', 'stats', 'countdown', 'ledger', 'alarms'];

/**
 * 2026-10-01 → 10月1日 周三
 * 第 229 条：日期的年月日部分交给 fmtDate，跟随语言和用户设置；
 * 星期的位置不跟着变（它本来就不属于年月日顺序）。
 */
function dayLine(d: string): string {
  const date = parseKey(d);
  return `${fmtMonthDay(date)} 周${WD[date.getDay()]}`;
}

/**
 * 浏览器式的多标签栏（第 172 / 173 / 175 条）。
 *
 * 三件事和以前不一样：
 * 1. 加号不再"再开一个今天"，而是弹面板让你挑日期 / 页面，日记标签带上日期；
 * 2. 标签可以拖着换顺序，顺序存 settings.tabs；
 * 3. 标签条能横向滚动：滚轮纵→横、两端渐变提示、选中项自动滚进可视区，窄窗口也点得到。
 */
export function Tabs() {
  const tabMode = String(useStore((s) => s.settings.tabMode ?? '0')) === '1';
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  const activateTab = useStore((s) => s.activateTab);
  const openTab = useStore((s) => s.openTab);
  const closeTab = useStore((s) => s.closeTab);
  const closeOthers = useStore((s) => s.closeOtherTabs);
  const closeLeft = useStore((s) => s.closeLeftTabs);
  const closeRight = useStore((s) => s.closeRightTabs);
  const closeAll = useStore((s) => s.closeAllTabs);
  const moveTab = useStore((s) => s.moveTab);

  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [add, setAdd] = useState<{ x: number; y: number } | null>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(false);

  const newBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement | null>(null);
  /** 刚拖完的那一下别当成点击，否则一松手就把标签切过去了 */
  const dragEndAt = useRef(0);

  const keys = useMemo(() => tabs.map((t) => t.key), [tabs]);
  const drag = useDragSort<HTMLDivElement>({
    keys,
    axis: 'x',
    onReorder: (from, to) => moveTab(from, to),
  });
  const rail = drag.boxRef;

  /* ---- 溢出提示：两端能不能继续滚 ---- */
  const syncEdges = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setCanL(el.scrollLeft > 2);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, [rail]);

  useEffect(() => {
    syncEdges();
    const el = rail.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncEdges, tabs.length, tabMode]);

  /*
   * 第 175 条「鼠标无法随意滚动」：
   * 横向容器里滚轮默认是滚整页，纵向 delta 完全没用在标签条上。
   * React 的 onWheel 是 passive 的，preventDefault 无效，所以这里挂原生监听。
   */
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // 横向手势交给浏览器
      if (el.scrollWidth <= el.clientWidth + 1) return;       // 没溢出就别抢滚动
      const before = el.scrollLeft;
      el.scrollLeft = before + e.deltaY;
      // 到边了还硬拦会让人以为卡住，交回给外层
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rail, tabMode, tabs.length]);

  /* ---- 选中项永远看得见（窗口缩小 / 切标签时） ---- */
  const revealActive = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const box = el.querySelector(`[data-tab="${active}"]`) as HTMLElement | null;
    if (!box) return;
    // 用 rect 算相对位移，别依赖 offsetLeft 的 offsetParent 是谁
    const pad = 40;   // 留出加号按钮和渐变遮罩的宽度
    const eb = el.getBoundingClientRect();
    const bb = box.getBoundingClientRect();
    const left = bb.left - eb.left + el.scrollLeft;
    const right = left + bb.width;
    if (left - pad < el.scrollLeft) {
      el.scrollTo({ left: Math.max(0, left - pad), behavior: 'smooth' });
    } else if (right + pad > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: right + pad - el.clientWidth, behavior: 'smooth' });
    }
  }, [active, rail]);

  useEffect(() => { revealActive(); }, [revealActive, tabs.length]);

  // 窗口变窄 / 侧栏折叠之后，选中项可能被挤出可视区，补一次
  useEffect(() => {
    const onResize = () => { revealActive(); syncEdges(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [revealActive, syncEdges]);

  /* ---- 菜单 / 面板：点外面关掉 ---- */
  useEffect(() => {
    if (!menu && !add) return;
    const off = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || addRef.current?.contains(t)) return;
      if (newBtnRef.current?.contains(t)) return;
      setMenu(null);
      setAdd(null);
    };
    const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(null); setAdd(null); } };
    window.addEventListener('mousedown', off);
    window.addEventListener('scroll', off, true);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('keydown', keydown);
    };
  }, [menu, add]);

  if (!tabMode || !tabs.length) return null;

  const idx = tabs.findIndex((t) => t.key === menu?.key);

  const openDated = (d: string) => {
    setAdd(null);
    void openTab('today', { date: d, title: shortDateLabel(d) });
  };

  return (
    <div className={`tabs ${canL ? 'can-l' : ''} ${canR ? 'can-r' : ''}`}>
      <div className="tabs-rail" ref={rail} onScroll={syncEdges}>
        {tabs.map((t, i) => {
          const p = drag.props(i);
          return (
            <div
              key={t.key}
              data-tab={t.key}
              className={`tab ${t.key === active ? 'on' : ''} ${p.className}`}
              data-dragkey={p['data-dragkey']}
              draggable={p.draggable}
              onDragStart={p.onDragStart}
              onDragOver={p.onDragOver}
              onDragLeave={p.onDragLeave}
              onDragEnd={(e) => { dragEndAt.current = Date.now(); p.onDragEnd(); void e; }}
              onDrop={(e) => { dragEndAt.current = Date.now(); p.onDrop(e); }}
              onClick={() => {
                if (Date.now() - dragEndAt.current < 220) return;
                activateTab(t.key);
              }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.key); } }}
              onContextMenu={(e) => {
                e.preventDefault();
                setAdd(null);
                setMenu({ x: e.clientX, y: e.clientY, key: t.key });
              }}
              title={`${t.title}${t.date ? `（${t.date}）` : ''} —— 拖动可以换位置`}
            >
              <Icon name={ICON[t.view] || 'note'} size={13} />
              <span className="tt">{t.title}</span>
              <button
                className="tx"
                onClick={(e) => { e.stopPropagation(); closeTab(t.key); }}
                title="关闭"
              >✕</button>
            </div>
          );
        })}
      </div>

      <button
        ref={newBtnRef}
        className={`tab-new ${add ? 'on' : ''}`}
        title="新建选项卡：选一天或一个页面"
        onClick={() => {
          const r = newBtnRef.current?.getBoundingClientRect();
          if (add) { setAdd(null); return; }
          setMenu(null);
          setAdd({ x: r ? r.left : 200, y: r ? r.bottom + 6 : 60 });
        }}
      ><Icon name="plus" size={14} /></button>

      {add ? <AddPanel x={add.x} y={add.y} hostRef={(n) => { addRef.current = n; }} onPickDate={openDated} onPickPage={(v) => { setAdd(null); void openTab(v); }} onClose={() => setAdd(null)} /> : null}

      {menu ? (
        <div
          ref={menuRef}
          className="tabmenu"
          style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 230) }}
        >
          <button disabled={idx < 0} onClick={() => { closeTab(menu.key); setMenu(null); }}>关闭</button>
          <button onClick={() => { closeOthers(menu.key); setMenu(null); }}>关闭其他</button>
          <button disabled={idx <= 0} onClick={() => { closeLeft(menu.key); setMenu(null); }}>关闭左侧</button>
          <button disabled={idx < 0 || idx >= tabs.length - 1} onClick={() => { closeRight(menu.key); setMenu(null); }}>关闭右侧</button>
          <div className="sep" />
          <button onClick={() => { closeAll(); setMenu(null); }}>全部关闭</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 加号面板：新建选项卡时「看哪天 / 看哪页」。
 * 列三块：今天昨天这种一键项、可以手选的日期、最近写过的日子、常用页面。
 */
function AddPanel({ x, y, hostRef, onPickDate, onPickPage, onClose }: {
  x: number; y: number;
  /** 回传给父组件，用来判断「点在外面」 */
  hostRef: (n: HTMLDivElement | null) => void;
  onPickDate: (d: string) => void;
  onPickPage: (v: ViewKey) => void;
  onClose: () => void;
}) {
  const today = todayKey();
  const [pick, setPick] = useState('');
  const [recent, setRecent] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const el = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.entry.list({ limit: 12 }).then((list) => {
      if (!alive) return;
      setRecent(list);
      setLoading(false);
    }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const width = 268;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 12));
  // 面板比窗口底部还高就往上翻，别让它顶出屏幕外
  const [top, setTop] = useState(y);
  useLayoutEffect(() => {
    const h = el.current?.offsetHeight ?? 0;
    setTop(y + h > window.innerHeight - 8 ? Math.max(8, window.innerHeight - h - 8) : y);
  }, [y, recent.length]);

  return (
    <div
      ref={(node) => { el.current = node; hostRef(node); }}
      className="tabadd"
      style={{ left, top, width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="tabadd-h">新建选项卡</div>

      <div className="tabadd-quick">
        <button className="btn sm" onClick={() => onPickDate(today)}>
          <Icon name="pen" size={12} />今天
        </button>
        <button className="btn sm" onClick={() => onPickDate(shiftDay(today, -1))}>昨天</button>
        <button className="btn sm" onClick={() => onPickDate(shiftDay(today, -2))}>前天</button>
      </div>

      <label className="tabadd-lab" htmlFor="tabadd-date">挑一天看</label>
      <div className="tabadd-date">
        <input
          id="tabadd-date"
          className="inp"
          type="date"
          value={pick}
          max="9999-12-31"
          onChange={(e) => setPick(e.target.value)}
        />
        <button
          className="btn sm primary"
          disabled={!pick}
          onClick={() => { if (pick) onPickDate(pick); }}
        >打开</button>
      </div>

      <div className="tabadd-lab">最近写过</div>
      <div className="tabadd-list">
        {loading ? <div className="tabadd-empty">读取中…</div>
          : recent.length ? recent.map((it) => (
            <button key={it.date} className="tabadd-item" onClick={() => onPickDate(it.date)}>
              <span className="d">{dayLine(it.date)}</span>
              <span className="t">{it.title || it.plain.slice(0, 18) || '（空白的一天）'}</span>
            </button>
          ))
            : <div className="tabadd-empty">这几天还没写过东西</div>}
      </div>

      <div className="tabadd-lab">打开一个页面</div>
      <div className="tabadd-pages">
        {PAGE_PICKS.map((v) => (
          <button key={v} className="chip" onClick={() => onPickPage(v)}>
            <Icon name={ICON[v] || 'note'} size={11} />{VIEW_TITLE[v]}
          </button>
        ))}
      </div>

      <div className="tabadd-foot">
        <button className="linkbtn" onClick={onClose}>收起</button>
      </div>
    </div>
  );
}

/** 打开某个视图（带标签页语义），供侧边栏与各处复用 */
export function useOpen() {
  const tabMode = String(useStore((s) => s.settings.tabMode ?? '0')) === '1';
  const openTab = useStore((s) => s.openTab);
  const date = useStore((s) => s.date);
  const go = useStore((s) => s.go);
  return (v: ViewKey) => {
    if (tabMode) openTab(v, v === 'today' ? { date, title: shortDateLabel(date) } : undefined);
    else void go(v);
  };
}

export { VIEW_TITLE };