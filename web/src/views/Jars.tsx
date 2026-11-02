/**
 * 储蓄罐 / 存钱目标（第 97 条）。
 *
 * 用户原话：「记账本、储蓄罐功能。进行联网查询，查询热门的记账本、储蓄罐功能。可以设置。」
 *
 * 查了一圈市面上的做法（一羽记账、Pennyjar 存钱目标、52 周存钱挑战），
 * 存钱模式收敛成三种，后端 DbV13.cs 那边定的：free / fixed / step。
 * 这里负责把三种模式变成用户能看懂的东西：
 *
 *   自由攒钱  没有进度条，只显示「已经攒了多少」——紧急备用金就是这种，
 *             它没有终点，非要画个 0% 的进度条反而让人以为自己没进展。
 *   定额 / 递增  有目标才有百分比和进度条，才有「还差多少、按现在的速度还要多久」。
 *
 * 三个界面上的取舍：
 *
 * ① 金额输入框默认填好「这一期该存多少」。
 *    52 周存钱法第 37 周该存 370，让用户自己去数到第几周是很烦的事，
 *    后端算好 nextAmount，这里直接塞进输入框，他只要点确认。
 *
 * ② 取出会二次确认。存入不会。
 *    存钱是可逆的（再取出来就行），取钱对「攒钱」这个目标来说是破坏性的，
 *    而且一旦手滑输入多一个零，余额直接见底。提示一句「罐子里只剩 xxx」比事后后悔强。
 *
 * ③ 卡片上就能存钱，不点进详情。
 *    大部分操作是「今天再存 100」，这条路要最短。详情留给看明细和改设置。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog, askConfirm } from '../components/ui';
import { Icon } from '../components/Icons';
import { useDragSort } from '../components/DragSort';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import { todayKey } from '../lib/date';
import type { AccountItem, Jar, JarDetail, JarPreset } from '../types';

const MODE_NAME: Record<string, string> = {
  free: '自由攒钱',
  fixed: '定额存钱',
  step: '递增存钱',
};

const PERIOD_NAME: Record<string, string> = {
  day: '每天',
  week: '每周',
  month: '每月',
  '': '不定期',
};

/** 罐子图标候选。用表情而不是图标组件 —— 罐子是个性化的，表情更有"我的罐子"的感觉 */
const ICONS = ['🐷', '🏦', '🎯', '✈️', '🏠', '🚗', '🎓', '💍', '🎁', '🛟', '📱', '🧳'];

/** 罐子颜色候选。跟着主题走会失掉个性，所以存的是具体色值 */
const COLORS = ['', '#e05a5a', '#e08a3c', '#c9a227', '#4a9d5f', '#3d8ec9', '#7a6fd0', '#c2559a'];

