/**
 * 第 102 条：从待办里挑一条，当番茄钟的任务名。
 *
 * 为什么不是下拉框：待办标题普遍很长（「把上季度报销单整理好发给财务」），
 * 原生 select 里会被截成一条横线，看不出差别。这里用一个点开的小弹层，
 * 带到期日和优先级，挑的时候能直接判断该先做哪个。
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from './Icons';
import { todayKey } from '../lib/date';
import { pickableTodos } from '../features/bridge';
import type { Todo } from '../types';

export function TodoPicker({ onPick, current }: { onPick: (title: string) => void; current: string }) {
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<Todo[] | null>(null);
  const [q, setQ] = useState('');

  /* 只在打开时拉一次：这本来就不是常驻数据，没必要进 store 占着 */
  useEffect(() => {
    if (!open || all) return;
    let alive = true;
    void api.todos.list('due')
      .then((x) => { if (alive) setAll(x); })
      .catch((e) => {
        if (alive) { setAll([]); toast((e as Error).message || '读不到待办'); }
      });
    return () => { alive = false; };
  }, [open, all, toast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const today = todayKey();
  const list = useMemo(() => {
    const base = pickableTodos(all || []);
    const k = q.trim();
    return k ? base.filter((t) => t.title.includes(k)) : base;
  }, [all, q]);

  return (
    <>
      <button
        className="btn sm ghost"
        title="不用手打：从待办里挑一条"
        onClick={() => setOpen(true)}
      >
        <Icon name="todo" size={13} />从待办里挑
      </button>

      {open ? (
        <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dlg" style={{ width: 'min(480px,92vw)' }} onClick={(e) => e.stopPropagation()}>
            <div className="h">
              <h3>挑一条待办</h3>
              <button className="x" title="关闭" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="b">
              <input
                className="inp"
                autoFocus
                placeholder="搜标题…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {!all ? <div className="empty small">读取中…</div> : null}
              {all && !list.length ? (
                <div className="empty small">
                  {q ? `没有标题含「${q}」的待办` : '没有可挑的待办（都做完了？去「待办」页加一条）'}
                </div>
              ) : null}
              <div style={{ marginTop: 8, maxHeight: 320, overflow: 'auto' }}>
                {list.map((t) => {
                  const isCur = t.title === current;
                  const overdue = !!t.due && t.due < today;
                  return (
                    <button
                      key={t.id}
                      className="tp-item"
                      disabled={isCur}
                      onClick={() => { onPick(t.title); setOpen(false); }}
                    >
                      <span className="tp-t">{t.title}</span>
                      <span className="tp-m">
                        {isCur ? <span className="chip on">当前</span> : null}
                        {t.priority >= 2 ? <span className="chip">重要</span> : null}
                        {t.due ? (
                          <span className="chip" style={{ color: overdue ? 'var(--bad)' : undefined }}>
                            {t.due === today ? '今天' : t.due}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}