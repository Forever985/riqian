import { useEffect, useState } from 'react';
import { api } from '../api';
import { PomoInsightPanel } from '../features/pomoInsight';
import { useStore } from '../store';
import { Topbar, askText } from '../components/ui';
import { Icon } from '../components/Icons';
import { BarChart, Donut } from '../components/Charts';
import { PomoDayDialog } from '../components/PomoDayDialog';
import { TodoPicker } from '../components/TodoPicker';
import { fmtClock, inHMWindow, nowHM, todayKey } from '../lib/date';
import { QUADRANTS, type QuadKey } from '../features/quad';
import { quadrantOf } from '../features/todos';
import type { PomodoroStats, Todo } from '../types';

const WD = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 统计区间。
 * 第 8 / 130 条：原来只有固定 7/30/90 三档，用户明确要「区间可自定义」。
 * 现在三档常用 + 一个「自定义…」，选了自定义就出两个日期框。
 */
const RANGES: { d: number; n: string; hint: string }[] = [
  { d: 7, n: '近 7 天', hint: '这周' },
  { d: 30, n: '近 30 天', hint: '这个月' },
  { d: 90, n: '近 90 天', hint: '一个季度' },
];

/**
 * 第 86b 条：计时器（倒计时）的预设时长。
 * 用户原话「也和番茄钟一样做好预设」—— 番茄钟早就有一排可以点的数字，
 * 计时器却要每次手打，两处体验不该不一致。
 * 覆盖常见的：泡茶 5 分、小憩 15、专注 25/45、一小时、长计时 90。
 */
const TIMER_PRESETS = [5, 15, 25, 45, 60, 90];

