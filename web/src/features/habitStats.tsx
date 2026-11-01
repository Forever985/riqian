import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { HabitStatData } from '../types';

/**
 * 打卡统计（近 N 天）：每天完成数柱状 + 习惯完成次数排行 + 总量 / 完成率。
 * 全部用 div 画，不引图表库；柱子复用 pomoInsight 里的 .hours / .hb。
 */
export function HabitStatsPanel({
  days = 30, habitCount = 0, refreshKey = 0,
}: {
  days?: number;
  /** 在用的习惯数（不含归档），用来算整体完成率 */
  habitCount?: number;
  /** 外部数据变了就 +1，触发重取 */
  refreshKey?: number;
}) {
  const [data, setData] = useState<HabitStatData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const x = await api.habitStats(days);
      setData(x);
      setErr('');
    } catch (e) {
      setErr((e as Error).message || '取不到统计');
    } finally {
      setBusy(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const perDay = data?.perDay || [];
  const ranks = data?.ranks || [];

  const totalDone = useMemo(() => perDay.reduce((n, x) => n + x.done, 0), [perDay]);
  const maxDay = useMemo(() => Math.max(1, ...perDay.map((x) => x.done)), [perDay]);
  const maxRank = useMemo(() => Math.max(1, ...ranks.map((x) => x.done)), [ranks]);
  const capacity = Math.max(1, habitCount * days);
  const rate = Math.min(100, Math.round((totalDone / capacity) * 100));
  const avg = perDay.length ? totalDone / perDay.length : 0;

  const shown = ranks.filter((x) => x.done > 0).slice(0, 10);

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="small muted">近 {data?.days || days} 天</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={() => void load()} disabled={busy}>
          {busy ? '统计中…' : '刷新'}
        </button>
      </div>

      {err ? <div className="empty small">{err}</div> : null}

      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div className="stat" style={{ flex: 1, minWidth: 118 }}>
          <div className="k">在用习惯</div>
          <div className="v">{habitCount}<small>个</small></div>
          <div className="s">库里共 {data?.total ?? habitCount} 个</div>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 118 }}>
          <div className="k">总打卡</div>
          <div className="v">{totalDone}<small>次</small></div>
          <div className="s">日均 {avg.toFixed(1)} 次</div>
        </div>
        <div className="stat" style={{ flex: 1, minWidth: 118 }}>
          <div className="k">整体完成率</div>
          <div className="v">{rate}<small>%</small></div>
          <div className="bar"><i style={{ width: `${rate}%` }} /></div>
        </div>
      </div>

      <div className="pi-t">每天完成了几项</div>
      {perDay.length ? (
        <div style={{ paddingBottom: 18 }}>
          <div className="hours" style={{ height: 96, gap: 3 }}>
            {perDay.map((x, i) => (
              <div className="hb" key={x.date} title={`${x.date} · ${x.done} 项打卡`}>
                <i style={{ height: `${Math.max(2, (x.done / maxDay) * 100)}%`, opacity: x.done ? 0.9 : 0.25 }} />
                {i % 5 === 0 ? <em>{Number(x.date.slice(8, 10))}</em> : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="empty small">还没有数据。</div>
      )}

      <div className="pi-t" style={{ marginTop: 14 }}>每个习惯完成次数</div>
      {shown.length ? shown.map((x) => (
        <div className="pi-task" key={x.id}>
          <span className="nm" title={x.name}>{x.name}</span>
          <span className="bar"><i style={{ width: `${(x.done / maxRank) * 100}%` }} /></span>
          <span className="mm">{x.done} 次</span>
        </div>
      )) : (
        <div className="empty small">这段时间还没打过卡。</div>
      )}

      {ranks.length > shown.length && ranks.some((x) => x.done === 0) ? (
        <div className="small muted" style={{ marginTop: 6 }}>
          还有 {ranks.filter((x) => x.done === 0).length} 个习惯近 {data?.days || days} 天一次都没打卡。
        </div>
      ) : null}
    </>
  );
}
