/**
 * 排序条（第 200 / 201 / 202 / 227 / 230 条）。
 *
 * 用户连着三条都在问同一件事：为什么这里能排、那里不能；为什么只能升不能降。
 * 答案很简单 —— 之前每个页面各写各的排序 UI，写一个漏一个。
 * 这里把它抽成一个组件 + 一个 hook，谁要排序就挂上去，行为和长相自动一致。
 *
 * 约定（和第 189 条多媒体库那套对齐，不再发明第二套）：
 *   - 维度是一排 chip，只表达「按什么排」，每个维度只有一个按钮
 *   - 升 / 降是**独立的一个开关**，不跟维度绑在一起 ——
 *     否则三个维度就要六个按钮，越加越长
 *   - 选择记进 settings，下次进来还是上次那样
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';

export type SortDir = 'asc' | 'desc';

export interface SortOption<V extends string = string> {
  /** 存进 settings 的值 */
  v: V;
  /** 按钮上的字 */
  n: string;
  /** 悬停提示（可选）：说清这一档到底怎么比 */
  tip?: string;
  /**
   * 这一档明不明白「升降」。像「手动」这种顺序是人拖出来的，
   * 翻个方向就没意义了，传 false 时方向开关会自动禁用。
   */
  dir?: boolean;
}

/**
 * 读 / 写排序偏好。
 *
 * key 用 settings 里的字段名（如 'noteSort'），dirKey 存方向。
 * 只做了两件事：从 settings 取个合法的值、改了就写回去。
 * 没有把排好序的数组也放这儿 —— 排序本身后端做（§2.6：能在 SQL 里算的不搬到前端）。
 */
export function useSortPref<V extends string>(opts: {
  options: SortOption<V>[];
  def: V;
  defDir?: SortDir;
  key: string;
  dirKey?: string;
}): { sort: V; dir: SortDir; setSort: (v: V) => void; setDir: (d: SortDir) => void; toggleDir: () => void } {
  const { options, def, defDir = 'desc', key, dirKey } = opts;
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);

  const valid = useMemo(() => new Set(options.map((o) => o.v)), [options]);

  const raw = String(settings?.[key] ?? '');
  const sort = (valid.has(raw as V) ? raw : def) as V;
  const rawDir = String(settings?.[dirKey || `${key}Dir`] ?? '');
  const dir: SortDir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : defDir;

  const setSort = useCallback((v: V) => { void setSetting(key, v); }, [key, setSetting]);
  const setDir = useCallback((d: SortDir) => {
    void setSetting(dirKey || `${key}Dir`, d);
  }, [dirKey, key, setSetting]);
  const toggleDir = useCallback(() => {
    setDir(dir === 'desc' ? 'asc' : 'desc');
  }, [dir, setDir]);

  return { sort, dir, setSort, setDir, toggleDir };
}

/**
 * 排序条本体。
 *
 * @param label   前面那行小字，默认「排序」
 * @param compact 紧凑模式：不要小标题、间距更小，塞进已有工具条里用
 */
export function SortBar<V extends string>({
  options, sort, dir, onSort, onDir, label = '排序',
  compact = false, right,
}: {
  options: SortOption<V>[];
  sort: V;
  dir: SortDir;
  onSort: (v: V) => void;
  onDir: (d: SortDir) => void;
  label?: string;
  compact?: boolean;
  /** 塞在右端的东西（视图切换之类），会靠右对齐 */
  right?: React.ReactNode;
}) {
  const cur = options.find((o) => o.v === sort);
  // 「手动」这类不认方向：按钮留着但按不动，免得用户点了半天没反应还以为是坏的
  const dirOk = cur ? cur.dir !== false : true;

  return (
    <div className="sortbar" data-compact={compact ? '1' : undefined}>
      {label ? <span className="sortbar-k">{label}</span> : null}
      <div className="sortbar-opts" role="group" aria-label={label || '排序'}>
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`chip ${sort === o.v ? 'on' : ''}`}
            data-sort={o.v}
            title={o.tip}
            aria-pressed={sort === o.v}
            onClick={() => onSort(o.v)}
          >{o.n}</button>
        ))}
      </div>
      <button
        type="button"
        className="chip sortbar-dir"
        data-act="sort-dir"
        data-dir={dir}
        data-off={dirOk ? undefined : '1'}
        disabled={!dirOk}
        title={dirOk
          ? (dir === 'desc' ? '现在是降序，点一下改升序' : '现在是升序，点一下改降序')
          : '这一档的顺序是固定的，没有升降之分'}
        aria-label={dir === 'desc' ? '切换为升序' : '切换为降序'}
        onClick={() => { if (dirOk) onDir(dir === 'desc' ? 'asc' : 'desc'); }}
      >
        <span className="sortbar-arrow" data-dir={dir}>{dir === 'desc' ? '↓' : '↑'}</span>
        {dir === 'desc' ? '降序' : '升序'}
      </button>
      {right ? <div className="sortbar-right">{right}</div> : null}
    </div>
  );
}