export function PomodoroView() {
  const pomo = useStore((s) => s.pomo);
  const pomoDone = useStore((s) => s.pomoDone);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);

  const start = useStore((s) => s.pomoStart);
  const pause = useStore((s) => s.pomoPause);
  const reset = useStore((s) => s.pomoReset);
  const skip = useStore((s) => s.pomoSkip);
  const setPreset = useStore((s) => s.pomoSetPreset);
  const setBreak = useStore((s) => s.pomoSetBreak);
  const setTask = useStore((s) => s.pomoSetTask);
  const savePresets = useStore((s) => s.pomoSavePresets);

  const [stats, setStats] = useState<PomodoroStats | null>(null);
  const [range, setRange] = useState(7);
  /* 第 8 / 130 条：自定义区间。-1 表示「用的是预设档位」 */
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [breakInput, setBreakInput] = useState(String(pomo.breakMin));
  /** 第 186 条：点开某一天的明细 */
  const [dayPick, setDayPick] = useState<string | null>(null);
  /* 第 101 条：四象限挑任务面板 */
  const [quadOpen, setQuadOpen] = useState(false);

  /** 第 8 / 130 条：range=-1 表示走自定义 from/to */
  const useCustom = range === -1;
  useEffect(() => {
    const p = useCustom
      ? api.pomodoro.stats(7, customFrom, customTo)
      : api.pomodoro.stats(range);
    // 自定义但两个日期还没填全时不要去查，否则后端拿到空串会退回默认 7 天，
    // 界面上却显示「自定义」，数字对不上会让人以为坏了
    if (useCustom && (!customFrom || !customTo)) return;
    void p.then(setStats);
  }, [pomoDone, pomo.total, range, customFrom, customTo, useCustom]);
  useEffect(() => { setBreakInput(String(pomo.breakMin)); }, [pomo.breakMin]);

  const pct = pomo.total ? (pomo.total - pomo.left) / pomo.total : 0;
  const deg = Math.round(pct * 360);

  const series = (stats?.series || []).map((p) => ({ label: p.date.slice(5), value: p.minutes }));
  const hours = (stats?.byHour || []).map((h) => ({ label: String(h.hour), value: h.minutes }));
  const weekdays = (stats?.byWeekday || []).map((w) => ({ label: WD[w.weekday], value: w.minutes }));
  const tasks = (stats?.byTask || []).map((t) => ({ label: t.task, value: t.minutes }));
  const avgPerDay = stats && stats.series.length ? Math.round(stats.rangeMinutes / stats.series.length) : 0;

  // 提醒现状：让人一眼知道"到点到底会发生什么"
  const desktop = String(settings.notifyDesktop ?? '1') === '1';
  const tray = String(settings.notifyTray ?? '0') === '1';
  const sound = String(settings.notifySound ?? '1') === '1';
  const dnd = String(settings.dndEnabled ?? '0') === '1';
  const inDnd = dnd && inHMWindow(String(settings.dndFrom || '22:00'), String(settings.dndTo || '07:00'));

  const addPreset = async (kind: 'focus' | 'break') => {
    const v = await askText(kind === 'focus' ? '加一个专注时长' : '加一个休息时长', '', '分钟数，如 50');
    if (!v) return;
    const n = Number(v);
    if (!n || n <= 0) { toast('填个数字'); return; }
    const cur = kind === 'focus' ? pomo.presets : pomo.breakPresets;
    if (cur.includes(n)) { toast('已经有这个时长了'); return; }
    await savePresets(kind, [...cur, n]);
    toast(`已加入 ${n} 分钟`);
  };

  const removePreset = async (kind: 'focus' | 'break', n: number) => {
    const cur = kind === 'focus' ? pomo.presets : pomo.breakPresets;
    if (cur.length <= 1) { toast('至少留一个'); return; }
    await savePresets(kind, cur.filter((x) => x !== n));
  };

  return (
    <>
      <Topbar
        title={String(settings.pomoModuleName || '学习')}
        sub={stats ? `今天 ${stats.todayCount} 颗 · ${stats.todayMinutes} 分钟` : undefined}
        right={
          <span className={`dnd-chip ${inDnd ? 'on' : ''}`} title="勿扰时段内不弹窗不响铃">
            <Icon name={inDnd ? 'mute' : 'bell'} size={12}
      />
            {inDnd ? '勿扰中' : `现在 ${nowHM()}`}
          </span>
        }
        lock={{ scope: 'pomodoro', label: '番茄钟' }}
      />
      <div className="wrap wide">
        <div className="card">
          <h3>
            计时
            <span className="muted">{pomo.preset} 分钟专注 · {pomo.breakMin} 分钟休息 · 已完成 {pomo.round} 颗</span>
          </h3>
          <div className="pomo-wrap">
            <div
              className="pomo-ring"
              style={{ background: `conic-gradient(${pomo.kind === 'focus' ? 'var(--accent)' : 'var(--ok)'} ${deg}deg, var(--line2) ${deg}deg)` }}
            >
              <div className="pomo-inner">
                {pomo.running || pomo.left !== pomo.total ? (
                  <div className="pomo-time">{fmtClock(pomo.left || pomo.total)}</div>
                ) : (
                  <div className="pomo-time pomo-edit">
                    <input
                      className="pomo-min"
                      type="number"
                      min={1}
                      max={180}
                      value={pomo.preset}
                      title="直接改分钟数，回车生效"
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(180, Number(e.target.value) || 1));
                        void setPreset(v);
                      }}
                    />
                    <span>分</span>
                  </div>
                )}
                <div className="pomo-sub">
                  {pomo.kind === 'focus'
                    ? (pomo.running ? '专注中' : '专注')
                    : (pomo.running ? '休息中' : '休息')}
                </div>
              </div>
            </div>

            <div className="pomo-presets">
              {pomo.presets.map((m) => (
                <span key={m} className={`pchip ${pomo.preset === m ? 'on' : ''}`}>
                  <button className="pc-main" onClick={() => void setPreset(m)}>{m} 分钟</button>
                  {pomo.presets.length > 1 ? (
                    <button className="pc-x" title="从预设里去掉" onClick={() => void removePreset('focus', m)}>✕</button>
                  ) : null}
                </span>
              ))}
              <button className="pchip add" onClick={() => void addPreset('focus')}>＋ 自定义</button>
            </div>

            <div className="row" style={{ justifyContent: 'center', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="small muted">休息</span>
              <input
                className="inp"
                type="number"
                min={1}
                max={120}
                value={breakInput}
                onChange={(e) => setBreakInput(e.target.value)}
                onBlur={() => {
                  const n = Math.max(1, Math.min(120, Number(breakInput) || 5));
                  setBreakInput(String(n));
                  void setBreak(n);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                style={{ width: 64, textAlign: 'center' }}
              />
              <span className="small muted">分钟</span>
              <span style={{ width: 6 }} />
              {pomo.breakPresets.map((m) => (
                <span key={m} className={`pchip sm ${pomo.breakMin === m ? 'on' : ''}`}>
                  <button className="pc-main" onClick={() => void setBreak(m)}>{m}′</button>
                </span>
              ))}
              <button className="pchip sm add" onClick={() => void addPreset('break')}>＋</button>
            </div>

            <div className="row" style={{ justifyContent: 'center', gap: 9 }}>
              <button className="btn primary" style={{ minWidth: 104 }} onClick={() => (pomo.running ? pause() : start())}>
                <Icon name={pomo.running ? 'pause' : 'play'} size={14} />
                {pomo.running ? '暂停' : '开始'}
              </button>
              <button className="btn" onClick={reset}><Icon name="reset" size={14} />重置</button>
              <button className="btn" onClick={() => void skip()}>跳过这一段</button>
            </div>

            <input
              className="inp"
              style={{ maxWidth: 340 }}
              placeholder="这一颗番茄要做什么？（填了会进任务占比图）"
              value={pomo.task}
              onChange={(e) => setTask(e.target.value)}
            />
            {/* 第 102 条：别的页面写过的事，别让人再打一遍 */}
            <div className="row" style={{ justifyContent: 'center', marginTop: -2 }}>
              <TodoPicker onPick={(t) => setTask(t)} current={pomo.task} />
              <button
                className={`btn sm ghost ${quadOpen ? 'primary' : ''}`}
                title="按「重要 × 紧急」挑接下来做哪件"
                onClick={() => setQuadOpen(!quadOpen)}
              >
                <Icon name="grid" size={13} />四象限挑任务
              </button>
            </div>

            {/* 第 101 条：番茄钟的四象限 —— 它没有自己的条目，能分象限的是「待办」，
                所以这里的用法不是「给番茄打标」，而是「从四格里挑这一颗做什么」 */}
            {quadOpen ? <PomoQuadBoard onPick={(t) => { setTask(t); setQuadOpen(false); }} /> : null}

            <div className="notify-hint">
              <Icon name={sound && (desktop || tray) ? 'volume' : 'mute'} size={13} />
              到点会：
              {desktop ? <span className="chip">桌面右下角弹窗</span> : null}
              {tray ? <span className="chip">系统通知</span> : null}
              {sound ? <span className="chip">提示音</span> : null}
              {!desktop && !tray && !sound ? <span className="chip">只记数据（提醒全关了）</span> : null}
              {inDnd ? <span className="chip on">当前在勿扰时段</span> : null}
              <button className="btn sm ghost" onClick={() => useStore.getState().goSettings('notify')}>去设置 →</button>
            </div>
            <div className="small muted" style={{ textAlign: 'center' }}>
              关掉窗口只是收进托盘，计时和提醒都还在跑。
            </div>
          </div>
        </div>

        <CountUpCard />

        {/* 第 228 条：手动补录 + 计时器，两张卡片并排 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
          <ManualEntryCard onDone={() => void api.pomodoro.stats(range).then(setStats)} />
          <TimerCard onDone={() => void api.pomodoro.stats(range).then(setStats)} />
        </div>

        <div className="card">
          <div className="range-head">
            <div>
              <h3 style={{ margin: 0 }}>统计</h3>
              <div className="small muted">选一段时间，下面的数字和图都跟着变</div>
            </div>
            <div className="seg">
              {RANGES.map((r) => (
                <button
                  key={r.d}
                  className={`seg-b ${range === r.d ? 'on' : ''}`}
                  onClick={() => setRange(r.d)}
                  title={`统计${r.n}的数据`}
                >
                  {r.n}
                  <small>{r.hint}</small>
                </button>
              ))}
              {/* 第 8 / 130 条：自定义区间 */}
              <button
                className={`seg-b ${useCustom ? 'on' : ''}`}
                onClick={() => {
                  if (!useCustom) {
                    /*
                     * 第一次点进来给个好用的默认值：近 30 天。
                     * 上一版给的是「本月 1 号 → 今天」，月初那天两个值会撞成同一天，
                     * 图表只画一格，看着像坏了。
                     */
                    const to = todayKey();
                    const d = new Date(to);
                    d.setDate(d.getDate() - 29);
                    setCustomFrom((v) => v || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
                    setCustomTo((v) => v || to);
                    setRange(-1);
                  }
                }}
                title="自己选起止日期"
              >
                自定义
                <small>选日期</small>
              </button>
            </div>
            {useCustom ? (
              <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span className="small muted">从</span>
                <input
                  className="inp" type="date" style={{ width: 150 }}
                  value={customFrom} max={customTo || todayKey()}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                <span className="small muted">到</span>
                <input
                  className="inp" type="date" style={{ width: 150 }}
                  value={customTo} min={customFrom} max={todayKey()}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
                <span className="small muted">
                  {customFrom && customTo ? `共 ${Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000) + 1} 天` : '两个日期都填上才算数'}
                </span>
              </div>
            ) : null}
          </div>

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', marginTop: 14 }}>
            <div className="kpi"><div className="k"><Icon name="timer" size={12} />区间番茄</div><div className="v">{stats?.rangeCount ?? 0}<small>颗</small></div></div>
            <div className="kpi"><div className="k"><Icon name="clock" size={12} />区间专注</div><div className="v">{((stats?.rangeMinutes ?? 0) / 60).toFixed(1)}<small>小时</small></div></div>
            <div className="kpi"><div className="k">日均专注</div><div className="v">{avgPerDay}<small>分钟</small></div></div>
            <div className="kpi"><div className="k">平均单颗</div><div className="v">{stats?.avgMinutes ?? 0}<small>分钟</small></div></div>
            <div className="kpi"><div className="k">连续天数</div><div className="v">{stats?.streak ?? 0}<small>天</small></div></div>
            <div className="kpi"><div className="k">累计番茄</div><div className="v">{stats?.totalCount ?? 0}<small>颗</small></div></div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 16 }}>
          <div className="card">
            <h3>专注时长趋势 <span className="muted">每根柱子是一天，左边刻度是分钟</span></h3>
            {/* 第 185 条：原来是折线，一问"这天多久"就答不出来。改成柱状 + 左侧刻度，
                并把数值写成「1h20m」这种一眼能懂的格式。 */}
            <BarChart
              data={series.map((p) => ({ label: p.label, value: p.value }))}
              height={150}
              yTicks
              fmtValue={(v) => (v >= 60 ? `${Math.floor(v / 60)}h${v % 60 ? `${v % 60}m` : ''}` : `${v}m`)}
            />
            <div className="small muted" style={{ marginTop: 6 }}>
              区间合计 {((stats?.rangeMinutes ?? 0) / 60).toFixed(1)} 小时 ·
              最高一天 {Math.max(...(stats?.series.map((x) => x.minutes) || [0]))} 分钟
            </div>
          </div>
          <div className="card">
            <h3>星期分布 <span className="muted">哪几天更能坐得住</span></h3>
            <div className="wd-bars">
              {weekdays.map((d) => {
                const max = Math.max(...weekdays.map((x) => x.value), 1);
                return (
                  <div className="col" key={d.label}>
                    <div className="bar" style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} title={`${d.value} 分钟`} />
                    <div className="lb">{d.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 16 }}>
          <div className="card">
            <h3>时间花在什么事上 <span className="muted">按任务</span></h3>
            <Donut data={tasks} size={128} />
          </div>
          <div className="card">
            <h3>一天里的专注时段 <span className="muted">按小时</span></h3>
            <BarChart data={hours} height={134} unit=" 分钟" />
          </div>
        </div>

        <PomoInsightPanel days={useCustom ? 30 : range} hideRange />

        <div className="card">
          <h3>
            今天完成的番茄 <span className="muted">{stats?.todayCount ?? 0} 颗</span>
            <button
              className="btn sm ghost"
              style={{ marginLeft: 'auto', fontWeight: 400 }}
              data-act="pomo-day"
              title="看这一天每颗番茄分别做了什么"
              onClick={() => setDayPick(todayKey())}
            >
              看明细 →
            </button>
          </h3>
          {stats?.todayList?.length ? stats.todayList.slice(0, 12).map((x, i) => (
            <div
              className="row small"
              key={`${x.ts}-${i}`}
              style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--line2)' }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{x.ts.slice(11, 16)}</span>
              <span className="muted" style={{ flex: 1, marginLeft: 10 }}>{x.task || '（没写任务）'}</span>
              <b>{x.minutes}′</b>
            </div>
          )) : <div className="empty">今天还没有完成番茄。</div>}
        </div>

        <PomoDayDialog date={dayPick} onClose={() => setDayPick(null)} />
      </div>
    </>
  );
}


/**
 * 正计时（第 86 条）：不设上限，从 0 往上走，停了就记一颗。
 * 和倒计时共用同一张 pomodoro 表，所以统计里照样能算到。
 */
function CountUpCard() {
  const toast = useStore((s) => s.toast);
  const task = useStore((s) => s.pomo.task);
  const setTask = useStore((s) => s.pomoSetTask);
  const [sec, setSec] = useState(0);
  const [run, setRun] = useState(false);

  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => setSec((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [run]);

  const stop = async () => {
    setRun(false);
    const minutes = Math.max(1, Math.round(sec / 60));
    if (sec < 60) { toast('不到 1 分钟，先不记'); setSec(0); return; }
    await api.pomodoro.add(minutes, "focus", task);
    toast(`已记一颗：${minutes} 分钟`);
    setSec(0);
  };

  return (
    <div className="card">
      <h3>正计时 <span className="muted">不设时长，想看自己到底坐了多久</span></h3>
      <div className="row" style={{ alignItems: 'center', gap: 14 }}>
        <span className="pomo-up">{fmtClock(sec)}</span>
        <button className="btn" onClick={() => setRun((x) => !x)}>
          {run ? '暂停' : sec ? '继续' : '开始'}
        </button>
        <button className="btn" onClick={() => void stop()}>记一颗并归零</button>
        <button className="btn sm ghost" onClick={() => { setRun(false); setSec(0); }}>归零</button>
      </div>
      <input
        className="inp"
        style={{ marginTop: 10, maxWidth: 360 }}
        placeholder="在做什么？（会记进任务排行）"
        value={task}
        onChange={(e) => setTask(e.target.value)}
      />
    </div>
  );
}

/* ==================================================================
   第 228 条：手动补录 + 计时器
   ================================================================== */

/**
 * 手动补录。
 *
 * 用户参考的是「番茄 todo」：忘记开计时器、或者昨天在图书馆学的，
 * 事后应该能补进去 —— 否则统计永远是漏的，那统计也就不可信了。
 * 这里让用户填「哪天、几点开始、做了多久、做了什么」，剩下的交给后端。
 */
function ManualEntryCard({ onDone }: { onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [date, setDate] = useState(todayKey());
  const [startHm, setStartHm] = useState(nowHM());
  const [minutes, setMinutes] = useState('25');
  const [task, setTask] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  const submit = async () => {
    if (busy) return;
    const m = Number(minutes);
    if (!m || m <= 0 || m > 600) { toast('时长填 1~600 分钟之间'); return; }
    setBusy(true);
    try {
      const r = await api.pomodoro.manual({ date, startHm, minutes: m, task: task.trim(), note: note.trim() });
      if (!r.ok) { toast(r.err || '补录失败'); return; }
      toast(`已补录 ${m} 分钟（${date} ${startHm}）`);
      setTask(''); setNote('');
      onDone();
    } catch (e) {
      toast('补录失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>
        手动补录 <span className="muted">忘了开计时？事后补上</span>
      </h3>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 130px', minWidth: 120 }}>
          <label>哪天</label>
          <input className="inp" type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 100px', minWidth: 96 }}>
          <label>几点开始</label>
          <input className="inp" type="time" value={startHm} onChange={(e) => setStartHm(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 0 96px' }}>
          <label>多少分钟</label>
          <input
            className="inp" type="number" min={1} max={600} value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </div>
      </div>
      <input
        className="inp" style={{ marginBottom: 8 }}
        placeholder="做了什么？（会进任务排行）"
        value={task} onChange={(e) => setTask(e.target.value)}
      />
      {more ? (
        <textarea
          className="inp" rows={2} style={{ marginBottom: 8, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="备注（可选）"
          value={note} onChange={(e) => setNote(e.target.value)}
        />
      ) : (
        <button className="btn sm ghost" style={{ marginBottom: 8 }} onClick={() => setMore(true)}>加一句备注</button>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>
          <Icon name="plus" size={13} />补进去
        </button>
        <span className="small muted">补录的会一起进统计，和真计时没区别</span>
      </div>
    </div>
  );
}

/**
 * 计时器（timer）。
 *
 * 和番茄钟不是一回事：番茄钟是「定好 25 分钟，到点提醒」，
 * 计时器是「我先干着，想起来再看用了多久」—— 正数或倒数都行。
 *
 * 它和上面那张「正计时」卡的区别在于：正计时只记一颗、必须点「记一颗并归零」；
 * 这里可以倒数（比如「给自己 90 分钟，到点收工」），而且结束时会响一声提醒。
 * 两者都写进 pomodoro 表，统计里是靠 source 区分的。
 */
function TimerCard({ onDone }: { onDone: () => void }) {
  const toast = useStore((s) => s.toast);
  const [up, setUp] = useState(true);          // true = 正数，false = 倒数
  const [limitMin, setLimitMin] = useState('90');
  const [sec, setSec] = useState(0);
  const [run, setRun] = useState(false);
  const [task, setTask] = useState('');
  const [note, setNote] = useState('');

  const limitSec = Math.max(1, Number(limitMin) || 90) * 60;
  const left = Math.max(0, limitSec - sec);
  const display = up ? sec : left;

  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => setSec((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [run]);

  /* 倒数到 0：停下、提醒、但不自动记 —— 由用户决定这一段算不算 */
  useEffect(() => {
    if (up || !run) return;
    if (sec >= limitSec) {
      setRun(false);
      toast(`时间到了：${Number(limitMin) || 90} 分钟。要记下来就点右边的按钮`);
      try {
        const ctx = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = 660; g.gain.value = 0.08;
        o.start();
        o.stop(ctx.currentTime + 0.45);
      } catch { /* 没声音也能用 */ }
    }
  }, [sec, limitSec, up, run, limitMin, toast]);

  const stopAndLog = async () => {
    setRun(false);
    const st = useStore.getState();
    const minutes = Math.max(1, Math.round(sec / 60));
    if (sec < 30) { toast('不到 30 秒，先不记'); onDone(); return; }
    const r = await api.pomodoro.timer({
      date: todayKey(), minutes, task: task.trim() || st.pomo.task, note: note.trim(), up: up ? 1 : 0,
    });
    if (!r.ok) { toast(r.err || '记录失败'); return; }
    toast(`已记下 ${minutes} 分钟`);
    setSec(0); setNote('');
    onDone();
  };

  return (
    <div className="card">
      <h3>
        计时器 <span className="muted">不设番茄，自由计</span>
      </h3>
      <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="seg">
          <button className={`seg-b ${up ? 'on' : ''}`} data-timer="up" onClick={() => { setUp(true); setSec(0); setRun(false); }}>正计时</button>
          <button className={`seg-b ${!up ? 'on' : ''}`} data-timer="down" onClick={() => { setUp(false); setSec(0); setRun(false); }}>倒计时</button>
        </div>
        {!up ? (
          <>
            {/* 第 86b 条：计时器也要像番茄钟一样有预设，别让人每次手打数字 */}
            <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
              {TIMER_PRESETS.map((m) => (
                <button
                  key={m}
                  className={`chip ${Number(limitMin) === m ? 'on' : ''}`}
                  style={{ fontSize: 11.5, padding: '2px 8px' }}
                  data-timer-preset={m}
                  onClick={() => { setLimitMin(String(m)); setSec(0); setRun(false); }}
                  title={`倒数 ${m} 分钟`}
                >{m}{m >= 60 ? ' 分钟' : ' 分'}</button>
              ))}
            </div>
            <input
              className="inp" type="number" min={1} max={600} style={{ width: 80 }}
              value={limitMin} onChange={(e) => setLimitMin(e.target.value)}
              title="倒计时多久（也可以直接填）"
            />
            <span className="small muted">分钟</span>
          </>
        ) : null}
      </div>

      <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="pomo-up" data-timer-clock={up ? 'up' : 'down'}>{fmtClock(display)}</span>
        <button className="btn" onClick={() => setRun((x) => !x)}>{run ? '暂停' : sec ? '继续' : '开始'}</button>
        <button className="btn" disabled={sec < 1} onClick={() => void stopAndLog()}>记下并归零</button>
        <button className="btn sm ghost" onClick={() => { setRun(false); setSec(0); }}>归零</button>
      </div>

      <input
        className="inp" style={{ marginTop: 10 }}
        placeholder="在做什么？（会记进任务排行）"
        value={task} onChange={(e) => setTask(e.target.value)}
      />
      <div className="small muted" style={{ marginTop: 8, lineHeight: 1.8 }}>
        正计时随便跑；倒计时到 0 会响一声，但不会自动记 —— 记不记由你按。
      </div>
    </div>
  );
}

/* ---------------- 第 101 条：四象限挑任务 ---------------- */

/**
 * 番茄钟的四象限。
 *
 * 这里和待办、倒计时那两个不太一样，值得说清楚：
 *   · 待办页的四象限是「看」自己的待办；
 *   · 倒计时页是「看」自己的日子；
 *   · 番茄钟**没有自己的条目** —— 一颗番茄的标题就是待办标题。
 *     所以它能做的唯一有意义的四象限动作，是「按象限挑接下来做哪件」。
 *
 * 硬做成「给番茄打重要/紧急标记」是把数据模型搞反：番茄是**结果**，
 * 记录的是「我刚做了什么」，不是「我打算做什么」。给结果打优先级没有意义。
 *
 * 数据来源：`api.todos.list('manual')`，只取未完成、未删的。
 * 为什么不用 store 里的 todos：那个列表是按当前视图筛过的，四象限要全量。
 */
function PomoQuadBoard({ onPick }: { onPick: (title: string) => void }) {
  const toast = useStore((s) => s.toast);
  const [all, setAll] = useState<Todo[] | null>(null);
  const [dragId, setDragId] = useState('');
  const [over, setOver] = useState('');
  const today = todayKey();

  useEffect(() => {
    let alive = true;
    void api.todos.list('manual')
      .then((x) => { if (alive) setAll(x); })
      .catch(() => { if (alive) setAll([]); });
    return () => { alive = false; };
  }, []);

  /** 换格子 = 反推 priority + due，和待办页一个路数 */
  const moveTo = async (id: string, q: QuadKey) => {
    const t = (all || []).find((x) => x.id === id);
    if (!t || quadrantOf(t, today) === q) return;
    const patch = q === 'ui' ? { priority: 2, due: today }
      : q === 'un' ? { priority: 1, due: today }
        : q === 'in' ? { priority: 2, due: shift(today, 7) }
          : { priority: 0, due: '' };
    try {
      await api.todos.update({ id, ...patch });
      const next = await api.todos.list('manual');
      setAll(next);
      toast('已换格子');
    } catch {
      toast('换格子失败了');
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.7, textAlign: 'left' }}>
        点一条就把它填进上面那个任务框。<b>重要</b> = 优先级高，<b>紧急</b> = 今天或明天到期。
        也能直接把条目拖到别的格子里换象限。
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {QUADRANTS.map((qd) => {
          const items = (all || []).filter((t) => !t.done && !t.trashed && quadrantOf(t, today) === qd.key);
          return (
            <div
              key={qd.key}
              className={`quad-cell ${over === qd.key ? 'drop-target' : ''}`}
              style={{
                border: '1px solid var(--line)', borderTop: `3px solid ${qd.color}`,
                borderRadius: 9, padding: '8px 10px', textAlign: 'left', minHeight: 64,
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                if (over !== qd.key) setOver(qd.key);
              }}
              onDragLeave={() => { if (over === qd.key) setOver(''); }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId || e.dataTransfer.getData('text/plain');
                setDragId(''); setOver('');
                if (id) void moveTo(id, qd.key);
              }}
            >
              <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                <b style={{ fontSize: 12.5 }}>{qd.title}</b>
                <span className="small muted" style={{ fontSize: 10.5 }}>{qd.hint}</span>
                <span style={{ flex: 1 }} />
                <span className="small muted">{items.length}</span>
              </div>
              {!all ? <div className="small muted">读取中…</div> : null}
              {all && !items.length ? <div className="small muted" style={{ fontSize: 11.5 }}>空着</div> : null}
              {items.slice(0, 12).map((t) => (
                <div
                  key={t.id}
                  className={`quad-drag ${dragId === t.id ? 'dragging' : ''}`}
                  draggable
                  title="点一下填进任务框；按住能拖到别的格子"
                  onClick={() => onPick(t.title)}
                  onDragStart={(e) => {
                    setDragId(t.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', t.id);
                  }}
                  onDragEnd={() => { setDragId(''); setOver(''); }}
                  style={{
                    fontSize: 12.5, padding: '2px 0', cursor: 'pointer',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >{t.title}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 加天数，只在这一个文件里用，不为它去引日期库 */
function shift(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
