/**
 * 记账本图表组件（第 205 条）。
 *
 * 全部手写 SVG，不引第三方图表库 —— 原因有三：
 *   1. 应用要打成单文件离线运行，多引一个库就多几百 KB；
 *   2. 各主题的色板是 CSS 变量，第三方库拿不到 `var(--accent)` 这类值去算插值；
 *   3. 用户要的「花里胡哨」本质是**密度**和**信息层次**，不是动画库。
 *
 * 八张图各自回答一个问题：
 *   Donut      钱主要花在哪几类（看结构）
 *   CatBars    分类横向条形，带笔数（看结构 + 频次）
 *   Trend      近 12 个月收支双柱 + 结余折线（看走势）
 *   DailyBars  当月每天支出柱（看波动）
 *   WeekBars   当月按周（4~6 根，比 30 根好读）
 *   WeekdayRadar 星期几花得多（找规律）
 *   Heatmap    近 24 周热力图（找长期习惯）
 *   TopList    金额最大的几笔（找异常）
 *   Balance    各账户余额占比（看资产分布）
 */

import { useMemo, useState } from 'react';
import type { LedgerInsight } from '../types';

const money = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 图表配色：全部从主题变量取，深浅主题自动适配 */
const PALETTE = [
  'var(--accent)', 'var(--blue)', 'var(--ok)', 'var(--warn)',
  'var(--bad)', '#8a6aa8', '#4f8a86', '#a55a72', '#96794f', '#5f7fa8',
];

/** 数字压缩：12345 → 1.2万，避免轴上挤成一团 */
function shortNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (a >= 1e4) return `${(n / 1e4).toFixed(a >= 1e6 ? 0 : 1)}万`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/* ================================================================== */
/* 1. 环图：支出构成                                                   */
/* ================================================================== */

