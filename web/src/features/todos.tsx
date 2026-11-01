/**
 * 待办的零件：编辑弹层、清单弹层、四象限归类。
 * 只用 Todo / TodoList 上已有的字段（priority / due / dueTime / repeat / listId / sort），不编后端。
 */
import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog } from '../components/ui';
import { shiftDay, todayKey } from '../lib/date';
import type { Todo, TodoList } from '../types';

export const PRIORITY_OPTIONS: { v: number; label: string; color: string; hint: string }[] = [
  { v: 0, label: '无', color: 'var(--line)', hint: '不标优先级' },
  { v: 1, label: '中', color: 'var(--warn)', hint: '有空就做' },
  { v: 2, label: '高', color: 'var(--bad)', hint: '今天要推进' },
  { v: 3, label: '紧急', color: 'var(--bad)', hint: '别的事先放下' },
];

export const priorityLabel = (p: number) => PRIORITY_OPTIONS.find((x) => x.v === p)?.label || '无';

export const REPEAT_OPTIONS: { v: string; label: string }[] = [
  { v: '', label: '不重复' },
  { v: 'daily', label: '每天' },
  { v: 'weekday', label: '每个工作日' },
  { v: 'weekly', label: '每周' },
  { v: 'monthly', label: '每月' },
  { v: 'monthly-last', label: '每月最后一天' },
  /*
   * 第 192 条：光靠智能识别不够，有人就是要用下拉框点。
   * 这里给常用的两个：最后一个 / 第一个周几。要第 2、3 个还是打文字。
   */
  { v: 'monthly-weekday:-1:4', label: '每月最后一个周四' },
  { v: 'monthly-weekday:1:1', label: '每月第一个周一' },
  { v: 'yearly', label: '每年' },
  { v: 'lunar-yearly', label: '每年（农历）' },
];

/* ---------------- 详细新建待办（第 129 条） ---------------- */

/**
 * 第 129 条：用户原话「这让我不禁想到，是否有很多类似的『新建』也和这个一样，非常的简陋？
 * 本来应该很丰富很详细的新建。」
 *
 * 待办原来只有一行输入框 + 「添加」——写的时候看不到也能改不到：优先级只能是 1、
 * 不能写备注、不能挂重复、不能挑清单。加一条要改四样东西，只能先加再一条条点开改。
 *
 * 这里给一个「详细新建」面板，字段和编辑弹层对齐（标题/备注/日期/时间/四象限/清单/重复），
 * 但默认只占一屏、一眼能看完；顶部那行还能继续用「说人话」自然语言解析 ——
 * 两边不冲突：一行输入快，面板细。
 */
