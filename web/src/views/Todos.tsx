import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { todoSortMode, useStore } from '../store';
import { useDragSort } from '../components/DragSort';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { shiftDay, todayKey } from '../lib/date';
import { parseSmartDate, repeatCode, repeatLabel } from '../lib/smartDate';
import { Highlight } from '../features/notes';
import { startPomoFor, todoToCountdown } from '../features/bridge';
import {
  PRIORITY_OPTIONS, priorityLabel, quadrantOf, quadPatch, QUADRANTS, QuadHint, TodoEditDialog, TodoListDialog, TodoNewDialog, type QuadKey,
} from '../features/todos';
import type { Todo, TodoList, TodoSortMode } from '../types';

type Sel =
  | { kind: 'today' }
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'trash' }
  | { kind: 'recycle' }
  | { kind: 'quad' }
  | { kind: 'list'; ids: string[] };

const sameSel = (a: Sel, b: Sel) =>
  a.kind === b.kind
  && (a.kind !== 'list' || b.kind !== 'list'
    || (a.ids.length === b.ids.length && a.ids.every((x) => b.ids.includes(x))));

/**
 * 第 163 条：排序方式。存 settings.todoSortMode，值见 types.ts 的 TodoSortMode。
 * 「优先级」就是四象限那一套（重要 = 优先级高、紧急 = 到期早），
 * 不叫「四象限」是因为左侧还有一个同名的网格视图，两个同名会让人以为是同一件事。
 */
const SORTS: { v: TodoSortMode; n: string }[] = [
  { v: 'manual', n: '手动' },
  { v: 'quad', n: '优先级' },
  { v: 'due', n: '截止日期' },
];

/**
 * 第 220 条：清单可以无限嵌套，左栏就要按层级缩进画出来。
 *
 * 两个必须防的坑：
 *   1. 环 —— 数据库里已经有防环逻辑，但历史数据可能是坏的，这里再加一道 visited 兜底，
 *      否则一次环就够把 React 渲染栈打爆。
 *   2. 孤儿 —— 父清单被软删之后，子清单的 parentId 会指向一个墓碑 id。
 *      这种直接当顶层画，不然它在左栏里会凭空消失（数据还在，用户找不到）。
 */
