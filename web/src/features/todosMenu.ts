/**
 * 待办行的右键菜单（第 235 条）—— 纯数据，不碰 JSX，也不持有任何状态。
 *
 * 为什么单独拎出来：
 *   它原来长在 TodosView 里，八十多行全是「点一下 → 调接口 → 刷新 → 提示」。
 *   这类代码的特点是**依赖很多但都是别人给的**（谁被点、当前哪个视图、清单有哪些、
 *   刷新用什么），自己一行状态都不存。放在组件里，它把主组件的可读区间切碎了；
 *   拎出来之后主组件只剩「状态 + 布局」两件事。
 *
 * 顺带修掉一个阅读陷阱：原来它引用 `order`（清单按 sort 排好的数组），
 * 而 `order` 定义在文件下方几百行。因为是闭包、调用时早已初始化，**运行时不报错**，
 * 但读到 `for (const l of order)` 的人得往下翻半天才知道那是什么。
 * 现在 `lists` 由调用方按顺序传进来，一眼就看得懂。
 */
import { api } from '../api';
import type { MenuItem } from '../components/ContextMenu';
import { shiftDay } from '../lib/date';
import { startPomoFor, todoToCountdown } from '../features/bridge';
import { PRIORITY_OPTIONS } from './todos';
import type { Todo, TodoList } from '../types';

/** 菜单要用到的一切外部能力。全部由调用方注入 —— 这里不 import store。 */
export interface TodoMenuCtx {
  /** 当前视图类型。回收站里的东西只能恢复或彻底删，别的项无意义 */
  kind: string;
  /** 今天（YYYY-MM-DD），算「明天到期」用 */
  today: string;
  /** 清单，**已按 sort 排好序**。菜单直接按这个顺序平铺 */
  lists: TodoList[];
  toggle: (t: Todo) => Promise<void> | void;
  edit: (t: Todo) => void;
  refresh: () => Promise<void> | void;
  loadRecycle: () => Promise<void> | void;
  setTrashed: (t: Todo, on: boolean) => Promise<void> | void;
  toast: (m: string) => void;
  copy: (text: string, what: string) => Promise<void> | void;
}

export function buildTodoMenu(t: Todo, ctx: TodoMenuCtx): MenuItem[] {
  const { kind, today, lists, toggle, edit, refresh, loadRecycle, setTrashed, toast, copy } = ctx;

  /* 回收站里的东西只能恢复或彻底删，别的都无意义 */
  if (kind === 'recycle') {
    return [
      {
        label: '捡回来', hint: '回到原来的清单', onClick: async () => {
          await api.todos.restore(t.id); await loadRecycle(); await refresh(); toast('已恢复');
        },
      },
      { sep: true },
      {
        label: '彻底删除', hint: '找不回来', danger: true,
        confirm: `彻底删除「${t.title}」？删除后无法恢复。`,
        onClick: async () => {
          await api.todos.purge(t.id); await loadRecycle(); toast('已彻底删除');
        },
      },
    ];
  }

  const items: MenuItem[] = [
    { label: t.done ? '标成未完成' : '标成完成', hint: t.done ? '' : '打勾', onClick: () => toggle(t) },
    { label: '编辑…', hint: '改标题 / 日期 / 备注', onClick: () => edit(t) },
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
    {
      label: '明天到期', disabled: t.due === shiftDay(today, 1),
      onClick: async () => { await api.todos.update({ id: t.id, due: shiftDay(today, 1) }); await refresh(); toast('改成明天了'); },
    },
    {
      label: '明天一早', disabled: t.due === shiftDay(today, 1) && t.dueTime === '09:00',
      onClick: async () => { await api.todos.update({ id: t.id, due: shiftDay(today, 1), dueTime: '09:00' }); await refresh(); toast('改成明天 09:00'); },
    },
    {
      label: '清掉日期', hint: '回到「无期限」', disabled: !t.due && !t.dueTime,
      onClick: async () => { await api.todos.update({ id: t.id, due: '', dueTime: '' }); await refresh(); toast('日期清掉了'); },
    },
    { sep: true },
    /* 第 102 条：三个板块之间别让用户再手打一遍字 */
    { label: '开一颗番茄', hint: '任务名直接带过去', onClick: () => startPomoFor(t.title) },
    {
      label: '建成倒数日', hint: t.due ? `用它现在的期限 ${t.due}` : '没设日期，按今天算',
      onClick: async () => {
        const d = await todoToCountdown(t);
        if (d) toast(`已建倒数日「${t.title}」，${d}`);
        else toast('建失败，稍后再试');
      },
    },
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
      items.push({
        label: '　收集箱', hint: '移出清单',
        onClick: async () => { await api.todos.moveList(t.id, ''); await refresh(); toast('已移出清单'); },
      });
    }
    for (const l of lists) {
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
    items.push({
      label: '移到回收站', hint: '还能再恢复', danger: true,
      onClick: async () => { await api.todos.remove(t.id); await refresh(); await loadRecycle(); toast('已移到回收站'); },
    });
  } else {
    items.push({ label: '放弃', hint: '不做了，不计完成率', onClick: () => setTrashed(t, true) });
    items.push({
      label: '删除', hint: '先进回收站', danger: true,
      onClick: async () => { await api.todos.remove(t.id); await refresh(); await loadRecycle(); toast('已移到回收站'); },
    });
  }

  return items;
}