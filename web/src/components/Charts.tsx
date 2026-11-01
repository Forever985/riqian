/** 纯 SVG 图表：不引第三方库，主题色跟随 CSS 变量 */
import { useId } from 'react';

const PALETTE = ['#b8623a', '#5f8256', '#4a7396', '#8a6aa8', '#b8863a', '#4f8a86', '#a55a72', '#7a7469'];

export interface Point { label: string; value: number }

/** 柱状图：适合「每天多少分钟」 */
export function BarChart({
  data, height = 112, showAxis = true, unit = '', yTicks = false, fmtValue,
}: {
  data: Point[];
  height?: number;
  showAxis?: boolean;
  unit?: string;
  /** 左边显示刻度值（第 185 条：原来只有柱子，高度等于多少全靠猜） */
  yTicks?: boolean;
  /** 刻度和悬浮提示怎么显示数值，默认就是数字本身 */
  fmtValue?: (v: number) => string;
}) {
  const W = 320;
  const H = height;
  const fv = fmtValue ?? ((v: number) => String(v));
  // 有刻度时左边留出空间，否则刻度会盖住柱子
  const padL = yTicks ? 30 : 4;
  const padR = 4;
  const padT = 10;
  const padB = showAxis ? 16 : 4;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const bw = insideWidth(innerW, data.length);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <line key={r} className="gridline" x1={padL} x2={W - padR} y1={padT + innerH * (1 - r)} y2={padT + innerH * (1 - r)} />
      ))}
      {yTicks ? [0.5, 1].map((r) => (
        <text
          key={`t${r}`}
          className="axis-label"
          x={padL - 4}
          y={padT + innerH * (1 - r) + 3}
          textAnchor="end"
        >
          {fv(Math.round(max * r))}
        </text>
      )) : null}
      {yTicks ? (
        <text className="axis-label" x={padL - 4} y={padT + innerH + 3} textAnchor="end">0</text>
      ) : null}
      {data.map((d, i) => {
        const h = max ? (d.value / max) * innerH : 0;
        const w = Math.min(bw * 0.64, 26);          // 数据点很少时不要把柱子拉满整行
        const x = padL + i * bw + (bw - w) / 2;
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              className="bar"
              x={x}
              y={padT + innerH - Math.max(h, d.value > 0 ? 2 : 0)}
              width={w}
              height={Math.max(h, d.value > 0 ? 2 : 0)}
              rx={2.5}
            >
              <title>{`${d.label}：${fv(d.value)}${unit}`}</title>
            </rect>
            {showAxis && i % Math.ceil(data.length / 7) === 0 ? (
              <text className="axis-label" x={x + w / 2} y={H - 4} textAnchor="middle">{d.label}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 把上界抬到一个「好读」的数（60/90/120/240…）。
 * 不抬的话最大值永远顶到画布顶端，看不出「离满还有多少」。
 */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const steps = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720];
  for (const s of steps) if (v <= s) return s;
  return Math.ceil(v / 120) * 120;
}

function insideWidth(innerW: number, n: number) {
  return n > 0 ? innerW / n : innerW;
}

/** 折线 + 面积：适合「趋势」 */
export function LineChart({
  data, height = 120, showAxis = true,
}: {
  data: Point[];
  height?: number;
  showAxis?: boolean;
}) {
  const gid = useId().replace(/:/g, '');
  const W = 320;
  const H = height;
  const padL = 6;
  const padR = 6;
  const padT = 10;
  const padB = showAxis ? 16 : 4;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(...data.map((d) => d.value), 1);
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const pts = data.map((d, i) => {
    const x = padL + i * step;
    const y = padT + innerH - (max ? (d.value / max) * innerH : 0);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = pts.length
    ? `${line} L${(padL + (pts.length - 1) * step).toFixed(1)},${padT + innerH} L${padL},${padT + innerH} Z`
    : '';

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient id={`areaGrad${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.5, 1].map((r) => (
        <line key={r} className="gridline" x1={padL} x2={W - padR} y1={padT + innerH * (1 - r)} y2={padT + innerH * (1 - r)} />
      ))}
      {area ? <path d={area} fill={`url(#areaGrad${gid})`} stroke="none" /> : null}
      <path className="line" d={line} />
      {pts.map(([x, y], i) => (
        <circle key={i} className="dot" cx={x} cy={y} r={data.length > 20 ? 1.6 : 2.6}>
          <title>{`${data[i].label}：${data[i].value}`}</title>
        </circle>
      ))}
      {showAxis && data.length ? (
        <>
          <text className="axis-label" x={padL} y={H - 4}>{data[0].label}</text>
          <text className="axis-label" x={W - padR} y={H - 4} textAnchor="end">{data[data.length - 1].label}</text>
        </>
      ) : null}
    </svg>
  );
}

export interface Slice { label: string; value: number }

/** 环形图：适合「占比」 */
export function Donut({
  data, size = 132, thickness = 15, showLegend = true,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  showLegend?: boolean;
}) {
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  const svg = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" style={{ flex: '0 0 auto' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line2)" strokeWidth={thickness} />
      {items.map((d, i) => {
        const len = total ? (d.value / total) * c : 0;
        const seg = (
          <circle
            key={d.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth={thickness}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-acc}
            strokeLinecap="butt"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray .3s' }}
          >
            <title>{`${d.label}：${d.value}（${total ? Math.round((d.value / total) * 100) : 0}%）`}</title>
          </circle>
        );
        acc += len;
        return seg;
      })}
      {total ? (
        <>
          <text
            x="50%" y="47%" textAnchor="middle"
            style={{ fontSize: size * 0.19, fontWeight: 600, fill: 'var(--ink)' }}
          >
            {total}
          </text>
          <text
            x="50%" y="62%" textAnchor="middle"
            style={{ fontSize: size * 0.085, fill: 'var(--ink3)' }}
          >
            合计
          </text>
        </>
      ) : null}
    </svg>
  );

  if (!showLegend) return svg;

  return (
    <div className="donut-wrap">
      {svg}
      <div className="donut-legend">
        {items.length ? items.slice(0, 8).map((d, i) => (
          <div className="row" key={d.label}>
            <span className="sw" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="nm" title={d.label}>{d.label}</span>
            <span className="vl">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </div>
        )) : <span className="nm" style={{ color: 'var(--ink3)' }}>还没有数据</span>}
      </div>
    </div>
  );
}

export { PALETTE };
