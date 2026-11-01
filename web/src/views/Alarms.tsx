import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { playAlarmSound, useStore } from '../store';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { nowHM } from '../lib/date';
import type { AlarmItem } from '../types';

/* ================= 宿主推送：window.__ALARMS__(list) ================= */

interface Fire { id: string; kind: string; title: string; mode?: string; sound?: string }
type FireHandler = (list: Fire[]) => void;

/**
 * 全局只装一次。宿主在原生侧定时调用 window.__ALARMS__，
 * 页面重进重出只改订阅表，不会把处理器套娃注册。
 */
const fireSubs = new Set<FireHandler>();
let bridgeInstalled = false;

function installAlarmBridge() {
  if (bridgeInstalled) return;
  bridgeInstalled = true;
  const w = window as unknown as { __ALARMS__?: (list: unknown) => void };
  const prev = w.__ALARMS__;
  w.__ALARMS__ = (list: unknown) => {
    try { prev?.(list); } catch { /* 别人的处理器坏了不该拖累这里 */ }
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return;
    const fires: Fire[] = arr.map((x, i) => {
      const o = (x || {}) as Record<string, unknown>;
      return {
        id: String(o.id ?? `alarm-${i}`),
        kind: String(o.kind ?? 'general'),
        title: String(o.title ?? '提醒'),
        // 第 143 条：方式和声音跟着推送一起带过来，页内横幅也要认这两个字段
        mode: String(o.mode ?? ''),
        sound: String(o.sound ?? ''),
      };
    });
    for (const fn of fireSubs) {
      try { fn(fires); } catch { /* 单个订阅出错不影响其他 */ }
    }
  };
}

function useAlarmFire(onFire: FireHandler) {
  useEffect(() => {
    installAlarmBridge();
    fireSubs.add(onFire);
    return () => { fireSubs.delete(onFire); };
  }, [onFire]);
}

/* ================= 文案 ================= */

const KINDS: { v: string; n: string }[] = [
  { v: 'habit', n: '打卡' },
  { v: 'todo', n: '待办' },
  { v: 'general', n: '通用' },
];

const REPEATS: { v: string; n: string }[] = [
  { v: 'daily', n: '每天' },
  { v: 'weekday', n: '工作日' },
  { v: 'once', n: '仅一次' },
  { v: 'every', n: '每隔 N 分钟' },
  { v: 'interval', n: '隔 N 天' },
];

const EVERY_PRESET = [15, 30, 60, 120];

/* ---- 第 143 条：方式 / 声音 / 提前量 / 贪睡 ---- */

/** 方式。'' = 跟随设置，跟老数据保持兼容 */
const MODES: { v: string; n: string; hint: string }[] = [
  { v: '', n: '跟随设置', hint: '用设置页里的弹窗 / 气泡 / 提示音开关' },
  { v: 'popup', n: '只弹窗', hint: '弹一个桌面提醒窗，不出声' },
  { v: 'sound', n: '只响铃', hint: '只放提示音，不弹窗' },
  { v: 'both', n: '弹窗+响铃', hint: '弹窗和提示音都来' },
  { v: 'silent', n: '静默', hint: '只在列表里记一笔，不弹窗也不出声音' },
];

/** 提示音。'' = 跟随设置；1/2 是内置风铃；其它是音乐库媒体 id */
const SOUNDS: { v: string; n: string }[] = [
  { v: '', n: '跟随设置' },
  { v: '1', n: '风铃 A' },
  { v: '2', n: '风铃 B' },
];

const ADVANCES: { v: number; n: string }[] = [
  { v: 0, n: '准点' },
  { v: 5, n: '提前 5 分' },
  { v: 15, n: '提前 15 分' },
  { v: 30, n: '提前 30 分' },
  { v: 60, n: '提前 1 小时' },
];

const SNOOZES = [5, 10, 30];

const modeName = (v: string) => MODES.find((x) => x.v === (v || ''))?.n || '跟随设置';
const soundName = (v: string) => SOUNDS.find((x) => x.v === (v || ''))?.n || '音乐库';
const advanceName = (v: number) => ADVANCES.find((x) => x.v === v)?.n || (v > 0 ? `提前 ${v} 分` : '准点');

