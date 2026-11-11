/**
 * 第 178 条：画板。
 *
 * 原话：「在笔记中增加画板……应该直接在整个轮子中增加画板。画板也是可编辑、
 * 可删除、可以被放入多媒体库的」。
 *
 * 存的**不是图片，是笔画**。理由很直接：
 *   · 存图片就改不了 —— 用户「想再添两笔」时只能重画，这是最糟的体验；
 *   · 笔画数据比 PNG 小得多，几百笔也就几十 KB；
 *   · 需要图片的地方（笔记里插图、多媒体库）现场导出一张就行。
 *
 * 缩略图和高清导出都是「画板 → PNG」（canvas.toDataURL），
 * 导出后的图会作为**新的 media 记录**进库，所以画板天生「可以被放入多媒体库」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from '../components/Icons';
import { imgUrl } from '../lib/media';
import { ColorPicker, normalizeHex } from './colorPicker';
import { askConfirm } from '../components/ui';

/* ---------------- 数据形状 ---------------- */

export type Tool = 'pen' | 'marker' | 'eraser' | 'line' | 'rect' | 'ellipse';

export interface Stroke {
  /** 工具类型 */
  t: Tool;
  /** 颜色 */
  c: string;
  /** 线宽 */
  w: number;
  /** 点序列，扁平存储 [x0,y0,x1,y1,...] —— 比 [{x,y}] 小一半，序列化也快 */
  p: number[];
}

export interface DrawingState {
  strokes: Stroke[];
  w: number;
  h: number;
}

const PALETTE = [
  '#1f1c18', '#b8623a', '#c9a227', '#5f8256',
  '#4a7396', '#8e6a9e', '#a04040', '#8a8378',
];

const WIDTHS: { n: string; v: number }[] = [
  { n: '细', v: 2 },
  { n: '中', v: 4 },
  { n: '粗', v: 8 },
  { n: '特粗', v: 16 },
];

function parseStrokes(raw: string): Stroke[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    /* 逐条校验：库里可能是旧版本写的、或者被别的工具改坏过，
       一条坏数据不该让整块画板打不开 */
    return v.filter((s): s is Stroke => (
      s && typeof s === 'object'
      && typeof (s as Stroke).t === 'string'
      && typeof (s as Stroke).c === 'string'
      && typeof (s as Stroke).w === 'number'
      && Array.isArray((s as Stroke).p)
      && (s as Stroke).p.every((x) => typeof x === 'number')
      && (s as Stroke).p.length >= 2
    ));
  } catch {
    return [];
  }
}

/* ---------------- 画布绘制 ---------------- */

function drawAll(ctx: CanvasRenderingContext2D, strokes: Stroke[], upTo = -1, live: Stroke | null = null) {
  const n = upTo < 0 ? strokes.length : Math.min(upTo, strokes.length);
  for (let i = 0; i < n; i++) drawOne(ctx, strokes[i]);
  if (live) drawOne(ctx, live);
}

