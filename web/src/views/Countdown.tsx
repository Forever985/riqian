import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar, Dialog } from '../components/ui';
import { Icon } from '../components/Icons';
import { useDragSort } from '../components/DragSort';
import { parseSmartDate, repeatCode, repeatLabel } from '../lib/smartDate';
import { todayKey } from '../lib/date';
import { countdownToTodo } from '../features/bridge';
import type { Countdown, CountdownTrash } from '../types';

const REPEATS: [string, string][] = [
  ['', '一次性'],
  ['yearly', '每年'],
  ['monthly', '每月'],
  ['lunar-yearly', '每年（农历）'],
  ['lunar-monthly', '每月（农历）'],
];

const COLORS = ['#b8623a', '#4a7396', '#5f8256', '#8e6a9e', '#b8863a', '#4f8a86'];

export function CountdownView() {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<Countdown[]>([]);
  const [trash, setTrash] = useState<CountdownTrash[]>([]);
  const [raw, setRaw] = useState('');
  const [date, setDate] = useState('');
  const [repeat, setRepeat] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [manual, setManual] = useState(false);
  const [editing, setEditing] = useState<Countdown | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  /** 第 102 条：倒数日 → 待办。日子快到了总得动手，别让人两头抄 */
  const makeTodo = async (c: Countdown) => {
    const ok = await countdownToTodo(c).catch(() => false);
    toast(ok ? `已在待办里加一条「${c.title}」，到期 ${c.nextDate || c.date}` : '加进待办失败');
  };

  const reload = async () => {
    const [l, t] = await Promise.all([api.cd.list(), api.cd.trash()]);
    setList(l);
    setTrash(t);
  };
  useEffect(() => { void reload(); }, []);

  // 边打边识别，让人知道「它准备怎么记」
  const smart = useMemo(() => parseSmartDate(raw), [raw]);
  const useSmart = (!!smart.hint || !!smart.due) && !manual;

  const add = async () => {
    const title = (useSmart ? smart.title : raw).trim();
    if (!title) { toast('先写个名字'); return; }
    // 第 192 条：`monthly-weekday` 要把「第几个 + 周几」编码进 repeat，否则算不出日子
    const rep = useSmart ? repeatCode(smart) : repeat;
    const d = useSmart && smart.due ? smart.due : date;
    if (!d && !rep.startsWith('lunar')) { toast('还需要一个日期'); return; }
    // 农历用「月-日」占位存在 date 里，后端按农历解释
    const finalDate = rep.startsWith('lunar') && smart.lunarMonth
      ? `2000-${String(smart.lunarMonth).padStart(2, '0')}-${String(smart.lunarDay || 1).padStart(2, '0')}`
      : d;
    await api.cd.add({ title, date: finalDate, repeat: rep, color, note: '' });
    setRaw(''); setDate(''); setRepeat(''); setManual(false);
    await reload();
    toast('已添加');
  };

  const changeRepeat = async (c: Countdown, r: string) => {
    await api.cd.setRepeat(c.id, r);
    await reload();
    toast(`已改为${repeatLabel(r) || '一次性'}`);
  };

  /** 删掉先放回收站，手滑点错还能捡回来（第 145 条） */
  const toTrash = async (c: Countdown) => {
    await api.cd.remove(c.id);
    await reload();
    toast(`「${c.title}」已放到回收站`);
  };

  /*
   * 顺序以服务端 sort 为准，前端不再按「还剩多少天」重排 ——
   * 否则用户拖出来的顺序每次刷新都会被天数打乱。
   * 没拖过的老数据 sort 都是 0，服务端会自动退化成按日期排。
   */
  const upcoming = useMemo(() => list.filter((c) => c.days >= 0), [list]);
  const past = useMemo(() => list.filter((c) => c.days < 0).sort((a, b) => b.days - a.days), [list]);

  const { boxRef, props: dragProps } = useDragSort({
    keys: upcoming.map((c) => c.id),
    onReorder: async (from, to) => {
      const next = upcoming.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // 归一化成 0/10/20…，以后插队不用整体重写
      for (let i = 0; i < next.length; i += 1) {
        if ((next[i].sort || 0) !== i * 10) {
          await api.cd.update({ id: next[i].id, sort: i * 10 });
        }
      }
      await reload();
      toast('顺序已保存');
    },
  });

  return (
    <>
      <Topbar title="倒计时" sub={`${list.length} 个 · 今天 ${todayKey()}`} />
      <div className="wrap">
        <div className="card">
          <h3><Icon name="sparkle" size={14} />新建 <span className="muted">可以直接说「每年3月6日 妈妈生日」</span></h3>
          <div className="row" style={{ marginBottom: 8 }}>
            <input
              className="inp" style={{ flex: 1 }}
              placeholder="例如：每年3月6日 妈妈生日 / 每月1号 交房租 / 农历八月十五 中秋 / 2027-06-07 高考"
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setManual(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            />
            <button className="btn primary" onClick={() => void add()}>添加</button>
            <button className="btn" onClick={() => setManual(!manual)} data-tip="手动指定日期与重复方式">
              <Icon name={manual ? 'sparkle' : 'sliders'} size={13} />
              {manual ? '用智能识别' : '手动'}
            </button>
          </div>

          {useSmart ? (
            <div className="smartbar">
              <Icon name="sparkle" size={13} />
              识别为：<b>{smart.title || '（没有标题）'}</b>
              {smart.hint ? <span className="chip on">{smart.hint}</span> : null}
              {smart.due ? <span className="chip">下次 {smart.due}</span> : null}
              {smart.lunarMonth ? <span className="chip">农历 {smart.lunarMonth} 月 {smart.lunarDay} 日</span> : null}
            </div>
          ) : null}

          {manual ? (
            <div className="row" style={{ marginTop: 10 }}>
              <input className="inp" type="date" style={{ width: 170, flex: '0 0 auto' }} value={date} onChange={(e) => setDate(e.target.value)} />
              <select className="inp" style={{ width: 160, flex: '0 0 auto' }} value={repeat} onChange={(e) => setRepeat(e.target.value)}>
                {REPEATS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
              </select>
              <div className="row" style={{ gap: 5 }}>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`cdot ${color === c ? 'on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <span className="small muted">农历重复时，日期填「月-日」即可</span>
            </div>
          ) : null}
        </div>

        {upcoming.length ? (
          <>
            <div className="small muted" style={{ margin: '16px 4px 8px' }}>
              还有的这些 · 按住卡片可以拖动换位置
            </div>
            <div className="cd-grid" ref={boxRef}>
              {upcoming.map((c, i) => {
                const p = dragProps(i);
                return (
                  <div
                    key={c.id}
                    className={`cd ${p.className}`}
                    data-dragkey={p['data-dragkey']}
                    draggable={p.draggable}
                    onDragStart={p.onDragStart}
                    onDragOver={p.onDragOver}
                    onDragLeave={p.onDragLeave}
                    onDrop={p.onDrop}
                    onDragEnd={p.onDragEnd}
                  >
                    <CdCard
                      c={c}
                      onEdit={() => setEditing(c)}
                      onDelete={() => void toTrash(c)}
                      onRepeat={changeRepeat}
                      onMakeTodo={() => void makeTodo(c)}
                    />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="card"><div className="empty">还没有未来的倒数日。上面输入一句就行。</div></div>
        )}

        {past.length ? (
          <>
            <div className="small muted" style={{ margin: '18px 4px 8px' }}>已经过去的</div>
            <div className="cd-grid">
              {past.map((c) => (
                <div className="cd past" key={c.id}>
                  <CdCard c={c} past onEdit={() => setEditing(c)} onDelete={() => void toTrash(c)} onRepeat={changeRepeat} />
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* 回收站：删掉的先来这里，随时能捡回来 */}
        {trash.length ? (
          <div className="card" style={{ marginTop: 18 }}>
            <button className="cd-trash-h" onClick={() => setTrashOpen(!trashOpen)}>
              <Icon name="trash" size={13} />
              <span>回收站</span>
              <span className="small muted">{trash.length} 个</span>
              <span style={{ flex: 1 }} />
              <span className="small muted">{trashOpen ? '收起' : '展开'}</span>
            </button>
            {trashOpen ? (
              <>
                <div className="small muted" style={{ margin: '4px 0 10px', lineHeight: 1.7 }}>
                  这里放着删掉的倒数日。<b>恢复</b>会放回原处，<b>彻底删除</b>才是真的没了。
                </div>
                {trash.map((t) => (
                  <div className="cd-trash-row" key={t.id}>
                    <span className="cdot-s" style={{ background: t.color || 'var(--accent)' }} />
                    <span className="n">{t.title}</span>
                    <span className="small muted">{t.date}</span>
                    <button
                      className="btn sm"
                      onClick={async () => { await api.cd.restore(t.id); await reload(); toast('已恢复'); }}
                    >恢复</button>
                    <button
                      className="btn sm danger"
                      onClick={async () => { await api.cd.purge(t.id); await reload(); toast('已彻底删除'); }}
                    >彻底删除</button>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {editing ? (
        <CdEdit
          c={editing}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await reload(); toast('已保存'); }}
        />
      ) : null}
    </>
  );
}

/* ---------------- 卡片 ---------------- */

function CdCard({
  c, onEdit, onDelete, onRepeat, onMakeTodo, past,
}: {
  c: Countdown;
  onEdit: () => void;
  onDelete: () => void;
  onRepeat: (c: Countdown, r: string) => Promise<void>;
  onMakeTodo?: () => void;
  past?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="bar" style={{ background: c.color || 'var(--accent)' }} />
      <div className="cd-acts">
        <button className="x" data-act="edit" data-tip="编辑" onClick={onEdit}><Icon name="pen" size={12} /></button>
        <button className="x" data-act="del" data-tip="移到回收站" onClick={onDelete}>✕</button>
      </div>
      <div className="t">{c.title}</div>
      <div className="d">
        {c.days >= 0 ? c.days : `-${Math.abs(c.days)}`}
        <small>{c.days >= 0 ? '天后' : '天前'}</small>
      </div>
      <div className="s">
        {c.nextDate}
        {c.repeat ? ` · ${repeatLabel(c.repeat)}` : ''}
        {c.repeat.startsWith('lunar') ? ' · 农历' : ''}
      </div>
      {c.note ? <div className="cd-note">{c.note}</div> : null}
      <div className="cd-tools">
        <button className="cd-edit" onClick={() => setOpen(!open)}>
          <Icon name="sliders" size={12} />重复
        </button>
        {/* 第 102 条：日子到了还得动手，直接把这条转成待办 */}
        {onMakeTodo && !past ? (
          <button className="cd-edit" title={`在待办里加一条，到期 ${c.nextDate}`} onClick={onMakeTodo}>
            <Icon name="todo" size={12} />加进待办
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="cd-menu">
          {REPEATS.map(([v, n]) => (
            <button
              key={v}
              className={c.repeat === v ? 'on' : ''}
              onClick={async () => { setOpen(false); await onRepeat(c, v); }}
            >{n}</button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* ---------------- 编辑弹层 ---------------- */

function CdEdit({ c, onClose, onDone }: { c: Countdown; onClose: () => void; onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [title, setTitle] = useState(c.title);
  const [date, setDate] = useState(c.date);
  const [repeat, setRepeat] = useState(c.repeat || '');
  const [color, setColor] = useState(c.color || COLORS[0]);
  const [note, setNote] = useState(c.note || '');

  const save = async () => {
    const t = title.trim();
    if (!t) { toast('名字不能空着'); return; }
    await api.cd.update({ id: c.id, title: t, date, repeat, color, note });
    onDone();
  };

  return (
    <Dialog
      title="编辑倒数日"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={() => void save()}>保存</button>
        </>
      }
    >
      <div className="field">
        <label>名字</label>
        <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <div className="row" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>日期</label>
          <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>重复</label>
          <select className="inp" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            {REPEATS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </div>
      </div>
      {repeat.startsWith('lunar') ? (
        <div className="small muted" style={{ marginBottom: 8 }}>
          农历的日期按「月-日」解释，上面的年份会被忽略。
        </div>
      ) : null}
      <div className="field">
        <label>颜色</label>
        <div className="row" style={{ gap: 6 }}>
          {COLORS.map((x) => (
            <button
              key={x}
              className={`cdot ${color === x ? 'on' : ''}`}
              style={{ background: x }}
              onClick={() => setColor(x)}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <label>备注（可不填）</label>
        <textarea
          className="inp" rows={2} value={note}
          placeholder="比如：礼物提前一周买"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
