import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RankData, RankExtraData } from '../types';

type Tab = 'diary' | 'chars' | 'habit' | 'habitTop' | 'pomo';

const TABS: { k: Tab; n: string }[] = [
  { k: 'diary', n: '日记连续' },
  { k: 'chars', n: '单日字数' },
  { k: 'habit', n: '打卡连续' },
  { k: 'habitTop', n: '打卡次数' },
  { k: 'pomo', n: '番茄时长' },
];

/**
 * 个人排行榜（第 126 条）：只算自己历史上真实发生过的区间与数量。
 *
 * 刻意不做「综合评分」：分数要怎么加权没有依据，凑出来的排名只会误导。
 * 这里每一项都是可以直接核对的原始事实（哪几天到哪几天、多少字、多少分钟）。
 * 数据分两次取：日记走 stats.rank，打卡和番茄走 stats.rankExtra。
 */
export function RankBoard() {
  const [d, setD] = useState<RankData | null>(null);
  const [x, setX] = useState<RankExtraData | null>(null);
  const [tab, setTab] = useState<Tab>('diary');

  useEffect(() => {
    void api.statsRank(8).then(setD).catch(() => setD(null));
    void api.statsRankExtra(5).then(setX).catch(() => setX(null));
  }, []);

  if (!d && !x) return null;

  const rows: { key: string; rank: string; main: string; side: string }[] = (() => {
    if (tab === 'diary') {
      return (d?.runs || []).map((r, i) => ({
        key: `${r.from}-${r.to}`, rank: String(i + 1), main: `${r.days} 天`, side: `${r.from} → ${r.to}`,
      }));
    }
    if (tab === 'chars') {
      return (d?.topDays || []).map((r, i) => ({
        key: r.date, rank: String(i + 1), main: `${r.chars} 字`, side: r.date,
      }));
    }
    if (tab === 'habit') {
      return (x?.habitRuns || []).map((r, i) => ({
        key: `${r.from}-${r.to}`, rank: String(i + 1), main: `${r.days} 天`, side: `${r.from} → ${r.to}`,
      }));
    }
    if (tab === 'habitTop') {
      return (x?.habitTop || []).map((r, i) => ({
        key: r.name, rank: String(i + 1), main: `${r.count} 次`, side: r.name,
      }));
    }
    return (x?.pomoTop || []).map((r, i) => ({
      key: r.date, rank: String(i + 1), main: `${r.minutes} 分钟`, side: `${r.date} · ${r.sessions} 颗`,
    }));
  })();

  /** 顶部那句摘要跟着 tab 变，避免"三个数字堆在一起不知道在说哪一项" */
  const summary = (() => {
    if (tab === 'diary') {
      return d ? `累计 ${d.totalDays} 天有记录${d.best ? ` · 最长连续 ${d.best.days} 天` : ''}` : '';
    }
    if (tab === 'chars') return d ? '按单日正文字数排' : '';
    if (tab === 'habit') {
      return x ? `累计 ${x.habitTotal} 天有打卡${x.habitRuns[0] ? ` · 最长连续 ${x.habitRuns[0].days} 天` : ''}` : '';
    }
    if (tab === 'habitTop') return '按完成次数排，能看出哪件事真的坚持下来了';
    return x ? `累计 ${x.pomoTotal} 天开过番茄${x.pomoRuns[0] ? ` · 最长连续 ${x.pomoRuns[0].days} 天` : ''}` : '';
  })();

  const emptyText = tab === 'pomo' ? '还没有番茄记录。' : tab === 'chars' ? '还没有字数记录。' : '还没有数据。';

  return (
    <div className="card">
      <div className="range-head">
        <div>
          <h3 style={{ margin: 0 }}>个人排行榜</h3>
          <div className="small muted">{summary}</div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, margin: '8px 0 10px', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.k} className={`chip ${tab === t.k ? 'on' : ''}`} onClick={() => setTab(t.k)}>{t.n}</button>
        ))}
      </div>

      {rows.length ? rows.map((r) => (
        <div className="rankrow" key={r.key}>
          <span className={`rk ${r.rank === '1' ? 'top' : ''}`}>{r.rank}</span>
          <span className="rk-n">{r.main}</span>
          <span className="rk-d">{r.side}</span>
        </div>
      )) : <div className="empty small">{emptyText}</div>}
    </div>
  );
}
