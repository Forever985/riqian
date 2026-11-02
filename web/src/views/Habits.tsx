import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore } from '../store';
import { useDragSort } from '../components/DragSort';
import { Topbar, Dialog, askConfirm } from '../components/ui';
import { ColorDots } from '../components/ColorDots';
import { HabitWidget, HabitSpark, habitIsDone } from '../modules/HabitWidget';
import { HabitStatsPanel } from '../features/habitStats';
import { COLORS, HABIT_TYPE_NAME } from '../lib/const';
import { todayKey } from '../lib/date';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import type { Habit, HabitHistory, HabitType } from '../types';

/* ---------------- 新建 / 编辑习惯 ---------------- */

const HABIT_TYPES: [HabitType, string][] = [
  ['bool', '打卡（做没做）'],
  ['time', '时间（几点）'],
  ['number', '数值（多少个）'],
  ['duration', '时长（多少分钟）'],
  ['choice', '多选（哪几项）'],
  ['note', '备注（一句话）'],
];

function HabitEditor({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const reloadHabits = useStore((s) => s.reloadHabits);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(habit?.name || '');
  const [icon, setIcon] = useState(habit?.icon || '');
  const [type, setType] = useState<HabitType>((habit?.type as HabitType) || 'bool');
  const [unit, setUnit] = useState(habit?.unit || '');
  const [goal, setGoal] = useState(String(habit?.goal || ''));
  const [opts, setOpts] = useState((habit?.options || []).join(', '));
  const [color, setColor] = useState(habit?.color || COLORS[0]);

  const save = async () => {
    if (!name.trim()) { toast('名称不能空'); return; }
    const payload = {
      name: name.trim(),
      icon: icon.trim(),
      type,
      unit: unit.trim(),
      options: opts.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      goal: Number(goal) || 0,
      color,
    };
    if (habit) await api.habits.update({ id: habit.id, ...payload });
    else await api.habits.add(payload);
    await reloadHabits();
    toast('已保存');
    onClose();
  };

  return (
    <Dialog
      title={habit ? '编辑习惯' : '新建习惯'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => void save()}>保存</button>
      </>}
    >
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <div className="field" style={{ flex: '0 0 74px' }}>
          <label>图标</label>
          <input className="inp" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="早" maxLength={2} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>名称</label>
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="早起 / 跑步 / 阅读" />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>数据类型</label>
        <select className="inp" value={type} onChange={(e) => setType(e.target.value as HabitType)}>
          {HABIT_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>单位</label>
          <input className="inp" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="页 / 分钟 / 个" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>每日目标（可空）</label>
          <input className="inp" type="number" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="30" />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>多选项（逗号分隔，仅「多选」类型用）</label>
        <input className="inp" value={opts} onChange={(e) => setOpts(e.target.value)} placeholder="跑步, 力量, 游泳" />
      </div>
      <div className="field">
        <label>颜色</label>
        <ColorDots colors={COLORS} value={color} onPick={setColor} />
      </div>
    </Dialog>
  );
}

/* ---------------- 近 60 天详情 ---------------- */

function HabitDetail({ habit, onClose }: { habit: Habit; onClose: () => void }) {
  const [hist, setHist] = useState<HabitHistory | null>(null);

  useEffect(() => { void api.habits.history(habit.id, 60).then(setHist).catch(() => setHist(null)); }, [habit.id]);

  const cell = (v: unknown) => {
    if (v == null) return '—';
    if (habit.type === 'bool') return v ? '✓' : '—';
    if (habit.type === 'choice') return Array.isArray(v) ? v.join('、') : String(v);
    return String(v);
  };

  const rows = [...(hist?.list || [])].reverse();

  return (
    <Dialog title={`${habit.name} · 近 60 天`} wide onClose={onClose} footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div className="row" style={{ gap: 18, marginBottom: 14 }}>
        <div className="stat" style={{ flex: 1 }}>
          <div className="k">记录天数</div>
          <div className="v">{hist?.count ?? 0}<small>天</small></div>
        </div>
        <div className="stat" style={{ flex: 1 }}>
          <div className="k">连续</div>
          <div className="v">{habit.streak}<small>天</small></div>
        </div>
        {hist?.avgNumber ? (
          <div className="stat" style={{ flex: 1 }}>
            <div className="k">平均</div>
            <div className="v">{hist.avgNumber}<small>{habit.unit || ''}</small></div>
          </div>
        ) : null}
        {hist?.avgTime ? (
          <div className="stat" style={{ flex: 1 }}>
            <div className="k">平均时间</div>
            <div className="v">{hist.avgTime}</div>
          </div>
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(118px,1fr))', gap: 6 }}>
        {rows.length ? rows.map((r) => (
          <div
            key={r.date}
            style={{
              border: '1px solid var(--line2)', borderRadius: 8, padding: '6px 9px', fontSize: 12.5,
              display: 'flex', justifyContent: 'space-between', background: 'var(--panel2)',
            }}
          >
            <span className="muted">{r.date.slice(5)}</span>
            <b style={{ fontWeight: 600 }}>{cell(r.v)}</b>
          </div>
        )) : <div className="empty">还没有记录。</div>}
      </div>

      {rows.some((r) => r.note) ? (
        <>
          <div className="small muted" style={{ margin: '16px 0 4px' }}>写过的记录</div>
          {rows.filter((r) => r.note).map((r) => (
            <div className="hnote-hist" key={`n-${r.date}`}>
              <span className="d">{r.date.slice(5)}</span>
              <span className="t">{r.note}</span>
            </div>
          ))}
        </>
      ) : null}
    </Dialog>
  );
}

/* ---------------- 卡片右上角的「…」菜单 ---------------- */

function HabitCardMenu({
  habit, onDetail, onEdit, onArchive, onDelete,
}: {
  habit: Habit;
  onDetail: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 点外面 / Esc 关掉，菜单不能赖在屏幕上
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.right - 168, window.innerWidth - 176)), top: r.bottom + 4 });
    setOpen((v) => !v);
  };

  const run = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <>
      <button
        ref={btnRef}
        className="btn sm ghost"
        title="更多操作"
        style={{ padding: '2px 7px', lineHeight: 1.1 }}
        onClick={toggle}
      >
        …
      </button>
      {open ? createPortal(
        <div
          ref={boxRef}
          className="rowmenu"
          style={{ position: 'fixed', left: pos.left, top: pos.top, right: 'auto', minWidth: 168, zIndex: 120 }}
        >
          <button onClick={() => run(onDetail)}>查看近 60 天</button>
          <button onClick={() => run(onEdit)}>编辑名称 / 颜色</button>
          <button onClick={() => run(onArchive)}>{habit.archived ? '取消归档' : '归档'}</button>
          <button onClick={() => run(onDelete)} style={{ color: 'var(--bad)' }}>删除（进回收站）</button>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

/* ---------------- 管理 ---------------- */

function HabitManage({
  onClose, onEdit, onNew,
}: {
  onClose: () => void;
  onEdit: (h: Habit) => void;
  onNew: () => void;
}) {
  const habits = useStore((s) => s.habits);
  const reloadHabits = useStore((s) => s.reloadHabits);
  const toast = useStore((s) => s.toast);

  const toggleArchive = async (h: Habit) => {
    await api.habits.update({ id: h.id, archived: h.archived ? 0 : 1 });
    await reloadHabits();
    toast(h.archived ? '已取消归档' : '已归档');
  };

  const remove = async (h: Habit) => {
    if (!(await askConfirm(`把「${h.name}」移到回收站？`, { body: '打卡记录会保留，可以在回收站里恢复。', ok: '移到回收站' }))) return;
    await api.habitDelete(h.id);
    await reloadHabits();
    toast('已移到回收站');
  };

  return (
    <Dialog
      title="管理习惯"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>关闭</button>
        <button className="btn primary" onClick={onNew}>新建</button>
      </>}
    >
      {habits.length ? habits.map((h) => (
        <div className="hrow" key={h.id} style={{ padding: '9px 0' }}>
          <span className="ico" style={{ width: 20, textAlign: 'center' }}>{h.icon || '·'}</span>
          <span className="nm" style={{ opacity: h.archived ? 0.45 : 1, textDecoration: h.archived ? 'line-through' : 'none' }}>
            {h.name}
          </span>
          <span className="ty">{HABIT_TYPE_NAME[h.type] || h.type}</span>
          <span className="num">连续 {h.streak} · 共 {h.total}</span>
          <button className="btn sm ghost" onClick={() => onEdit(h)}>改</button>
          <button className="btn sm ghost" onClick={() => void toggleArchive(h)}>
            {h.archived ? '恢复' : '归档'}
          </button>
          <button className="btn sm ghost danger" title="移到回收站（可在回收站里恢复）" onClick={() => void remove(h)}>✕ 删除</button>
        </div>
      )) : <div className="empty">还没有习惯。</div>}
      <div className="small muted" style={{ marginTop: 10, lineHeight: 1.8 }}>
        「归档」只是从打卡列表里收起来，记录还在；「删」会先放进回收站，在回收站里还能恢复。
      </div>
    </Dialog>
  );
}

/* ---------------- 回收站 ---------------- */

interface TrashItem { id: string; name: string; color: string; deletedAt: string }

function HabitTrashDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<TrashItem[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setList(await api.habitTrash()); } catch { setList([]); }
  };

  useEffect(() => { void load(); }, []);

  const restore = async (x: TrashItem) => {
    setBusy(true);
    try {
      await api.habitRestore(x.id);
      toast(`已恢复「${x.name}」`);
      await load();
      onChanged();
    } catch (e) {
      toast('恢复失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const purge = async (x: TrashItem) => {
    if (!(await askConfirm(`彻底删除「${x.name}」？`, { body: '会连它的全部打卡记录一起删掉，删了就找不回来了。', ok: '彻底删除' }))) return;
    setBusy(true);
    try {
      await api.habitPurge(x.id);
      toast('已彻底删除');
      await load();
      onChanged();
    } catch (e) {
      toast('删除失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="打卡回收站" onClose={onClose} footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.8 }}>
        删除习惯只是先放到这里，打卡记录都还留着；只有「彻底删除」才会真的把记录一起清掉。
      </div>
      {list.length ? list.map((x) => (
        <div className="hrow" key={x.id} style={{ padding: '9px 0' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: x.color || 'var(--line)', flex: '0 0 auto' }} />
          <span className="nm">{x.name}</span>
          <span className="num">{x.deletedAt ? x.deletedAt.slice(0, 16).replace('T', ' ') : ''}</span>
          <button className="btn sm" disabled={busy} onClick={() => void restore(x)}>恢复</button>
          <button className="btn sm danger" disabled={busy} onClick={() => void purge(x)}>彻底删除</button>
        </div>
      )) : <div className="empty">回收站是空的。</div>}
    </Dialog>
  );
}

/* ---------------- 打卡页 ---------------- */

export function HabitsView() {
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.logs);
  const notes = useStore((s) => s.habitNotes);
  const date = useStore((s) => s.date);
  const setLog = useStore((s) => s.setLog);
  const setHabitNote = useStore((s) => s.setHabitNote);
  const reloadHabits = useStore((s) => s.reloadHabits);

  const [editor, setEditor] = useState<{ open: boolean; habit: Habit | null }>({ open: false, habit: null });
  const [detail, setDetail] = useState<Habit | null>(null);
  const [manage, setManage] = useState(false);
  const [trash, setTrash] = useState(false);
  /* 拖动排序统一走 useDragSort：DnD 负责搬，FLIP 负责放下之后那一下滑过去（第 93 条） */
  /** 打卡 / 习惯变了就让统计面板重取一次 */
  const [statTick, setStatTick] = useState(0);

  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const sortMode = String(settings.habitSortMode || 'drag');
  const canDrag = sortMode === 'drag' || sortMode === 'both';

  useEffect(() => { void reloadHabits(); }, [reloadHabits]);
  const firstStat = useRef(true);
  useEffect(() => {
    if (firstStat.current) { firstStat.current = false; return; }
    setStatTick((t) => t + 1);
  }, [logs, habits]);

  const active = habits.filter((h) => !h.archived);
  const archived = habits.filter((h) => h.archived);

  /** 保存习惯顺序：只存未归档的，归档的跟在后面 */
  const saveOrder = async (ids: string[]) => {
    const rest = habits.filter((h) => h.archived).map((h) => h.id);
    await api.habits.reorder([...ids, ...rest]);
    await reloadHabits();
  };

  const moveBy = async (id: string, dir: -1 | 1) => {
    const ids = active.map((h) => h.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await saveOrder(ids);
  };

  const { boxRef: habitBoxRef, props: habitDrag } = useDragSort({
    keys: active.map((h) => h.id),
    disabled: !canDrag,
    onReorder: async (from, to) => {
      const ids = active.map((h) => h.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      await saveOrder(ids);
      toast('打卡顺序已保存');
    },
  });

  const archiveHabit = async (h: Habit) => {
    try {
      await api.habits.update({ id: h.id, archived: h.archived ? 0 : 1 });
      await reloadHabits();
      toast(h.archived ? '已取消归档，回到打卡列表' : '已归档，不再出现在打卡列表');
    } catch (e) {
      toast('没成功：' + (e as Error).message);
    }
  };

  const deleteHabit = async (h: Habit) => {
    if (!(await askConfirm(`把「${h.name}」移到回收站？`, { body: '打卡记录会保留，可以在回收站里恢复。', ok: '移到回收站' }))) return;
    try {
      await api.habitDelete(h.id);
      await reloadHabits();
      toast('已移到回收站');
    } catch (e) {
      toast('删除失败：' + (e as Error).message);
    }
  };

  /* ---------------- 右键菜单（第 235 条） ----------------
   *
   * 一张打卡卡片的右上角已经挤了「上移 / 下移 / 详情 / 改 / …」五个按钮，
   * 再往里塞就只能缩字号了。这些操作里有一半是低频的（改名字、归档、删除），
   * 正好是右键该干的活：平时不占地方，想起来时就在鼠标底下。
   *
   * 注意「上移 / 下移」在这里仍然保留 —— 它们确实低频，
   * 但只要用户在「界面布局」里选了按钮模式，就说明他喜欢按钮，不该被他关掉。
   */
  const ctx = useContextMenu();

  const menuFor = (h: Habit, idx: number): MenuItem[] => [
    { label: '查看近 60 天', hint: '打卡曲线', onClick: () => setDetail(h) },
    { label: '编辑名称 / 颜色', onClick: () => setEditor({ open: true, habit: h }) },
    { sep: true },
    { label: '上移一行', disabled: idx === 0, onClick: () => void moveBy(h.id, -1) },
    { label: '下移一行', disabled: idx >= active.length - 1, onClick: () => void moveBy(h.id, 1) },
    { sep: true },
    { label: '归档', hint: '从打卡列表收起来，记录保留', onClick: () => void archiveHabit(h) },
    { label: '删除（进回收站）', danger: true, onClick: () => void deleteHabit(h) },
  ];

  const done = active.filter((h) => habitIsDone(h, logs[h.id])).length;
  const pct = active.length ? Math.round((done / active.length) * 100) : 0;

  return (
    <>
      <Topbar title="打卡" sub={date === todayKey() ? '今天' : `回顾 ${date}`}
        lock={{ scope: 'habits', label: '打卡记录' }}
      />
      <div className="wrap">
        <div className="card">
          <h3>今天 <span className="muted">{date}</span></h3>
          <div className="row" style={{ gap: 18, marginBottom: 14 }}>
            <div className="stat" style={{ flex: 1 }}>
              <div className="k">完成</div>
              <div className="v">{done}<small>/ {active.length}</small></div>
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="stat" style={{ flex: 1 }}>
              <div className="k">习惯数</div>
              <div className="v">{active.length}<small>个</small></div>
              <div className="s">{archived.length} 个已归档</div>
            </div>
            <div className="stat" style={{ flex: 1 }}>
              <div className="k">写了记录的</div>
              <div className="v">{Object.values(notes).filter(Boolean).length}<small>条</small></div>
              <div className="s">边打卡边记一句</div>
            </div>
          </div>

          <div ref={habitBoxRef} className="habit-sortable">
          {active.length ? active.map((h, idx) => {
            const vv = logs[h.id];
            const on = habitIsDone(h, vv);
            const showBtns = sortMode === 'buttons' || sortMode === 'both';
            return (
              <div
                className={`hcard ${on ? 'done' : ''} ${habitDrag(idx).className}`}
                key={h.id}
                data-dragkey={habitDrag(idx)['data-dragkey']}
                style={{ marginBottom: 10, position: 'relative' }}
                onDragOver={habitDrag(idx).onDragOver}
                onDragLeave={habitDrag(idx).onDragLeave}
                onDrop={habitDrag(idx).onDrop}
                onContextMenu={(e) => ctx.open(e, menuFor(h, idx))}
              >
                <div className="top">
                  {canDrag ? (
                    <span
                      className="mod-grip" title="拖动调整顺序"
                      draggable={habitDrag(idx).draggable}
                      onDragStart={habitDrag(idx).onDragStart}
                      onDragEnd={habitDrag(idx).onDragEnd}
                    >⠿</span>
                  ) : null}
                  <span className="ico">{h.icon || '·'}</span>
                  <span className="nm">{h.name}</span>
                  {h.type === 'bool' ? <span className="val">{vv != null ? '已打卡' : '未记录'}</span> : null}
                  <span className="goal">{h.streak ? `连续 ${h.streak} 天` : ''}</span>
                  {showBtns ? (
                    <>
                      <button className="btn sm ghost" data-act="up" title="上移" disabled={idx === 0} onClick={() => void moveBy(h.id, -1)}>↑</button>
                      <button className="btn sm ghost" data-act="down" title="下移" disabled={idx === active.length - 1} onClick={() => void moveBy(h.id, 1)}>↓</button>
                    </>
                  ) : null}
                  <button className="btn sm ghost" onClick={() => setDetail(h)}>详情</button>
                  <button className="btn sm ghost" title="编辑名称 / 颜色" onClick={() => setEditor({ open: true, habit: h })}>改</button>
                  <HabitCardMenu
                    habit={h}
                    onDetail={() => setDetail(h)}
                    onEdit={() => setEditor({ open: true, habit: h })}
                    onArchive={() => void archiveHabit(h)}
                    onDelete={() => void deleteHabit(h)}
                  />
                </div>
                <div className="body" style={{ marginBottom: 9 }}>
                  <HabitWidget
                    habit={h}
                    value={vv}
                    onCommit={(v) => void setLog(h.id, v)}
                    note={notes[h.id]}
                    onNote={(v) => void setHabitNote(h.id, v)}
                  />
                </div>
                <HabitSpark habit={h} />
              </div>
            );
          }) : <div className="empty">还没有习惯。下面加一个吧，比如「早起（记录几点起）」「跑步（记录分钟数）」。</div>}
          </div>
        </div>

        <div className="card">
          <h3>统计 <span className="muted">完成情况</span></h3>
          <HabitStatsPanel days={30} habitCount={active.length} refreshKey={statTick} />
        </div>

        <div className="card">
          <h3>新增 / 管理</h3>
          <div className="row">
            <button className="btn primary" onClick={() => setEditor({ open: true, habit: null })}>＋ 新建习惯</button>
            <button className="btn" onClick={() => setManage(true)}>管理已有</button>
            <button className="btn" onClick={() => setTrash(true)}>回收站</button>
          </div>
          <div className="small muted" style={{ marginTop: 12, lineHeight: 1.9 }}>
            习惯可以记不同类型的数据：<br />
            · <b>打卡</b>：做没做<br />
            · <b>时间</b>：几点起床 / 几点睡<br />
            · <b>数值</b>：读了几页 / 做了几组<br />
            · <b>时长</b>：运动多少分钟<br />
            · <b>多选</b>：参加了什么运动<br />
            · <b>备注</b>：一句话说明
          </div>
        </div>

        {archived.length ? (
          <div className="card">
            <h3>已归档 <span className="muted">{archived.length} 个</span></h3>
            {archived.map((h) => (
              <div
                className="hrow"
                key={h.id}
                style={{ padding: '9px 0' }}
                onContextMenu={(e) => ctx.open(e, [
                  { label: '取消归档', hint: '回到打卡列表', onClick: () => void archiveHabit(h) },
                  { sep: true },
                  { label: '删除（进回收站）', danger: true, onClick: () => void deleteHabit(h) },
                ])}
              >
                <span className="ico" style={{ width: 20, textAlign: 'center' }}>{h.icon || '·'}</span>
                <span className="nm" style={{ opacity: 0.65 }}>{h.name}</span>
                <span className="ty">{HABIT_TYPE_NAME[h.type] || h.type}</span>
                <span className="num">连续 {h.streak} · 共 {h.total}</span>
                <button className="btn sm" onClick={() => void archiveHabit(h)}>取消归档</button>
                <button className="btn sm danger" onClick={() => void deleteHabit(h)}>删除</button>
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 8 }}>
              归档只是收起来，打卡记录都还在；取消归档就会回到上面的列表。
            </div>
          </div>
        ) : null}
      </div>

      {editor.open ? (
        <HabitEditor habit={editor.habit} onClose={() => setEditor({ open: false, habit: null })} />
      ) : null}
      {detail ? <HabitDetail habit={detail} onClose={() => setDetail(null)} /> : null}
      {manage ? (
        <HabitManage
          onClose={() => setManage(false)}
          onEdit={(h) => { setManage(false); setEditor({ open: true, habit: h }); }}
          onNew={() => { setManage(false); setEditor({ open: true, habit: null }); }}
        />
      ) : null}
      {trash ? (
        <HabitTrashDialog onClose={() => setTrash(false)} onChanged={() => void reloadHabits()} />
      ) : null}

      {/* 第 235 条：右键菜单出口 */}
      {ctx.node}
    </>
  );
}
