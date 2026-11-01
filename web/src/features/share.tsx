import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog } from '../components/ui';
import { Icon } from '../components/Icons';

export type ShareStyle = 'paper' | 'ink' | 'night' | 'plain';
export type ShareSize = 'story' | 'square' | 'wide';

export interface ShareStats {
  label: string;
  value: string;
}

export interface ShareData {
  /** 卡片顶部的大标题，通常就是日期 */
  heading: string;
  sub?: string;
  body: string;
  tags?: string[];
  stats?: ShareStats[];
  /** 底部小字，留空则用设置里的 */
  footer?: string;
}

const SIZES: Record<ShareSize, [number, number]> = {
  story: [1080, 1440],
  square: [1080, 1080],
  wide: [1200, 675],
};

const STYLES: { k: ShareStyle; n: string; bg: string; fg: string; sub: string; line: string; accent: string; chip: string }[] = [
  { k: 'paper', n: '宣纸', bg: '#f6f3ec', fg: '#26221d', sub: '#6d6459', line: '#ded5c4', accent: '#b8623a', chip: '#efe7d8' },
  { k: 'ink', n: '墨色', bg: '#1e1c1a', fg: '#f3efe6', sub: '#a8a093', line: '#3a3530', accent: '#c98a5e', chip: '#2c2925' },
  { k: 'night', n: '夜色', bg: '#16202b', fg: '#eaf0f6', sub: '#93a4b5', line: '#2a3744', accent: '#7fb0d0', chip: '#20303d' },
  { k: 'plain', n: '素白', bg: '#ffffff', fg: '#1b1b1b', sub: '#8a8a8a', line: '#ececec', accent: '#2f6f4f', chip: '#f2f2f2' },
];

const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';

/** 中文按字符断行（英文单词尽量不拆），并支持最多 maxLines 行 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const clean = (text || '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();
  if (!clean) return [];
  const out: string[] = [];
  for (const para of clean.split('\n')) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = ch;
        if (out.length >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (out.length >= maxLines) break;
    if (line) out.push(line);
    if (out.length >= maxLines) break;
  }
  if (out.length > maxLines) out.length = maxLines;
  if (out.length === maxLines) {
    // 最后一行加省略号（宽度还会变，粗略判断有没有被截断）
    const joined = out.join('');
    if (joined.length < clean.replace(/\n/g, '').length && !out[maxLines - 1].endsWith('…')) {
      out[maxLines - 1] = out[maxLines - 1].replace(/.$/, '…');
    }
  }
  return out;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 生成分享卡片画布。纯本地绘制，不请求任何字体或图片。 */
