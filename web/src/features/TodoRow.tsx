/**
 * 待办的单行渲染。
 *
 * 拆出来的理由：这一行 87 行 JSX 塞在 TodosView 的 render 路径里，
 * 而它的输入其实只有「这一条待办 + 它是不是第几条」这一点点上下文。
 * 拎成组件之后，主组件从「一眼看不完的巨型 return」退回到
 * 「左栏 / 头部 / 列表」三段结构。
 *
 * **className 一个字都不能改。** 原来写的是
 *   `todo-row ${t.done ? 'done' : ''} ${dp?.className || ''}`
 * 未完成时会拼出「todo-row  」（两个空格）—— 看着像手误，但：
 *   · 样式表按 class 匹配，多一个空格不影响
 *   · 却会影响按字符串做断言的探针和截图对比
 * 所以这里原样保留，不做「顺手清理」。重构的边界是行为不变，不是顺手美化。
 */
import { api } from '../api';
import { askConfirm } from '../components/ui';
import { Icon } from '../components/Icons';
import { Highlight } from '../features/notes';
import { priorityLabel } from '../features/todos';
import { repeatLabel } from '../lib/smartDate';
import type { DragItemProps } from '../components/DragSort';
import type { Todo, TodoList } from '../types';

export function TodoRow({
  t, dp, today, lists, kw, recycle, ctxMenu,
  toggle, edit, setTrashed, refresh, loadRecycle, toast,
}: {
  t: Todo;
  /** 拖动句柄属性。不参与排序时传 null（回收站 / 已放弃 / 非手动模式 / 四象限格子） */
  dp: DragItemProps | null;
  today: string;
  lists: TodoList[];
  /** 搜索关键词，用来高亮 */
  kw: string;
  /** 是不是「回收站」视图 —— 按钮换成恢复 / 彻底删 */
  recycle: boolean;
  ctxMenu: (e: React.MouseEvent) => void;
  toggle: (t: Todo) => Promise<void> | void;
  edit: (t: Todo) => void;
  setTrashed: (t: Todo, on: boolean) => Promise<void> | void;
  refresh: () => Promise<void> | void;
  loadRecycle: () => Promise<void> | void;
  toast: (m: string) => void;
}) {
  const overdue = !!t.due && t.due < today && !t.done && !t.trashed;
  const list = lists.find((l) => l.id === t.listId);

  const toRecycle = async () => {
    await api.todos.remove(t.id);
    await refresh();
    await loadRecycle();
    toast('已移到回收站');
  };

  return (
    <div
      className={`todo-row ${t.done ? 'done' : ''} ${dp?.className || ''}`}
      data-dragkey={dp?.['data-dragkey']}
      draggable={dp?.draggable}
      onDragStart={dp?.onDragStart}
      onDragOver={dp?.onDragOver}
      onDragLeave={dp?.onDragLeave}
      onDrop={dp?.onDrop}
      onDragEnd={dp?.onDragEnd}
      onContextMenu={ctxMenu}
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
        {recycle ? (
          <>
            <button
              className="btn sm ghost" title="恢复到原来的清单"
              onClick={async () => { await api.todos.restore(t.id); await loadRecycle(); await refresh(); toast('已恢复'); }}
            >恢复</button>
            <button
              className="btn sm ghost" title="彻底删除，无法找回"
              onClick={async () => {
                if (!(await askConfirm(`彻底删除「${t.title}」？`, { body: '删除后无法恢复。', ok: '彻底删除' }))) return;
                await api.todos.purge(t.id);
                await loadRecycle();
                toast('已彻底删除');
              }}
            ><Icon name="x" size={13} /></button>
          </>
        ) : (
          <>
            <button className="btn sm ghost" data-act="edit" title="编辑" onClick={() => edit(t)}>
              <Icon name="pen" size={13} />
            </button>
            {t.trashed ? (
              <>
                <button className="btn sm ghost" title="捡回来，重新做" onClick={() => void setTrashed(t, false)}>捡回来</button>
                <button
                  className="btn sm ghost" title="移到回收站（还能再恢复）"
                  onClick={() => void toRecycle()}
                ><Icon name="trash" size={13} /></button>
              </>
            ) : (
              <>
                <button className="btn sm ghost" data-act="giveup" title="放弃：过期了或不想做了，不算删除、不计完成率" onClick={() => void setTrashed(t, true)}>
                  <Icon name="archive" size={13} />
                </button>
                <button
                  className="btn sm ghost" title="删除（进回收站）"
                  onClick={() => void toRecycle()}
                ><Icon name="trash" size={13} /></button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}