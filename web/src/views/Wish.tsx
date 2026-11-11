/**
 * #250：愿望单。
 *
 * 用户原话：「愿望单功能」。
 *
 * 和「待办」的界线在这里划死，否则它就长成第二个待办清单：
 *   · 待办是**该做的事** —— 有截止日、有优先级、没做完会焦虑、会在导航上挂角标。
 *   · 愿望是**想要的东西** —— 可以一直放着，不是欠债，不催、不标红、不挂数字。
 *
 * 所以这页刻意不做：逾期提醒、进度条催办、导航角标。
 * 只做三件事：记下来、攒够了打勾、算算还差多少。
 *
 * 金额全部以「分」在数据层流转（见 DbWishes.cs 的注释），
 * 界面上只在显示时才换成元 —— 一旦中间某一步用了浮点，
 * 用户自己加一遍就会发现差几分钱，然后这个功能就废了。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Topbar, Dialog, askConfirm } from '../components/ui';
import { Icon } from '../components/Icons';
import { useStore } from '../store';
import { api } from '../api';
import type { Wish, WishStats } from '../types';

/** 分 → "¥1,234.50"。整数元不显示小数，读起来干净 */
function yuan(cents: number): string {
  const v = Math.round(Number(cents) || 0) / 100;
  const s = Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return '¥' + s;
}

/** 输入框里的字符串 → 分。空串按 0 算，非法输入返回 -1 让调用方拦下来 */
function toCents(text: string): number {
  const t = (text || '').trim().replace(/[,，¥\s]/g, '');
  if (!t) return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return -1;
  return Math.round(parseFloat(t) * 100);
}

const PRIORITY: { v: number; n: string; d: string }[] = [
  { v: 1, n: '想要', d: '有了会开心，没有也行' },
  { v: 2, n: '很想要', d: '一直在惦记' },
  { v: 3, n: '最想要', d: '攒钱就为了它' },
];