export function buildCard(
  data: ShareData,
  style: ShareStyle,
  size: ShareSize,
  opts: { brand: string; footer: string; watermark: boolean },
): HTMLCanvasElement {
  const [W, H] = SIZES[size];
  const st = STYLES.find((s) => s.k === style) || STYLES[0];
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return cv;

  const wide = size === 'wide';
  const pad = wide ? 72 : 96;

  g.fillStyle = st.bg;
  g.fillRect(0, 0, W, H);

  // 纸感：一层极淡的斜向纹理，深色主题上不显脏
  if (style === 'paper' || style === 'plain') {
    g.save();
    g.globalAlpha = 0.5;
    g.strokeStyle = st.line;
    g.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const y = (H / 26) * i;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y + 30);
      g.stroke();
    }
    g.restore();
  }

  // 内描边
  g.strokeStyle = st.line;
  g.lineWidth = 2;
  roundRect(g, pad * 0.42, pad * 0.42, W - pad * 0.84, H - pad * 0.84, 18);
  g.stroke();

  let y = pad + 26;

  /* 品牌条 */
  g.fillStyle = st.accent;
  roundRect(g, pad, y, 46, 46, 14);
  g.fill();
  g.fillStyle = st.bg;
  g.font = `700 26px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillText('签', pad + 14, y + 25);

  g.fillStyle = st.sub;
  g.font = `600 20px ${FONT}`;
  g.fillText(opts.brand || '日签', pad + 62, y + 24);

  y += 46 + 54;

  /* 大标题 */
  g.textBaseline = 'alphabetic';
  g.fillStyle = st.fg;
  const headSize = wide ? 58 : 70;
  g.font = `700 ${headSize}px ${FONT}`;
  g.fillText(data.heading, pad, y + headSize);
  y += headSize + 12;

  if (data.sub) {
    g.fillStyle = st.sub;
    g.font = `400 ${wide ? 20 : 24}px ${FONT}`;
    g.fillText(data.sub, pad, y + 18);
    y += 22 + 18;
  }

  y += 18;
  g.strokeStyle = st.line;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(pad, y);
  g.lineTo(W - pad, y);
  g.stroke();
  y += 46;

  /* 正文 */
  const bodySize = wide ? 24 : 34;
  const lh = Math.round(bodySize * 1.72);
  g.fillStyle = st.fg;
  g.font = `400 ${bodySize}px ${FONT}`;
  const restH = H - y - pad - (wide ? 96 : 250);
  const maxLines = Math.max(2, Math.floor(restH / lh));
  const lines = wrap(g, data.body, W - pad * 2, maxLines);
  lines.forEach((ln, i) => g.fillText(ln, pad, y + bodySize + i * lh));
  y += lines.length * lh + 18;

  /* 标签 */
  if (data.tags?.length) {
    g.font = `400 20px ${FONT}`;
    let x = pad;
    for (const t of data.tags.slice(0, 6)) {
      const w = g.measureText('#' + t).width + 28;
      if (x + w > W - pad) break;
      g.fillStyle = st.chip;
      roundRect(g, x, y, w, 38, 19);
      g.fill();
      g.fillStyle = st.sub;
      g.fillText('#' + t, x + 14, y + 26);
      x += w + 10;
    }
    y += 56;
  }

  /* 数据条 */
  if (data.stats?.length) {
    const items = data.stats.slice(0, wide ? 4 : 3);
    const colW = (W - pad * 2) / items.length;
    const baseY = H - pad - 118;
    items.forEach((s, i) => {
      const x = pad + colW * i;
      g.fillStyle = st.fg;
      g.font = `700 ${wide ? 34 : 44}px ${FONT}`;
      g.fillText(s.value, x, baseY);
      g.fillStyle = st.sub;
      g.font = `400 20px ${FONT}`;
      g.fillText(s.label, x, baseY + 30);
    });
  }

  /* 页脚 + 水印 */
  g.fillStyle = st.sub;
  g.font = `400 19px ${FONT}`;
  const foot = data.footer || opts.footer || '';
  if (foot) g.fillText(foot, pad, H - pad - 26);

  if (opts.watermark) {
    g.textAlign = 'right';
    g.fillStyle = st.accent;
    g.font = `600 19px ${FONT}`;
    g.fillText(`${opts.brand} · 记录每一天`, W - pad, H - pad - 26);
    g.textAlign = 'left';
  }

  return cv;
}

/** 分享文案：发微信 / 微博可以直接粘的那种 */
export function buildShareText(data: ShareData, brand: string): string {
  const lines = [data.heading + (data.sub ? ` · ${data.sub}` : ''), ''];
  lines.push(data.body.slice(0, 260));
  if (data.tags?.length) lines.push('', data.tags.slice(0, 6).map((t) => `#${t}`).join(' '));
  if (data.stats?.length) lines.push('', data.stats.map((s) => `${s.label} ${s.value}`).join(' · '));
  lines.push('', `—— 来自「${brand}」，数据存在自己电脑里`);
  return lines.join('\n');
}

