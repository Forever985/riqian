import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar } from '../components/ui';
import { MOODS } from '../lib/const';
import type { EntryListItem } from '../types';

type Grain = 'year' | 'month' | 'day';
type Dir = 'v' | 'h';

/** 一页取多少条 */
const PAGE = 100;

const WD = ['日', '一', '二', '三', '四', '五', '六'];

interface Node {
  key: string;
  /** 点击后打开的那一天 */
  date: string;
  /** 轴上第一行 */
  axis: string;
  /** 轴上第二行 */
  axisSub: string;
  title: string;
  excerpt: string;
  chars: number;
  mood: string;
  count?: number;
}

const clean = (s: string) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * 日记时间轴：把日记按年份 / 月份 / 日子铺开，能横着滑也能竖着看。
 *
 * 第 188 条之后它不再是独立页面 —— 它和「记录」页是同一批数据的另一种排版，
 * 所以并进记录页当一个视图（embedded）。独立页面的位置让给了「大事时间轴」。
 */
export function TimelineView({ embedded = false }: { embedded?: boolean } = {}) {
  const modules = useStore((s) => s.modules);
  const setDate = useStore((s) => s.setDate);
  const toast = useStore((s) => s.toast);

  const [items, setItems] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [grain, setGrain] = useState<Grain>('day');
  const [dir, setDir] = useState<Dir>('v');
  const [year, setYear] = useState('');

  /** 按 date 去重后倒序：分页追加时不会因为边界重复多出一条 */
  const merge = (prev: EntryListItem[], add: EntryListItem[]): EntryListItem[] => {
    const map = new Map<string, EntryListItem>();
    for (const it of prev) map.set(it.date, it);
    for (const it of add) if (!map.has(it.date)) map.set(it.date, it);
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  };

  /** 回到第一页（首次进入、切换年份都走这里） */
  const firstPage = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.entry.list({ limit: PAGE });
      setItems(merge([], list));
      setHasMore(list.length >= PAGE);
    } catch {
      setItems([]);
      setHasMore(false);
      toast('日记没读出来，稍后再试');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // 年份一变就重置分页；首屏也由这里负责
  useEffect(() => { void firstPage(); }, [year, firstPage]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const list = await api.entry.list({ limit: PAGE, offset: items.length });
      const merged = merge(items, list);
      setItems(merged);
      if (list.length < PAGE || merged.length === items.length) setHasMore(false);
    } catch {
      toast('更早的日记没读出来，稍后再试');
    } finally {
      setLoadingMore(false);
    }
  };

  const moodMod = modules.find((m) => m.type === 'mood');

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(it.date.slice(0, 4));
    return [...set].sort((a, b) => (a < b ? 1 : -1));
  }, [items]);

  const pool = useMemo(
    () => (year ? items.filter((it) => it.date.startsWith(year)) : items),
    [items, year],
  );

  const nodes = useMemo<Node[]>(() => {
    const moodOf = (it: EntryListItem) => {
      if (!moodMod) return '';
      const v = Number(it.values?.[moodMod.id]);
      return v ? (MOODS.find((x) => x.v === v)?.t || '') : '';
    };

    if (grain === 'day') {
      return pool.map((it) => {
        const [y, m, d] = it.date.split('-').map(Number);
        const wd = new Date(y, m - 1, d).getDay();
        const plain = clean(it.plain);
        return {
          key: it.date,
          date: it.date,
          axis: `${m} 月 ${d} 日`,
          axisSub: `${y} · 周${WD[wd]}`,
          title: clean(it.title || '') || (plain ? plain.slice(0, 26) : '还没起标题'),
          excerpt: plain.length > 110 ? `${plain.slice(0, 110)}…` : plain,
          chars: it.chars || 0,
          mood: moodOf(it),
        };
      });
    }

    const keyLen = grain === 'year' ? 4 : 7;
    const map = new Map<string, EntryListItem[]>();
    for (const it of pool) {
      const k = it.date.slice(0, keyLen);
      const arr = map.get(k);
      if (arr) arr.push(it); else map.set(k, [it]);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, arr]) => {
        const chars = arr.reduce((n, x) => n + (x.chars || 0), 0);
        const latest = arr[0];
        const moods = arr.map(moodOf).filter(Boolean);
        const topMood = moods.length
          ? (() => {
              const cnt = new Map<string, number>();
              for (const m of moods) cnt.set(m, (cnt.get(m) || 0) + 1);
              return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
            })()
          : '';
        if (grain === 'year') {
          return {
            key: k,
            date: latest.date,
            axis: k,
            axisSub: `${arr.length} 篇`,
            title: `${k} 年`,
            excerpt: `一共写了 ${arr.length} 篇、${chars.toLocaleString('zh-CN')} 字，最近一篇是 ${latest.date}`,
            chars,
            mood: topMood,
            count: arr.length,
          };
        }
        const [y, m] = k.split('-').map(Number);
        return {
          key: k,
          date: latest.date,
          axis: `${m} 月`,
          axisSub: `${y} 年 · ${arr.length} 篇`,
          title: `${y} 年 ${m} 月`,
          excerpt: `一共写了 ${arr.length} 篇、${chars.toLocaleString('zh-CN')} 字，最近一篇是 ${latest.date}`,
          chars,
          mood: topMood,
          count: arr.length,
        };
      });
  }, [pool, grain, moodMod]);

  const totalChars = pool.reduce((n, x) => n + (x.chars || 0), 0);

  return (
    <>
      {embedded ? null : (
        <Topbar
          title="时间轴"
          sub={`${pool.length} 天 · ${totalChars.toLocaleString('zh-CN')} 字 · 已加载 ${items.length} 条`}
          right={
            <select className="inp" style={{ width: 132 }} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">全部年份</option>
              {years.map((y) => <option key={y} value={y}>{y} 年</option>)}
            </select>
          }
        />
      )}
      <div className={embedded ? 'tl-embedded' : 'wrap'}>
        <div className="card tl-tools">
          <div className="row">
            <span className="small muted">粒度</span>
            <div className="seg">
              {([['year', '按年'], ['month', '按月'], ['day', '按日']] as [Grain, string][]).map(([v, n]) => (
                <button key={v} className={`seg-b ${grain === v ? 'on' : ''}`} onClick={() => setGrain(v)}>{n}</button>
              ))}
            </div>
            <span className="small muted" style={{ marginLeft: 10 }}>方向</span>
            <div className="seg">
              {([['v', '纵向'], ['h', '横向']] as [Dir, string][]).map(([v, n]) => (
                <button key={v} className={`seg-b ${dir === v ? 'on' : ''}`} onClick={() => setDir(v)}>{n}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <span className="small muted">
              {grain === 'day' ? '每个点是一天' : grain === 'month' ? '每个点是一个月' : '每个点是一年'}
              {dir === 'h' ? ' · 可左右拖动' : ' · 点标题打开那一天'}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="card"><div className="empty">正在铺时间轴…</div></div>
        ) : nodes.length === 0 ? (
          <div className="card">
            <div className="empty">
              {items.length
                ? (year && hasMore
                  ? '这一年还没有加载到的日记，点下面「加载更早的」再往下翻。'
                  : '这一年还没有日记，换个年份看看。')
                : '还没有日记。写下第一篇之后，这里会按时间把它们串起来。'}
            </div>
          </div>
        ) : dir === 'v' ? (
          <div className="card tl-v">
            {nodes.map((n) => (
              <div className="tl-node" key={n.key}>
                <div className="tl-rail">
                  <span className="tl-dot" />
                  <div className="tl-axis">{n.axis}</div>
                  <div className="tl-axis-sub">{n.axisSub}</div>
                </div>
                <button className={`tl-card ${n.count ? 'agg' : ''}`} onClick={() => void setDate(n.date)} title={`打开 ${n.date}`}>
                  <div className="tl-t">{n.title}</div>
                  {n.excerpt ? <div className="tl-x">{n.excerpt}</div> : null}
                  <div className="tl-m">
                    <span>{n.chars.toLocaleString('zh-CN')} 字</span>
                    {n.count ? <span>· {n.count} 篇</span> : null}
                    {n.mood ? <span>· 心情 {n.mood}</span> : null}
                  </div>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="card tl-h-wrap">
            <div className="tl-h">
              {nodes.map((n) => (
                <div className="tl-hnode" key={n.key}>
                  <div className="tl-haxis">
                    <div className="tl-axis">{n.axis}</div>
                    <div className="tl-axis-sub">{n.axisSub}</div>
                  </div>
                  <div className="tl-hline"><span className="tl-dot" /></div>
                  <button className={`tl-card ${n.count ? 'agg' : ''}`} onClick={() => void setDate(n.date)} title={`打开 ${n.date}`}>
                    <div className="tl-t">{n.title}</div>
                    {n.excerpt ? <div className="tl-x">{n.excerpt}</div> : null}
                    <div className="tl-m">
                      <span>{n.chars.toLocaleString('zh-CN')} 字</span>
                      {n.count ? <span>· {n.count} 篇</span> : null}
                      {n.mood ? <span>· 心情 {n.mood}</span> : null}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && items.length ? (
          <div className="card tl-more">
            {hasMore ? (
              <button className="btn" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? '正在读…' : '加载更早的'}
              </button>
            ) : (
              <span className="small muted">没有更早的了</span>
            )}
            <span className="small muted" style={{ marginLeft: 'auto' }}>
              已加载 {items.length} 条{hasMore ? ' · 还有更早的' : ' · 全部'}
            </span>
          </div>
        ) : null}
      </div>

      <style>{`
        .tl-tools{padding:12px 16px}
        .tl-more{display:flex;align-items:center;gap:10px;padding:12px 16px}
        .tl-v{padding:16px 20px 6px}
        .tl-node{display:flex;gap:0;position:relative}
        .tl-rail{
          width:108px;flex:0 0 auto;position:relative;text-align:right;
          padding:7px 18px 0 0;
        }
        .tl-rail:before{
          content:"";position:absolute;right:6px;top:0;bottom:-14px;width:1px;background:var(--line);
        }
        .tl-node:first-child .tl-rail:before{top:13px}
        .tl-node:last-child .tl-rail:before{bottom:calc(100% - 13px)}
        .tl-dot{
          position:absolute;right:2.5px;top:12px;width:8px;height:8px;border-radius:50%;
          background:var(--accent);box-shadow:0 0 0 3px var(--panel);
        }
        .tl-axis{font-size:12.5px;color:var(--ink2);letter-spacing:.03em;line-height:1.4}
        .tl-axis-sub{font-size:11px;color:var(--ink3);margin-top:2px}
        .tl-card{
          flex:1;min-width:0;text-align:left;cursor:pointer;margin:0 0 12px 0;
          background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 13px;
          transition:.14s;font:inherit;color:inherit;
        }
        .tl-card:hover{border-color:var(--accent);background:var(--panel)}
        .tl-card.agg{background:transparent;border-style:dashed}
        .tl-t{font-size:13.5px;color:var(--ink);font-weight:600;line-height:1.45}
        .tl-x{
          font-size:12.5px;color:var(--ink2);margin-top:4px;line-height:1.6;
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
        }
        .tl-m{display:flex;gap:6px;font-size:11px;color:var(--ink3);margin-top:5px}
        .tl-h-wrap{padding:16px 8px 10px;overflow:hidden}
        .tl-h{display:flex;gap:14px;overflow-x:auto;padding:0 12px 8px;scrollbar-width:thin}
        .tl-hnode{flex:0 0 240px;display:flex;flex-direction:column;min-width:0}
        .tl-haxis{height:36px;padding-left:2px}
        .tl-hline{height:16px;position:relative;display:flex;align-items:center;margin-bottom:6px}
        .tl-hline:before{content:"";position:absolute;left:4px;right:-14px;height:1px;background:var(--line)}
        .tl-hline .tl-dot{position:static;box-shadow:0 0 0 3px var(--panel)}
        .tl-h .tl-card{margin:0;flex:0 0 auto}
        .tl-h .tl-x{-webkit-line-clamp:3}
      `}</style>
    </>
  );
}