/** 到点时间扣掉提前量之后真正该弹的时刻，给列表上那句「会提前在……」用 */
function advanceFireTime(atTime: string, advance: number): string {
  const adv = Number(advance) || 0;
  if (adv <= 0) return '';
  const [hh, mm] = (atTime || '').split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
  const d = new Date();
  d.setHours(hh, mm - adv, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const kindName = (k: string) => KINDS.find((x) => x.v === k)?.n || k || '通用';

const everyMin = (a: AlarmItem) => (Number(a.intervalMin) > 0 ? Number(a.intervalMin) : 30);
const gapDays = (a: AlarmItem) => (Number(a.intervalMin) > 0 ? Number(a.intervalMin) : 3);

function repeatName(a: AlarmItem): string {
  if (a.repeat === 'every') return `每隔 ${everyMin(a)} 分钟`;
  if (a.repeat === 'interval') return `隔 ${gapDays(a)} 天`;
  return REPEATS.find((x) => x.v === a.repeat)?.n || a.repeat || '每天';
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];

/** lastFire 可能是 'yyyy-MM-dd HH:mm:ss' 也可能是 ISO，两种都认 */
function parseFire(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const d2 = new Date(s.replace(/-/g, '/'));
  return Number.isNaN(d2.getTime()) ? null : d2;
}

const DAY = 86400000;

/** 按重复规则推算下一次响的时间，返回一句人话；算不出来给 '—' */
export function nextFireText(a: AlarmItem): string {
  if (!a.enabled) return '已经关掉了';
  const [hh, mm] = (a.atTime || '').split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return '—';

  try {
    const now = new Date();
    // 第 143 条：提前量要算进去 —— 「08:00 提前 15 分」应该今天 07:45 就响，
    // 所以基准点用 at_time 减去 advance，下面的分支全都按这个基准点推。
    const adv = Math.max(0, Number(a.advance) || 0);
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm - adv, 0, 0);
    const hm0 = `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`;
    const label = (d: Date) => {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayStart) / DAY);
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (diff === 0) return `今天 ${hm}`;
      if (diff === 1) return `明天 ${hm}`;
      if (diff === 2) return `后天 ${hm}`;
      if (diff > 2 && diff < 7) return `周${WD[d.getDay()]} ${hm}（${diff} 天后）`;
      return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
    };

    if (a.repeat === 'weekday') {
      for (let i = 0; i < 10; i++) {
        const c = new Date(base);
        c.setDate(c.getDate() + i);
        if (c.getDay() === 0 || c.getDay() === 6) continue;
        if (c.getTime() > now.getTime()) return label(c);
      }
      return '—';
    }

    if (a.repeat === 'once') {
      // 提前量生效时，显示基准点（at_time - advance）而不是 at_time，否则用户看到的「下次」是错的
      if (base.getTime() > now.getTime()) {
        return adv > 0 ? `今天 ${hm0}（提前 ${adv} 分，只响这一次）` : `今天 ${a.atTime}（只响这一次）`;
      }
      const last = parseFire(a.lastFire || '');
      if (last) return `已经响过（${last.getMonth() + 1} 月 ${last.getDate()} 日）`;
      return '今天这个点已经过了';
    }

    if (a.repeat === 'every') {
      // 起点是本应响的那次（每天 atTime），之后按分钟步长往后推，落在步长倍数的时刻上
      const step = Math.max(1, everyMin(a)) * 60000;
      if (base.getTime() > now.getTime()) return label(base);
      const k = Math.ceil((now.getTime() - base.getTime()) / step);
      const next = new Date(base.getTime() + k * step);
      if (!Number.isFinite(next.getTime())) return '—';
      // 已过 0 点就从第二天的起点重新算，避免把今天的最后一格算到凌晨
      const tomorrow = new Date(base.getTime() + DAY);
      if (next.getTime() >= tomorrow.getTime()) {
        const anchor = new Date(tomorrow.getTime());
        if (anchor.getTime() > now.getTime()) return label(anchor);
        const k2 = Math.ceil((now.getTime() - anchor.getTime()) / step);
        return label(new Date(anchor.getTime() + k2 * step));
      }
      return label(next);
    }

    if (a.repeat === 'interval') {
      const gap = Math.max(1, gapDays(a));
      const last = parseFire(a.lastFire || '');
      if (!last) {
        // 还没响过：今天没到点就今天，到点了就明天
        return label(base.getTime() > now.getTime() ? base : new Date(base.getTime() + DAY));
      }
      // 用基准点（已扣提前量）的小时/分钟，不是 at_time 的
      const c = new Date(last.getFullYear(), last.getMonth(), last.getDate(), base.getHours(), base.getMinutes(), 0, 0);
      let guard = 0;
      while (c.getTime() <= now.getTime() && guard < 4000) {
        c.setTime(c.getTime() + gap * DAY);
        guard += 1;
      }
      if (c.getTime() <= now.getTime()) return '—';
      return label(c);
    }

    const c = base.getTime() > now.getTime() ? base : new Date(base.getTime() + DAY);
    return label(c);
  } catch {
    return '—';
  }
}