function buildListTree(lists: TodoList[]): { l: TodoList; depth: number }[] {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const kids = new Map<string, TodoList[]>();
  const roots: TodoList[] = [];
  for (const l of lists) {
    const p = l.parentId || '';
    if (p && byId.has(p) && p !== l.id) {
      const arr = kids.get(p) || [];
      arr.push(l);
      kids.set(p, arr);
    } else {
      roots.push(l);
    }
  }
  const out: { l: TodoList; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (arr: TodoList[], depth: number) => {
    for (const l of arr) {
      if (seen.has(l.id) || depth > 32) continue;
      seen.add(l.id);
      out.push({ l, depth });
      const ch = kids.get(l.id);
      if (ch && ch.length) walk(ch, depth + 1);
    }
  };
  walk(roots, 0);
  // 环里的节点从根走不到，最后兜一遍，保证「一条都不丢」
  for (const l of lists) if (!seen.has(l.id)) out.push({ l, depth: 0 });
  return out;
}

/* ---------------- 主视图 ---------------- */

export function TodosView() {
  const todos = useStore((s) => s.todos);
  const lists = useStore((s) => s.todoLists);
  const reloadTodos = useStore((s) => s.reloadTodos);
  const reloadTodoLists = useStore((s) => s.reloadTodoLists);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);

  /* 第 163 条：排序方式从 settings 读（不能只放本地 state —— 同一页面内组件不会重挂） */
  const sortMode: TodoSortMode = todoSortMode(settings);

  /*
   * 第 83 条：左栏（清单导航）和右边清单之间的空隙，允许用户自己拖。
   *
   * 用户原话是「空的过多，应该允许用户自由设置……也要允许用户进行自由拖动，
   * 还要允许用户自由设置是否能够自由拖动」。所以三件事：
   *   ① 宽度可拖（刚拖到的宽度歇一下再落库，别每动一像素写一次库）
   *   ② 宽度记进 settings，下次进来还是这个宽度
   *   ③ 设置里能关掉拖动，关掉就锁死在设定值
   */
  const railDragOn = String(settings.todoRailDrag ?? '1') !== '0';
  const railW = Math.max(140, Math.min(420, Number(settings.todoRailW) || 196));
  const [railDrag, setRailDrag] = useState(false);
  const railSaveTimer = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--railw', `${railW}px`);
  }, [railW]);

  const startRailDrag = (e: React.MouseEvent) => {
    if (!railDragOn) return;
    e.preventDefault();
    setRailDrag(true);
    const startX = e.clientX;
    const startW = railW;
    const move = (ev: MouseEvent) => {
      const next = Math.max(140, Math.min(420, startW + (ev.clientX - startX)));
      // 拖的时候只改 CSS 变量，绝不写库 —— 否则一次拖动几十次 RPC
      document.documentElement.style.setProperty('--railw', `${next}px`);
      if (railSaveTimer.current) window.clearTimeout(railSaveTimer.current);
      railSaveTimer.current = window.setTimeout(() => {
        void setSetting('todoRailW', String(next));
      }, 400);
    };
    const up = () => {
      setRailDrag(false);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const [sel, setSel] = useState<Sel>({ kind: 'all' });
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [newList, setNewList] = useState(false);
  const [editList, setEditList] = useState<TodoList | null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  /* 第 129 条：详细新建面板 */
  const [newOpen, setNewOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  /* 第 142 条：四象限里拖动换格子 */
  const [quadDrag, setQuadDrag] = useState('');
  const [quadOver, setQuadOver] = useState('');

  const today = todayKey();

  /**
   * 把一条待办挪进某个象限。
   *
   * 象限是「重要 × 紧急」两个维度**算**出来的，不是存的字段，
   * 所以换象限必须反推回 priority 和 due —— 不然拖完下次一算又跳回去了。
   */
  const moveToQuad = async (id: string, q: QuadKey) => {
    const t = todos.find((x) => x.id === id);
    if (!t || quadrantOf(t, today) === q) return;
    const patch = quadPatch(q, today);
    try {
      await api.todos.update({ id, ...patch });
      await refresh();
      toast(`已放进「${QUADRANTS.find((x) => x.key === q)?.title || ''}」`);
    } catch {
      toast('挪过去失败了，再试一次');
    }
  };

  useEffect(() => { void reloadTodos(); void reloadTodoLists(); }, [reloadTodos, reloadTodoLists]);

  // 回收站单独拉：它里面的东西不该混进 store.todos，否则今日待办、统计都会被污染
  const [recycle, setRecycle] = useState<Todo[]>([]);
  const loadRecycle = async () => setRecycle(await api.todos.recycle().catch(() => [] as Todo[]));
  useEffect(() => { void loadRecycle(); }, []);
  useEffect(() => { if (sel.kind === 'recycle') void loadRecycle(); }, [sel.kind]);

  const bySel = useMemo(() => {
    switch (sel.kind) {
      case 'recycle': return recycle;
      case 'trash': return todos.filter((t) => t.trashed === 1);
      case 'all': return todos.filter((t) => !t.trashed);
      case 'inbox': return todos.filter((t) => !t.trashed && !t.listId);
      case 'today': return todos.filter((t) => !t.trashed && !!t.due && t.due <= today);
      case 'quad': return todos.filter((t) => !t.trashed && !t.done);
      default: return todos.filter((t) => !t.trashed && sel.ids.includes(t.listId));
    }
  }, [todos, recycle, sel, today]);

  // 搜索：标题 + 备注，命中高亮
  const kw = q.trim();
  const visible = useMemo(() => {
    if (!kw) return bySel;
    const k = kw.toLowerCase();
    return bySel.filter((t) => `${t.title || ''} ${t.note || ''}`.toLowerCase().includes(k));
  }, [bySel, kw]);

  const open = visible.filter((t) => !t.done);
  const done = visible.filter((t) => t.done);
  const rate = visible.length ? Math.round((done.length / visible.length) * 100) : 0;

  const alive = todos.filter((t) => !t.trashed);
  const globalDone = alive.filter((t) => t.done).length;
  const globalRate = alive.length ? Math.round((globalDone / alive.length) * 100) : 0;
  const trashCount = todos.filter((t) => t.trashed === 1).length;

  const preview = text.trim() ? parseSmartDate(text) : null;
  const defaultList = sel.kind === 'list' && sel.ids.length === 1 ? sel.ids[0] : '';

  const refresh = async () => { await reloadTodos(); await reloadTodoLists(); };

  const add = async () => {
    const raw = text.trim();
    if (!raw) { toast('先写点什么'); return; }
    const p = parseSmartDate(raw);
    await api.todos.add({
      title: p.title, due: p.due || '', dueTime: p.time || '', priority: 1, listId: defaultList,
      repeat: repeatCode(p),
    });
    setText('');
    await refresh();
    // 在「今天」里加了一条没有日期 / 明天以后的事，它会立刻从当前视图消失 —— 换成「全部」并提示
    const due = p.due || '';
    if (sel.kind === 'today' && (!due || due > today)) {
      setSel({ kind: 'all' });
      toast(due ? `已加到 ${due}${p.time ? ` ${p.time}` : ''}，先放到「全部」里给你看` : '已加进「全部」，没写日期');
    } else if (sel.kind === 'list' && defaultList && sel.ids.length === 1) {
      toast('已加入当前清单');
    }
  };

  const toggle = async (t: Todo) => {
    await api.todos.update({ id: t.id, done: t.done ? 0 : 1 });
    await refresh();
  };

  const setTrashed = async (t: Todo, on: boolean) => {
    await api.todos.trash(t.id, on ? 1 : 0);
    await refresh();
    toast(on ? '已放弃：不打算做了，不计入完成率' : '已捡回来');
  };

  /*
   * 第 163 条：手动排序。
   * 只有「手动」模式能拖 —— 切到四象限 / 截止日期时顺序由后端算，拖了也会被下一次查询冲掉，
   * 所以干脆不给手柄，免得用户白拖一场。
   * 已放弃（trashed）和回收站里的不参与排序，它们本来也不在这个列表里。
   */
  const canDrag = sortMode === 'manual'
    && sel.kind !== 'trash' && sel.kind !== 'recycle' && sel.kind !== 'quad';

  /**
   * 拖动落库。
   *
   * 只把「当前视图可见的这一段」重新排，但发回去的是**全部未完成待办**的顺序 ——
   * 否则在「今天」里拖一下，这几条的 sort 会变成 0/10/20，正好撞上「全部」里
   * 其他任务的旧值，换个视图顺序就乱了（老的逐条 +1/+10 混用就是这么坏的）。
   * 已完成 / 已放弃的不参与：它们在 SQL 里排在 done、trashed 之后，sort 怎么写都不影响。
   */
  const onReorder = async (from: number, to: number) => {
    const visIds = open.map((t) => t.id);
    if (from < 0 || to < 0 || from >= visIds.length || to >= visIds.length) return;
    const moved = visIds.slice();
    moved.splice(to, 0, moved.splice(from, 1)[0]);
    const inView = new Set(moved);
    const all = todos.filter((t) => !t.trashed && !t.done).map((t) => t.id);
    let k = 0;
    const next = all.map((id) => (inView.has(id) ? moved[k++] : id));
    try {
      await api.todos.reorder(next);
      await reloadTodos();
      toast('顺序已保存');
    } catch {
      toast('顺序没存上，再试一次');
    }
  };

  const { boxRef, props: dragProps } = useDragSort({
    keys: open.map((t) => t.id),
    disabled: !canDrag,
    onReorder,
  });

  /** 切换排序方式：写 settings 之后必须重新取一次，顺序是后端算的（§2.6） */
  const pickSort = async (mode: TodoSortMode) => {
    if (mode === sortMode) return;
    await setSetting('todoSortMode', mode);
    await reloadTodos();
    toast(mode === 'manual' ? '按你拖的顺序排，可以拖着换位置'
      : mode === 'quad' ? '按优先级排：又重要又紧急的在最上面'
        : '按截止日期排，没日期的垫底');
  };

  /* ---------------- 右键菜单（第 235 条） ---------------- */

  /**
   * 第 235 条：用户说得很明确 —— 右键菜单的潜力不该被一刀切封死。
   *
   * 待办这一行上，鼠标悬停才露出来的按钮已经有 3~4 个，
   * 再往下加就会把行挤爆；而「改优先级 / 挪清单 / 换个重复规则」这些
   * 恰好是低频但必要的操作，塞进右键最合适：不用占地方，想用时就在。
   *
   * 回收站 / 已放弃两个视图里的菜单项单独分支，因为能做的事不一样。
   */
  const ctx = useContextMenu();

  const copy = async (txt: string, what: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      toast(`已复制${what}`);
    } catch {
      toast('复制失败，可能是被系统拦了');
    }
  };

  const menuFor = (t: Todo): MenuItem[] => {
    /* 回收站里的东西只能恢复或彻底删，别的都无意义 */
    if (sel.kind === 'recycle') {
      return [
        { label: '捡回来', hint: '回到原来的清单', onClick: async () => {
          await api.todos.restore(t.id); await loadRecycle(); await refresh(); toast('已恢复');
        } },
        { sep: true },
        { label: '彻底删除', hint: '找不回来', danger: true, confirm: `彻底删除「${t.title}」？删除后无法恢复。`, onClick: async () => {
          await api.todos.purge(t.id); await loadRecycle(); toast('已彻底删除');
        } },
      ];
    }

    const items: MenuItem[] = [
      { label: t.done ? '标成未完成' : '标成完成', hint: t.done ? '' : '打勾', onClick: () => toggle(t) },
      { label: '编辑…', hint: '改标题 / 日期 / 备注', onClick: () => setEditTodo(t) },
      { sep: true },
      /* 优先级：四象限就是靠 priority 和 due 反推的，这里改它等于换象限 */
      ...PRIORITY_OPTIONS.map((p): MenuItem => ({
        label: `优先级 · ${p.label}`,
        hint: (t.priority || 0) === p.v ? '当前' : p.hint,
        disabled: (t.priority || 0) === p.v,
        onClick: async () => {
          await api.todos.update({ id: t.id, priority: p.v });
          await refresh();
          toast(`优先级改成「${p.label}」`);
        },
      })),
      { sep: true },
      { label: '明天到期', disabled: t.due === shiftDay(today, 1),
        onClick: async () => { await api.todos.update({ id: t.id, due: shiftDay(today, 1) }); await refresh(); toast('改成明天了'); } },
      { label: '明天一早', disabled: t.due === shiftDay(today, 1) && t.dueTime === '09:00',
        onClick: async () => { await api.todos.update({ id: t.id, due: shiftDay(today, 1), dueTime: '09:00' }); await refresh(); toast('改成明天 09:00'); } },
      { label: '清掉日期', hint: '回到「无期限」', disabled: !t.due && !t.dueTime,
        onClick: async () => { await api.todos.update({ id: t.id, due: '', dueTime: '' }); await refresh(); toast('日期清掉了'); } },
      { sep: true },
      /* 第 102 条：三个板块之间别让用户再手打一遍字 */
      { label: '开一颗番茄', hint: '任务名直接带过去', onClick: () => startPomoFor(t.title) },
      { label: '建成倒数日', hint: t.due ? `用它现在的期限 ${t.due}` : '没设日期，按今天算',
        onClick: async () => {
          const d = await todoToCountdown(t);
          if (d) toast(`已建倒数日「${t.title}」，${d}`);
          else toast('建失败，稍后再试');
        } },
      { sep: true },
      { label: '复制标题', onClick: () => copy(t.title, '标题') },
      { label: '复制成清单文本', hint: '- [ ] 一行', onClick: () => copy(`- [${t.done ? 'x' : ' '}] ${t.title}`, '待办文本') },
    ];

    /*
     * 挪清单（第 219 条顺带补的）：清单一般只有几个到十几个，
     * 直接平铺比做二级子菜单好用 —— 少一次悬停。
     * 清单特别多的时候这里会变长，但清单本来也不该有几十个。
     */
    if (lists.length) {
      items.push({ sep: true });
      items.push({ label: '放进清单', hint: '选一个', disabled: true });
      if (t.listId) {
        items.push({ label: '　收集箱', hint: '移出清单',
          onClick: async () => { await api.todos.moveList(t.id, ''); await refresh(); toast('已移出清单'); } });
      }
      for (const l of order) {
        items.push({
          label: `　${l.name}`,
          hint: t.listId === l.id ? '当前' : '',
          disabled: t.listId === l.id,
          onClick: async () => { await api.todos.moveList(t.id, l.id); await refresh(); toast(`已放进「${l.name}」`); },
        });
      }
    }

    items.push({ sep: true });

    if (t.trashed) {
      items.push({ label: '捡回来', hint: '重新做', onClick: () => setTrashed(t, false) });
      items.push({ label: '移到回收站', hint: '还能再恢复', danger: true,
        onClick: async () => { await api.todos.remove(t.id); await refresh(); await loadRecycle(); toast('已移到回收站'); } });
    } else {
      items.push({ label: '放弃', hint: '不做了，不计完成率', onClick: () => setTrashed(t, true) });
      items.push({ label: '删除', hint: '先进回收站', danger: true,
        onClick: async () => { await api.todos.remove(t.id); await refresh(); await loadRecycle(); toast('已移到回收站'); } });
    }

    return items;
  };

  const row = (t: Todo, i?: number) => {
    const dp = i == null ? null : dragProps(i);
    const overdue = !!t.due && t.due < today && !t.done && !t.trashed;
    const list = lists.find((l) => l.id === t.listId);
    return (
      <div
        key={t.id}
        className={`todo-row ${t.done ? 'done' : ''} ${dp?.className || ''}`}
        data-dragkey={dp?.['data-dragkey']}
        draggable={dp?.draggable}
        onDragStart={dp?.onDragStart}
        onDragOver={dp?.onDragOver}
        onDragLeave={dp?.onDragLeave}
        onDrop={dp?.onDrop}
        onDragEnd={dp?.onDragEnd}
        onContextMenu={(e) => ctx.open(e, menuFor(t))}
      >
        {dp?.draggable ? (
          <span className="mod-grip todo-grip" title="按住拖动，调整手动的顺序">⠿</span>
        ) : null}
        <div
          className="pri"
          style={{ background: t.priority >= 2 ? 'var(--bad)' : t.priority === 1 ? 'var(--warn)' : 'transparent' }}
        />
        <div className="ck" onClick={() => void toggle(t)}>{t.done ? '✓' : ''}</div>
        <div className="tx">
          <Highlight text={t.title} kw={kw} />
          <div className="sub">
            {t.due ? (
              <span style={{ color: overdue ? 'var(--bad)' : 'inherit' }}>
                {t.due === today ? '今天' : t.due}{t.dueTime ? ` ${t.dueTime}` : ''}{overdue ? ' 已逾期' : ''}
              </span>
            ) : null}
            {t.priority ? <span style={{ marginLeft: 6 }}>优先级 {priorityLabel(t.priority)}</span> : null}
            {list ? <span className="tag" style={{ marginLeft: 6 }}>{list.name}</span> : null}
            {t.repeat ? <span className="tag repeat" style={{ marginLeft: 6 }}>{repeatLabel(t.repeat)}</span> : null}
            {t.doneAt ? <span style={{ marginLeft: 6 }}>完成于 {t.doneAt.slice(5, 16)}</span> : null}
            {t.note ? <span style={{ marginLeft: 6 }}>· <Highlight text={t.note} kw={kw} /></span> : null}
          </div>
        </div>
        <div className="acts">
          {sel.kind === 'recycle' ? (
            <>
              <button
                className="btn sm ghost" title="恢复到原来的清单"
                onClick={async () => { await api.todos.restore(t.id); await loadRecycle(); await refresh(); toast('已恢复'); }}
              >恢复</button>
              <button
                className="btn sm ghost" title="彻底删除，无法找回"
                onClick={async () => {
                  if (!confirm(`彻底删除「${t.title}」？删除后无法恢复。`)) return;
                  await api.todos.purge(t.id);
                  await loadRecycle();
                  toast('已彻底删除');
                }}
              ><Icon name="x" size={13} /></button>
            </>
          ) : (
            <>
              <button className="btn sm ghost" data-act="edit" title="编辑" onClick={() => setEditTodo(t)}>
                <Icon name="pen" size={13} />
              </button>
              {t.trashed ? (
                <>
                  <button className="btn sm ghost" title="捡回来，重新做" onClick={() => void setTrashed(t, false)}>捡回来</button>
                  <button
                    className="btn sm ghost" title="移到回收站（还能再恢复）"
                    onClick={async () => { await api.todos.remove(t.id); await refresh(); await loadRecycle(); toast('已移到回收站'); }}
                  ><Icon name="trash" size={13} /></button>
                </>
              ) : (
                <>
                  <button className="btn sm ghost" data-act="giveup" title="放弃：过期了或不想做了，不算删除、不计完成率" onClick={() => void setTrashed(t, true)}>
                    <Icon name="archive" size={13} />
                  </button>
                  <button
                    className="btn sm ghost" title="删除（进回收站）"
                    onClick={async () => { await api.todos.remove(t.id); await refresh(); await loadRecycle(); toast('已移到回收站'); }}
                  ><Icon name="trash" size={13} /></button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const railItem = (
    key: string, icon: React.ReactNode, label: string, count: number,
    active: boolean, onClick: (e: React.MouseEvent) => void, extra?: React.ReactNode,
  ) => (
    <button key={key} className={`rail-item ${active ? 'on' : ''}`} onClick={onClick}>
      {icon}
      <span className="nm">{label}</span>
      {count ? <span className="n">{count}</span> : null}
      {extra}
    </button>
  );

  /* ---------------- 清单拖动排序：靠 sort 字段 ---------------- */

  const order = lists.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  /* 第 220 条：扁平顺序 → 层级顺序，左栏按 depth 缩进（拖动排序仍然只改同级 sort） */
  const tree = useMemo(() => buildListTree(order), [order]);

  const dropOn = async (targetId: string) => {
    const from = order.findIndex((l) => l.id === dragId);
    const to = order.findIndex((l) => l.id === targetId);
    setDragId(null);
    setDragOver(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    for (let i = 0; i < next.length; i += 1) {
      const want = i * 10;
      if ((next[i].sort || 0) !== want) await api.todos.updateList({ id: next[i].id, sort: want });
    }
    await reloadTodoLists();
    toast('顺序已保存');
  };

  const title = sel.kind === 'today' ? '今天到期'
    : sel.kind === 'inbox' ? '收集箱'
      : sel.kind === 'all' ? '全部任务'
        : sel.kind === 'trash' ? '已放弃'
          : sel.kind === 'recycle' ? '回收站'
            : sel.kind === 'quad' ? '四象限'
              : sel.ids.length === 1
                ? (lists.find((l) => l.id === sel.ids[0])?.name || '清单')
                : `组合视图 · ${sel.ids.length} 个清单`;

  return (
    <>
      <Topbar
        title="待办"
        sub={`${alive.filter((t) => !t.done).length} 项未完成 · 完成率 ${globalRate}%`}
        right={
          /*
           * 第 193 条：搜索框原来杵在「新建」输入框上面，两个都是满宽输入框、
           * 长得还像，用起来分不清哪个是找一个写。搜索放到顶栏右侧常驻，
           * 卡片里从上到下就只剩一条主路径：写 → 添加 → 列表。
           */
          <div className="searchbox sb-top">
            <Icon name="search" size={14} />
            <input placeholder="搜待办" value={q} onChange={(e) => setQ(e.target.value)} />
            {q ? <button className="sb-clear" onClick={() => setQ('')}>✕</button> : null}
          </div>
        }
      />
      <div className="wrap">
        <div className="todo-stack">
          <div className="rail">
            {/* 第 83 条：左栏右边这条能拖，把空隙调大调小 */}
            <div
              className={`todo-rail-grip ${railDrag ? 'on' : ''}`}
              onMouseDown={startRailDrag}
              title={railDragOn ? '拖动可以调左栏宽度（双击恢复默认）' : '左栏宽度已锁定，去「设置 → 界面布局」打开拖动'}
              onDoubleClick={() => { if (railDragOn) void setSetting('todoRailW', '196'); }}
            />
            {railItem('today', <Icon name="clock" size={14} />, '今天',
              todos.filter((t) => !t.trashed && !!t.due && t.due <= today && !t.done).length,
              sameSel(sel, { kind: 'today' }), () => setSel({ kind: 'today' }))}
            {railItem('inbox', <Icon name="inbox" size={14} />, '收集箱',
              todos.filter((t) => !t.trashed && !t.listId && !t.done).length,
              sameSel(sel, { kind: 'inbox' }), () => setSel({ kind: 'inbox' }))}
            {railItem('all', <Icon name="list" size={14} />, '全部',
              alive.filter((t) => !t.done).length,
              sameSel(sel, { kind: 'all' }), () => setSel({ kind: 'all' }))}
            {railItem('quad', <Icon name="grid" size={14} />, '四象限',
              alive.filter((t) => !t.done).length,
              sameSel(sel, { kind: 'quad' }), () => setSel({ kind: 'quad' }))}

            <div className="rail-h" style={{ display: 'flex', alignItems: 'center' }}>
              清单
              <button
                className="btn sm ghost" style={{ marginLeft: 'auto', padding: '0 4px' }}
                title="新建清单" onClick={() => setNewList(true)}
              >
                <Icon name="plus" size={13} />
              </button>
            </div>

            {tree.map(({ l, depth }) => (
              <button
                key={l.id}
                className={`rail-item ${sel.kind === 'list' && sel.ids.includes(l.id) ? 'on' : ''}`}
                draggable
                onDragStart={() => setDragId(l.id)}
                onDragEnd={() => { setDragId(null); setDragOver(null); }}
                onDragOver={(e) => { e.preventDefault(); if (dragId && dragId !== l.id) setDragOver(l.id); }}
                onDragLeave={() => setDragOver((x) => (x === l.id ? null : x))}
                onDrop={(e) => { e.preventDefault(); void dropOn(l.id); }}
                style={{
                  opacity: dragId === l.id ? 0.5 : 1,
                  borderTop: dragOver === l.id ? '2px solid var(--accent)' : '2px solid transparent',
                  // 第 220 条：层级缩进。超过 6 层就不再继续右移，否则深树会把名字挤没
                  paddingLeft: 9 + Math.min(depth, 6) * 13,
                }}
                title={l.note ? `${l.name}\n${l.note}` : l.name}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    const cur = sel.kind === 'list' ? sel.ids : [];
                    const next = cur.includes(l.id) ? cur.filter((x) => x !== l.id) : [...cur, l.id];
                    setSel(next.length ? { kind: 'list', ids: next } : { kind: 'all' });
                  } else {
                    setSel({ kind: 'list', ids: [l.id] });
                  }
                }}
              >
                {depth > 0 ? <span className="rail-tree" aria-hidden>└</span> : null}
                <span className="dot" style={{ background: l.color }} />
                <span className="nm">{l.name}</span>
                {l.open ? <span className="n">{l.open}</span> : null}
                <span
                  className="x"
                  title="编辑清单"
                  onClick={(e) => { e.stopPropagation(); setEditList(l); }}
                  style={{ cursor: 'pointer' }}
                >⋯</span>
              </button>
            ))}
            {lists.length === 0 ? <div className="small muted" style={{ padding: '4px 9px' }}>还没有清单</div> : null}
            <div className="small muted" style={{ padding: '2px 9px', fontSize: 11, lineHeight: 1.6 }}>
              Ctrl 点清单可组合查看；按住清单可拖动排序
            </div>

            <div className="rail-h">其他</div>
            {railItem('trash', <Icon name="archive" size={14} />, '已放弃', trashCount,
              sameSel(sel, { kind: 'trash' }), () => setSel({ kind: 'trash' }))}
            {railItem('recycle', <Icon name="trash" size={14} />, '回收站', recycle.length,
              sameSel(sel, { kind: 'recycle' }), () => setSel({ kind: 'recycle' }))}
          </div>

          <div className="card">
            <div className="todo-head">
              <h3>{title}</h3>
              <span className="sub">{visible.length} 项 · 完成 {done.length}</span>
              {/* 第 219 条：清单描述得真的看得见，否则填了等于没填 */}
              {sel.kind === 'list' && sel.ids.length === 1
                ? (() => {
                  const cur = lists.find((l) => l.id === sel.ids[0]);
                  if (!cur?.note) return null;
                  return <span className="todo-listnote" title={cur.note}>{cur.note}</span>;
                })()
                : null}
              {sel.kind === 'list' && sel.ids.length > 1 ? (
                <button className="btn sm ghost" onClick={() => setSel({ kind: 'all' })}>取消组合</button>
              ) : null}
              {sel.kind !== 'trash' && sel.kind !== 'recycle' && sel.kind !== 'quad' ? (
                <div className="seg todo-sortseg" title="换个排法；只有「手动」能拖动">
                  {SORTS.map((s) => (
                    <button
                      key={s.v}
                      className={`seg-b ${sortMode === s.v ? 'on' : ''}`}
                      data-sort={s.v}
                      onClick={() => void pickSort(s.v)}
                    >{s.n}</button>
                  ))}
                </div>
              ) : null}
            </div>

            {sel.kind !== 'trash' && sel.kind !== 'recycle' && sel.kind !== 'quad' ? (
              <div className="small muted todo-sorthint">
                {sortMode === 'manual'
                  ? '按住待办左边的 ⠿ 拖动，顺序会记住'
                  : sortMode === 'quad' ? '按优先级排：重要、紧急的在前。想自己摆就切到「手动」'
                    : '按截止日期由近到远，没写日期的垫底。想自己摆就切到「手动」'}
              </div>
            ) : null}

            {sel.kind === 'quad' ? <QuadHint /> : null}

            {sel.kind !== 'trash' && sel.kind !== 'recycle' && sel.kind !== 'quad' ? (
              <>
                <div className="row" style={{ marginBottom: 4 }}>
                  <input
                    className="inp"
                    style={{ flex: 1 }}
                    placeholder="说人话就行：明天下午三点开周会 / 周五交报告 / 3 天后复查"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
                  />
                  <button className="btn primary" onClick={() => void add()}>
                    <Icon name="plus" size={14} />添加
                  </button>
                  {/* 第 129 条：一行输入够快，但真要把优先级 / 备注 / 重复 / 清单一次写全，
                      还是得有个详细面板。用户原话「本来应该很丰富很详细的新建」。 */}
                  <button
                    className="btn"
                    data-act="todo-new"
                    title="详细新建：一次写好日期、优先级、重复、清单和备注"
                    onClick={() => setNewOpen(true)}
                  >
                    <Icon name="sliders" size={13} />详细
                  </button>
                </div>
                <div className="small" style={{ color: 'var(--ink3)', marginBottom: 10, minHeight: 18 }}>
                  {preview && (preview.due || preview.time) ? (
                    <>识别为：<b style={{ color: 'var(--accent)' }}>{preview.due || '今天'} {preview.time}</b> · 标题「{preview.title}」</>
                  ) : '可以直接写「明天」「周五」「10月30日」「下午三点」，会自动识别日期'}
                </div>
              </>
            ) : null}

            {sel.kind === 'trash' || sel.kind === 'recycle' ? (
              <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.8 }}>
                {sel.kind === 'trash' ? (
                  <>这里放过时但没做完的事。<b>它们不计入完成率和未完成率</b>，也不出现在别处的计数里。想重新捡起来就点「捡回来」。</>
                ) : (
                  <>删掉的任务先来这里，随时能恢复；「彻底删除」才是真的没了。</>
                )}
              </div>
            ) : null}

            {sel.kind !== 'trash' && sel.kind !== 'recycle' && sel.kind !== 'quad' ? (
              <>
                <div className="rate-bar"><i style={{ width: `${rate}%` }} /></div>
                <div className="small muted" style={{ marginBottom: 12 }}>
                  当前视图完成率 {rate}%（{done.length}/{visible.length}）· 已放弃的不算
                </div>
              </>
            ) : null}

            {sel.kind === 'quad' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {QUADRANTS.map((qd) => {
                  const items = visible.filter((t) => quadrantOf(t, today) === qd.key);
                  return (
                    <div
                      key={qd.key}
                      /* 第 142 条：这里同时是拖放目标 —— 把待办拖到哪个格子就归到哪个象限 */
                      className={`card quad-cell ${quadOver === qd.key ? 'drop-target' : ''}`}
                      style={{ margin: 0, padding: '12px 14px', borderTop: `3px solid ${qd.color}` }}
                      onDragOver={(e) => {
                        if (!quadDrag) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (quadOver !== qd.key) setQuadOver(qd.key);
                      }}
                      onDragLeave={() => { if (quadOver === qd.key) setQuadOver(''); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = quadDrag || e.dataTransfer.getData('text/plain');
                        setQuadDrag('');
                        setQuadOver('');
                        if (id) void moveToQuad(id, qd.key);
                      }}
                    >
                      <div className="todo-head" style={{ marginBottom: 6 }}>
                        <h3 style={{ margin: 0, fontSize: 13.5 }}>{qd.title}</h3>
                        <span className="sub">{qd.hint}</span>
                        <span style={{ flex: 1 }} />
                        <span className="sub">{items.length}</span>
                      </div>
                      {items.length ? items.map((t) => (
                        <div
                          key={t.id}
                          className={`quad-drag ${quadDrag === t.id ? 'dragging' : ''}`}
                          draggable
                          title="按住拖到别的格子，换象限"
                          onDragStart={(e) => {
                            setQuadDrag(t.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', t.id);
                          }}
                          onDragEnd={() => { setQuadDrag(''); setQuadOver(''); }}
                        >
                          {row(t)}
                        </div>
                      )) : <div className="empty small">这里空着。</div>}
                    </div>
                  );
                })}
              </div>
            ) : visible.length ? (
              <>
                {open.length ? (
                  <div ref={boxRef} className="todo-sortable">
                    {open.map((t, i) => row(t, i))}
                  </div>
                ) : (
                  <div className="empty">
                    {kw ? `没有匹配「${kw}」的未完成任务。` : '这里没有未完成的事。'}
                  </div>
                )}
                {done.length ? (
                  <>
                    <div className="small muted" style={{ margin: '16px 0 4px' }}>已完成 {done.length}</div>
                    {done.slice(0, 40).map((t) => row(t))}
                    {sel.kind !== 'trash' ? (
                      <div className="row" style={{ marginTop: 12 }}>
                        <button
                          className="btn sm danger"
                          onClick={async () => { await api.todos.clearDone(); await refresh(); }}
                        >
                          清空已完成
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <div className="empty">
                {kw
                  ? `没有找到包含「${kw}」的任务，换个关键词试试。`
                  : sel.kind === 'trash' ? '还没有放弃的任务。'
                    : sel.kind === 'recycle' ? '回收站是空的。删掉的任务会先来这里，随时能捡回来。'
                      : '这里还没有任务。'}
              </div>
            )}
          </div>
        </div>
      </div>

      {newList ? <TodoListDialog list={null} lists={lists} onClose={() => setNewList(false)} /> : null}
      {editList ? <TodoListDialog list={editList} lists={lists} onClose={() => setEditList(null)} /> : null}
      {editTodo ? (
        <TodoEditDialog
          todo={editTodo}
          lists={lists}
          onClose={() => setEditTodo(null)}
        />
      ) : null}
      {/* 第 129 条：详细新建 */}
      {newOpen ? (
        <TodoNewDialog
          lists={lists}
          defaultList={defaultList}
          onClose={() => setNewOpen(false)}
          onDone={() => void refresh()}
        />
      ) : null}
      {ctx.node}
    </>
  );
}
