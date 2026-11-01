import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar, Dialog } from '../components/ui';
import { Icon } from '../components/Icons';
import { parseKey, todayKey } from '../lib/date';

/**
 * 第 188 条：大事时间轴。
 *
 * 和「记录」页不是一回事 —— 记录是把每天写的日记摊开看，这里只留用户**特意挑出来**的节点：
 * 换工作、搬家、毕业、第一次见面。数量少、跨度长，所以按年月分组、竖着读。
 */
interface Milestone {
  id: string;
  date: string;
  title: string;
  note: string;
  kind: string;
}

/**
 * 第 198 条：标签原来是写死在这张表里的（普通 / 生活 / 工作 / 学习 / 感情）。
 * 用户要能自己加、自己删 —— 有人想分「家人 / 朋友 / 健康」，有人只留一个「重要」。
 * 所以改成 settings.tlLabels 存，格式 `值:名字` 用 `|` 分隔，颜色按顺序从调色板里取。
 *
 * 为什么不用 JSON：这些值要在很多地方（下拉、图例、卡片色点）读，
 * 一个扁平字符串比嵌套对象好解析，出错也只是少一条标签，不会让整页崩掉。
 */
const PALETTE = ['var(--accent)', 'var(--ok)', 'var(--blue)', 'var(--warn)', 'var(--bad)', '#8a6aa8', '#4f8a86', '#a55a72'];

const DEFAULT_LABELS = '普通|生活|工作|学习|感情';

type Label = { v: string; n: string; c: string };

function parseLabels(raw: string): Label[] {
  const list = (raw || DEFAULT_LABELS).split('|').map((s) => s.trim()).filter(Boolean);
  /* 第一个永远是「普通」，它是兜底值，不允许被删 —— 否则无标签的节点没有颜色 */
  const out: Label[] = [];
  list.forEach((s, i) => {
    /* 兼容 `值:名字` 和纯名字两种写法；纯名字时值和名字相同 */
    const [v, n] = s.includes(':') ? (s.split(':').slice(0, 2) as [string, string]) : [s, s];
    if (!out.some((x) => x.v === v)) out.push({ v, n: n || v, c: PALETTE[i % PALETTE.length] });
  });
  if (!out.length) return parseLabels(DEFAULT_LABELS);
  return out;
}

const joinLabels = (ls: { v: string; n: string }[]) =>
  ls.map((l) => (l.v === l.n ? l.v : `${l.v}:${l.n}`)).join('|');

/** 第 199 条：按「年 → 月」两层分组，年、月都倒序，月内按日倒序 */
type MonthGroup = { key: string; label: string; list: Milestone[] };
type YearGroup = { year: string; count: number; months: MonthGroup[] };

function groupByYM(items: Milestone[]): YearGroup[] {
  const ys = new Map<string, Map<string, Milestone[]>>();
  for (const m of items) {
    const y = (m.date || '').slice(0, 4) || '未知';
    const mo = (m.date || '').slice(5, 7) || '00';
    if (!ys.has(y)) ys.set(y, new Map());
    const mm = ys.get(y)!;
    if (!mm.has(mo)) mm.set(mo, []);
    mm.get(mo)!.push(m);
  }
  return [...ys.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([year, mm]) => {
      const months: MonthGroup[] = [...mm.entries()]
        /* 月也要按数字倒序，「未知」的 '00' 自然落到最后 */
        .sort((a, b) => (Number(a[0]) - Number(b[0])) * -1)
        .map(([mo, list]) => ({
          key: `${year}-${mo}`,
          label: mo === '00' ? '未写日期' : `${Number(mo)} 月`,
          /* 第 199 条的核心：原来组内保持后端返回顺序，用户改了个更早的日期它还是排在后面。
             这里强制按日期倒序，同一天再按创建顺序（id）稳定一下。 */
          list: list.slice().sort((a, b) => {
            if (a.date === b.date) return (a.id < b.id ? 1 : -1);
            return a.date < b.date ? 1 : -1;
          }),
        }));
      return { year, count: months.reduce((n, x) => n + x.list.length, 0), months };
    });
}

