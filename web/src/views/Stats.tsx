import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar } from '../components/ui';
import { RankBoard } from '../features/rankBoard';
import { Icon } from '../components/Icons';
import { BarChart, Donut } from '../components/Charts';
import { MOODS } from '../lib/const';
import { fmtYearMonth } from '../lib/date';
import { shiftDay, todayKey } from '../lib/date';
import { useDragSort } from '../components/DragSort';
import type { Overview } from '../types';

const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD_NAME = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 第 214 条：统计页所有卡片都能拖动排序。
 *
 * 原话：「我希望可以拖动，很多子区域子模块要是能拖动就好了。要允许用户拖动排序，
 * 而不是只能用我们给的固定排序、顺序。包括子模块、子子模块等」。
 *
 * 做法：整页铺一个 6 列栅格，每张卡声明自己占几列（6 整行 / 3 半行 / 2 三分之一行）。
 * 这样既保留原来的并排布局，又能任意换顺序 —— 换的时候不会突然有张卡卡在半行上留空洞，
 * 因为占位是按卡片算的，栅格自动回流。
 *
 * 顺序存 settings.statsOrder（只存 key 的 JSON 数组）。
 * 只存 key 不存下标：以后加新卡片时老数组里没有它，补到末尾就行；
 * 存下标的话一插入就全错位。
 *
 * 默认不开启拖动 —— 有人就喜欢固定顺序，不该强迫所有人拖。
 */
type CardKey =
  | 'core' | 'strip' | 'monthWords' | 'weekday' | 'mood' | 'habits'
  | 'todos' | 'pomo' | 'assets' | 'tags' | 'reset';

interface CardDef {
  k: CardKey;
  /** 6 列栅格里占几列 */
  span: number;
  /** 拖动手柄的提示文字 */
  label: string;
}

const CARDS: CardDef[] = [
  { k: 'core', span: 6, label: '核心' },
  { k: 'strip', span: 6, label: '近 30 天' },
  { k: 'monthWords', span: 3, label: '每月写作量' },
  { k: 'weekday', span: 3, label: '写作都发生在星期几' },
  { k: 'mood', span: 3, label: '心情分布' },
  { k: 'habits', span: 3, label: '习惯坚持度' },
  { k: 'todos', span: 2, label: '待办' },
  { k: 'pomo', span: 2, label: '番茄钟' },
  { k: 'assets', span: 2, label: '素材与模板' },
  { k: 'tags', span: 6, label: '常用标签' },
  { k: 'reset', span: 6, label: '重置统计' },
];

const CARD_LABEL: Record<string, string> = Object.fromEntries(CARDS.map((c) => [c.k, c.label]));

/** 把存的顺序补全成当前全部卡片（新增的补末尾，删掉的忽略，坏数据退回默认） */
function orderCards(raw: unknown): CardDef[] {
  let saved: string[] = [];
  if (typeof raw === 'string' && raw) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) saved = v.filter((x): x is string => typeof x === 'string');
    } catch { saved = []; }
  }
  if (!saved.length) return CARDS;
  const map = new Map(CARDS.map((c) => [c.k as string, c]));
  const out = saved.map((k) => map.get(k)).filter(Boolean) as CardDef[];
  for (const c of CARDS) if (!saved.includes(c.k)) out.push(c);
  return out;
}

