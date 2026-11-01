import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icons';
import { PomoDayDialog } from '../components/PomoDayDialog';
import type { PomoInsight } from '../types';

const DAYS = [[7, '7 天'], [30, '30 天'], [90, '90 天']] as const;

const h = (min: number) => (min >= 60 ? `${(min / 60).toFixed(1)} 小时` : `${min} 分钟`);

/** 分钟切成「h m」，图表标签和柱子上都用它，别让人自己换算 */
const hm = (min: number) => {
  if (!min) return '0';
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return [hh ? `${hh}h` : '', mm ? `${mm}m` : ''].filter(Boolean).join('');
};

/**
 * 番茄洞察（第 47 条）。
 * 参考「番茄 todo」的统计页：它把「今天 / 本周 / 本月」摆在最前面，
 * 下面给日历热力和任务排行 —— 这三个能直接回答「我最近到底投入了多少」，
 * 比一个综合评分有用。所以这里也只做这些，不编效率分。
 *
 * 第 130 / 132 条：这一块原来自己也带一排 7/30/90，跟外面番茄页那排「近 7 天」
 * 完全重复 —— 用户原话「一方面功能重复，另一方面不知所云」。
 * 现在改成**受控**：区间由外面那一个决定，这里不再单独给按钮。
 * 传了 days 就用外面的；没传（独立使用）才退回自己那排。
 */