/* ================= 页面 ================= */

export function AlarmsView() {
  const toast = useStore((s) => s.toast);

  const [list, setList] = useState<AlarmItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fired, setFired] = useState<Record<string, number>>({});
  /** 第 143 条：到点横幅里显示哪几条，带贪睡按钮 */
  const [banner, setBanner] = useState<Fire[]>([]);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fTime, setFTime] = useState('08:00');
  const [fKind, setFKind] = useState('habit');
  const [fRepeat, setFRepeat] = useState('daily');
  const [fInterval, setFInterval] = useState('30');
  const [fEnabled, setFEnabled] = useState(true);
  // 第 143 条：方式 / 声音 / 提前量
  const [fMode, setFMode] = useState('');
  const [fSound, setFSound] = useState('');
  const [fAdvance, setFAdvance] = useState(0);
  /** 音乐库里的音频，给「声音」下拉当额外选项 */
  const [music, setMusic] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    void api.music.list()
      .then((m) => setMusic(m.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api.alarmList());
    } catch {
      toast('提醒没读出来，稍后再试');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  // 每分钟刷一次，「下次……」的文字不会一直停在打开页面那一刻
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const onFire = useCallback((fires: Fire[]) => {
    if (!fires.length) return;
    // 第 143 条：这里只负责「页内」那一份反馈（横幅 / 常驻 toast）。
    // 桌面弹窗和提示音由 App.tsx 的全局钩子按每条的方式/声音统一发，
    // 这里再响一遍就成了双份声音。
    const now = Date.now();
    setFired((prev) => {
      const next = { ...prev };
      for (const f of fires) next[f.id] = now;
      return next;
    });
    setBanner(fires.filter((f) => f.mode !== 'silent'));
    setTick((x) => x + 1);   // 让「下次」立刻往后推一格
    // 界面提示条由 App 的全局钩子统一发（任何页面都能看到），这里不重复发一遍
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      setFired({});
      setBanner([]);
    }, 8000);

    // 「仅一次」的响过就关掉，不然宿主下一天还会再推一次
    const once = list.filter((a) => a.repeat === 'once' && fires.some((f) => f.id === a.id));
    if (once.length) {
      void (async () => {
        for (const a of once) {
          await api.alarmSave({
            id: a.id, kind: a.kind, title: a.title, atTime: a.atTime,
            repeat: a.repeat, enabled: 0,
          }).catch(() => null);
        }
        await load();
      })();
    }
  }, [toast, list, load]);

  useAlarmFire(onFire);

  /**
   * 第 143 条：稍后提醒。
   *
   * 只把 snooze_until 推到 now + minutes，last_fire 不动 ——
   * 「每天 08:00」的提醒贪睡到 08:10 响过之后，明天还是 08:00，
   * 不会被贪睡时间带跑偏。到点由 AlarmsDue 的 snooze_due 分支单独判。
   */
  const snooze = async (f: Fire, minutes: number) => {
    try {
      await api.alarmSnooze(f.id, minutes);
      setBanner((prev) => prev.filter((x) => x.id !== f.id));
      toast(`${minutes} 分钟后再说：${f.title}`);
      await load();
    } catch {
      toast('没能推后，再试一次');
    }
  };

  const openNew = () => {
    setEditId(null);
    setFTitle('');
    setFTime('08:00');
    setFKind('habit');
    setFRepeat('daily');
    setFInterval('30');
    setFEnabled(true);
    setFMode('');
    setFSound('');
    setFAdvance(0);
    setFormOpen(true);
  };

  const openEdit = (a: AlarmItem) => {
    setEditId(a.id);
    setFTitle(a.title);
    setFTime(a.atTime || '08:00');
    setFKind(a.kind || 'general');
    setFRepeat(a.repeat || 'daily');
    setFInterval(String(
      Number(a.intervalMin) > 0 ? Number(a.intervalMin) : (a.repeat === 'interval' ? 3 : 30),
    ));
    setFEnabled(!!a.enabled);
    setFMode(a.mode || '');
    setFSound(a.sound || '');
    setFAdvance(Number(a.advance) || 0);
    setFormOpen(true);
  };

  /** 切重复方式时给个合理的默认间隔 */
  const pickRepeat = (r: string) => {
    setFRepeat(r);
    if (r === 'every') setFInterval('30');
    else if (r === 'interval') setFInterval('3');
  };

  const intervalValue = (): number | undefined => {
    if (fRepeat !== 'every' && fRepeat !== 'interval') return undefined;
    const n = Math.round(Number(fInterval));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const save = async () => {
    const title = fTitle.trim();
    if (!title) { toast('给提醒起个名字'); return; }
    if (!/^\d{2}:\d{2}$/.test(fTime)) { toast('选一个时间'); return; }
    const iv = intervalValue();
    if ((fRepeat === 'every' || fRepeat === 'interval') && !iv) {
      toast(fRepeat === 'every' ? '每隔几分钟要填个大于 0 的数' : '隔几天要填个大于 0 的数');
      return;
    }
    try {
      await api.alarmSave({
        id: editId ?? undefined,
        kind: fKind,
        title,
        atTime: fTime,
        repeat: fRepeat,
        enabled: fEnabled ? 1 : 0,
        intervalMin: iv,
        // 第 143 条：三个新字段必须一起传，漏了就是「界面选了、后端没收到」
        mode: fMode,
        sound: fSound,
        advance: fAdvance,
      });
      setFormOpen(false);
      setEditId(null);
      await load();
      /*
       * 第 208 条：新建时如果这个时间点今天已经过了，后端会把 last_fire 直接填成「现在」，
       * 免得 30 秒轮询当场补响一次。这里把这件事告诉用户，
       * 否则他会以为「我明明设了，怎么今天没响」。
       */
      if (!editId) {
        const nowM = nowHM();
        if (fEnabled && fTime < nowM) {
          toast(`提醒加好了。${fTime} 今天已经过了，从明天开始响`);
        } else {
          toast('提醒加好了');
        }
      } else {
        toast('已保存');
      }
    } catch {
      toast('没存上，再试一次');
    }
  };

  const toggle = async (a: AlarmItem) => {
    try {
      // 只切开关：mode / sound / advance 不传，Db 那边会原样保留，不会把用户选好的方式和声音清掉
      await api.alarmSave({
        id: a.id, kind: a.kind, title: a.title, atTime: a.atTime,
        repeat: a.repeat, enabled: a.enabled ? 0 : 1,
        intervalMin: Number(a.intervalMin) > 0 ? Number(a.intervalMin) : undefined,
      });
      await load();
      toast(a.enabled ? '已关掉' : '已打开');
    } catch {
      toast('没能改动，再试一次');
    }
  };

  const remove = async (a: AlarmItem) => {
    if (!window.confirm(`删除「${a.title}」这个提醒？`)) return;
    try {
      await api.alarmDelete(a.id);
      await load();
      toast('已删除');
    } catch {
      toast('没删掉，再试一次');
    }
  };

  const onN = list.filter((a) => a.enabled).length;

  return (
    <>
      <Topbar
        title="提醒"
        sub={`${list.length} 个 · ${onN} 个开着`}
        right={<button className="btn primary sm" onClick={openNew}><Icon name="plus" size={13} />新建提醒</button>}
      />
      <div className="wrap">
        {banner.length ? (
          <div className="al-banner">
            <Icon name="bell" size={14} />
            <div className="al-banner-body">
              {banner.map((f) => (
                <div className="al-banner-item" key={f.id}>
                  <b>{f.title}</b>
                  {/* 第 143 条：贪睡 —— 挑一个 5 / 10 / 30 分钟，之后单独再响一次 */}
                  <span className="al-snooze">
                    <span className="small muted">稍后提醒</span>
                    {SNOOZES.map((m) => (
                      <button
                        type="button"
                        key={m}
                        className="btn sm ghost al-snooze-btn"
                        onClick={() => void snooze(f, m)}
                        title={`${m} 分钟后再响一次；原来的每日重复不受影响`}
                      >{m} 分</button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <button className="btn sm ghost" onClick={() => { setBanner([]); setFired({}); }}>知道了</button>
          </div>
        ) : null}

        {formOpen ? (
          <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <h3>
              <Icon name="bell" size={14} />
              {editId ? '改一下这个提醒' : '新建提醒'}
              <span className="muted">回车保存</span>
            </h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <input
                className="inp al-time-inp"
                type="time"
                value={fTime}
                onChange={(e) => setFTime(e.target.value)}
                step={60}
              />
              <input
                className="inp"
                style={{ flex: 1, minWidth: 160 }}
                placeholder="提醒什么？比如：喝水 / 交房租"
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
              />
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="small muted" style={{ width: 34 }}>类型</span>
              {KINDS.map((k) => (
                <button
                  type="button"
                  key={k.v}
                  className={`chip ${fKind === k.v ? 'on' : ''}`}
                  onClick={() => setFKind(k.v)}
                >{k.n}</button>
              ))}
              <span style={{ width: 10 }} />
              <span className="small muted" style={{ width: 34 }}>重复</span>
              {REPEATS.map((r) => (
                <button
                  type="button"
                  key={r.v}
                  className={`chip ${fRepeat === r.v ? 'on' : ''}`}
                  onClick={() => pickRepeat(r.v)}
                >{r.n}</button>
              ))}
            </div>
            {fRepeat === 'every' ? (
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="small muted" style={{ width: 60 }}>间隔分钟</span>
                {EVERY_PRESET.map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`chip ${Number(fInterval) === n ? 'on' : ''}`}
                    onClick={() => setFInterval(String(n))}
                  >{n}</button>
                ))}
                <input
                  className="inp al-iv-inp"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="自定义"
                  value={fInterval}
                  onChange={(e) => setFInterval(e.target.value)}
                />
                <span className="small muted">从 {fTime} 起，每这么多分钟响一次</span>
              </div>
            ) : null}
            {fRepeat === 'interval' ? (
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="small muted" style={{ width: 60 }}>间隔天数</span>
                <input
                  className="inp al-iv-inp"
                  type="number"
                  min="1"
                  step="1"
                  value={fInterval}
                  onChange={(e) => setFInterval(e.target.value)}
                />
                <span className="small muted">上次响过之后隔这么多天再响一次</span>
              </div>
            ) : null}
            {/* 第 143 条：方式 */}
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="small muted" style={{ width: 60 }}>方式</span>
              {MODES.map((m) => (
                <button
                  type="button"
                  key={m.v || 'default'}
                  className={`chip ${fMode === m.v ? 'on' : ''}`}
                  title={m.hint}
                  onClick={() => setFMode(m.v)}
                >{m.n}</button>
              ))}
            </div>
            {/* 第 143 条：声音 + 试听。静默方式下声音没意义，直接不显示 */}
            {fMode !== 'silent' ? (
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="small muted" style={{ width: 60 }}>声音</span>
                <select
                  className="inp al-snd-inp"
                  value={fSound}
                  onChange={(e) => setFSound(e.target.value)}
                >
                  {SOUNDS.map((s) => (
                    <option key={s.v || 'default'} value={s.v}>{s.n}</option>
                  ))}
                  {music.length ? (
                    <optgroup label="音乐库">
                      {music.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  ) : null}
                </select>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => playAlarmSound(fSound)}
                  title="听一下这条提醒会用什么声音"
                >
                  <Icon name="volume" size={13} />试听
                </button>
              </div>
            ) : null}
            {/* 第 143 条：提前量 */}
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="small muted" style={{ width: 60 }}>提前量</span>
              {ADVANCES.map((p) => (
                <button
                  type="button"
                  key={p.v}
                  className={`chip ${fAdvance === p.v ? 'on' : ''}`}
                  onClick={() => setFAdvance(p.v)}
                >{p.n}</button>
              ))}
              <span className="small muted">
                {fAdvance > 0 ? `到 ${fTime} 时会提前到 ${advanceFireTime(fTime, fAdvance)} 提醒` : '到点就响'}
              </span>
            </div>
            <div className="row">
              <button
                type="button"
                className={`switch ${fEnabled ? 'on' : ''}`}
                aria-pressed={fEnabled}
                onClick={() => setFEnabled(!fEnabled)}
                title={fEnabled ? '启用中' : '已停用'}
              />
              <span className="small">{fEnabled ? '到点会响' : '先存着，不响'}</span>
              <div style={{ flex: 1 }} />
              <button type="button" className="btn" onClick={() => { setFormOpen(false); setEditId(null); }}>取消</button>
              <button type="submit" className="btn primary">{editId ? '保存' : '添加'}</button>
            </div>
          </form>
        ) : null}

        {loading && !list.length ? (
          <div className="card"><div className="empty">正在读提醒…</div></div>
        ) : list.length ? (
          <div className="card al-list">
            {list.map((a) => {
              const ringing = !!fired[a.id];
              return (
                <div className={`al-row ${a.enabled ? '' : 'off'} ${ringing ? 'ring' : ''}`} key={a.id}>
                  <div className="al-time">{a.atTime || '--:--'}</div>
                  <div className="al-main">
                    <div className="al-title">
                      {a.title}
                      {ringing ? <span className="al-badge">正在响</span> : null}
                    </div>
                    <div className="al-meta">
                      <span className="chip">{kindName(a.kind)}</span>
                      <span>{repeatName(a)}</span>
                      {/* 第 143 条：方式和声音也摆出来，不用点进编辑才知道 */}
                      <span>{modeName(a.mode || '')}</span>
                      {a.mode !== 'silent' && a.mode !== 'popup' ? <span>{soundName(a.sound || '')}</span> : null}
                      {Number(a.advance) > 0 ? <span>{advanceName(Number(a.advance))}</span> : null}
                      {a.snoozeUntil ? <span className="al-snz">已推后到 {a.snoozeUntil.slice(11, 16)}</span> : null}
                      <span className="al-next">下次：{nextFireText(a) || '—'}</span>
                    </div>
                  </div>
                  <button
                    className={`switch ${a.enabled ? 'on' : ''}`}
                    aria-pressed={!!a.enabled}
                    title={a.enabled ? '关掉' : '打开'}
                    onClick={() => void toggle(a)}
                  />
                  <button className="btn sm" onClick={() => openEdit(a)}>编辑</button>
                  <button className="btn sm danger" onClick={() => void remove(a)}>删除</button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <div className="empty">
              还没有提醒。加一个「每天 08:00 喝水」或者「工作日 09:30 看今日待办」，到点桌面会响一声。
            </div>
          </div>
        )}

        <div className="small muted" style={{ margin: '6px 4px 0' }}>
          提醒由桌面端每 30 秒检查一次，软件开着就会响；关掉软件不会响。
        </div>
      </div>

      <style>{`
        .al-banner{
          display:flex;align-items:flex-start;gap:9px;margin-bottom:12px;padding:10px 14px;
          border:1px solid color-mix(in srgb,var(--accent) 45%,var(--line));
          background:color-mix(in srgb,var(--accent) 10%,transparent);
          border-radius:10px;font-size:13px;color:var(--ink);
        }
        .al-banner > svg{margin-top:2px}
        .al-banner-body{flex:1;display:flex;flex-direction:column;gap:6px;min-width:0}
        .al-banner-item{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
        .al-snooze{display:inline-flex;align-items:center;gap:4px}
        .al-snooze-btn{padding:1px 8px;font-size:11.5px}
        .al-list{padding:6px 16px}
        .al-row{
          display:flex;align-items:center;gap:12px;padding:11px 0;
          border-bottom:1px solid var(--line2);transition:.18s;
        }
        .al-row:last-child{border-bottom:0}
        .al-row.off .al-time,.al-row.off .al-title{opacity:.45}
        .al-row.ring{background:color-mix(in srgb,var(--accent) 9%,transparent);border-radius:8px;padding-left:8px;padding-right:8px}
        .al-time{
          font-size:19px;font-weight:600;font-variant-numeric:tabular-nums;
          letter-spacing:-.02em;flex:0 0 auto;width:66px;
        }
        .al-main{flex:1;min-width:0}
        .al-title{font-size:14px;display:flex;align-items:center;gap:7px}
        .al-badge{
          font-size:10.5px;padding:0 6px;border-radius:5px;background:var(--accent);color:#fff;
        }
        .al-meta{display:flex;align-items:center;gap:7px;margin-top:3px;font-size:11.5px;color:var(--ink3);flex-wrap:wrap}
        .al-meta .chip{font-size:11px;padding:0 6px}
        .al-next{color:var(--ink2)}
        .al-snz{color:var(--accent)}
        .al-time-inp{width:120px;flex:0 0 auto;font-size:15px;font-variant-numeric:tabular-nums}
        .al-iv-inp{width:110px;flex:0 0 auto}
        .al-snd-inp{width:150px;flex:0 0 auto}
      `}</style>
    </>
  );
}