export function StatsView() {
  const habits = useStore((s) => s.habits);
  const setDate = useStore((s) => s.setDate);
  const setView = useStore((s) => s.go);
  const [s, setS] = useState<Overview | null>(null);
  // 第 229 条：日期怎么排由语言决定，不再写死「月/年」
  const lang = (useStore((x) => x.settings.language) as string) || 'zh-Hans';
  /** 第 157 条：重置统计的两步确认（0=没展开，1=已展开警告） */
  const [resetStep, setResetStep] = useState(0);
  const toast = useStore((s) => s.toast);
  // 悬停提示：方块只有一个色块，不写日期和当天的量，用户根本不知道点下去是哪天（第 124 条）
  const [hover, setHover] = useState<{ k: string; chars: number; checks: number } | null>(null);

  /* 第 214 条：卡片顺序与拖动开关 */
  const settings = useStore((x) => x.settings);
  const setSetting = useStore((x) => x.setSetting);
  const ordered = useMemo(() => orderCards(settings.statsOrder), [settings.statsOrder]);
  const sortOn = String(settings.statsSortOn ?? '0') === '1';

  const drag = useDragSort({
    keys: ordered.map((c) => c.k),
    disabled: !sortOn,
    onReorder: async (from, to) => {
      const next = ordered.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      await setSetting('statsOrder', JSON.stringify(next.map((c) => c.k)));
    },
  });

  useEffect(() => { void api.stats.overview().then(setS); }, []);

  if (!s) {
    return (<><Topbar title="统计" /><div className="wrap"><div className="empty">统计中…</div></div></>);
  }

  const per = s.perDay || [];
  const last30: { k: string; v: number; chars: number; checks: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const k = shiftDay(todayKey(), -i);
    const hit = per.find((x) => x.d === k);
    const chars = hit ? hit.chars : 0;
    const checks = hit ? hit.checks : 0;
    last30.push({ k, v: chars + checks * 80, chars, checks });
  }
  const maxV = Math.max(...last30.map((x) => x.v), 1);

  const active = habits.filter((h) => !h.archived);
  const dist = s.moodDist || [0, 0, 0, 0, 0];
  const monthSeries = (s.monthWords || []).slice().reverse().map((m) => ({
    // 第 229 条：原来写死成「26/10」（月/年），既不符合中文习惯也不跟语言走。
    // 现在：中文「2026年10月」、英文「10/2026」。
    // 注意这里必须用 fmtYearMonth —— monthWords 的 m 是「2026-10」，
    // 拿 fmtMonthDay 当日期用会补出个 1 号，画成「10月1日」，月份序列不该有「日」。
    label: fmtYearMonth(m.m, lang),
    value: m.n,
  }));
  const wdSeries = WD_ORDER.map((idx) => ({ label: WD_NAME[idx], value: s.byWeekday?.[idx] ?? 0 }));
  const moodSlices = MOODS.map((m, i) => ({ label: `${m.e} ${m.t}`, value: dist[i] || 0 }));
  const spanDays = s.firstDate && s.lastDate
    ? Math.round((new Date(s.lastDate).getTime() - new Date(s.firstDate).getTime()) / 86400000) + 1
    : 0;
  const todoTotal = (s.todos?.open ?? 0) + (s.todos?.done ?? 0);

  /* ---------------- 每张卡的内容 ---------------- */

  const bodyOf = (k: CardKey) => {
    switch (k) {
      case 'core':
        return (
          <div className="card">
            <h3>核心 <span className="muted">累计与坚持</span></h3>
            {/* 以前写死 3 列，拖动变宽变窄时会挤出空白；auto-fit 让它跟着卡片宽度走 */}
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(148px,1fr))' }}>
              <div className="kpi">
                <div className="k"><Icon name="sparkle" size={12} />当前连续</div>
                <div className="v">{s.streak}<small>天</small></div>
                <div className="s">最长 {s.longestStreak} 天</div>
              </div>
              <div className="kpi">
                <div className="k"><Icon name="calendar" size={12} />记录天数</div>
                <div className="v">{s.activeDays}<small>天</small></div>
                <div className="s">跨 {spanDays} 天 · 覆盖率 {spanDays ? Math.round((s.activeDays / spanDays) * 100) : 0}%</div>
              </div>
              <div className="kpi">
                <div className="k"><Icon name="note" size={12} />累计字数</div>
                <div className="v">{s.totalChars >= 10000 ? `${(s.totalChars / 10000).toFixed(1)}万` : s.totalChars}<small>字</small></div>
                <div className="s">日均 {s.avgChars} 字</div>
              </div>
              <div className="kpi">
                <div className="k">单日最高</div>
                <div className="v">{s.maxChars}<small>字</small></div>
                <div className="s">{s.maxCharsDate || '—'}</div>
              </div>
              <div className="kpi">
                <div className="k"><Icon name="star" size={12} />收藏</div>
                <div className="v">{s.favorites}<small>篇</small></div>
                <div className="s">关联 {s.links} 条</div>
              </div>
              <div className="kpi">
                <div className="k"><Icon name="check-circle" size={12} />打卡</div>
                <div className="v">{s.habitLogs}<small>次</small></div>
                <div className="s">带记录 {s.habitNotes} 条</div>
              </div>
            </div>
          </div>
        );

      case 'strip':
        return (
          <div className="card">
            <h3>近 30 天 <span className="muted">悬停看是哪天 · 点击打开</span></h3>
            <div className="strip-wrap">
              <div className="strip">
                {last30.map((x) => (
                  <i
                    key={x.k}
                    onMouseEnter={() => setHover(x)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => void setDate(x.k)}
                    style={{
                      cursor: 'pointer',
                      background: x.v
                        ? `color-mix(in srgb,var(--accent) ${12 + Math.round((x.v / maxV) * 50)}%,var(--panel))`
                        : 'var(--line2)',
                    }}
                  />
                ))}
              </div>
              <div className={`strip-tip ${hover ? 'on' : ''}`}>
                {hover
                  ? `${hover.k} · ${hover.chars} 字${hover.checks ? ` · ${hover.checks} 项打卡` : ''}`
                  : '把鼠标放到方块上，这里会显示日期与当天写了多少'}
              </div>
            </div>
          </div>
        );

      case 'monthWords':
        return (
          <div className="card">
            <h3>每月写作量 <span className="muted">篇 / 月</span></h3>
            <BarChart data={monthSeries} height={124} />
          </div>
        );

      case 'weekday':
        return (
          <div className="card">
            <h3>写作都发生在星期几</h3>
            <BarChart data={wdSeries} height={124} unit=" 天" />
          </div>
        );

      case 'mood':
        return (
          <div className="card">
            <h3>心情分布</h3>
            <Donut data={moodSlices} size={128} />
          </div>
        );

      case 'habits':
        return (
          <div className="card">
            <h3>习惯坚持度 <span className="muted">右侧 14 天</span></h3>
            {active.length ? active.map((h) => (
              <div className="hrow" key={h.id}>
                <span className="nm">{h.name}</span>
                <div className="mini">
                  {h.last14.map((x) => (
                    <i key={x.date} style={x.v ? { background: h.color } : undefined} />
                  ))}
                </div>
                <span className="num">连续 {h.streak} · 共 {h.total}</span>
              </div>
            )) : <div className="empty">还没有习惯。</div>}
          </div>
        );

      case 'todos':
        return (
          <div className="card">
            <h3>待办</h3>
            <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="kpi"><div className="k">未完成</div><div className="v">{s.todos?.open ?? 0}</div></div>
              <div className="kpi"><div className="k">已完成</div><div className="v">{s.todos?.done ?? 0}</div></div>
              <div className="kpi"><div className="k">近 7 天完成</div><div className="v">{s.todos?.done7 ?? 0}</div></div>
              <div className="kpi"><div className="k">垃圾桶</div><div className="v">{s.todos?.trashed ?? 0}<small>不计入</small></div></div>
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>
              完成率 {todoTotal ? Math.round(((s.todos?.done ?? 0) / todoTotal) * 100) : 0}%（不含垃圾桶）
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => void setView('todos')}>去看待办</button>
            </div>
          </div>
        );

      case 'pomo':
        return (
          <div className="card">
            <h3>番茄钟</h3>
            <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="kpi"><div className="k">累计颗数</div><div className="v">{s.pomodoroCount}</div></div>
              <div className="kpi"><div className="k">累计专注</div><div className="v">{(s.pomodoroMinutes / 60).toFixed(1)}<small>小时</small></div></div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => void setView('pomodoro')}>去看番茄钟</button>
            </div>
          </div>
        );

      case 'assets':
        return (
          <div className="card">
            <h3>素材与模板</h3>
            <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="kpi"><div className="k">多媒体库</div><div className="v">{s.mediaCount}<small>张</small></div></div>
              <div className="kpi"><div className="k">模板</div><div className="v">{s.templates}<small>个</small></div></div>
              <div className="kpi"><div className="k">倒计时</div><div className="v">{s.countdowns}<small>个</small></div></div>
              <div className="kpi"><div className="k">日记条目</div><div className="v">{s.entries}</div></div>
            </div>
          </div>
        );

      case 'tags':
        return (
          <div className="card">
            <h3>常用标签 <span className="muted">点击去搜索</span></h3>
            {s.tagTop?.length ? (
              <div className="tagcloud">
                {s.tagTop.map((t) => (
                  <span
                    key={t.tag}
                    className="t"
                    title={`看带「${t.tag}」标签的日子`}
                    onClick={() => useStore.getState().openRecords({ tag: t.tag })}
                  >
                    {t.tag}<b>{t.n}</b>
                  </span>
                ))}
              </div>
            ) : <div className="empty">还没有标签。</div>}
          </div>
        );

      case 'reset':
        return (
          /* 第 157 条：重置统计。用户原话要求「要弹出警告，不能随手一点就重置掉了」，
             所以这里必须点两次：先展开警告，再确认。 */
          <div className="card">
            <h3>重置统计 <span className="muted">清空行为记录，重新开始</span></h3>
            <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
              「重置」清的是<b>番茄记录</b>和<b>打卡记录</b>——这些是计时器和打卡攒出来的。
              <br />
              你的<b>日记正文一个字都不会删</b>，写作字数、连续天数等指标会跟着减少，因为它们是按记录算的。
            </div>
            {resetStep === 0 ? (
              <button className="btn sm" onClick={() => setResetStep(1)}>重置统计…</button>
            ) : (
              <div style={{ borderTop: '1px dashed var(--line2)', paddingTop: 10 }}>
                <div style={{ color: 'var(--warn, #c0392b)', fontWeight: 600, marginBottom: 8 }}>
                  ⚠ 这一步不可撤销，确定要继续吗？
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      const r = await api.stats.reset('pomodoro');
                      toast(`已清空 ${r.pomodoro ?? 0} 条番茄记录`);
                      setResetStep(0);
                      setS(await api.stats.overview());
                    }}
                  >只清番茄记录</button>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      const r = await api.stats.reset('habits');
                      toast(`已清空 ${r.habits ?? 0} 条打卡记录`);
                      setResetStep(0);
                      setS(await api.stats.overview());
                    }}
                  >只清打卡记录</button>
                  <button
                    className="btn sm"
                    style={{ background: 'var(--warn, #c0392b)', color: '#fff' }}
                    onClick={async () => {
                      const r = await api.stats.reset('all');
                      toast(`已清空 ${r.pomodoro ?? 0} 条番茄、${r.habits ?? 0} 条打卡记录`);
                      setResetStep(0);
                      setS(await api.stats.overview());
                    }}
                  >两个都清空</button>
                  <button className="btn sm ghost" onClick={() => setResetStep(0)}>取消</button>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <Topbar
        title="统计"
        sub={s.firstDate ? `${s.firstDate} 起 · 共 ${spanDays} 天` : undefined}
        right={
          <button
            className={`btn sm ${sortOn ? 'primary' : ''}`}
            title={sortOn ? '关掉拖动（排好的顺序不会丢）' : '打开后可以把每张卡片拖到任意位置'}
            onClick={() => void setSetting('statsSortOn', sortOn ? '0' : '1')}
          >
            <Icon name="grip" size={13} />{sortOn ? '拖动中' : '排序'}
          </button>
        }
      />
      <div className="wrap wide">
        <RankBoard />

        {sortOn ? (
          <div className="small muted" style={{ margin: '0 2px 10px', lineHeight: 1.8 }}>
            <Icon name="grip" size={11} /> 按住卡片上的 <b>⠿</b> 拖到别的位置，松手自动保存。
            小卡片（待办 / 番茄钟 / 素材）和上面的大卡片一样能拖。不想拖了再点一次右上角「拖动中」。
          </div>
        ) : null}

        <div className="stats-grid" ref={drag.boxRef}>
          {ordered.map((c, i) => {
            const dp = sortOn ? drag.props(i) : null;
            return (
              <div
                key={c.k}
                className={`stats-cell span-${c.span} ${dp?.className || ''}`}
                data-dragkey={dp?.['data-dragkey']}
                draggable={dp?.draggable}
                onDragStart={dp?.onDragStart}
                onDragOver={dp?.onDragOver}
                onDragLeave={dp?.onDragLeave}
                onDrop={dp?.onDrop}
                onDragEnd={dp?.onDragEnd}
              >
                {sortOn ? (
                  <span className="stats-grip" title={`拖动「${CARD_LABEL[c.k] || c.k}」`}>⠿</span>
                ) : null}
                {bodyOf(c.k)}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}