import { createContext, useContext, type ReactNode } from 'react';
import { PINYIN } from '../lib/pinyinData';

/* 设置页的三种基础控件。抽出来给 SettingsV8.tsx 复用，
   这样新加的分组也能吃到「搜索过滤」——搜索词通过 QCtx 往下传。 */

export const QCtx = createContext('');
export const useQ = () => useContext(QCtx);

/** 缓存：同一段文案在一次搜索里会被反复评估，翻成拼音不便宜 */
const pyCache = new Map<string, { full: string; initial: string }>();

/**
 * 把一段中文转成「连写拼音」和「首字母」，按非汉字的边界断开。
 *
 * 例：「导航宽度」→ full='daohangkuandu'，initial='dhkd'
 * 断开处理是为了跨词也能拼：搜「daohang」能命中「导航宽度」，
 * 中间夹的标点 / 数字 / 空格不至于把拼音串糊在一起。
 */
function toPinyin(text: string): { full: string; initial: string } {
  const hit = pyCache.get(text);
  if (hit) return hit;
  let full = '';
  let initial = '';
  for (const ch of text) {
    const py = PINYIN[ch];
    if (py) {
      full += py;
      // 首字母是**每个字各取一个**，不是整段取一个 ——
      // 之前写成一整段 flush 一次，结果「导航宽度」只贡献了一个 'd'，
      // 搜 dhkd 什么都搜不到
      initial += py[0];
      continue;
    }
    // 字母数字原样保留（搜「todo」「v8」这类也得能中），其余当分隔
    if (/[a-z0-9]/i.test(ch)) {
      full += ch.toLowerCase();
      initial += ch.toLowerCase();
    }
  }
  const r = { full, initial };
  pyCache.set(text, r);
  return r;
}

/**
 * 匹配分级（第 148 条重做）。
 *
 * 用户原话：「还要增加模糊查询，部分查询。自动显示在完全匹配的查询后面。
 * 拼音什么的也要可以查。」
 *
 * 所以返回 1–5 五档，数字越小越精确，0 表示不匹配：
 *   1  完全相等（搜「字号」正好是「字号」这一项）        ← 排最前
 *   2  开头就是它（搜「字号」命中「字号大小」）
 *   3  中间包含（部分查询，搜「宽度」命中「导航宽度」）
 *   4  拼音 / 首字母命中（搜 shezhi / sz 命中「设置」）
 *   5  按顺序的子序列（最松的一层，兜底不漏）
 *
 * 为什么 0 是「不匹配」而不是「最精确」：调用方四处都在用 `if (!fuzzy(...))` 判掉，
 * 一旦 0 变成「完全匹配」，那些地方会把最精确的结果全过滤掉。
 */
export function fuzzy(text: string, q: string): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!q) return 5;
  const raw = text.toLowerCase();
  const needle = q.replace(/\s+/g, '').toLowerCase();
  if (!needle) return 5;

  if (raw.trim() === needle) return 1;
  if (raw.startsWith(needle)) return 2;
  if (raw.includes(needle)) return 3;

  // 拼音层：全拼和首字母都试
  const { full, initial } = toPinyin(raw);
  // 「整串拼音相等」或「整串首字母相等」是最精确的拼音命中，和「中间包含」同一档
  if (full === needle || initial === needle) return 3;
  if (full.startsWith(needle)) return 3;
  if (full.includes(needle) || initial.includes(needle)) return 4;

  // 子序列兜底
  let i = 0;
  for (const ch of raw) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return 5;
  }
  return 0;
}

/** 把命中的字包成 <mark>，搜索时能一眼看到为什么这条被留下 */
export function hl(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button className={`switch ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} />;
}

/** 一行设置。搜索时按 标题+说明+关键词 过滤，命中才渲染 */
export function Row({
  label, sub, kw, children, stack,
}: {
  label: string; sub?: string; kw?: string; children: ReactNode; stack?: boolean;
}) {
  const q = useQ();
  let score = 0;
  if (q) {
    const hay = `${label} ${sub || ''} ${kw || ''}`;
    /*
     * 第 148 条：标题自己单独打一次分，取更精确的那个。
     * 混在一起打分的话，「字号」这一行会因为它长长的说明里也有「字号」而只算「包含」，
     * 跟「正文字号」「导航字号」落在同一档 —— 那就没法做到「完全匹配排在前面」了。
     */
    const byAll = fuzzy(hay, q);
    if (!byAll) return null;
    const byLabel = fuzzy(label, q);
    score = byLabel ? Math.min(byLabel, byAll) : byAll;
  }
  return (
    <div
      className={stack ? 'set-row stack' : 'set-row'}
      data-hit={q ? '1' : undefined}
      /* 第 148 条：命中档位既挂到 DOM 上给分组排序看，也用 CSS order 让
         「完全匹配」在同一个卡片里排到前面 —— 逐行重排 DOM 会跟 React 打架，
         CSS order 不动结构，只改视觉顺序。 */
      data-fs={q ? String(score) : undefined}
      style={q ? { order: score } : undefined}
    >
      <div className="lbl">
        {q ? hl(label, q) : label}
        {sub ? <small>{q ? hl(sub, q) : sub}</small> : null}
      </div>
      {children}
    </div>
  );
}

export function Chips<T extends string>({
  value, items, onPick,
}: {
  value: string; items: [T, string][]; onPick: (v: T) => void;
}) {
  return (
    <div className="row">
      {items.map(([v, n]) => (
        <button key={v} className={`chip ${value === v ? 'on' : ''}`} onClick={() => onPick(v)}>{n}</button>
      ))}
    </div>
  );
}
