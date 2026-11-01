import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { useDragSort } from '../components/DragSort';
import { EncourageQuote } from '../features/encourage';
import { WD, cnDateLabel, parseKey, todayKey } from '../lib/date';
import type { Countdown, FestivalItem, OnThisDay } from '../types';

function greet(): string {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 9) return '早上好';
  if (h < 12) return '上午好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  if (h < 22) return '晚上好';
  return '夜深了';
}

/** 第 139 条：欢迎页格子的默认顺序，用户拖过就按 settings.welcomeOrder 走 */
const WELCOME_CARDS = ['todo', 'countdown', 'festival', 'progress'] as const;
type WelcomeCard = typeof WELCOME_CARDS[number];

function normalizeOrder(raw: string): WelcomeCard[] {
  const saved = String(raw || '').split(',').filter((x): x is WelcomeCard => (WELCOME_CARDS as readonly string[]).includes(x));
  // 老数据里可能有已经删掉的卡片，或者新增了卡片 —— 补齐到完整集合，不丢项也不重复
  return [...new Set(saved), ...WELCOME_CARDS.filter((k) => !saved.includes(k))];
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/** 欢迎页：打开软件第一眼看到的东西，回答「今天该做什么」 */
export function WelcomeView() {
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('zh-CN', { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  const go = useStore((s) => s.go);
  const setDate = useStore((s) => s.setDate);
  const todos = useStore((s) => s.todos);
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.logs);
  const pomo = useStore((s) => s.pomo);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);

  const [cds, setCds] = useState<Countdown[]>([]);
  const [fest, setFest] = useState<FestivalItem[]>([]);
  const [memories, setMemories] = useState<OnThisDay[]>([]);
  const [lunar, setLunar] = useState('');

  useEffect(() => {
    void (async () => {
      const [c, f, m] = await Promise.all([
        api.cd.list().catch(() => [] as Countdown[]),
        api.festival.upcoming(30).catch(() => [] as FestivalItem[]),
        api.stats.onThisDay().catch(() => [] as OnThisDay[]),
      ]);
      setCds(c);
      setFest(f);
      setMemories(m);
    })();
    api.festival.day(todayKey()).then((n) => setLunar(n.join(' · '))).catch(() => null);
  }, []);

  const today = todayKey();
  const d = parseKey(today);
  const open = todos.filter((t) => !t.done && !t.trashed);
  const dueToday = open.filter((t) => t.due && t.due <= today);
  const doneToday = todos.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) === today);
  const habitDone = habits.filter((h) => !h.archived && logs[h.id] != null).length;
  const habitAll = habits.filter((h) => !h.archived).length;

  /* ---- 第 139 条：欢迎页格子可以拖着换位置 ---- */
  const order = useMemo(() => normalizeOrder(String(settings.welcomeOrder || '')), [settings.welcomeOrder]);
  const drag = useDragSort<HTMLDivElement>({
    keys: order,
    onReorder: (from, to) => {
      setSetting('welcomeOrder', reorder(order, from, to).join(','));
    },
  });

  /** 单个格子的内容。抽出来是为了让拖动容器只关心「排第几」，不掺和业务 */
  const renderCard = (k: WelcomeCard) => {
    if (k === 'todo') {
      return (
        <>
          <h3><Icon name="todo" size={14} />今天要做 <span className="muted">{dueToday.length} 项</span></h3>
          {dueToday.length ? dueToday.slice(0, 6).map((t) => (
            <div className="wrow" key={t.id}>
              <span className={`wdot ${t.priority >= 2 ? 'hi' : ''}`} />
              <span className="wt">{t.title}</span>
              {t.dueTime ? <span className="wtime">{t.dueTime}</span> : null}
            </div>
          )) : <div className="empty small">今天没有逾期或到期的待办。要不要安排一件？</div>}
          {open.length > dueToday.length ? (
            <div className="small muted" style={{ marginTop: 8 }}>另有 {open.length - dueToday.length} 项未安排日期</div>
          ) : null}
          <div className="wfoot">
            <span className="small muted">今天已完成 {doneToday.length} 项</span>
            <button className="btn sm ghost" onClick={() => void go('todos')}>全部待办 →</button>
          </div>
        </>
      );
    }

    if (k === 'countdown') {
      return (
        <>
          <h3><Icon name="hourglass" size={14} />最近的倒数日</h3>
          {cds.length ? cds.slice(0, 4).map((c) => (
            <div className="wrow" key={c.id}>
              <span className="wdot" style={{ background: c.color }} />
              <span className="wt">{c.title}</span>
              <span className="wnum">{c.days === 0 ? '就是今天' : c.days > 0 ? `${c.days} 天` : `已过 ${-c.days} 天`}</span>
            </div>
          )) : <div className="empty small">还没有倒数日。生日、纪念日、考试都可以记。</div>}
          <div className="wfoot">
            <button className="btn sm ghost" onClick={() => void go('countdown')}>管理 →</button>
          </div>
        </>
      );
    }

    if (k === 'festival') {
      return (
        <>
          <h3><Icon name="sparkle" size={14} />接下来 30 天</h3>
          {fest.length ? fest.slice(0, 6).map((f, i) => (
            <div className="wrow" key={`${f.date}-${f.name}-${i}`}>
              <span className="wdot" style={{ background: f.lunar ? 'var(--blue)' : 'var(--accent)' }} />
              <span className="wt">{f.name}{f.lunar ? <span className="small muted"> 农历</span> : null}</span>
              <span className="wnum">{f.days === 0 ? '今天' : `${f.days} 天后`}</span>
            </div>
          )) : <div className="empty small">最近没有节日。</div>}
        </>
      );
    }

    return (
      <>
        <h3><Icon name="check-circle" size={14} />今日进度</h3>
        <div className="wstats">
          <div><b>{habitDone}<small>/{habitAll}</small></b><span>打卡</span></div>
          <div><b>{pomo.left && pomo.running ? Math.round((pomo.total - pomo.left) / 60) : 0}<small> 分</small></b><span>专注</span></div>
          <div><b>{doneToday.length}</b><span>待办完成</span></div>
        </div>
        <div className="wfoot">
          <button className="btn sm ghost" onClick={() => void go('habits')}>去打卡 →</button>
        </div>
      </>
    );
  };

  return (
    <>
    <Topbar
      title="今天"
      sub={lunar || undefined}
      right={<button className="btn sm ghost" onClick={() => void go('today')}>直接写日记 →</button>}
    />
    <div className="wrap welcome">
      <div className="hero">
        <div className="hero-l">
          <div className="greet">{greet()}<span className="hero-clock">{clock}</span></div>
          <div className="hdate">
            {d.getFullYear()} 年 {d.getMonth() + 1} 月 {d.getDate()} 日
            <span className="wd">星期{WD[d.getDay()]}</span>
          </div>
          {lunar ? <div className="hlunar">{lunar}</div> : null}
        </div>
        <div className="hero-r">
          <button className="btn primary" onClick={() => void go('today')}>
            <Icon name="pen" size={14} />写今天的日记
          </button>
          <button className="btn" onClick={() => void go('todos')}>
            <Icon name="todo" size={14} />看待办
          </button>
          <button className="btn" onClick={() => void go('pomodoro')}>
            <Icon name="timer" size={14} />开始专注
          </button>
        </div>
      </div>

      <EncourageQuote />

      <div className="wgrid" ref={drag.boxRef}>
        {order.map((k, i) => {
          const p = drag.props(i);
          return (
            <div
              key={k}
              className={`card wcard ${p.className}`}
              data-dragkey={p['data-dragkey']}
              draggable={p.draggable}
              onDragStart={p.onDragStart}
              onDragOver={p.onDragOver}
              onDragLeave={p.onDragLeave}
              onDrop={p.onDrop}
              onDragEnd={p.onDragEnd}
              title="按住拖动可以换位置"
            >
              {renderCard(k)}
            </div>
          );
        })}
      </div>
      <div className="wlinks">
        <button className="linkbtn" onClick={() => void go('manual')}>使用说明书</button>
        <span>·</span>
        <button className="linkbtn" onClick={() => void go('changelog')}>更新日志</button>
        <span>·</span>
        <button className="linkbtn" onClick={() => void go('contact')}>联系我们</button>
      </div>

      {memories.length ? (
        <div className="card">
          <h3><Icon name="clock" size={14} />那年今日</h3>
          {memories.map((m) => (
            <div className="wmem" key={m.date}>
              <button className="wmem-d" onClick={() => void setDate(m.date)}>{m.years} 年前 · {m.date}</button>
              <div className="wmem-t">{m.plain.slice(0, 120)}{m.plain.length > 120 ? '…' : ''}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>
        {cnDateLabel(today, today)} · 数据在本机，不上传任何服务器
      </div>
    </div>
    </>
  );
}