export function PomoInsightPanel({ days: daysProp, hideRange }: { days?: number; hideRange?: boolean } = {}) {
  const [ownDays, setOwnDays] = useState(30);
  const days = daysProp ?? ownDays;
  const [d, setD] = useState<PomoInsight | null>(null);
  /** 第 186 条：点某一天 → 看那天专注了哪些事 */
  const [pickDate, setPickDate] = useState<string | null>(null);

  useEffect(() => { void api.pomoInsight(days).then(setD).catch(() => setD(null)); }, [days]);

  const max = Math.max(1, ...(d?.series.map((x) => x.minutes) || [1]));
  const maxTask = Math.max(1, ...(d?.topTasks.map((x) => x.minutes) || [1]));
  const maxHour = Math.max(1, ...(d?.byHour || [1]));

  return (
    <div className="card">
      <div className="range-head">
        <div>
          <h3 style={{ margin: 0 }}>洞察</h3>
          <div className="small muted">今天 / 本周 / 本月，再加一段热力</div>
        </div>
        <div className="seg">
          {/* 第 130 条：外面已经有一排区间时就不重复显示了 */}
          {hideRange || daysProp != null ? null : DAYS.map(([n, label]) => (
            <button key={n} className={`seg-b ${days === n ? 'on' : ''}`} onClick={() => setOwnDays(n)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))', marginTop: 14 }}>
        <div className="kpi"><div className="k">今天</div><div className="v">{h(d?.todayMinutes ?? 0)}<small>{d?.todaySessions ?? 0} 颗</small></div></div>
        <div className="kpi"><div className="k">本周</div><div className="v">{h(d?.weekMinutes ?? 0)}</div></div>
        <div className="kpi"><div className="k">本月</div><div className="v">{h(d?.monthMinutes ?? 0)}</div></div>
      </div>

      <div className="row" style={{ marginTop: 14, gap: 18, flexWrap: 'wrap' }}>
        <span className="small muted"><Icon name="timer" size={12} /> 连续 <b style={{ color: 'var(--accent2)' }}>{d?.streak ?? 0}</b> 天</span>
        <span className="small muted">区间最长 <b>{d?.longest ?? 0}</b> 天</span>
        <span className="small muted">有记录 <b>{d?.activeDays ?? 0}</b> 天 / 共 {d?.sessions ?? 0} 颗</span>
        {d?.bestDate ? <span className="small muted">最好的一天 {d.bestDate.slice(5)} · {h(d.bestMinutes)}</span> : null}
      </div>

      {/* 第 185 条：原来只有一排小方块 + 一个 title，看不出「哪几天到底做了多久」。
          现在改成按周成列、格子够大、有月份刻度，并且每格都能点开看明细。 */}
      <PomoHeat series={d?.series || []} max={max} onPick={setPickDate} />

      <div className="pi-heat-foot small muted">
        区间内 <b>{d?.activeDays ?? 0}</b> 天有专注，
        合计 <b>{h(d?.totalMinutes ?? 0)}</b>，
        日均 <b>{hm(d?.avgMinutes ?? 0)}</b>
        {d?.bestDate ? `，最多的一天 ${d.bestDate.slice(5)} · ${hm(d.bestMinutes)}` : ''}。
      </div>

      <PomoDayDialog date={pickDate} onClose={() => setPickDate(null)} />

      <div className="pi-cols">
        <div>
          <div className="pi-t">一天里什么时候最专注</div>
          <div className="hours">
            {(d?.byHour || []).map((m, i) => (
              <div className="hb" key={i} title={`${i}:00 · ${h(m)}`}>
                <i style={{ height: `${Math.max(2, (m / maxHour) * 100)}%` }} />
                {i % 6 === 0 ? <em>{i}</em> : null}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="pi-t">任务排行</div>
          {d?.topTasks?.length ? d.topTasks.map((t) => (
            <div className="pi-task" key={t.name}>
              <span className="nm" title={t.name}>{t.name}</span>
              <span className="bar"><i style={{ width: `${(t.minutes / maxTask) * 100}%` }} /></span>
              <span className="mm">{h(t.minutes)}</span>
            </div>
          )) : <div className="empty small">还没给番茄写过任务名。开始前填一句就会出现在这里。</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * 第 185 条：专注热力（按周成列的日历式方格）。
 *
 * 拆成独立组件而不是继续内联，是因为它要接「点某天」这件事 ——
 * 内联 IIFE 里挂 onClick 只能闭包外面那个 setState，越写越绕。
 * 这里只认三样东西：series、max、onPick，不碰 API。
 */
function PomoHeat({
  series, max, onPick,
}: {
  series: { date: string; minutes: number; count: number }[];
  max: number;
  onPick: (date: string) => void;
}) {
  // 按周成列：首列前面补空格，让星期对齐（周一在第一行）
  const pad = series.length ? (new Date(series[0].date.replace(/-/g, '/')).getDay() + 6) % 7 : 0;
  const cols: (typeof series[number] | null)[][] = [];
  let col: (typeof series[number] | null)[] = Array(pad).fill(null);
  for (const c of series) {
    col.push(c);
    if (col.length === 7) { cols.push(col); col = []; }
  }
  if (col.length) cols.push(col);

  return (
    <>
      <div className="pi-heat-head">
        <span className="pi-t" style={{ margin: 0 }}>每天专注了多久</span>
        <span className="small muted">点任意一天，看那天每颗番茄干了什么</span>
        <span className="pi-heat-legend">
          <span className="small muted">少</span>
          {[0.15, 0.4, 0.65, 0.9].map((k) => (
            <i
              key={k}
              className="heat-c"
              style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(k * 100)}%, var(--line2))` }}
            />
          ))}
          <span className="small muted">多</span>
        </span>
      </div>

      <div className="pi-heat-wrap">
        <div className="pi-heat-wd">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}
        </div>
        <div className="pi-heat-cols">
          {cols.map((c, ci) => (
            <div className="pi-heat-col" key={ci}>
              {Array.from({ length: 7 }, (_, ri) => {
                const x = c[ri];
                if (!x) return <span className="heat-c blank" key={ri} />;
                const k = max ? x.minutes / max : 0;
                return (
                  <button
                    key={x.date}
                    className={`heat-c ${x.minutes ? 'has' : ''}`}
                    data-date={x.date}
                    title={`${x.date} · ${x.minutes ? `${x.minutes} 分钟（${x.count} 颗）` : '没专注'} · 点击看明细`}
                    onClick={() => onPick(x.date)}
                    style={{
                      background: x.minutes === 0
                        ? 'var(--line2)'
                        : `color-mix(in srgb, var(--accent) ${Math.max(18, Math.round(k * 100))}%, var(--line2))`,
                    }}
                  />
                );
              })}
              <em>
                {c[0] && (c[0].date.slice(8, 10) === '01' || ci === 0)
                  ? `${Number(c[0].date.slice(5, 7))}月`
                  : ''}
              </em>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