export function TodoNewDialog({
  lists, defaultList, onClose, onDone,
}: {
  lists: TodoList[];
  defaultList: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const curDay = todayKey();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState(1);
  const [listId, setListId] = useState(defaultList);
  const [repeat, setRepeat] = useState('');
  /* 连着加：写完一条不清面板，直接清标题继续下一条 —— 一次记事往往是好几件 */
  const [keepOn, setKeepOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const quad = quadrantOf({ priority, due } as Todo, curDay);

  const save = async () => {
    if (busy) return;
    if (!title.trim()) { toast('标题不能空'); return; }
    setBusy(true);
    try {
      const r = await api.todos.add({
        title: title.trim(),
        note: note.trim(),
        due,
        dueTime: due ? dueTime : '',
        priority,
        listId,
        repeat,
      });
      if (!r?.ok) { toast('添加失败'); return; }
      onDone();
      toast(`已添加${due ? ` · ${due}${dueTime ? ` ${dueTime}` : ''}` : ''}`);
      if (keepOn) {
        setTitle('');
        setNote('');
        // 日期和清单留着 —— 连着记的事项通常同一天、同一清单
        setBusy(false);
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>('[data-newtodo-title]')?.focus();
        });
        return;
      }
      onClose();
    } catch (e) {
      toast('添加失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="新建待办"
      onClose={onClose}
      footer={<>
        <label className="row small muted" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={keepOn} onChange={(e) => setKeepOn(e.target.checked)} />
          加完继续加
        </label>
        <span className="sp" />
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>添加</button>
      </>}
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label>要做什么</label>
        <input
          className="inp"
          autoFocus
          data-newtodo-title="1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            // 中文输入法回车是在选词，别当成提交
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save();
          }}
          placeholder="一句话说清这件事"
        />
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>截止日期</label>
          <input className="inp" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 110 }}>
          <label>截止时间</label>
          <input
            className="inp" type="time" value={dueTime}
            disabled={!due}
            title={due ? '' : '先选日期才有时间可填'}
            onChange={(e) => setDueTime(e.target.value)}
          />
        </div>
      </div>

      {/* 常用日期一键填：比开日历快得多 */}
      <div className="row" style={{ gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          ['今天', 0], ['明天', 1], ['后天', 2], ['本周日', -1], ['下周一', -2],
        ].map(([label, off]) => (
          <button
            key={String(label)}
            className={`chip ${due === (off === -1 ? nextWeekday(0) : off === -2 ? nextWeekday(1) : shiftDay(curDay, Number(off))) ? 'on' : ''}`}
            style={{ fontSize: 11.5, padding: '2px 9px' }}
            onClick={() => {
              const d = off === -1 ? nextWeekday(0) : off === -2 ? nextWeekday(1) : shiftDay(curDay, Number(off));
              setDue(d);
            }}
          >{label}</button>
        ))}
        {due ? (
          <button className="chip" style={{ fontSize: 11.5, padding: '2px 9px' }} onClick={() => { setDue(''); setDueTime(''); }}>
            清空
          </button>
        ) : null}
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 150 }}>
          <label>四象限</label>
          <select
            className="inp"
            value={quad}
            onChange={(e) => {
              const patch = quadPatch(e.target.value as QuadKey, curDay);
              setPriority(patch.priority);
              setDue(patch.due ?? '');
              if (patch.due == null) setDueTime('');
            }}
          >
            {QUADRANTS.map((q) => <option key={q.key} value={q.key}>{q.title}（{q.hint}）</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label>所属清单</label>
          <select className="inp" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">收集箱</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>重复规则</label>
        <select className="inp" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
          {REPEAT_OPTIONS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
        </select>
      </div>

      <div className="field">
        <label>备注</label>
        <textarea
          className="inp" rows={3} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="补充说明、链接、地点…"
          style={{ resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
        />
      </div>
    </Dialog>
  );
}

/** 下一个指定的星期几（0=周日）。今天就是那天时取下週，避免点了没反应 */
function nextWeekday(wd: number): string {
  const t = new Date(todayKey());
  const diff = (wd - t.getDay() + 7) % 7 || 7;
  t.setDate(t.getDate() + diff);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/* ---------------- 编辑待办 ---------------- */

export function TodoEditDialog({ todo, lists, onClose }: { todo: Todo; lists: TodoList[]; onClose: () => void }) {
  const reloadTodos = useStore((s) => s.reloadTodos);
  const reloadTodoLists = useStore((s) => s.reloadTodoLists);
  const toast = useStore((s) => s.toast);

  const curDay = todayKey();
  const [title, setTitle] = useState(todo.title || '');
  const [note, setNote] = useState(todo.note || '');
  const [due, setDue] = useState(todo.due || '');
  const [dueTime, setDueTime] = useState(todo.dueTime || '');
  const [priority, setPriority] = useState(todo.priority || 0);
  const [listId, setListId] = useState(todo.listId || '');
  const [repeat, setRepeat] = useState(todo.repeat || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (!title.trim()) { toast('标题不能空'); return; }
    setBusy(true);
    try {
      // '' = 清空（null / undefined 才表示"别动这个字段"）
      await api.todos.update({
        id: todo.id,
        title: title.trim(),
        note: note.trim(),
        due,
        dueTime,
        priority,
        listId,
      });
      if ((todo.repeat || '') !== repeat) await api.todos.setRepeat(todo.id, repeat);
      await reloadTodos();
      await reloadTodoLists();
      toast('已保存');
      onClose();
    } catch (e) {
      toast('保存失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="编辑待办"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>保存</button>
      </>}
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label>标题</label>
        <input
          className="inp" autoFocus value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }}
          placeholder="要做什么"
        />
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 130 }}>
          <label>截止日期</label>
          <input className="inp" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 110 }}>
          <label>截止时间</label>
          <input className="inp" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <div className="field" style={{ flex: 1, minWidth: 150 }}>
          {/*
            第 141 条：用户要的是「直接选象限」，不是选一个叫「高 / 紧急」的抽象档位。
            选中之后优先级和到期日会一起写好；反过来改了日期，选中项会跟着变回对应的格子。
          */}
          <label>四象限</label>
          <select
            className="inp"
            value={quadrantOf({ ...todo, priority, due } as Todo, curDay)}
            onChange={(e) => {
              const q = e.target.value as QuadKey;
              const patch = quadPatch(q, curDay);
              setPriority(patch.priority);
              setDue(patch.due ?? '');
              if (patch.due == null) setDueTime('');
            }}
          >
            {QUADRANTS.map((q) => <option key={q.key} value={q.key}>{q.title}（{q.hint}）</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label>所属清单</label>
          <select className="inp" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">收集箱</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>重复规则</label>
        <select className="inp" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
          {REPEAT_OPTIONS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
        </select>
      </div>

      <div className="field">
        <label>备注</label>
        <textarea
          className="inp" rows={3} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="补充说明、链接、地点…"
          style={{ resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
        />
      </div>
    </Dialog>
  );
}

/* ---------------- 清单 ---------------- */

export const LIST_COLORS = ['#b8623a', '#5f8256', '#4a7396', '#8a6aa8', '#b8863a', '#4f8a86', '#a55a72', '#7a7469'];

export function TodoListDialog({
  list, lists, onClose,
}: {
  list: TodoList | null;
  lists: TodoList[];
  onClose: () => void;
}) {
  const reloadTodoLists = useStore((s) => s.reloadTodoLists);
  const reloadTodos = useStore((s) => s.reloadTodos);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(list?.name || '');
  const [color, setColor] = useState(list?.color || LIST_COLORS[0]);
  /* 第 218 条：清单要能写几句描述，不然只剩一个名字，什么也记不住 */
  const [note, setNote] = useState(list?.note || '');
  /* 第 220 条：清单也能有父清单，跟笔记本一个道理 */
  const [parentId, setParentId] = useState(list?.parentId || '');
  const [busy, setBusy] = useState(false);

  const sorted = lists.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const idx = list ? sorted.findIndex((l) => l.id === list.id) : -1;

  const save = async () => {
    if (busy) return;
    if (!name.trim()) { toast('名字不能空'); return; }
    setBusy(true);
    let savedId = list?.id || '';
    if (list) {
      await api.todos.updateList({ id: list.id, name: name.trim(), color });
      savedId = list.id;
    } else {
      const r = await api.todos.addList(name.trim(), color);
      savedId = (r as { id?: string })?.id || '';
    }
    if (savedId) {
      // 描述和父级是后加的字段，走单独的 RPC，老调用点不受影响
      if (note.trim() || list?.note) await api.todoListNote(savedId, note.trim());
      await api.todoListParent(savedId, parentId);
    }
    await reloadTodoLists();
    await reloadTodos();
    toast('已保存');
    onClose();
  };

  /*
   * 第 220 条：父清单候选要排除「自己」和「自己的所有子孙」，
   * 否则挂上去就成环了 —— 界面上看不出来，但读的时候会无限递归。
   * 后端 NotebookSetParent2 有同样的保护，这里是第一道。
   */
  const parentOptions = (() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const kids = new Map<string, TodoList[]>();
    for (const l of sorted) {
      const p = l.parentId || '';
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p)!.push(l);
    }
    const walk = (pid: string, depth: number, dead: Set<string>) => {
      for (const l of kids.get(pid) || []) {
        if (dead.has(l.id)) continue;
        out.push({ id: l.id, name: l.name, depth });
        walk(l.id, depth + 1, dead);
      }
    };
    // 算出要排除的子树：自己 + 所有子孙
    const dead = new Set<string>();
    if (list) {
      dead.add(list.id);
      let grew = true;
      while (grew) {
        grew = false;
        for (const l of sorted) {
          if (!dead.has(l.id) && l.parentId && dead.has(l.parentId)) { dead.add(l.id); grew = true; }
        }
      }
    }
    walk('', 0, dead);
    return out;
  })();

  /** 上下移：后端只有 sort 字段，先把 sort 归一化成 0/10/20…，再和邻居互换 */
  const swap = async (dir: -1 | 1) => {
    if (!list || idx < 0) return;
    if (idx + dir < 0 || idx + dir >= sorted.length) return;
    const ids = sorted.map((l) => l.id);
    const other = ids[idx + dir];
    ids[idx + dir] = ids[idx];
    ids[idx] = other;
    for (let i = 0; i < ids.length; i += 1) {
      await api.todos.updateList({ id: ids[i], sort: i * 10 });
    }
    await reloadTodoLists();
    toast(dir < 0 ? '已上移' : '已下移');
  };

  return (
    <Dialog
      title={list ? '编辑清单' : '新建清单'}
      onClose={onClose}
      footer={<>
        {list ? (
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(`删除清单「${list.name}」？里面的任务会退回收集箱，不会被删。`)) return;
              await api.todos.removeList(list.id);
              await reloadTodoLists();
              await reloadTodos();
              toast('清单已删除，任务已退回收集箱');
              onClose();
            }}
          >删除清单</button>
        ) : null}
        {list && idx >= 0 ? (
          <>
            <button className="btn" disabled={idx <= 0} onClick={() => void swap(-1)}>上移</button>
            <button className="btn" disabled={idx >= sorted.length - 1} onClick={() => void swap(1)}>下移</button>
          </>
        ) : null}
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>保存</button>
      </>}
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label>清单名称</label>
        <input
          className="inp" autoFocus value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          placeholder="比如：工作 / 家里 / 读书 / 副业"
        />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>描述（可空）</label>
        <textarea
          className="inp" rows={2} value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="这个清单是干什么的、有什么规矩。比如：只在上班时间做、超过两周没动就删"
          style={{ resize: 'vertical', lineHeight: 1.65 }}
        />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>放在哪个清单下面</label>
        <select className="inp" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">顶层</option>
          {parentOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {'　'.repeat(o.depth)}{o.depth ? '└ ' : ''}{o.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>颜色</label>
        <div className="row" style={{ gap: 7 }}>
          {LIST_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
                border: `2px solid ${color === c ? 'var(--ink)' : 'transparent'}`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="small muted" style={{ marginTop: 10, lineHeight: 1.7 }}>
        左侧清单可以直接按住拖动排序，这里也能上移 / 下移。
      </div>
    </Dialog>
  );
}

/* ---------------- 四象限（艾森豪威尔） ---------------- */

export type QuadKey = 'ui' | 'un' | 'in' | 'nn';

export const QUADRANTS: { key: QuadKey; title: string; hint: string; color: string }[] = [
  { key: 'ui', title: '紧急且重要', hint: '马上做', color: 'var(--bad)' },
  { key: 'un', title: '紧急不重要', hint: '尽快处理或转交', color: 'var(--warn)' },
  { key: 'in', title: '重要不紧急', hint: '安排时间做', color: 'var(--accent)' },
  { key: 'nn', title: '都不', hint: '有空再说', color: 'var(--ink3)' },
];

/** 重要 = priority >= 2（高 / 紧急）；紧急 = 没有日期算不紧急，今天或明天到期算紧急 */
export function isImportant(t: Todo): boolean {
  return (t.priority || 0) >= 2;
}

export function isUrgent(t: Todo, today: string): boolean {
  if (!t.due) return false;
  return t.due <= shiftDay(today, 1);
}

/**
 * 从象限反推「优先级 + 到期日」。
 *
 * 象限不是存的字段，是 priority × due 算出来的，所以选象限必须写成这两个字段，
 * 否则下次一算又跳回原来的格子。
 */
export function quadPatch(q: QuadKey, today: string): { priority: number; due: string | null } {
  switch (q) {
    case 'ui': return { priority: 2, due: today };              // 重要 + 今天
    case 'un': return { priority: 1, due: today };              // 不重要 + 今天
    case 'in': return { priority: 2, due: shiftDay(today, 7) }; // 重要 + 一周后
    default: return { priority: 0, due: null };                 // 都不占：清掉日期
  }
}

export function quadrantOf(t: Todo, today: string): QuadKey {
  const important = isImportant(t);
  const urgent = isUrgent(t, today);
  if (urgent && important) return 'ui';
  if (urgent) return 'un';
  if (important) return 'in';
  return 'nn';
}

/* ---------------- 一个小的说明块，四象限和列表都能用 ---------------- */

export function QuadHint() {
  return (
    <div className="small muted" style={{ lineHeight: 1.8, marginBottom: 10 }}>
      两个维度都是自动算的：<b>重要</b> = 优先级「高 / 紧急」，<b>紧急</b> = 今天或明天到期。
      <br />
      想换格子不用改优先级 —— 直接把待办<b>拖到</b>那个格子里就行，日期和优先级会跟着调好。
    </div>
  );
}