export function Jars({
  amt, accounts, onChanged,
}: {
  /** 货币格式化，和账本保持同一个符号 */
  amt: (n: number) => string;
  accounts: AccountItem[];
  /** 存钱会往 ledger 里写一笔，账本列表要跟着刷新 */
  onChanged: () => void | Promise<void>;
}) {
  const toast = useStore((s) => s.toast);

  const [jars, setJars] = useState<Jar[]>([]);
  const [total, setTotal] = useState(0);
  const [presets, setPresets] = useState<JarPreset[]>([]);
  const [loading, setLoading] = useState(true);

  /* ---------- 编辑罐子 ---------- */
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [fName, setFName] = useState('');
  const [fTarget, setFTarget] = useState('');
  const [fMode, setFMode] = useState('free');
  const [fPeriod, setFPeriod] = useState('');
  const [fBase, setFBase] = useState('');
  const [fStep, setFStep] = useState('');
  const [fIcon, setFIcon] = useState('🐷');
  const [fColor, setFColor] = useState('');
  const [fNote, setFNote] = useState('');
  const [presetKey, setPresetKey] = useState('');

  /* ---------- 存 / 取 ---------- */
  const [depOpen, setDepOpen] = useState(false);
  const [depJar, setDepJar] = useState<Jar | null>(null);
  const [depDir, setDepDir] = useState<'in' | 'out'>('in');
  const [depAmount, setDepAmount] = useState('');
  const [depDate, setDepDate] = useState(todayKey());
  const [depNote, setDepNote] = useState('');
  const [depAcc, setDepAcc] = useState('');
  const [depErr, setDepErr] = useState('');
  /** 后端算出的「这一期该存多少」，只做参考展示，不跟着输入框变 ——
      否则用户改了金额，这行字也跟着改，等于什么也没说 */
  const [depNext, setDepNext] = useState(0);

  /* ---------- 明细 ---------- */
  const [detail, setDetail] = useState<JarDetail | null>(null);
  const [detailJar, setDetailJar] = useState<Jar | null>(null);

  const ctx = useContextMenu();

  const load = useCallback(async () => {
    try {
      const r = await api.jarList();
      setJars(r.jars || []);
      setTotal(r.total || 0);
    } catch {
      toast('读储蓄罐失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void api.jarPresets().then(setPresets).catch(() => { /* 预设拿不到不影响手动填 */ });
  }, []);

  const active = useMemo(() => jars.filter((j) => !j.archived), [jars]);
  const archived = useMemo(() => jars.filter((j) => j.archived), [jars]);

  const drag = useDragSort({
    keys: active.map((j) => j.id),
    onReorder: async (from, to) => {
      const ids = active.map((j) => j.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      // 归档的排后面，一起提交，下次读出来顺序才对
      await api.jarReorder([...ids, ...archived.map((j) => j.id)]);
      await load();
    },
    disabled: active.length < 2,
  });

  /* ---------------- 新建 / 编辑 ---------------- */

  const openNew = () => {
    setEditId('');
    setFName('');
    setFTarget('');
    setFMode('free');
    setFPeriod('');
    setFBase('');
    setFStep('');
    setFIcon('🐷');
    setFColor('');
    setFNote('');
    setPresetKey('');
    setEditOpen(true);
  };

  const openEdit = (j: Jar) => {
    setEditId(j.id);
    setFName(j.name);
    setFTarget(j.target ? String(j.target) : '');
    setFMode(j.mode || 'free');
    setFPeriod(j.period || '');
    setFBase(j.baseAmount ? String(j.baseAmount) : '');
    setFStep(j.stepAmount ? String(j.stepAmount) : '');
    setFIcon(j.icon || '🐷');
    setFColor(j.color || '');
    setFNote(j.note || '');
    setPresetKey('');
    setEditOpen(true);
  };

  /** 套预设：把开局那一套数字填进表单，用户还可以再改 */
  const applyPreset = (p: JarPreset) => {
    setPresetKey(p.k);
    setFName((v) => v || p.name);
    setFMode(p.mode);
    setFPeriod(p.period);
    setFBase(String(p.baseAmount));
    setFStep(String(p.stepAmount));
    setFTarget(p.target ? String(p.target) : '');
    if (p.k === '52w') setFIcon('🎯');
    else if (p.k === '365d') setFIcon('🐷');
    else if (p.k === 'free') setFIcon('🛟');
  };

  const saveJar = async () => {
    if (!fName.trim()) { toast('先给储蓄罐起个名字'); return; }
    const body = {
      name: fName.trim(),
      target: Number(fTarget) || 0,
      mode: fMode,
      period: fMode === 'free' ? '' : fPeriod || 'week',
      baseAmount: Number(fBase) || 0,
      stepAmount: fMode === 'step' ? Number(fStep) || 0 : 0,
      color: fColor,
      icon: fIcon,
      note: fNote,
    };
    try {
      const r = editId ? await api.jarUpdate({ id: editId, ...body }) : await api.jarAdd(body);
      if (!r.ok) { toast(r.err || '没存上'); return; }
      setEditOpen(false);
      await load();
      toast(editId ? '已保存' : '储蓄罐建好了');
    } catch {
      toast('没存上，再试一次');
    }
  };

  /* ---------------- 存 / 取 ---------------- */

  const openDeposit = (j: Jar, dir: 'in' | 'out') => {
    setDepJar(j);
    setDepDir(dir);
    setDepDate(todayKey());
    setDepNote('');
    setDepAcc('');
    setDepErr('');
    setDepNext(0);
    /* 存钱时把「这一期该存多少」填好 —— 让用户从零开始输是对他记忆力的浪费。
       取钱不预填：取多少是他自己的决定，给个默认值容易被顺手确认。 */
    if (dir === 'in') {
      void api.jarDetail(j.id).then((d) => {
        const next = Number(d.nextAmount || 0);
        setDepNext(next);
        setDepAmount(next > 0 ? String(Math.round(next * 100) / 100) : '');
      }).catch(() => setDepAmount(''));
    } else {
      setDepAmount('');
    }
    setDepOpen(true);
  };

  const doDeposit = async () => {
    if (!depJar) return;
    const n = Number(depAmount);
    if (!(n > 0)) { setDepErr('金额要大于 0'); return; }
    /* 取出超过余额在后端也会拦，但这里先挡一次：
       用户在对话框里就能看到「罐子里只有 xx」，不用等一次往返。 */
    if (depDir === 'out' && n > depJar.balance + 1e-9) {
      setDepErr(`罐子里只有 ${amt(depJar.balance)}，取不出 ${amt(n)}`);
      return;
    }
    try {
      const r = await api.jarDeposit({
        id: depJar.id, dir: depDir, amount: n,
        date: depDate, note: depNote,
        accountId: depAcc || undefined,
      });
      if (!r.ok) { setDepErr(r.err || '没记上'); return; }
      setDepOpen(false);
      await load();
      await onChanged();
      toast(depDir === 'in' ? '存进去了' : '取出来了');
    } catch {
      setDepErr('没记上，再试一次');
    }
  };

  /* ---------------- 明细 ---------------- */

  const openDetail = async (j: Jar) => {
    try {
      const d = await api.jarDetail(j.id);
      if (!d.ok) { toast('找不到这个罐子'); return; }
      setDetail(d);
      setDetailJar(j);
    } catch {
      toast('读明细失败');
    }
  };

  const removeItem = async (id: string) => {
    if (!(await askConfirm('删掉这一笔？', { body: '它会同时从账本里消失 —— 本来就同一条记录。', ok: '删掉' }))) return;
    await api.jarRemoveItem(id);
    if (detailJar) await openDetail(detailJar);
    await load();
    await onChanged();
  };

  /* ---------------- 其它 ---------------- */

  const toggleArchive = async (j: Jar) => {
    await api.jarArchive(j.id, j.archived ? 0 : 1);
    await load();
    toast(j.archived ? '已取消归档' : '已归档');
  };

  const removeJar = async (j: Jar) => {
    if (!(await askConfirm(`删掉「${j.name}」？`, { body: `罐子里的 ${amt(j.balance)} 记录会留在账本里，只是不再归属这个罐子。`, ok: '删掉' }))) return;
    await api.jarDelete(j.id);
    await load();
  };

  const menuFor = (j: Jar): MenuItem[] => [
    { label: '存钱…', onClick: () => openDeposit(j, 'in') },
    { label: '取钱…', disabled: j.balance <= 0, onClick: () => openDeposit(j, 'out') },
    { sep: true },
    { label: '看明细', onClick: () => void openDetail(j) },
    { label: '改设置…', onClick: () => openEdit(j) },
    { sep: true },
    { label: j.archived ? '取消归档' : '归档', onClick: () => void toggleArchive(j) },
    { label: '删除储蓄罐', danger: true, onClick: () => void removeJar(j) },
  ];

  /** 这一期该存多少的提示语。只有 fixed / step 才有意义 */
  const periodHint = (j: Jar) => {
    if (j.mode === 'free' || !j.target) return '';
    if (j.mode === 'fixed') return `${PERIOD_NAME[j.period] || '每期'} ${amt(j.baseAmount)}`;
    return `${PERIOD_NAME[j.period] || '每期'}递增，起 ${amt(j.baseAmount)} +${amt(j.stepAmount)}`;
  };

  const card = (j: Jar) => {
    const dragProps = j.archived ? null : drag.props(active.findIndex((x) => x.id === j.id));
    const pct = j.pct;
    const overPct = pct != null && pct >= 100;
    return (
      <div
        key={j.id}
        /* 拖动属性里自带 className，所以先铺开再覆盖，不能反过来 */
        {...(dragProps || {})}
        className={`jar ${overPct ? 'done' : ''} ${j.archived ? 'off' : ''} ${dragProps?.className || ''}`}
        onContextMenu={(e) => ctx.open(e, menuFor(j))}
        onClick={() => void openDetail(j)}
      >
        <div className="jar-h">
          {dragProps ? <span className="jar-grip" title="拖着可以排序"><Icon name="grip" size={13} /></span> : null}
          <span className="jar-ic" style={j.color ? { background: `${j.color}22`, color: j.color } : undefined}>
            {j.icon || '🐷'}
          </span>
          <span className="jar-n">{j.name}</span>
          {overPct ? <span className="jar-badge">已达成</span> : null}
        </div>

        <div className="jar-v">
          {amt(j.balance)}
          {j.target > 0 ? <small> / {amt(j.target)}</small> : null}
        </div>

        {pct != null ? (
          <div className="jar-bar" title={`${pct}%`}>
            <i
              style={{
                width: `${Math.min(100, Math.max(0, pct))}%`,
                background: overPct ? 'var(--ok)' : (j.color || 'var(--accent)'),
              }}
            />
          </div>
        ) : (
          /* 没设目标的罐子画虚线，不是画一条满格进度条 ——
             满格看着像"已经达成了"，但它根本没有终点，那是假的完成感。 */
          <div className="jar-bar free" title="不设目标，想存就存" />
        )}

        <div className="jar-f">
          <span className="jar-s">
            {pct != null
              ? `${pct}%${j.target > j.balance ? ` · 还差 ${amt(j.target - j.balance)}` : ''}`
              : `已存 ${j.deposits} 笔 · 不设目标`}
          </span>
          <span className="jar-s tip">{periodHint(j) || (j.note || '')}</span>
        </div>

        <div className="jar-acts">
          <button
            className="btn sm"
            type="button"
            onClick={(e) => { e.stopPropagation(); openDeposit(j, 'in'); }}
          >存钱</button>
          <button
            className="btn sm ghost"
            type="button"
            disabled={j.balance <= 0}
            onClick={(e) => { e.stopPropagation(); openDeposit(j, 'out'); }}
          >取钱</button>
          <button
            className="btn sm ghost"
            type="button"
            title="改设置"
            onClick={(e) => { e.stopPropagation(); openEdit(j); }}
          >改</button>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="card">
        <h3>
          <Icon name="star" size={14} />储蓄罐
          <span className="muted">
            {active.length} 个 · 共计 {amt(total)}
          </span>
          <button className="btn sm" type="button" onClick={openNew}>新建储蓄罐</button>
        </h3>

        {loading ? (
          <div className="empty small">正在读储蓄罐…</div>
        ) : active.length === 0 ? (
          <div className="empty small">
            还没有储蓄罐。想攒一笔钱（旅行、换手机、应急备用金），建一个罐子把进度看起来 ——
            存进去的每一笔都会记进账本，不会凭空消失。
          </div>
        ) : (
          <div ref={drag.boxRef} className="jars">
            {active.map(card)}
          </div>
        )}

        {archived.length ? (
          <details className="jar-arch">
            <summary>已归档（{archived.length}）</summary>
            <div className="jars">{archived.map(card)}</div>
          </details>
        ) : null}
      </div>

      {/* ---------------- 新建 / 改设置 ---------------- */}
      {editOpen ? (
        <Dialog
          title={editId ? '改储蓄罐' : '新建储蓄罐'}
          wide
          onClose={() => setEditOpen(false)}
          footer={<>
            <button className="btn" type="button" onClick={() => setEditOpen(false)}>取消</button>
            <button className="btn primary" type="button" onClick={() => void saveJar()}>
              {editId ? '保存' : '建好'}
            </button>
          </>}
        >
          {!editId && presets.length ? (
            <div style={{ marginBottom: 14 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                先用一个常见的存钱法打底，数字之后都能改
              </div>
              <div className="row">
                {presets.map((p) => (
                  <button
                    key={p.k}
                    type="button"
                    className={`chip ${presetKey === p.k ? 'on' : ''}`}
                    title={p.desc}
                    onClick={() => applyPreset(p)}
                  >{p.name}</button>
                ))}
              </div>
              {presetKey ? (
                <div className="small muted" style={{ marginTop: 6 }}>
                  {presets.find((p) => p.k === presetKey)?.desc}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="row" style={{ marginBottom: 10 }}>
            <input
              className="inp"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="罐子名字，比如「过年回家的机票」"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
            <input
              className="inp"
              style={{ width: 130, flex: '0 0 auto' }}
              type="number"
              step="0.01"
              min="0"
              placeholder="目标金额"
              value={fTarget}
              onChange={(e) => setFTarget(e.target.value)}
            />
            <span className="small muted" style={{ flex: '0 0 auto' }}>元</span>
          </div>
          <div className="small muted" style={{ marginBottom: 12 }}>
            目标金额留空就是纯攒钱罐 —— 不画进度条，只累计「已经攒了多少」。
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            <span className="small muted" style={{ width: 42 }}>方式</span>
            {(['free', 'fixed', 'step'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${fMode === m ? 'on' : ''}`}
                onClick={() => {
                  setFMode(m);
                  if (m !== 'free' && !fPeriod) setFPeriod('week');
                }}
              >{MODE_NAME[m]}</button>
            ))}
          </div>

          {fMode !== 'free' ? (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="small muted" style={{ width: 42 }}>周期</span>
                {(['day', 'week', 'month'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`chip ${fPeriod === p ? 'on' : ''}`}
                    onClick={() => setFPeriod(p)}
                  >{PERIOD_NAME[p]}</button>
                ))}
              </div>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="small muted" style={{ width: 62 }}>
                  {fMode === 'fixed' ? '每期金额' : '起存金额'}
                </span>
                <input
                  className="inp"
                  style={{ width: 120, flex: '0 0 auto' }}
                  type="number"
                  step="0.01"
                  min="0"
                  value={fBase}
                  onChange={(e) => setFBase(e.target.value)}
                />
                {fMode === 'step' ? (
                  <>
                    <span className="small muted" style={{ width: 52 }}>每期加</span>
                    <input
                      className="inp"
                      style={{ width: 120, flex: '0 0 auto' }}
                      type="number"
                      step="0.01"
                      min="0"
                      value={fStep}
                      onChange={(e) => setFStep(e.target.value)}
                    />
                  </>
                ) : null}
              </div>
              <div className="small muted" style={{ marginBottom: 12 }}>
                递增方式下，存钱时会自动帮你算好「这一期该存多少」并填进输入框，
                不用自己去数到第几期。
              </div>
            </>
          ) : null}

          <div className="row" style={{ marginBottom: 10 }}>
            <span className="small muted" style={{ width: 42 }}>图标</span>
            {ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                className={`jar-pick ${fIcon === ic ? 'on' : ''}`}
                onClick={() => setFIcon(ic)}
              >{ic}</button>
            ))}
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            <span className="small muted" style={{ width: 42 }}>颜色</span>
            {COLORS.map((c) => (
              <button
                key={c || 'def'}
                type="button"
                className={`jar-dot ${fColor === c ? 'on' : ''}`}
                style={{ background: c || 'var(--accent)' }}
                title={c || '跟随主题'}
                onClick={() => setFColor(c)}
              />
            ))}
          </div>

          <input
            className="inp"
            style={{ width: '100%' }}
            placeholder="备注（可空），比如「年底前攒够」"
            value={fNote}
            onChange={(e) => setFNote(e.target.value)}
          />
        </Dialog>
      ) : null}

      {/* ---------------- 存 / 取 ---------------- */}
      {depOpen && depJar ? (
        <Dialog
          title={`${depDir === 'in' ? '往罐子里存钱' : '从罐子里取钱'} · ${depJar.name}`}
          onClose={() => setDepOpen(false)}
          footer={<>
            <button className="btn" type="button" onClick={() => setDepOpen(false)}>取消</button>
            <button className="btn primary" type="button" onClick={() => void doDeposit()}>
              {depDir === 'in' ? '存进去' : '取出来'}
            </button>
          </>}
        >
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="seg">
              <button
                type="button"
                className={`seg-b ${depDir === 'in' ? 'on' : ''}`}
                onClick={() => { setDepDir('in'); setDepErr(''); }}
              >存入</button>
              <button
                type="button"
                className={`seg-b ${depDir === 'out' ? 'on' : ''}`}
                onClick={() => { setDepDir('out'); setDepErr(''); }}
              >取出</button>
            </div>
            <input
              className="inp"
              style={{ width: 140, flex: '0 0 auto', fontSize: 16 }}
              type="number"
              step="0.01"
              min="0"
              autoFocus
              placeholder="金额"
              value={depAmount}
              onChange={(e) => { setDepAmount(e.target.value); setDepErr(''); }}
            />
            <input
              className="inp"
              style={{ flex: 1, minWidth: 120 }}
              type="date"
              value={depDate}
              onChange={(e) => setDepDate(e.target.value)}
            />
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            <span className="small muted" style={{ width: 42 }}>备注</span>
            <input
              className="inp"
              style={{ flex: 1 }}
              placeholder="可空"
              value={depNote}
              onChange={(e) => setDepNote(e.target.value)}
            />
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            <span className="small muted" style={{ width: 42 }}>账户</span>
            <select
              className="inp"
              style={{ width: 160, flex: '0 0 auto' }}
              value={depAcc}
              onChange={(e) => setDepAcc(e.target.value)}
            >
              <option value="">不管账户，只记罐子</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <span className="small muted" style={{ flex: 1 }}>
              {depDir === 'in' ? '选一个账户，这笔钱会从那个账户扣掉' : '选一个账户，这笔钱会回到那个账户'}
            </span>
          </div>

          <div className="jar-info small">
            罐子里现在有 <b>{amt(depJar.balance)}</b>
            {depJar.target > 0 ? <> · 目标 {amt(depJar.target)}</> : null}
            {depNext > 0 && depDir === 'in'
              ? <> · 这一期按计划是 {amt(depNext)}（已帮你填好，可以改）</>
              : null}
          </div>

          {depErr ? <div className="jar-err small">{depErr}</div> : null}

          <div className="small muted" style={{ marginTop: 8 }}>
            这笔钱会作为一条「存钱」记录进账本，但它不计入当月支出 ——
            存钱不是花掉，只是钱换了个地方待着。
          </div>
        </Dialog>
      ) : null}

      {/* ---------------- 明细 ---------------- */}
      {detail && detailJar ? (
        <Dialog
          title={`${detailJar.name} · 明细`}
          wide
          onClose={() => { setDetail(null); setDetailJar(null); }}
          footer={<>
            <button className="btn ghost" type="button" onClick={() => {
              setDetail(null); setDetailJar(null); openEdit(detailJar);
            }}>改设置</button>
            <button className="btn primary" type="button" onClick={() => {
              const j = detailJar;
              setDetail(null); setDetailJar(null); openDeposit(j, 'in');
            }}>存钱</button>
          </>}
        >
          <div className="jar-dsum">
            <div>
              <div className="small muted">现在有</div>
              <div className="jar-dv">{amt(detail.balance || 0)}</div>
            </div>
            <div>
              <div className="small muted">目标</div>
              <div className="jar-dv">{detail.jar && detail.jar.target > 0 ? amt(detail.jar.target) : '不设目标'}</div>
            </div>
            <div>
              <div className="small muted">已存</div>
              <div className="jar-dv">{(detail.items || []).filter((i) => i.dir === 'in').length} 笔</div>
            </div>
            {detail.jar && detail.jar.mode === 'step' ? (
              <div>
                <div className="small muted">下一期建议</div>
                <div className="jar-dv">{amt(detail.nextAmount || 0)}</div>
              </div>
            ) : null}
          </div>

          {(detail.items || []).length === 0 ? (
            <div className="empty small">还没存过。点下面「存钱」记第一笔。</div>
          ) : (
            <div className="jar-dlist">
              {(detail.items || []).map((it) => (
                <div className="jar-drow" key={it.id}>
                  <span className="jar-dd">{it.date}</span>
                  <span className={`jar-dm ${it.dir === 'in' ? 'in' : 'out'}`}>
                    {it.dir === 'in' ? '+' : '−'}{amt(it.amount)}
                  </span>
                  <span className="jar-dn">{it.note || (it.dir === 'in' ? '存入' : '取出')}</span>
                  <button
                    className="btn sm ghost"
                    type="button"
                    onClick={() => void removeItem(it.id)}
                  >删除</button>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      ) : null}

      {ctx.node}

      <style>{`
        .jars{display:grid;grid-template-columns:repeat(auto-fill,minmax(212px,1fr));gap:11px}
        .jar{border:1px solid var(--line);border-radius:11px;background:var(--panel2);
          padding:11px 12px;display:flex;flex-direction:column;gap:7px;cursor:pointer;
          transition:border-color .15s,box-shadow .15s}
        .jar:hover{border-color:color-mix(in srgb,var(--accent) 38%,transparent)}
        .jar.done{border-color:color-mix(in srgb,var(--ok) 42%,transparent)}
        .jar.off{opacity:.55}
        .jar-h{display:flex;align-items:center;gap:7px}
        .jar-grip{color:var(--ink3);cursor:grab;display:flex;margin-left:-4px}
        .jar-ic{width:24px;height:24px;border-radius:7px;display:flex;align-items:center;
          justify-content:center;font-size:14px;background:var(--tap);flex:0 0 auto}
        .jar-n{font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap;flex:1}
        .jar-badge{font-size:10px;padding:1px 6px;border-radius:5px;flex:0 0 auto;
          color:var(--ok);border:1px solid color-mix(in srgb,var(--ok) 40%,transparent)}
        .jar-v{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--ink)}
        .jar-v small{font-size:11.5px;font-weight:400;color:var(--ink3)}
        .jar-bar{height:6px;border-radius:4px;background:var(--tap-hi);overflow:hidden}
        .jar-bar i{display:block;height:100%;border-radius:4px;transition:width .25s}
        .jar-bar.free{background:transparent;border:1px dashed var(--tap-ed);height:5px}
        .jar-f{display:flex;flex-direction:column;gap:1px;min-height:28px}
        .jar-s{font-size:11.5px;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .jar-s.tip{font-size:11px;opacity:.85}
        .jar-acts{display:flex;gap:6px;margin-top:1px}
        .jar-arch{margin-top:12px}
        .jar-arch summary{font-size:12px;color:var(--ink3);cursor:pointer;padding:4px 0}
        .jar-arch .jars{margin-top:8px}
        .jar-pick{width:28px;height:28px;border-radius:7px;border:1px solid var(--line);
          background:var(--panel2);font-size:14px;cursor:pointer;display:flex;
          align-items:center;justify-content:center}
        .jar-pick.on{border-color:var(--accent);background:var(--tap-hi)}
        .jar-dot{width:20px;height:20px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
        .jar-dot.on{border-color:var(--ink)}
        .jar-info{margin-top:2px;color:var(--ink2)}
        .jar-err{color:var(--bad);margin-top:6px}
        .jar-dsum{display:flex;gap:22px;flex-wrap:wrap;padding-bottom:11px;
          border-bottom:1px solid var(--line2);margin-bottom:8px}
        .jar-dv{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}
        .jar-dlist{max-height:46dvh;overflow-y:auto}
        .jar-drow{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:12.5px}
        .jar-drow + .jar-drow{border-top:1px solid var(--line2)}
        .jar-dd{color:var(--ink3);font-variant-numeric:tabular-nums;flex:0 0 auto}
        .jar-dm{font-variant-numeric:tabular-nums;font-weight:600;flex:0 0 auto;min-width:78px}
        .jar-dm.in{color:var(--ok)}
        .jar-dm.out{color:var(--warn)}
        .jar-dn{flex:1;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      `}</style>
    </>
  );
}