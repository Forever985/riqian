import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar } from '../components/ui';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import { MOODS } from '../lib/const';
import type { EntryListItem } from '../types';

type Grain = 'year' | 'month' | 'day';
/**
 * 第 95 条：用户要求「四个方向，可以设置」。
 * 原来只有「纵向（从上往下）」和「横向（从左往右）」两种，本质是同一条轴的两个朝向；
 * 这里补上反向的两种 —— 时间从左往右 / 从右往左、从上往下 / 从下往上，
 * 一共四个方向。反向只是「轴的头部在哪一头」，数据本身照旧倒序读。
 */
type Dir = 'v' | 'vrev' | 'h' | 'hrev';

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
  /* 第 187 条：按月粒度下钻后要知道是哪个月，所以除了 year 还要留 month */
  const [month, setMonth] = useState('');

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

  /* 第 187 条：下钻之后实际显示的那一段（月粒度再筛一次月） */
  const shown = useMemo(
    () => (month ? pool.filter((it) => it.date.startsWith(month)) : pool),
    [pool, month],
  );

  /**
   * 第 187 条：粒度下钻。
   * 用户原话：「在粒度按年的时候点击某个年，会进入……」——
   * 意思是年节点不是终点，点进去应该看到这一年的月份，再点月份看到每一天。
   *   year  → 点一个年  → 切到「按月」，只留这一年
   *   month → 点一个月  → 切到「按日」，只留这个月
   *   day   → 点一天    → 打开那天的日记（原有行为）
   */
  const drill = (n: Node) => {
    if (grain === 'year') {
      setYear(n.key);
      setMonth('');
      setGrain('month');
      return;
    }
    if (grain === 'month') {
      setMonth(n.key);
      setGrain('day');
      return;
    }
    void setDate(n.date);
  };

  /*
   * 第 235 条：时间轴的右键菜单。
   *
   * 这一页没有"编辑/删除"按钮（节点是聚合出来的，不是数据库里的行），
   * 所以菜单的价值全在「换一种方式看同一段」：
   *   · 按年看的时候 → 下钻到这一年的每个月
   *   · 按月看的时候 → 下钻到这个月的每一天；也可以直接跳去记录页筛这个月
   *   · 按天看的时候 → 打开那天写；跳去记录页找同一天的条目
   * 这些原来都得靠猜（点卡片才会下钻，但卡片上没写会跳到哪），
   * 摆成文字菜单就一目了然了。
   */
  const ctx = useContextMenu();
  const openRecords = useStore((s) => s.openRecords);

  const menuFor = (n: Node): MenuItem[] => {
    if (grain === 'year') {
      return [
        { label: `看 ${n.key} 年的每个月`, hint: '下钻', onClick: () => drill(n) },
      ];
    }
    if (grain === 'month') {
      return [
        { label: `看 ${n.key} 的每一天`, hint: '下钻', onClick: () => drill(n) },
        { sep: true },
        { label: '在记录里筛这个月', onClick: () => openRecords({ q: n.key }) },
      ];
    }
    return [
      { label: `打开 ${n.date}`, onClick: () => drill(n) },
      { label: '在记录里找这一天', onClick: () => openRecords({ q: n.date }) },
      { sep: true },
      { label: '复制日期', onClick: () => { void navigator.clipboard?.writeText(n.date).then(() => {}, () => {}); } },
    ];
  };

  const nodes = useMemo<Node[]>(() => {
    const moodOf = (it: EntryListItem) => {
      if (!moodMod) return '';
      const v = Number(it.values?.[moodMod.id]);
      return v ? (MOODS.find((x) => x.v === v)?.t || '') : '';
    };

    if (grain === 'day') {
      return shown.map((it) => {
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
    for (const it of shown) {
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
  }, [shown, grain, moodMod]);

  const totalChars = shown.reduce((n, x) => n + (x.chars || 0), 0);

  return (
    <>
      {embedded ? null : (
        <Topbar
          title="时间轴"
          sub={`${shown.length} 天 · ${totalChars.toLocaleString('zh-CN')} 字 · 已加载 ${items.length} 条`}
          right={
            <select
              className="inp" style={{ width: 132 }} value={year}
              onChange={(e) => { setYear(e.target.value); setMonth(''); }}
            >
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
                <button
                  key={v} className={`seg-b ${grain === v ? 'on' : ''}`}
                  onClick={() => { setGrain(v); if (v === 'year') { setYear(''); setMonth(''); } if (v === 'month') setMonth(''); }}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="small muted" style={{ marginLeft: 10 }}>方向</span>
            <div className="seg">
              {/* 第 95 条：四个方向 —— 纵向 / 纵向反向 / 横向 / 横向反向 */}
              {([['v', '纵向'], ['vrev', '纵向往上'], ['h', '横向'], ['hrev', '横向倒着']] as [Dir, string][]).map(([v, n]) => (
                <button key={v} className={`seg-b ${dir === v ? 'on' : ''}`} onClick={() => setDir(v)}>{n}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <span className="small muted">
              {grain === 'day' ? '每个点是一天' : grain === 'month' ? '每个点是一个月' : '每个点是一年'}
              {grain === 'day' ? ' · 点标题打开那一天' : ' · 点节点往下钻一级'}
            </span>
          </div>
          {/* 第 187 条：下钻之后给一条回退路径，否则进到月里就出不来 */}
          {(year || month) ? (
            <div className="row tl-crumb">
              <span className="small muted">正在看</span>
              <button className="tl-crumb-b" onClick={() => { setYear(''); setMonth(''); setGrain('year'); }}>全部年份</button>
              {year ? (
                <>
                  <span className="small muted">›</span>
                  <button
                    className="tl-crumb-b"
                    onClick={() => { setMonth(''); setGrain('month'); }}
                  >
                    {year} 年
                  </button>
                </>
              ) : null}
              {month ? (
                <>
                  <span className="small muted">›</span>
                  <span className="tl-crumb-cur">{Number(month.slice(5, 7))} 月</span>
                </>
              ) : null}
              <div style={{ flex: 1 }} />
              <button className="btn small" onClick={() => { setYear(''); setMonth(''); setGrain('year'); }}>返回年视图</button>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="card"><div className="empty">正在铺时间轴…</div></div>
        ) : nodes.length === 0 ? (
          <div className="card">
            <div className="empty">
              {items.length
                ? (month
                  ? '这个月还没有日记，回到年视图换个时间吧。'
                  : year && hasMore
                    ? '这一年还没有加载到的日记，点下面「加载更早的」再往下翻。'
                    : '这一年还没有日记，换个年份看看。')
                : '还没有日记。写下第一篇之后，这里会按时间把它们串起来。'}
            </div>
          </div>
        ) : dir === 'v' || dir === 'vrev' ? (
          /* 第 95 条：纵向 / 纵向往上。vrev 只是把节点顺序反过来，轴还是那条竖线 */
          <div className={`card tl-v ${dir === 'vrev' ? 'rev' : ''}`}>
            {(dir === 'vrev' ? nodes.slice().reverse() : nodes).map((n) => (
              <div className="tl-node" key={n.key} onContextMenu={(e) => ctx.open(e, menuFor(n))}>
                <div className="tl-rail">
                  <span className="tl-dot" />
                  <div className="tl-axis">{n.axis}</div>
                  <div className="tl-axis-sub">{n.axisSub}</div>
                </div>
                <button
                  className={`tl-card ${n.count ? 'agg' : ''}`}
                  onClick={() => drill(n)}
                  title={grain === 'day' ? `打开 ${n.date}` : `看 ${grain === 'year' ? '这一年的每个月' : '这个月的每一天'}`}
                >
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
          /* 第 95 条：横向 / 横向倒着（从右往左读，符合「时间往前推」的直觉） */
          <div className="card tl-h-wrap">
            <div className={`tl-h ${dir === 'hrev' ? 'rev' : ''}`}>
              {(dir === 'hrev' ? nodes.slice().reverse() : nodes).map((n) => (
                <div className="tl-hnode" key={n.key} onContextMenu={(e) => ctx.open(e, menuFor(n))}>
                  <div className="tl-haxis">
                    <div className="tl-axis">{n.axis}</div>
                    <div className="tl-axis-sub">{n.axisSub}</div>
                  </div>
                  <div className="tl-hline"><span className="tl-dot" /></div>
                  <button
                    className={`tl-card ${n.count ? 'agg' : ''}`}
                    onClick={() => drill(n)}
                    title={grain === 'day' ? `打开 ${n.date}` : `看 ${grain === 'year' ? '这一年的每个月' : '这个月的每一天'}`}
                  >
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

      {ctx.node}

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
        /* 第 95 条：反向的两种方向。
           纵向反向 = 最新的在最下面（往上读就是往前翻），
           横向反向 = 最新的在最右边（滚到右头才是刚开始写的时候）。
           这里只翻转内容的排列顺序，不改滚动容器的方向 —— dir="rtl" 在很多地方会连带
           翻转滚动条和 padding，字形也会受影响，不如直接 reverse 数组来得干净。 */
        .tl-v.rev .tl-rail:before{top:0;bottom:-14px}
        .tl-v.rev .tl-node:first-child .tl-rail:before{top:0}
        .tl-v.rev .tl-node:last-child .tl-rail:before{bottom:calc(100% - 13px)}
        .tl-h.rev{flex-direction:row-reverse}
        .tl-h.rev .tl-hline:before{left:-14px;right:4px}
        /* 第 187 条：下钻面包屑 */
        .tl-crumb{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line2)}
        .tl-crumb-b{
          border:0;background:transparent;cursor:pointer;font:inherit;
          font-size:12px;color:var(--accent);padding:1px 2px;border-radius:4px;
        }
        .tl-crumb-b:hover{background:color-mix(in srgb,var(--accent) 12%,transparent)}
        .tl-crumb-cur{font-size:12px;color:var(--ink2);font-weight:600}
      `}</style>
    </>
  );
}