export function Donut({
  items, total, sym, size = 190,
}: {
  items: { cat: string; sum: number; n: number }[];
  total: number; sym: string; size?: number;
}) {
  const [hover, setHover] = useState<number>(-1);
  const r = size / 2;
  const thick = size * 0.155;
  const rr = r - thick / 2 - 2;

  const arcs = useMemo(() => {
    if (!total) return [];
    const out: { d: string; color: string; idx: number; pct: number }[] = [];
    let acc = -Math.PI / 2;                    // 从 12 点方向开始
    items.forEach((it, i) => {
      const pct = it.sum / total;
      const a0 = acc;
      const a1 = acc + pct * Math.PI * 2;
      acc = a1;
      // 单独一段占满 100% 时画不出弧（起点终点重合），退化成整圆
      if (pct >= 0.9999) {
        out.push({
          d: `M ${r} ${r - rr} A ${rr} ${rr} 0 1 1 ${r - 0.01} ${r - rr}`,
          color: PALETTE[i % PALETTE.length], idx: i, pct,
        });
        return;
      }
      const x0 = r + rr * Math.cos(a0);
      const y0 = r + rr * Math.sin(a0);
      const x1 = r + rr * Math.cos(a1);
      const y1 = r + rr * Math.sin(a1);
      const large = pct > 0.5 ? 1 : 0;
      out.push({
        d: `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rr} ${rr} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
        color: PALETTE[i % PALETTE.length], idx: i, pct,
      });
    });
    return out;
  }, [items, total, r, rr]);

  const cur = hover >= 0 ? items[hover] : null;

  return (
    <div className="lg-chart-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="支出构成环图">
        {/* 底环：没数据时也有个形，不至于空得突兀 */}
        <circle cx={r} cy={r} r={rr} fill="none" stroke="var(--line2)" strokeWidth={thick} />
        {arcs.map((a) => (
          <path
            key={a.idx}
            d={a.d}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === a.idx ? thick + 5 : thick}
            strokeLinecap="butt"
            style={{ transition: 'stroke-width .14s', cursor: 'pointer' }}
            onMouseEnter={() => setHover(a.idx)}
            onMouseLeave={() => setHover(-1)}
          >
            <title>{`${items[a.idx].cat} ${sym}${money(items[a.idx].sum)} · ${(a.pct * 100).toFixed(1)}%`}</title>
          </path>
        ))}
        {/* 中心读数：hover 时切到那一类，否则显示总额 */}
        <text x={r} y={r - 4} textAnchor="middle" className="lgc-c1" fill="var(--ink3)">
          {cur ? cur.cat : '支出合计'}
        </text>
        <text x={r} y={r + 18} textAnchor="middle" className="lgc-c2" fill={cur ? 'var(--accent)' : 'var(--ink)'}>
          {sym}{shortNum(cur ? cur.sum : total)}
        </text>
        {cur ? (
          <text x={r} y={r + 34} textAnchor="middle" className="lgc-c3" fill="var(--ink3)">
            {((cur.sum / total) * 100).toFixed(1)}% · {cur.n} 笔
          </text>
        ) : null}
      </svg>
      <div className="lgc-legend">
        {items.slice(0, 10).map((it, i) => (
          <div
            key={it.cat}
            className={`lgc-leg ${hover === i ? 'on' : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(-1)}
          >
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="n">{it.cat}</span>
            <span className="p">{total ? ((it.sum / total) * 100).toFixed(1) : '0.0'}%</span>
            <span className="v">{sym}{money(it.sum)}</span>
          </div>
        ))}
        {items.length > 10 ? <div className="lgc-leg more">还有 {items.length - 10} 个分类…</div> : null}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 2. 分类条形（带笔数 + 均笔）                                         */
/* ================================================================== */

export function CatBars({ items, total, sym }: { items: { cat: string; sum: number; n: number }[]; total: number; sym: string }) {
  if (!items.length) return <div className="empty small">这个月还没有支出。</div>;
  const max = Math.max(...items.map((x) => x.sum), 1);
  return (
    <div className="lgc-bars">
      {items.map((it, i) => {
        const w = (it.sum / max) * 100;
        const pct = total ? (it.sum / total) * 100 : 0;
        const avg = it.n ? it.sum / it.n : 0;
        return (
          <div className="lgc-bar" key={it.cat}>
            <div className="lgc-bar-h">
              <i style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="n">{it.cat}</span>
              <span className="sub">{it.n} 笔 · 均 {sym}{shortNum(avg)}</span>
              <span className="v">{sym}{money(it.sum)}</span>
              <span className="p">{pct.toFixed(1)}%</span>
            </div>
            <div className="lgc-bar-t">
              <i style={{ width: `${Math.max(w, 1.5)}%`, background: PALETTE[i % PALETTE.length] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/* 3. 近 12 月趋势：收支双柱 + 结余折线                                 */
/* ================================================================== */

export function Trend({
  months, sym, active, onPick, h = 190,
}: {
  months: { ym: string; label: string; outSum: number; inSum: number; balance: number }[];
  sym: string; active: string; onPick?: (ym: string) => void; h?: number;
}) {
  const W = 660;
  const padL = 42;
  const padR = 42;
  const padB = 26;
  const padT = 12;
  const innerW = W - padL - padR;
  const innerH = h - padT - padB;
  if (!months.length) return <div className="empty small">还没有足够的月份数据。</div>;

  const maxV = Math.max(...months.map((m) => Math.max(m.outSum, m.inSum)), 1);
  const minB = Math.min(...months.map((m) => m.balance), 0);
  const maxB = Math.max(...months.map((m) => m.balance), 1);
  const bRange = maxB - minB || 1;

  const slot = innerW / months.length;
  const bw = Math.min(15, slot * 0.30);
  const x = (i: number) => padL + slot * i + slot / 2;
  const yV = (v: number) => padT + innerH - (v / maxV) * innerH;
  const yB = (v: number) => padT + innerH - ((v - minB) / bRange) * innerH;

  const line = months.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yB(m.balance).toFixed(1)}`).join(' ');
  // 结余的 0 轴：正负都在一张图上，得画出来才知道哪个月亏了
  const zeroY = minB < 0 ? yB(0) : null;

  return (
    <div className="lgc-trend">
      <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label="近一年收支趋势">
        {/* 横向网格：4 档 */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH - innerH * t;
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line2)" strokeWidth={1} />
              <text x={padL - 6} y={y + 3.5} textAnchor="end" className="lgc-axis" fill="var(--ink3)">
                {shortNum(maxV * t)}
              </text>
            </g>
          );
        })}
        {zeroY != null ? (
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--ink3)" strokeWidth={1} strokeDasharray="3 3" />
        ) : null}

        {months.map((m, i) => {
          const isOn = m.ym === active;
          return (
            <g key={m.ym} onClick={() => onPick?.(m.ym)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
              {/* hover / 选中的整列底 */}
              <rect
                x={padL + slot * i} y={padT} width={slot} height={innerH}
                fill={isOn ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent'}
              />
              <rect x={x(i) - bw - 1.5} y={yV(m.inSum)} width={bw} height={Math.max(innerH + padT - yV(m.inSum), 0)} fill="var(--ok)" opacity={0.85} rx={2}>
                <title>{`${m.label} 收入 ${sym}${money(m.inSum)}`}</title>
              </rect>
              <rect x={x(i) + 1.5} y={yV(m.outSum)} width={bw} height={Math.max(innerH + padT - yV(m.outSum), 0)} fill="var(--bad)" opacity={0.85} rx={2}>
                <title>{`${m.label} 支出 ${sym}${money(m.outSum)}`}</title>
              </rect>
              <text x={x(i)} y={h - 8} textAnchor="middle" className="lgc-axis" fill={isOn ? 'var(--accent)' : 'var(--ink3)'}>
                {m.label}
              </text>
            </g>
          );
        })}
        <path d={line} fill="none" stroke="var(--blue)" strokeWidth={1.8} strokeLinejoin="round" />
        {months.map((m, i) => (
          <circle key={m.ym} cx={x(i)} cy={yB(m.balance)} r={2.6} fill="var(--panel)" stroke="var(--blue)" strokeWidth={1.6}>
            <title>{`${m.label} 结余 ${sym}${money(m.balance)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="lgc-hint">
        <span><i style={{ background: 'var(--ok)' }} />收入</span>
        <span><i style={{ background: 'var(--bad)' }} />支出</span>
        <span><i className="ln" />结余</span>
        <span className="muted">点一根柱子可以跳到那个月</span>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 4/5. 柱状：按天 / 按周                                              */
/* ================================================================== */

export function Bars({
  data, sym, h = 150, label = '支出',
}: {
  data: { key: string; label: string; value: number; tip?: string }[];
  sym: string; h?: number; label?: string;
}) {
  const [hover, setHover] = useState(-1);
  if (!data.length) return <div className="empty small">这个区间还没有{label}。</div>;
  const W = 660;
  const padL = 38;
  const padR = 8;
  const padB = 22;
  const padT = 10;
  const innerW = W - padL - padR;
  const innerH = h - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = innerW / data.length;
  const bw = Math.max(2, Math.min(26, slot * 0.68));
  // 标签太多就隔几个画一个，避免叠成一坨
  const step = Math.ceil(data.length / 14);

  return (
    <div className="lgc-bars2">
      <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label={`按${label}柱状图`}>
        {[0, 0.5, 1].map((t) => {
          const y = padT + innerH - innerH * t;
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--line2)" strokeWidth={1} />
              <text x={padL - 5} y={y + 3.5} textAnchor="end" className="lgc-axis" fill="var(--ink3)">{shortNum(max * t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const bh = (d.value / max) * innerH;
          const x = padL + slot * i + (slot - bw) / 2;
          const on = hover === i;
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
              {/* 整列热区，比细柱子好点 */}
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" />
              <rect
                x={x} y={padT + innerH - bh} width={bw} height={Math.max(bh, d.value > 0 ? 1.5 : 0)}
                fill={on ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 62%, var(--panel))'}
                rx={Math.min(3, bw / 2)}
                style={{ transition: 'fill .12s' }}
              >
                <title>{`${d.tip || d.label}：${sym}${money(d.value)}`}</title>
              </rect>
              {i % step === 0 || on ? (
                <text x={padL + slot * i + slot / 2} y={h - 6} textAnchor="middle" className="lgc-axis" fill={on ? 'var(--accent)' : 'var(--ink3)'}>
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover >= 0 ? (
        <div className="lgc-tip">
          <b>{data[hover].tip || data[hover].label}</b>
          <span>{sym}{money(data[hover].value)}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ================================================================== */
/* 6. 星期几雷达（找规律：周末是不是花得多）                            */
/* ================================================================== */

const WD_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

export function WeekdayRadar({ data, sym, size = 200 }: { data: { dow: number; sum: number }[]; sym: string; size?: number }) {
  const [hover, setHover] = useState(-1);
  const r = size / 2;
  const rr = r - 24;
  const max = Math.max(...data.map((d) => d.sum), 1);
  const total = data.reduce((n, d) => n + d.sum, 0);

  const pt = (i: number, ratio: number) => {
    const a = -Math.PI / 2 + (i / 7) * Math.PI * 2;
    return [r + rr * ratio * Math.cos(a), r + rr * ratio * Math.sin(a)] as const;
  };
  const poly = data.map((d, i) => pt(i, Math.max(d.sum / max, 0.03)).map((v) => v.toFixed(1)).join(',')).join(' ');

  if (!total) return <div className="empty small">这个月没有支出，雷达图是空的。</div>;

  return (
    <div className="lgc-radar">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="按星期分布">
        {/* 三层网格环 */}
        {[0.33, 0.66, 1].map((g) => (
          <polygon
            key={g}
            points={data.map((_, i) => pt(i, g).map((v) => v.toFixed(1)).join(',')).join(' ')}
            fill="none" stroke="var(--line2)" strokeWidth={1}
          />
        ))}
        {data.map((d, i) => {
          const [x, y] = pt(i, 1);
          return <line key={d.dow} x1={r} y1={r} x2={x} y2={y} stroke="var(--line2)" strokeWidth={1} />;
        })}
        <polygon
          points={poly}
          fill="color-mix(in srgb, var(--accent) 26%, transparent)"
          stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round"
        />
        {data.map((d, i) => {
          const [x, y] = pt(i, Math.max(d.sum / max, 0.03));
          return (
            <circle
              key={d.dow} cx={x} cy={y} r={hover === i ? 4.4 : 3}
              fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.8}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}
              style={{ cursor: 'pointer' }}
            >
              <title>{`星期${WD_LABEL[d.dow]} ${sym}${money(d.sum)}`}</title>
            </circle>
          );
        })}
        {data.map((d, i) => {
          const [x, y] = pt(i, 1.18);
          return (
            <text key={d.dow} x={x} y={y + 4} textAnchor="middle" className="lgc-axis" fill={hover === i ? 'var(--accent)' : 'var(--ink3)'}>
              {WD_LABEL[d.dow]}
            </text>
          );
        })}
      </svg>
      <div className="lgc-radar-side">
        {[...data].sort((a, b) => b.sum - a.sum).slice(0, 3).map((d) => (
          <div key={d.dow} className="lgc-radar-row">
            <span className="k">周{WD_LABEL[d.dow]}</span>
            <b>{sym}{money(d.sum)}</b>
            <span className="p">{total ? ((d.sum / total) * 100).toFixed(1) : 0}%</span>
          </div>
        ))}
        <div className="small muted" style={{ marginTop: 6 }}>
          花得最多的三天排在上面，占比高的往往是周末。
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 7. 热力图：近 24 周                                                  */
/* ================================================================== */

export function Heatmap({
  cells, sym, from, to,
}: {
  cells: { date: string; w: number; d: number; sum: number }[];
  sym: string; from: string; to: string;
}) {
  const [hover, setHover] = useState<{ date: string; sum: number } | null>(null);
  const max = Math.max(...cells.map((c) => c.sum), 1);
  const level = (v: number) => {
    if (v <= 0) return 0;
    const t = v / max;
    if (t < 0.2) return 1;
    if (t < 0.45) return 2;
    if (t < 0.75) return 3;
    return 4;
  };
  const CW = 13;
  const GAP = 3;
  const weeks = 24;
  const w = weeks * (CW + GAP) + 22;
  const h = 7 * (CW + GAP) + 18;

  return (
    <div className="lgc-heat">
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="支出热力图">
        {[1, 3, 5].map((d) => (
          <text key={d} x={0} y={16 + d * (CW + GAP) + CW - 3} className="lgc-axis" fill="var(--ink3)">
            {WD_LABEL[d]}
          </text>
        ))}
        {cells.map((c) => (
          <rect
            key={c.date}
            x={18 + c.w * (CW + GAP)}
            y={4 + c.d * (CW + GAP)}
            width={CW} height={CW} rx={2.5}
            className={`lgc-cell lv${level(c.sum)}`}
            onMouseEnter={() => setHover({ date: c.date, sum: c.sum })}
            onMouseLeave={() => setHover(null)}
          >
            <title>{`${c.date} ${c.sum > 0 ? `${sym}${money(c.sum)}` : '没花钱'}`}</title>
          </rect>
        ))}
      </svg>
      <div className="lgc-heat-foot">
        <span className="small muted">{from} → {to}</span>
        <span className="lgc-legend-scale">
          少
          {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`lgc-cell lv${l}`} />)}
          多
        </span>
        <span className="small" style={{ marginLeft: 'auto' }}>
          {hover ? `${hover.date} · ${hover.sum > 0 ? `${sym}${money(hover.sum)}` : '没花钱'}` : '把鼠标放到格子上看具体金额'}
        </span>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 8. 金额最大的几笔                                                    */
/* ================================================================== */

export function TopList({
  items, sym, onEdit,
}: {
  items: { id: string; date: string; amount: number; cat: string; note: string }[];
  sym: string; onEdit?: (id: string) => void;
}) {
  if (!items.length) return <div className="empty small">这个月还没有支出。</div>;
  const max = Math.max(...items.map((x) => x.amount), 1);
  return (
    <div className="lgc-top">
      {items.map((it, i) => (
        <div
          className="lgc-top-row" key={it.id}
          onClick={() => onEdit?.(it.id)}
          style={{ cursor: onEdit ? 'pointer' : 'default' }}
        >
          <span className="rk">{i + 1}</span>
          <span className="lgc-top-bar"><i style={{ width: `${(it.amount / max) * 100}%` }} /></span>
          <span className="n">{it.cat}{it.note ? ` · ${it.note}` : ''}</span>
          <span className="d">{it.date.slice(5)}</span>
          <span className="v">{sym}{money(it.amount)}</span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* 9. 账户余额占比                                                      */
/* ================================================================== */

export function BalanceSplit({
  accounts, sym,
}: {
  accounts: { id: string; name: string; balance: number }[];
  sym: string;
}) {
  const positive = accounts.filter((a) => a.balance > 0);
  const total = positive.reduce((n, a) => n + a.balance, 0);
  if (!accounts.length) return <div className="empty small">还没设账户。在账户管理里加一个，这里就能看到资产怎么分布。</div>;
  return (
    <div className="lgc-split">
      <div className="lgc-split-track">
        {total > 0 ? positive.map((a, i) => (
          <i
            key={a.id}
            style={{ width: `${(a.balance / total) * 100}%`, background: PALETTE[i % PALETTE.length] }}
            title={`${a.name} ${sym}${money(a.balance)} · ${((a.balance / total) * 100).toFixed(1)}%`}
          />
        )) : <i style={{ width: '100%', background: 'var(--line2)' }} />}
      </div>
      <div className="lgc-split-legend">
        {accounts.map((a, i) => (
          <div key={a.id} className={`lgc-leg ${a.balance <= 0 ? 'neg' : ''}`}>
            <i style={{ background: a.balance > 0 ? PALETTE[positive.findIndex((p) => p.id === a.id) % PALETTE.length] : 'var(--ink3)' }} />
            <span className="n">{a.name}</span>
            <span className="v">{sym}{money(a.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 10. 每日收支对比（收入 vs 支出，双色堆叠条）                         */
/* ================================================================== */

export function DailyCompare({
  days, sym, h = 150,
}: {
  days: { date: string; day: number; outSum: number; inSum: number; n: number }[];
  sym: string; h?: number;
}) {
  const [hover, setHover] = useState(-1);
  if (!days.length) return <div className="empty small">这个月还没有流水。</div>;
  const W = 660;
  const padL = 38;
  const padB = 22;
  const padT = 10;
  const innerW = W - padL - 8;
  const innerH = h - padT - padB;
  const max = Math.max(...days.map((d) => Math.max(d.outSum, d.inSum)), 1);
  const slot = innerW / days.length;
  const bw = Math.max(2, Math.min(16, slot * 0.66));
  const step = Math.ceil(days.length / 14);

  return (
    <div className="lgc-bars2">
      <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label="每日收支对比">
        {[0, 0.5, 1].map((t) => {
          const y = padT + innerH - innerH * t;
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - 8} y2={y} stroke="var(--line2)" strokeWidth={1} />
              <text x={padL - 5} y={y + 3.5} textAnchor="end" className="lgc-axis" fill="var(--ink3)">{shortNum(max * t)}</text>
            </g>
          );
        })}
        {days.map((d, i) => {
          const ho = (d.outSum / max) * innerH;
          const hi = (d.inSum / max) * innerH;
          const x = padL + slot * i + (slot - bw) / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" />
              {hi > 0 ? <rect x={x} y={padT + innerH - hi} width={bw} height={hi} fill="var(--ok)" opacity={0.9} rx={2} /> : null}
              {ho > 0 ? <rect x={x} y={padT + innerH - ho} width={bw} height={ho} fill="var(--bad)" opacity={0.9} rx={2} /> : null}
              {i % step === 0 || hover === i ? (
                <text x={padL + slot * i + slot / 2} y={h - 6} textAnchor="middle" className="lgc-axis" fill={hover === i ? 'var(--accent)' : 'var(--ink3)'}>
                  {d.day}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover >= 0 ? (
        <div className="lgc-tip">
          <b>{days[hover].date}</b>
          <span className="out">支出 {sym}{money(days[hover].outSum)}</span>
          <span className="in">收入 {sym}{money(days[hover].inSum)}</span>
          <span className="muted">{days[hover].n} 笔</span>
        </div>
      ) : null}
    </div>
  );
}
/* ================================================================== */
/* 第 239 条：再补四张，把「专业记账软件」该有的都补上                  */
/* ================================================================== */

/**
 * 10. 金额分档（小钱 / 中钱 / 大钱 / 巨款）
 *
 * 回答的问题：「我这个月是不是被几笔大额干掉了？」
 * 和分类图互补 —— 分类看"花在哪"，分档看"怎么花"。
 * 分界线由后端按当月分位数算，不是写死的绝对值。
 */
export function AmountBuckets({
  data, sym, total,
}: {
  data: { name: string; sum: number; n: number; upTo: number }[];
  sym: string;
  total: number;
}) {
  if (!data.length || data.every((x) => x.n === 0))
    return <div className="empty small">这个月还没有支出。</div>;

  const max = Math.max(...data.map((x) => x.sum), 1);
  return (
    <div className="lgc-buckets">
      {data.map((b, i) => {
        const pct = total > 0 ? (b.sum / total) * 100 : 0;
        return (
          <div className="lgc-bk" key={b.name}>
            <div className="lgc-bk-head">
              <span className="nm">{b.name}</span>
              <span className="up muted">{i === 0 ? `≤ ${money(b.upTo)}` : i === 3 ? `> ${money(data[2].upTo)}` : `≤ ${money(b.upTo)}`}</span>
              <span className="pct">{pct.toFixed(1)}%</span>
            </div>
            <div className="lgc-bk-track">
              <i
                style={{
                  width: `${(b.sum / max) * 100}%`,
                  background: PALETTE[i % PALETTE.length],
                }}
              />
            </div>
            <div className="lgc-bk-foot">
              <span>{sym}{money(b.sum)}</span>
              <span className="muted">{b.n} 笔</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 11. 分类环比涨跌
 *
 * 回答的问题：「哪一类在悄悄变贵？」
 * 同比 / 环比是记账软件最有价值的一栏 —— 单看这个月 800 块餐饮没感觉，
 * 看到「比上月 +47%」才知道出事了。
 */
export function CatTrend({
  data, sym,
}: {
  data: { cat: string; now: number; prev: number; delta: number; pct: number | null; isNew: boolean }[];
  sym: string;
}) {
  if (!data.length) return <div className="empty small">这个月还没有支出。</div>;

  // 按涨跌幅度排序，涨得最凶的排最前 —— 用户最先想看的是"哪儿超了"
  const rows = [...data].sort((a, b) => {
    const av = a.pct === null ? (a.isNew ? 9999 : -9999) : a.pct;
    const bv = b.pct === null ? (b.isNew ? 9999 : -9999) : b.pct;
    return bv - av;
  });
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pct ?? 0)), 1);

  return (
    <div className="lgc-trendlist">
      {rows.map((r) => {
        const up = (r.pct ?? 0) > 0;
        const barW = r.isNew ? 100 : Math.min(100, (Math.abs(r.pct ?? 0) / maxAbs) * 100);
        return (
          <div className="lgc-tl-row" key={r.cat}>
            <span className="nm">{r.cat}</span>
            <span className="now">{sym}{money(r.now)}</span>
            <span className="bar">
              <i
                className={up ? 'up' : 'down'}
                style={{ width: `${barW}%` }}
              />
            </span>
            <span className={`d ${up ? 'up' : r.isNew ? 'new' : 'down'}`}>
              {r.isNew ? '新增' : r.pct === null ? '—' : `${up ? '+' : ''}${r.pct}%`}
            </span>
            <span className="prev muted">上月 {sym}{money(r.prev)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 12. 支出堆叠柱（近 12 个月 × 分类）
 *
 * 回答的问题：「餐饮是每个月都这么多，还是只有这个月？」
 * 单月饼图看不出趋势，这张能看出结构在怎么漂移。
 */
export function StackedMonths({
  data, topCats, sym,
}: {
  data: { ym: string; label: string; total: number; parts: { cat: string; sum: number }[] }[];
  topCats: string[];
  sym: string;
}) {
  const [hover, setHover] = useState(-1);
  if (!data.length) return <div className="empty small">还没有数据。</div>;

  const W = 620, H = 200, padL = 34, padB = 26, padT = 10;
  const innerW = W - padL - 10;
  const innerH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.total), 1);
  const bw = Math.min(34, (innerW / data.length) * 0.62);
  const gap = innerW / data.length;
  const colorOf = (cat: string) => {
    const i = topCats.indexOf(cat);
    return i >= 0 ? PALETTE[i % PALETTE.length] : 'var(--ink3)';
  };

  return (
    <div className="lgc-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="lgc-svg" style={{ height: 200 }}>
        {/* y 轴刻度 */}
        {[0, 0.5, 1].map((p) => (
          <g key={p}>
            <line
              x1={padL} x2={W - 10}
              y1={padT + innerH * (1 - p)} y2={padT + innerH * (1 - p)}
              stroke="var(--line2)" strokeWidth="1"
            />
            <text x={padL - 6} y={padT + innerH * (1 - p) + 4} textAnchor="end" className="lgc-axis">
              {shortNum(max * p)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = padL + gap * i + (gap - bw) / 2;
          let acc = 0;
          return (
            <g key={d.ym} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}>
              {/* 透明热区比柱子宽，鼠标好点 */}
              <rect x={padL + gap * i} y={padT} width={gap} height={innerH} fill="transparent" />
              {d.parts.map((p) => {
                if (p.sum <= 0) return null;
                const h = (p.sum / max) * innerH;
                const y = padT + innerH - acc - h;
                acc += h;
                return (
                  <rect
                    key={p.cat}
                    x={x} y={y} width={bw} height={Math.max(0.6, h)}
                    fill={colorOf(p.cat)}
                    opacity={hover === -1 || hover === i ? 0.92 : 0.42}
                  />
                );
              })}
              <text x={padL + gap * i + gap / 2} y={H - 8} textAnchor="middle" className="lgc-axis">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="lgc-legend">
        {topCats.map((c, i) => (
          <span key={c} className="lgc-leg-item">
            <i style={{ background: PALETTE[i % PALETTE.length] }} />{c}
          </span>
        ))}
        <span className="lgc-leg-item"><i style={{ background: 'var(--ink3)' }} />其它</span>
      </div>

      {hover >= 0 ? (
        <div className="lgc-tip">
          <b>{data[hover].label}</b>
          <span>合计 {sym}{money(data[hover].total)}</span>
          {data[hover].parts.filter((p) => p.sum > 0)
            .sort((a, b) => b.sum - a.sum)
            .slice(0, 5)
            .map((p) => (
              <span key={p.cat} className="muted">{p.cat} {sym}{money(p.sum)}</span>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 13. 场次日均对比（星期几 × 平均每笔）
 *
 * 和 WeekdayRadar 的区别：那张是「合计」，会被某个大额日彻底带偏；
 * 这张是「场均」，才反映真实的消费习惯。
 * 两张一起看：合计高 + 场均也高 = 那天真的爱花钱；
 * 合计高但场均低 = 只是那天办了一件大事（比如交房租）。
 */
export function WeekdayAvg({
  data, sym,
}: {
  data: { dow: number; avg: number; n: number }[];
  sym: string;
}) {
  const NAMES = ['日', '一', '二', '三', '四', '五', '六'];
  const max = Math.max(...data.map((d) => d.avg), 1);
  const best = data.reduce((a, b) => (b.avg > a.avg ? b : a), data[0] ?? { dow: 0, avg: 0, n: 0 });

  return (
    <div className="lgc-wdavg">
      {data.map((d) => (
        <div className="lgc-wd" key={d.dow}>
          <span className="h">{max > 0 ? Math.round((d.avg / max) * 100) : 0}</span>
          <div className="col">
            <i
              style={{ height: `${max > 0 ? Math.max(2, (d.avg / max) * 100) : 2}%` }}
              className={d.dow === best.dow ? 'best' : ''}
              title={`周${NAMES[d.dow]}：场均 ${sym}${money(d.avg)} · ${d.n} 笔`}
            />
          </div>
          <span className="d">{NAMES[d.dow]}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 14. 按小时分布（一天里什么时候花钱）
 *
 * 只有带时间戳的账才有意义。后端用 hasTime 标出有没有，
 * 没有就整张不画 —— 画一排全 0 的柱子只会让人以为图坏了。
 */
export function HourBars({
  data, sym,
}: {
  data: { hour: number; sum: number }[];
  sym: string;
}) {
  const [hover, setHover] = useState(-1);
  if (!data.length) return <div className="empty small">这个月的账没有记时间，画不出小时分布。</div>;

  const max = Math.max(...data.map((d) => d.sum), 1);
  return (
    <div className="lgc-hours">
      {data.map((d, i) => (
        <div
          className="lgc-hr" key={d.hour}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}
        >
          <div className="col">
            <i
              style={{ height: `${max > 0 ? Math.max(2, (d.sum / max) * 100) : 2}%` }}
              className={hover === i ? 'hot' : ''}
            />
          </div>
          <span className="d">{d.hour % 3 === 0 ? d.hour : ''}</span>
        </div>
      ))}
      {hover >= 0 ? (
        <div className="lgc-tip">
          <b>{data[hover].hour}:00 前后</b>
          <span>{sym}{money(data[hover].sum)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 15. 「高频小额」排行
 *
 * 回答的问题：「我是不是每天都在买咖啡？」
 * 大额排行榜抓不到这类消费 —— 单笔 15 块永远排不进 Top 8，
 * 但一个月 40 笔就是 600 块。这张专门把它们揪出来。
 */
export function FreqList({
  data, sym,
}: {
  data: { cat: string; n: number; sum: number; avg: number }[];
  sym: string;
}) {
  if (!data.length) return <div className="empty small">这个月还没有支出。</div>;
  const maxN = Math.max(...data.map((d) => d.n), 1);

  return (
    <div className="lgc-freq">
      {data.slice(0, 10).map((d, i) => (
        <div className="lgc-fq-row" key={d.cat}>
          <span className="rk">{i + 1}</span>
          <span className="nm">{d.cat}</span>
          <span className="bar"><i style={{ width: `${(d.n / maxN) * 100}%` }} /></span>
          <span className="n">{d.n} 笔</span>
          <span className="avg muted">均 {sym}{money(d.avg)}</span>
          <span className="v">{sym}{money(d.sum)}</span>
        </div>
      ))}
    </div>
  );
}