export function WishView() {
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<Wish[]>([]);
  const [stats, setStats] = useState<WishStats | null>(null);
  const [loading, setLoading] = useState(true);
  /** null = 不显示编辑框；'' = 新建；其它 = 编辑这一条 */
  const [editing, setEditing] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([
        api.wish.list(),
        api.wish.stats().catch(() => null),
      ]);
      setItems(list || []);
      setStats(st);
    } catch (e) {
      toast((e as Error).message || '读不到愿望单');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const open = useMemo(() => items.filter((x) => x.done !== 1), [items]);
  const done = useMemo(() => items.filter((x) => x.done === 1), [items]);
  const shown = showDone ? done : open;

  const toggle = async (w: Wish) => {
    const nv = w.done === 1 ? 0 : 1;
    /* 先改界面再落库：打勾是这页最高频的动作，等一次往返会明显卡手 */
    setItems((prev) => prev.map((x) => (x.id === w.id ? { ...x, done: nv } : x)));
    const r = await api.wish.done(w.id, nv).catch(() => ({ ok: false }));
    if (!r.ok) {
      setItems((prev) => prev.map((x) => (x.id === w.id ? { ...x, done: w.done } : x)));
      toast('没能保存，再试一次');
      return;
    }
    toast(nv ? `实现了：${w.title}` : '已放回愿望单');
    void load();   // 汇总要跟着变
  };

  const remove = async (w: Wish) => {
    if (!(await askConfirm(`删掉「${w.title}」？`, {
      body: '只是从清单里移走，记录本身没有删掉。',
      ok: '删掉',
    }))) return;
    await api.wish.remove(w.id).catch(() => null);
    await load();
    toast('已移出愿望单');
  };

  return (
    <>
      <Topbar
        title="愿望单"
        sub={stats ? `还想要 ${stats.open} 件 · 已实现 ${stats.done} 件` : '想要的东西，攒够了就打勾'}
        right={
          <button className="btn sm primary" onClick={() => setEditing('')}>
            <Icon name="plus" size={13} />许个愿
          </button>
        }
      />
      <div className="wrap">
        {/* 汇总：只报数，不做进度条 —— 进度条会把「愿望」变成「KPI」 */}
        {stats ? (
          <div className="card">
            <div className="wish-sum">
              <div>
                <div className="small muted">还想要</div>
                <div className="wish-num">{stats.open}<small> 件</small></div>
                {stats.openCents > 0 ? <div className="small muted">合计 {yuan(stats.openCents)}</div> : null}
              </div>
              <div>
                <div className="small muted">已实现</div>
                <div className="wish-num">{stats.done}<small> 件</small></div>
                {stats.doneCents > 0 ? <div className="small muted">共花 {yuan(stats.doneCents)}</div> : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="row" style={{ margin: '14px 0 10px' }}>
          <div className="seg">
            <button
              className={`seg-b ${!showDone ? 'on' : ''}`}
              onClick={() => setShowDone(false)}
            >还想要 <small>{open.length}</small></button>
            <button
              className={`seg-b ${showDone ? 'on' : ''}`}
              onClick={() => setShowDone(true)}
            >已实现 <small>{done.length}</small></button>
          </div>
          <span className="sp" />
        </div>

        {loading ? <div className="empty small">读取中…</div>
          : !shown.length ? (
            <div className="empty">
              {showDone
                ? '还没有实现过的愿望。实现一个之后会记在这里。'
                : '还没有许过愿。想买的东西、想去的地方，都可以先记下来 —— 它不会催你。'}
            </div>
          ) : (
            <div className="card">
              {shown.map((w) => (
                <div className={`wish-row ${w.done === 1 ? 'done' : ''}`} key={w.id}>
                  <button
                    className="wish-check"
                    title={w.done === 1 ? '改回还没实现' : '标记为已实现'}
                    onClick={() => void toggle(w)}
                  >
                    {w.done === 1 ? '✓' : ''}
                  </button>
                  <div className="wish-main">
                    <div className="wish-title" onClick={() => setEditing(w.id)}>{w.title}</div>
                    <div className="wish-meta">
                      {w.priceCents > 0 ? <span className="wish-price">{yuan(w.priceCents)}</span> : null}
                      {w.priority > 1 ? (
                        <span className="wish-pri" data-p={w.priority}>
                          {PRIORITY.find((p) => p.v === w.priority)?.n}
                        </span>
                      ) : null}
                      {w.targetDate ? <span>想在 {w.targetDate} 前</span> : null}
                      {w.done === 1 && w.doneAt ? <span>实现于 {w.doneAt.slice(0, 10)}</span> : null}
                      {w.url ? (
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); void api.shell.openUrl(w.url); }}
                        >链接</a>
                      ) : null}
                    </div>
                    {w.note ? <div className="wish-note">{w.note}</div> : null}
                  </div>
                  <button className="btn sm ghost" onClick={() => setEditing(w.id)}>改</button>
                  <button
                    className="btn sm ghost danger"
                    onClick={() => void remove(w)}
                    title="移出愿望单"
                  >×</button>
                </div>
              ))}
            </div>
          )}
      </div>

      {editing !== null ? (
        <WishDialog
          id={editing}
          item={items.find((x) => x.id === editing)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      ) : null}
    </>
  );
}

/* ---------------- 新建 / 编辑 ---------------- */

function WishDialog({
  id, item, onClose, onSaved,
}: {
  id: string;
  item?: Wish;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const [title, setTitle] = useState(item?.title || '');
  /* 用字符串存输入框里的元，不用 number —— 输入 "12." 的过程中
     number 会把它变成 12，光标和末尾的点都会消失，用户没法接着打小数 */
  const [price, setPrice] = useState(
    item && item.priceCents > 0 ? (item.priceCents / 100).toString() : '',
  );
  const [note, setNote] = useState(item?.note || '');
  const [url, setUrl] = useState(item?.url || '');
  const [priority, setPriority] = useState(item?.priority || 1);
  const [targetDate, setTargetDate] = useState(item?.targetDate || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const cents = toCents(price);
    if (cents < 0) { setErr('金额写成数字，最多两位小数（比如 199 或 199.90）'); return; }
    if (!title.trim()) { setErr('想许个什么愿？先写一句'); return; }
    setBusy(true);
    setErr('');
    const r = await api.wish.save({
      id: id || undefined,
      title: title.trim(),
      priceCents: cents,
      note: note.trim(),
      url: url.trim(),
      priority,
      targetDate,
    }).catch((e) => ({ ok: false, err: (e as Error).message }));
    setBusy(false);
    if (!r.ok) { setErr(r.err || '保存失败'); return; }
    toast(id ? '已保存' : '已记下');
    onSaved();
  };

  return (
    <Dialog
      title={id ? '改一改这个愿望' : '许个愿'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div style={{ marginBottom: 10 }}>
        <div className="small muted" style={{ marginBottom: 4 }}>想要什么</div>
        <input
          className="inp" style={{ width: '100%' }} autoFocus
          value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="比如：一台能画画的平板"
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
        />
      </div>

      <div className="row" style={{ marginBottom: 10, gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>大概多少钱（可留空）</div>
          <input
            className="inp" style={{ width: '100%' }} inputMode="decimal"
            value={price} onChange={(e) => setPrice(e.target.value)}
            placeholder="199"
          />
        </div>
        <div style={{ flex: 1 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>想在什么时候之前（可留空）</div>
          <input
            className="inp" type="date" style={{ width: '100%' }}
            value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div className="small muted" style={{ marginBottom: 4 }}>有多想要</div>
        <div className="seg">
          {PRIORITY.map((p) => (
            <button
              key={p.v}
              className={`seg-b ${priority === p.v ? 'on' : ''}`}
              title={p.d}
              onClick={() => setPriority(p.v)}
            >{p.n}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div className="small muted" style={{ marginBottom: 4 }}>链接（可留空）</div>
        <input
          className="inp" style={{ width: '100%' }}
          value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="商品页、参考图都行"
        />
      </div>

      <div>
        <div className="small muted" style={{ marginBottom: 4 }}>备注（可留空）</div>
        <textarea
          className="inp" style={{ width: '100%', minHeight: 70 }}
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="为什么想要它、看到哪家便宜、送自己什么理由"
        />
      </div>

      {err ? <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{err}</div> : null}
    </Dialog>
  );
}