export function MilestonesView() {
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [open, setOpen] = useState(false);
  /** 第 198 条：横向模式 */
  const [dir, setDir] = useState<'v' | 'h'>(() => (String((useStore.getState().settings || {}).tlDir || 'v') === 'h' ? 'h' : 'v'));
  const [labelsOpen, setLabelsOpen] = useState(false);

  const labels = useMemo(() => parseLabels(String(settings.tlLabels || DEFAULT_LABELS)), [settings.tlLabels]);
  const kindOf = (v: string) => labels.find((k) => k.v === v) || labels[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.milestone.list();
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupByYM(items), [items]);

  const startNew = () => { setEditing(null); setOpen(true); };
  const startEdit = (m: Milestone) => { setEditing(m); setOpen(true); };

  const switchDir = async (v: 'v' | 'h') => {
    setDir(v);
    await setSetting('tlDir', v);
  };

  return (
    <>
      <Topbar
        title="时间轴"
        sub={items.length ? `${items.length} 个节点 · ${groups.length} 年 · ${groups.reduce((n, g) => n + g.months.length, 0)} 个月` : '还没记过大事'}
        right={<>
          {/* 第 198 条：横向 / 纵向。和「流」用同一套图标，看着是一家的 */}
          <div className="seg seg-icon" title="横向或纵向铺开">
            <button className={`seg-b ${dir === 'v' ? 'on' : ''}`} data-tldir="v" title="纵向：往下读" onClick={() => void switchDir('v')}>
              <Icon name="down" size={13} />
            </button>
            <button className={`seg-b ${dir === 'h' ? 'on' : ''}`} data-tldir="h" title="横向：左右滑动" onClick={() => void switchDir('h')}>
              <Icon name="right" size={13} />
            </button>
          </div>
          <button className="btn sm" title="加标签、删标签、改名" onClick={() => setLabelsOpen(true)}>
            <Icon name="tag" size={13} />标签
          </button>
          <button className="btn primary" onClick={startNew}><Icon name="plus" size={14} />记一件大事</button>
        </>}
      />
      <div className="wrap">
        {loading ? null : items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <Icon name="hourglass" size={26} />
              <div style={{ margin: '10px 0 4px' }}>这里放那些「以后想起来会记得」的事</div>
              <div className="small muted" style={{ lineHeight: 1.8 }}>
                换工作、搬家、毕业、第一次见面、某个决定性的下午。<br />
                不用写长，一行就够 —— 它和日记的区别是：日记按天记，这里按年看。
              </div>
              <button className="btn primary" style={{ marginTop: 12 }} onClick={startNew}>记第一件</button>
            </div>
          </div>
        ) : (
          <div className={`msline ${dir === 'h' ? 'h' : ''}`} data-msdir={dir}>
            {groups.map((g) => (
              <div className="msyear" key={g.year}>
                <div className="msyear-h">
                  <span className="msyear-y">{g.year}</span>
                  <span className="small muted">{g.count} 件</span>
                </div>
                <div className="msyear-b">
                  {g.months.map((mo) => (
                    /* 第 199 条：月份分阶段 —— 同一年里换了月，视觉上要断一下，
                       否则一年 30 条看下来完全不知道哪条在哪个月 */
                    <div className="msmonth" key={mo.key} data-month={mo.key}>
                      <div className="msmonth-h">
                        <span className="msmonth-m">{mo.label}</span>
                        <span className="msmonth-n">{mo.list.length}</span>
                      </div>
                      {mo.list.map((m) => {
                        const k = kindOf(m.kind);
                        const d = parseKey(m.date);
                        return (
                          <div className="msnode" key={m.id}>
                            <span className="msdot" style={{ background: k.c }} />
                            <div className="mscard" onClick={() => startEdit(m)} title="点一下改">
                              <div className="mscard-top">
                                <span className="msdate">{d.getMonth() + 1} 月 {d.getDate()} 日</span>
                                {m.kind ? <span className="mskind" style={{ color: k.c, borderColor: k.c }}>{k.n}</span> : null}
                                <span style={{ flex: 1 }} />
                                <button
                                  className="msdel"
                                  title="删掉这条"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!confirm(`删掉「${m.title}」？`)) return;
                                    void (async () => {
                                      await api.milestone.delete(m.id);
                                      await load();
                                      toast('已删掉');
                                    })();
                                  }}
                                >✕</button>
                              </div>
                              <div className="mscard-t">{m.title}</div>
                              {m.note ? <div className="mscard-n">{m.note}</div> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open ? (
        <MilestoneDialog
          init={editing}
          labels={labels}
          onClose={() => setOpen(false)}
          onSaved={async () => { setOpen(false); await load(); }}
        />
      ) : null}

      {labelsOpen ? (
        <LabelsDialog
          labels={labels}
          onClose={() => setLabelsOpen(false)}
          onSave={async (next) => {
            await setSetting('tlLabels', joinLabels(next));
            setLabelsOpen(false);
            toast('标签已更新');
          }}
        />
      ) : null}
    </>
  );
}

/* ---------------- 标签管理（第 198 条） ---------------- */

function LabelsDialog({
  labels, onClose, onSave,
}: {
  labels: Label[];
  onClose: () => void;
  onSave: (next: { v: string; n: string }[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<{ v: string; n: string }[]>(labels.map((l) => ({ v: l.v, n: l.n })));
  const [draft, setDraft] = useState('');

  const add = () => {
    const n = draft.trim();
    if (!n) return;
    if (rows.some((r) => r.n === n)) return;
    /* 值和名字一致就够了：用户想的是「一个标签」，不是「键值对」 */
    setRows((p) => [...p, { v: n, n }]);
    setDraft('');
  };

  return (
    <Dialog
      title="时间轴标签"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => void onSave(rows)}>保存</button>
      </>}
    >
      <div className="small muted" style={{ lineHeight: 1.8, marginBottom: 12 }}>
        这些标签会出现在记事时的选择里。颜色按顺序自动分配，第一项是「普通」，用来兜底，不能删。
        <br />
        删掉一个标签不会删掉已经用了它的节点，那些节点会退回「普通」。
      </div>
      <div className="lbl-list">
        {rows.map((r, i) => (
          <div className="lbl-row" key={`${r.v}-${i}`} data-label={r.v}>
            <span className="lbl-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <input
              className="inp"
              value={r.n}
              onChange={(e) => {
                const nv = e.target.value;
                setRows((p) => p.map((x, j) => (j === i ? { ...x, n: nv, v: x.v === x.n || !x.v ? nv : x.v } : x)));
              }}
              placeholder="标签名"
            />
            <button
              className="btn sm ghost"
              disabled={i === 0}
              title={i === 0 ? '第一项是兜底标签，不能删' : '删掉这个标签'}
              onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
            ><Icon name="trash" size={13} /></button>
          </div>
        ))}
        {rows.length === 0 ? <div className="empty small">至少要留一个标签。</div> : null}
      </div>
      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <input
          className="inp" style={{ flex: 1 }} value={draft}
          placeholder="新标签，比如：家人 / 健康 / 旅行"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button className="btn" onClick={add}><Icon name="plus" size={13} />加</button>
      </div>
    </Dialog>
  );
}

/* ---------------- 记事 ---------------- */

function MilestoneDialog({
  init, labels, onClose, onSaved,
}: {
  init: Milestone | null;
  labels: Label[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useStore((s) => s.toast);
  const [date, setDate] = useState(init?.date || todayKey());
  const [title, setTitle] = useState(init?.title || '');
  const [note, setNote] = useState(init?.note || '');
  const [kind, setKind] = useState(init?.kind || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (!title.trim()) { toast('写一句这是什么'); return; }
    setBusy(true);
    try {
      await api.milestone.save({ id: init?.id || '', date, title: title.trim(), note: note.trim(), kind });
      toast(init ? '已保存' : '记下了');
      await onSaved();
    } catch (e) {
      toast('保存失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={init ? '改这条' : '记一件大事'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{init ? '保存' : '记下'}</button>
      </>}
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label>什么时候</label>
        <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>什么事</label>
        <input
          className="inp"
          autoFocus
          value={title}
          placeholder="比如：搬到了杭州"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
        />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>属于哪类</label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {labels.map((k) => (
            <button
              key={k.v || 'plain'}
              className={`chip ${kind === k.v ? 'on' : ''}`}
              onClick={() => setKind(k.v)}
            >
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: k.c, marginRight: 6 }} />
              {k.n}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>想补两句就补（可以不写）</label>
        <textarea
          className="inp"
          rows={4}
          value={note}
          placeholder="当时是什么感觉？"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Dialog>
  );
}