export function ShareDialog({ data, onClose }: { data: ShareData; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const [style, setStyle] = useState<ShareStyle>((settings.shareStyle as ShareStyle) || 'paper');
  const [size, setSize] = useState<ShareSize>((settings.shareSize as ShareSize) || 'story');
  const [busy, setBusy] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState('');

  const brand = String(settings.shareBrand || '日签 · 打卡日记本');
  const footer = String(settings.shareFooter || '');
  const mark = String(settings.shareWatermark ?? '1') === '1';

  const opts = useMemo(() => ({ brand, footer, watermark: mark }), [brand, footer, mark]);

  useEffect(() => {
    const cv = buildCard(data, style, size, opts);
    canvasRef.current = cv;
    setUrl(cv.toDataURL('image/png'));
  }, [data, style, size, opts]);

  const fname = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `日签分享-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };

  const pickStyle = (k: ShareStyle) => { setStyle(k); void setSetting('shareStyle', k); };
  const pickSize = (k: ShareSize) => { setSize(k); void setSetting('shareSize', k); };

  const save = async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    setBusy('save');
    const r: { ok: boolean; path?: string; err?: string } = await api.share.saveImage(cv.toDataURL('image/png'), fname())
      .catch((e) => ({ ok: false, err: (e as Error).message }));
    setBusy('');
    if (r.ok) toast(`已保存到 ${(r.path || '').split(/[\\/]/).slice(-2).join('/')}`);
    else toast(r.err || '保存失败');
  };

  const copyImg = async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    setBusy('copy');
    const r: { ok: boolean; err?: string } = await api.share.copyImage(cv.toDataURL('image/png'))
      .catch((e) => ({ ok: false, err: (e as Error).message }));
    setBusy('');
    toast(r.ok ? '图片已在剪贴板，去微信 / QQ 粘贴即可' : (r.err || '复制失败'));
  };

  const copyText = async () => {
    const r: { ok: boolean; err?: string } = await api.share.copyText(buildShareText(data, brand))
      .catch((e) => ({ ok: false, err: (e as Error).message }));
    toast(r.ok ? '文案已复制' : (r.err || '复制失败'));
  };

  const saveHtml = async () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const img = cv.toDataURL('image/png');
    const text = buildShareText(data, brand);
    const html = `<!DOCTYPE html><meta charset="utf-8"><title>${data.heading} · ${brand}</title>
<body style="margin:0;background:#1e1c1a;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:${FONT}">
<div style="max-width:${cv.width}px;width:100%">
<img src="${img}" style="width:100%;display:block">
<pre style="color:#b9b2a6;font:14px/1.9 ${FONT};white-space:pre-wrap;padding:20px 24px">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</pre>
</div></body>`;
    const r = await api.share.saveHtml(html, fname());
    if (r.ok) toast('分享页已保存，双击就能看');
    else toast('保存失败');
  };

  return (
    <Dialog
      title="分享这一天"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={() => void saveHtml()}>存成网页</button>
        <button className="btn" onClick={() => void copyText()}>复制文案</button>
        <button className="btn" onClick={() => void copyImg()} disabled={busy === 'copy'}>
          {busy === 'copy' ? '复制中…' : '复制图片'}
        </button>
        <span className="sp" />
        <button className="btn primary" onClick={() => void save()} disabled={busy === 'save'}>
          <Icon name="download" size={13} />{busy === 'save' ? '保存中…' : '保存图片'}
        </button>
      </>}
    >
      <div className="share">
        <div className="share-prev">
          {url ? <img src={url} alt="分享卡片预览" /> : <div className="empty small">正在生成…</div>}
        </div>
        <div className="share-side">
          <div className="share-t">版式</div>
          <div className="share-styles">
            {STYLES.map((s) => (
              <button
                key={s.k}
                className={`share-sw ${style === s.k ? 'on' : ''}`}
                onClick={() => pickStyle(s.k)}
                title={s.n}
              >
                <span style={{ background: s.bg, color: s.fg, borderColor: s.line }}>
                  <b style={{ color: s.accent }}>签</b>文
                </span>
                <small>{s.n}</small>
              </button>
            ))}
          </div>

          <div className="share-t">尺寸</div>
          <div className="row">
            {([['story', '竖版 3:4'], ['square', '方图 1:1'], ['wide', '横版 16:9']] as [ShareSize, string][]).map(([k, n]) => (
              <button key={k} className={`chip ${size === k ? 'on' : ''}`} onClick={() => pickSize(k)}>{n}</button>
            ))}
          </div>

          <div className="share-t">说明</div>
          <div className="small muted" style={{ lineHeight: 1.85 }}>
            图片是在你电脑上画出来的，不上传、不联网。<br />
            保存的图片在数据目录的「导出 / 分享」里。<br />
            水印和设备标识可以在「设置 → 分享与总结」里改。
          </div>
        </div>
      </div>
    </Dialog>
  );
}