/* ---------------- 一个能直接挂到页面上的「排序 + 记住」组合 ---------------- */

/**
 * 用法：页面只关心 `sort` / `dir` 两个值，渲染交给 `bar`。
 *
 *   const s = useSortBar({ options: NOTE_SORTS, def: 'new', key: 'noteSort' });
 *   ...
 *   {s.bar(<span>3 篇</span>)}
 */
export function useSortBar<V extends string>(opts: {
  options: SortOption<V>[];
  def: V;
  defDir?: SortDir;
  key: string;
  dirKey?: string;
  label?: string;
  compact?: boolean;
}) {
  const { options, def, defDir, key, dirKey, label, compact } = opts;
  const pref = useSortPref({ options, def, defDir, key, dirKey });

  const bar = useCallback((right?: React.ReactNode) => (
    <SortBar
      options={options}
      sort={pref.sort}
      dir={pref.dir}
      onSort={pref.setSort}
      onDir={pref.setDir}
      label={label}
      compact={compact}
      right={right}
    />
  ), [options, pref.sort, pref.dir, pref.setSort, pref.setDir, label, compact]);

  return { ...pref, bar };
}

/* ---------------- 通用比较器（前端已经有数组、不想再问后端时用） ---------------- */

/** 按字符串比，认中文排序（拼音），空值一律垫底 —— 空值跑到顶上最烦人 */
export function cmpText(a: string, b: string): number {
  const x = (a || '').trim();
  const y = (b || '').trim();
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, 'zh-CN');
}

/** 按数字比，NaN / 空 也垫底 */
export function cmpNum(a: number, b: number): number {
  const x = Number.isFinite(a) ? a : Infinity;
  const y = Number.isFinite(b) ? b : Infinity;
  return x - y;
}

/**
 * 把一份比较结果按方向翻过来。
 *
 * 注意**不要**直接 `-cmp` —— 空值垫底那部分是特意排在后面的，
 * 翻个方向就变成「空的跑到最上面」，用户会以为坏了。
 * 所以这里只翻「真正有值可比」的那一段，空值永远垫底。
 *
 * @param empty 这一项是不是空值
 */
export function applyDir(cmp: number, dir: SortDir, empty = false): number {
  if (empty) return 1;
  return dir === 'desc' ? -cmp : cmp;
}

/* ---------------- 一次性的小工具：切换时给个轻提示 ---------------- */

/**
 * 排序切换后给一句人话，让用户确认「确实换了一种排法」。
 * 比 toast 轻，只是把维度名和方向拼起来。
 */
export function sortHint<V extends string>(
  options: SortOption<V>[], v: V, dir: SortDir, extra?: Record<V, string>,
): string {
  const o = options.find((x) => x.v === v);
  const n = extra?.[v] || o?.n || '';
  return o?.dir === false ? `按「${n}」排` : `按「${n}」${dir === 'desc' ? '倒着' : '顺着'}排`;
}

/* ---------------- 兜底：外部没给 settings 时用的内存版 ---------------- */

/**
 * 不落库的内存版排序偏好。给「临时列表」用 ——
 * 比如某个弹窗里的候选列表，没必要为它往 settings 里塞一个键。
 */
export function useLocalSort<V extends string>(def: V, defDir: SortDir = 'desc') {
  const [sort, setSort] = useState<V>(def);
  const [dir, setDir] = useState<SortDir>(defDir);
  useEffect(() => { setSort(def); }, [def]);
  return {
    sort, dir, setSort, setDir,
    toggleDir: () => setDir((d) => (d === 'desc' ? 'asc' : 'desc')),
  };
}