function drawOne(ctx: CanvasRenderingContext2D, s: Stroke) {
  const p = s.p;
  if (p.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s.w;

  /* 橡皮 = 用底色画。用 globalCompositeOperation='destination-out' 会把
     下层背景也擦掉，导出 PNG 时变成透明洞，放到深色日记里会很难看。 */
  ctx.strokeStyle = s.t === 'eraser' ? '#ffffff' : s.c;
  if (s.t === 'marker') {
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = s.w * 3;
  }

  if (s.t === 'line' || s.t === 'rect' || s.t === 'ellipse') {
    /* 形状类只有两个点：起点和终点 */
    const x0 = p[0]; const y0 = p[1];
    const x1 = p[p.length - 2]; const y1 = p[p.length - 1];
    ctx.beginPath();
    if (s.t === 'line') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    } else if (s.t === 'rect') {
      ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else {
      ctx.ellipse(
        (x0 + x1) / 2, (y0 + y1) / 2,
        Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2,
        0, 0, Math.PI * 2,
      );
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  /* 自由笔：一条 path 走完，比逐段 lineTo 少一半状态切换 */
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
  ctx.restore();
}

/* ---------------- 画板编辑器 ---------------- */

export function DrawBoard({
  drawingId, onClose, onSaved,
}: {
  /** 空 = 新建 */
  drawingId: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const toast = useStore((s) => s.toast);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [title, setTitle] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(PALETTE[0]);
  /*
   * #240 拾色器。存两样东西：
   *   · `recent` —— 最近用过的自定义色，纯前端记着就行（存设置里会让
   *     "换个颜色"变成一次落库操作，画板上高频操作不值当）
   *   · 固定色板之外的一律算自定义，所以要单独一个 state 管面板开合
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [width, setWidth] = useState(4);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!drawingId);

  /* 正在画的这一笔。放 ref 不放 state —— 每移动一像素 setState 会重渲染整棵树，
     画起来就是一卡一卡的。 */
  const live = useRef<Stroke | null>(null);
  const drawing = useRef(false);

  const repaint = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    drawAll(ctx, strokes, -1, live.current);
  }, [strokes]);

  /* 打开已有画板 */
  useEffect(() => {
    if (!drawingId) return;
    let alive = true;
    void api.draw.get(drawingId).then((d) => {
      if (!alive) return;
      if (!d.ok) { toast(d.err || '这块画板读不出来'); onClose(); return; }
      setTitle(d.title || '未命名画板');
      setStrokes(parseStrokes(d.strokes));
      setSize({ w: d.w || 1200, h: d.h || 800 });
      setLoaded(true);
      setDirty(false);
    }).catch((e) => {
      if (alive) { toast((e as Error).message || '读取失败'); onClose(); }
    });
    return () => { alive = false; };
  }, [drawingId, toast, onClose]);

  useEffect(() => { repaint(); }, [repaint, loaded]);

  /* Esc 关闭（脏了先问一句） */
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (dirty && !(await askConfirm('画板还没保存，直接关掉吗？', { ok: '关掉' }))) return;
      onClose();
    };
    const h = (e: KeyboardEvent) => void onKey(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [dirty, onClose]);

  /* ---------------- 指针 ---------------- */

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return { x: 0, y: 0 };
    const r = cv.getBoundingClientRect();
    /* CSS 尺寸和 canvas 像素尺寸不是一回事（缩放窗口后会不一样），必须按比例换算，
       否则鼠标和笔迹会越画越偏 */
    return {
      x: Math.round((e.clientX - r.left) * (cv.width / r.width)),
      y: Math.round((e.clientY - r.top) * (cv.height / r.height)),
    };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    drawing.current = true;
    live.current = { t: tool, c: color, w: width, p: [x, y] };
    repaint();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !live.current) return;
    const { x, y } = pos(e);
    const s = live.current;
    if (s.t === 'line' || s.t === 'rect' || s.t === 'ellipse') {
      /* 形状类只留起点 + 当前点，跟手重画 */
      s.p = [s.p[0], s.p[1], x, y];
    } else {
      const n = s.p.length;
      /* 采样去抖：离上一个点不到 1px 就不记，否则一笔几百个点全是重复坐标 */
      if (Math.abs(x - s.p[n - 2]) + Math.abs(y - s.p[n - 1]) < 1) return;
      s.p.push(x, y);
    }
    repaint();
  };

  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const s = live.current;
    live.current = null;
    if (!s) return;
    /* 点一下没画（只有起点）就当没画，免得留一个看不见的点 */
    if (s.p.length < 4 && s.t !== 'line' && s.t !== 'rect' && s.t !== 'ellipse') { repaint(); return; }
    setStrokes((prev) => [...prev, s]);
    setDirty(true);
  };

  /* ---------------- 动作 ---------------- */

  const undo = () => {
    if (!strokes.length) return;
    setStrokes((prev) => prev.slice(0, -1));
    setDirty(true);
  };

  const clearAll = async () => {
    if (!strokes.length) return;
    if (!(await askConfirm('清空整块画板？', { body: '还没保存的话，清掉就找不回来了。', ok: '清空' }))) return;
    setStrokes([]);
    setDirty(true);
  };

  /** 导出 PNG（不含背景透明，白底 —— 贴进深色日记里也能看清） */
  const toPng = (maxSide = 0): string => {
    const cv = canvasRef.current;
    if (!cv) return '';
    if (!maxSide || (cv.width <= maxSide && cv.height <= maxSide)) return cv.toDataURL('image/png');
    /* 太大的图缩一下，当缩略图用 */
    const k = maxSide / Math.max(cv.width, cv.height);
    const t = document.createElement('canvas');
    t.width = Math.round(cv.width * k);
    t.height = Math.round(cv.height * k);
    const c2 = t.getContext('2d');
    if (!c2) return cv.toDataURL('image/png');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, t.width, t.height);
    c2.drawImage(cv, 0, 0, t.width, t.height);
    return t.toDataURL('image/png');
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      /* 缩略图顺手一起存：列表页要它，单独生成一次就够，不该每次进列表都重画 */
      const thumbB64 = strokes.length ? toPng(360) : '';
      let thumbId = '';
      if (thumbB64) {
        const t = await api.draw.toMedia(drawingId || 'new', thumbB64, '画板缩略图.png').catch(() => null);
        if (t?.ok && t.id) thumbId = t.id;
      }

      const r = await api.draw.save({
        id: drawingId,
        title: title.trim() || '未命名画板',
        w: size.w,
        h: size.h,
        strokes: JSON.stringify(strokes),
        thumb: thumbId,
        note: '',
      });
      if (!r.ok) { toast(r.err || '保存失败'); return; }
      setDirty(false);
      /*
       * #247：缩略图「保存了但看不到」。
       *
       * 上面 toMedia 已经真的把图写进库、也拿到了 id（库里 thumb_id 是有值的），
       * 但列表页渲染走的是 imgUrl(thumb_id) —— 它查的是 lib/media.ts 里那份
       * **内存索引**，而索引只在 reloadMedia() 时重建。
       * 新建画板时没有任何代码去刷它，于是 resolveRef 返回 null，
       * imgUrl 给出空串，<img src=""> 自然一片空白。
       * 重开软件能看见，正是因为启动时 reloadMedia 跑过了 —— 这种
       * 「重启就好」的 bug 最容易被当成偶发问题放过去。
       *
       * 只在真的生成了新缩略图时刷：没画东西的画板不该白发一次全量请求。
       */
      if (thumbId) await useStore.getState().reloadMedia().catch(() => null);
      toast(`已保存${r.id && !drawingId ? '，新画板建好了' : ''}`);
      onSaved?.(r.id || drawingId);
    } catch (e) {
      toast((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  /** 放进多媒体库：导一张原尺寸 PNG 进 media 表，然后能在任何地方插图 */
  const toLibrary = async () => {
    if (!strokes.length) { toast('画板还是空的'); return; }
    setBusy(true);
    try {
      const r = await api.draw.toMedia(drawingId, toPng(0), `${title.trim() || '画板'}.png`);
      if (r.ok) toast('已放进多媒体库，可以去插图了');
      else toast(r.err || '放进去失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget && !dirty) onClose(); }}>
      <div className="dlg db-dlg" onClick={(e) => e.stopPropagation()}>
        <div className="h">
          <h3>
            <Icon name="pen" size={14} />
            <input
              className="db-title"
              value={title}
              placeholder="画板叫什么"
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            />
          </h3>
          <button className="x" title="关闭" onClick={async () => {
            if (dirty && !(await askConfirm('画板还没保存，直接关掉吗？', { ok: '关掉' }))) return;
            onClose();
          }}>✕</button>
        </div>

        <div className="b db-body">
          {/* 工具条 */}
          <div className="db-tools">
            <div className="db-grp">
              {([
                ['pen', 'pen', '画笔'],
                ['marker', 'palette', '荧光笔'],
                ['eraser', 'x', '橡皮'],
              ] as [Tool, 'pen' | 'palette' | 'x', string][]).map(([t, ic, tip]) => (
                <button
                  key={t} className={`db-tool ${tool === t ? 'on' : ''}`} data-tip={tip}
                  onClick={() => setTool(t)}
                ><Icon name={ic} size={14} /></button>
              ))}
            </div>

            <div className="db-grp">
              {([
                ['line', '直线'],
                ['rect', '方框'],
                ['ellipse', '椭圆'],
              ] as [Tool, string][]).map(([t, tip]) => (
                <button
                  key={t} className={`db-tool ${tool === t ? 'on' : ''}`} data-tip={tip}
                  onClick={() => setTool(t)}
                >
                  {t === 'line' ? '╱' : t === 'rect' ? '▭' : '◯'}
                </button>
              ))}
            </div>

            <div className="db-grp pick">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`db-color ${color === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }}
                />
              ))}
              {/*
               * 自定义色按钮。当前色不在固定板里时，按钮本身就是那个颜色 ——
               * 否则用户调完色关掉面板，就会以为颜色自己变回去了。
               */}
              <button
                className={`db-tool ${pickerOpen ? 'on' : ''}`}
                title="调一个任意颜色"
                style={{ marginLeft: 2 }}
                onClick={() => setPickerOpen((v) => !v)}
                data-act="draw-picker-open"
              >
                <span className="db-color-cur">
                  <i style={{ background: color }} />
                  {PALETTE.includes(color) ? '更多' : '自定'}
                </span>
              </button>

              {pickerOpen && (
                <ColorPicker
                  value={color}
                  recent={recent}
                  onChange={(hex) => { setColor(hex); if (tool === 'eraser') setTool('pen'); }}
                  onCommit={(hex) => {
                    const n = normalizeHex(hex);
                    if (!n) return;
                    setRecent((r) => [n, ...r.filter((x) => x !== n)].slice(0, 8));
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>

            <div className="db-grp">
              {WIDTHS.map((w) => (
                <button
                  key={w.v} className={`db-tool ${width === w.v ? 'on' : ''}`}
                  title={`${w.n}（${w.v}px）`}
                  onClick={() => setWidth(w.v)}
                >{w.n}</button>
              ))}
            </div>

            <span className="sp" />

            <button className="btn sm" onClick={undo} disabled={!strokes.length}>撤销</button>
            <button className="btn sm" onClick={clearAll} disabled={!strokes.length}>清空</button>
          </div>

          {/* 画布 */}
          <div className="db-canvas-wrap">
            {!loaded ? <div className="empty small">读取画板…</div> : null}
            <canvas
              ref={canvasRef}
              width={size.w}
              height={size.h}
              className="db-canvas"
              style={{ aspectRatio: `${size.w} / ${size.h}` }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={up}
            />
          </div>

          <div className="db-foot">
            <span className="small muted">{strokes.length} 笔 · {size.w}×{size.h}</span>
            <span className="sp" />
            <button className="btn sm" onClick={() => void toLibrary()} disabled={busy || !strokes.length}>
              <Icon name="image" size={13} />放进多媒体库
            </button>
            <button className="btn primary sm" onClick={() => void save()} disabled={busy || !loaded}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 画板列表 ---------------- */

export function DrawList({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<{ id: string; title: string; thumb: string; updatedAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.draw.list();
      setItems(r.items || []);
    } catch (e) {
      toast((e as Error).message || '读不到画板');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const del = async (id: string, title: string) => {
    if (!(await askConfirm(`删除画板「${title}」？`, { body: '会先进回收站，还能找回来。', ok: '删除' }))) return;
    await api.draw.remove(id, 0);
    await load();
    toast('已移到回收站');
  };

  const k = q.trim().toLowerCase();
  const shown = k ? items.filter((x) => (x.title || '').toLowerCase().includes(k)) : items;

  if (loading) return <div className="empty small">读取画板…</div>;

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn primary sm" onClick={() => onOpen('')}>
          <Icon name="plus" size={13} />新建画板
        </button>
        <input
          className="inp" style={{ width: 200 }} placeholder="搜画板…"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        <span className="sp" />
        <span className="small muted">{items.length} 块</span>
      </div>

      {!shown.length ? (
        <div className="empty">
          {k ? `没有标题含「${q}」的画板` : '还没有画板。画板存的是笔画，所以随时能再改，不是一张死图。'}
        </div>
      ) : (
        <div className="db-grid">
          {shown.map((d) => (
            <div className="db-card" key={d.id}>
              <button className="db-thumb" onClick={() => onOpen(d.id)} title="打开继续画">
                {d.thumb ? <img src={imgUrl(d.thumb)} alt={d.title} loading="lazy" /> : <span className="db-nothumb">空白</span>}
              </button>
              <div className="db-meta">
                <span className="db-name" title={d.title}>{d.title || '未命名画板'}</span>
                <span className="small muted">{(d.updatedAt || '').slice(5, 16)}</span>
              </div>
              <div className="db-acts">
                <button className="btn sm ghost" onClick={() => onOpen(d.id)}>继续画</button>
                <button className="btn sm ghost danger" onClick={() => void del(d.id, d.title)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}