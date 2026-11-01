/**
 * 搜索历史（第 89 条）。
 *
 * 用户的原话是「保留历史，但也不是一直保留，智能；还有常用搜索」。
 * 所以这里不是简单记一个数组，而是每条都带「次数」和「最后使用时间」：
 * - 常用：按次数排（用得多的浮上来）
 * - 最近：按时间排（刚搜过的方便再点）
 * - 超上限时先淘汰「次数最少且最久没用」的那条，而不是粗暴地砍最早的
 *
 * 存在 settings.searchHistory 里（JSON 字符串），跟着设置一起落库，不额外建表。
 */
import { useStore } from '../store';

export interface HistoryItem {
  q: string;
  n: number;
  t: number;
}

const MAX = 24;
const MAX_SAME = 1;

function parse(raw: unknown): HistoryItem[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw) as HistoryItem[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.q === 'string' && x.q.trim())
      .map((x) => ({ q: x.q.trim(), n: Number(x.n) || 1, t: Number(x.t) || 0 }));
  } catch {
    return [];
  }
}

function save(list: HistoryItem[]) {
  const st = useStore.getState();
  void st.setSetting('searchHistory', JSON.stringify(list));
}

/** 记一次搜索。同一个词只累加次数，不重复占位。 */
export function recordSearch(q: string) {
  const key = q.trim();
  if (!key || key.length > 60) return;
  const st = useStore.getState();
  const list = parse(st.settings.searchHistory);
  const hit = list.find((x) => x.q === key);
  if (hit) {
    hit.n += 1;
    hit.t = Date.now();
  } else {
    list.push({ q: key, n: MAX_SAME, t: Date.now() });
  }
  // 淘汰：次数少的优先，其次最久没用
  list.sort((a, b) => (b.n - a.n) || (b.t - a.t));
  save(list.slice(0, MAX));
}

/** 热门：按次数，取前 n（次数相同按最近） */
export function topSearches(n = 5): HistoryItem[] {
  const list = parse(useStore.getState().settings.searchHistory);
  return list.slice().sort((a, b) => (b.n - a.n) || (b.t - a.t)).filter((x) => x.n >= 2).slice(0, n);
}

/** 最近：按时间，取前 n */
export function recentSearches(n = 6): HistoryItem[] {
  const list = parse(useStore.getState().settings.searchHistory);
  return list.slice().sort((a, b) => b.t - a.t).slice(0, n);
}

export function clearSearches() {
  save([]);
}

export function removeSearch(q: string) {
  const list = parse(useStore.getState().settings.searchHistory).filter((x) => x.q !== q);
  save(list);
}
