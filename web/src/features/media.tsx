/**
 * 媒体库：选择器 / 总览 / 解析 / 调色引擎。
 *
 * 这里同时承担三件事（都放在一个文件里，避免 markdown、bbcode、模块互相 import 成环）：
 * 1. 引用 → HTML：mediaHtml() 把媒体 id 解析成 <img>/<audio>/<video>，失效就出「已丢失」占位
 * 2. 调色：toneFilter() 把 {b,c,s,o} 翻成 CSS filter；mediaDomPass() 统一给 [data-tone] 和正文里的
 *    媒体套上 filter（正文是后端存的 HTML，长什么样前端说了不算，只能靠一遍 DOM 扫描补齐）
 * 3. 界面：MediaPicker（挑图 / 挑视频）、MediaManager（多媒体库：搜索 / 类型 / 排序 / 网格列表）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { useMarquee } from '../components/Marquee';
import { SearchBox } from '../components/SearchBox';
import { imgUrl, mediaAll, rawUrl, resolveRef, setMediaIndex } from '../lib/media';
import { Dialog, askText, askConfirm } from '../components/ui';
import { Icon } from '../components/Icons';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import { MediaToneDialog, toneFilter } from './mediaTone';
import type { MediaItem } from '../types';
import { EmptyState } from '../components/EmptyState';

export { toneFilter, parseTone, toneIsFlat } from './mediaTone';
export type { Tone } from './mediaTone';

export type MediaKind = 'image' | 'audio' | 'video';
export type MediaKindFilter = MediaKind | 'all';
export type MediaSort = 'new' | 'old' | 'name' | 'size';

/**
 * 第 232 条：浏览方式。
 * xl = 超大图标（220px 一格，看构图）  grid = 标准网格（150px）
 * list = 紧凑列表（带小缩略图）        detail = 详细信息（表格式，看尺寸 / 大小 / 时间）
 * month = 按月分组
 */
export type MediaView = 'xl' | 'grid' | 'list' | 'detail' | 'month';

const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v|avi|wmv|flv|3gp|ogv)$/i;
const AUDIO_RE = /\.(mp3|m4a|wav|flac|ogg|oga|aac|opus|wma|ape)$/i;

/* ---------------- 基础工具 ---------------- */

export function kindOf(m: MediaItem): MediaKind {
  const k = (m.kind || '').toLowerCase();
  if (k === 'image' || k === 'audio' || k === 'video') return k;
  const hay = `${m.file || ''} ${m.name || ''} ${m.ext || ''}`;
  if (VIDEO_RE.test(hay)) return 'video';
  if (AUDIO_RE.test(hay)) return 'audio';
  return 'image';
}

export const kindName = (k: string): string =>
  k === 'video' ? '视频' : k === 'audio' ? '音频' : k === 'all' ? '全部' : '图片';

export const fileUrl = (m: MediaItem): string => (m.file ? rawUrl(m.file) : '');

/** 缩略图优先；没有缩略图（webp/gif 等 GDI+ 读不了的）就退回原图，不撞 404 */
export function thumbUrl(m: MediaItem): string {
  if (kindOf(m) !== 'image') return fileUrl(m);
  if (m.thumb) return `https://riqian.local/.thumb/${encodeURIComponent(m.thumb)}`;
  return fileUrl(m);
}

export function fmtBytes(n: number): string {
  const b = Number(n) || 0;
  if (b <= 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtTime(s?: string): string {
  if (!s) return '—';
  return s.replace('T', ' ').slice(0, 16);
}

/* ---------------- 按月分组 ---------------- */

const MONTH_ANY = 'unknown';

/** 取 "2026-10-31 12:30:00" / "2026-10-31T12:30:00" 的月 key；没有日期归到 unknown */
function monthKeyOf(m: MediaItem): string {
  const s = (m.createdAt || m.mtime || '').replace('T', ' ');
  const k = s.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(k) ? k : MONTH_ANY;
}

function monthLabel(key: string): string {
  if (key === MONTH_ANY) return '未知时间';
  const [y, mo] = key.split('-');
  return `${y} 年 ${Number(mo)} 月`;
}

export type MediaGroup = { key: string; label: string; items: MediaItem[]; bytes: number };

/**
 * 按月份分组。组顺序跟当前排序的「第一次出现」走（最新排序就是倒序月份），
 * 未知时间固定放最后；组内保持传进来的顺序，所以排序依然生效。
 */
function groupByMonth(items: MediaItem[]): MediaGroup[] {
  const map = new Map<string, MediaGroup>();
  for (const m of items) {
    const k = monthKeyOf(m);
    let g = map.get(k);
    if (!g) {
      g = { key: k, label: monthLabel(k), items: [], bytes: 0 };
      map.set(k, g);
    }
    g.items.push(m);
    g.bytes += Number(m.bytes) || 0;
  }
  const out: MediaGroup[] = [];
  for (const g of map.values()) if (g.key !== MONTH_ANY) out.push(g);
  const any = map.get(MONTH_ANY);
  if (any) out.push(any);
  return out;
}

/* ---------------- 调色 ---------------- */

/**
 * 把刚查到的媒体并进全局索引（不覆盖别的条目）。
 * 好处：一旦媒体库页拉过音视频，正文里的 [video]id[/video] 立刻就能解析；
 * 而且只做合并，不会因为「只查了图片」把视频从索引里挤掉。
 */
function mergeMediaIndex(list: MediaItem[]) {
  if (!list.length) return;
  const map = new Map<string, MediaItem>();
  for (const m of mediaAll()) map.set(m.id, m);
  for (const m of list) map.set(m.id, m);
  setMediaIndex([...map.values()]);
}

/** 从媒体索引里读这张图的调色参数（拿不到就是空串） */
export function toneOf(ref?: string | null): string {
  if (!ref) return '';
  return resolveRef(ref)?.tone || '';
}

/** 给组件直接用的样式：读索引里的 tone 转成 filter */
export function toneStyle(ref?: string | null): React.CSSProperties {
  const f = toneFilter(toneOf(ref));
  return f ? { filter: f } : {};
}

/* ---------------- 引用 → HTML ---------------- */

const escHtml = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const escAttr = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c] as string));

/** 失效引用一律给个可见的方块，绝不留白屏 / 破图 */
export function missBox(text: string, note = ''): string {
  return `<span class="mediamiss" title="${escAttr(note || text)}">${escHtml(text)}</span>`;
}

/** 反查：src 的文件名（或显示名）→ 媒体记录 */
let revFor: MediaItem[] | null = null;
let revMap = new Map<string, MediaItem>();

function mediaSrcKey(src: string): string {
  const clean = (src || '').split('?')[0].split('#')[0];
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function mediaBySrc(src: string): MediaItem | null {
  if (!src) return null;
  const all = mediaAll();
  if (revFor !== all) {
    revFor = all;
    revMap = new Map();
    for (const m of all) {
      if (m.file) revMap.set(m.file, m);
      if (m.name && !revMap.has(m.name)) revMap.set(m.name, m);
    }
  }
  const key = mediaSrcKey(src);
  if (!key) return null;
  return revMap.get(key) || resolveRef(key);
}

function playerHtml(m: MediaItem, kind: MediaKind): string {
  const url = escAttr(imgUrl(m.id) || fileUrl(m));
  if (!url) return missBox(kind === 'video' ? '视频已丢失' : '音频已丢失', m.name || m.id);
  const mid = escAttr(m.id);
  return kind === 'video'
    ? `<video class="vid" src="${url}" controls preload="metadata" data-mid="${mid}"></video>`
    : `<audio class="aud" src="${url}" controls preload="metadata" data-mid="${mid}"></audio>`;
}

/**
 * 一个引用 → 一段 HTML。支持：媒体 id、显示名、http(s)/data/blob 直链。
 * 图片给 <img>，音视频给可播放的控件；找不到就给占位。
 */
export function mediaHtml(ref: string, width = 0): string {
  const s = (ref || '').trim();
  if (!s) return missBox('图片已丢失');
  if (/^(https?:|data:|blob:)/i.test(s)) {
    if (VIDEO_RE.test(s)) return `<video class="vid" src="${escAttr(s)}" controls preload="metadata"></video>`;
    if (AUDIO_RE.test(s)) return `<audio class="aud" src="${escAttr(s)}" controls preload="metadata"></audio>`;
    const w = width ? ` style="width:${Math.round(width)}px"` : '';
    return `<img src="${escAttr(s)}" alt=""${w}>`;
  }
  const m = resolveRef(s);
  if (!m) {
    return missBox(
      VIDEO_RE.test(s) ? '视频已丢失' : AUDIO_RE.test(s) ? '音频已丢失' : '图片已丢失',
      `${s} 不在媒体库里`,
    );
  }
  const k = kindOf(m);
  if (k !== 'image') return playerHtml(m, k);
  const url = imgUrl(m.id) || fileUrl(m);
  if (!url) return missBox('图片已丢失', m.name || m.id);
  const w = width ? ` style="width:${Math.round(width)}px"` : '';
  return `<img src="${escAttr(url)}" alt="${escAttr(m.name || '')}" data-mid="${escAttr(m.id)}"${w}>`;
}

/**
 * BBCode 先抽走 [img]/[img=宽]/[video]/[audio]，转完再塞回去。
 * lib/bbcode.ts 里的 [img] 只认文件名且失败会出破图，这里绕开它统一走媒体库。
 */
const TOK = /\u0001M(\d+)\u0001/g;

export function bbMediaWrap(bb: string, render: (src: string) => string): string {
  if (!bb) return '';
  const bag: string[] = [];
  const pre = bb.replace(
    /\[img(?:=(\d{1,4}))?\]([\s\S]*?)\[\/img\]|\[video\]([\s\S]*?)\[\/video\]|\[audio\]([\s\S]*?)\[\/audio\]/gi,
    (_m: string, w: string | undefined, imgRef: string | undefined, vidRef: string | undefined, audRef: string | undefined) => {
      const ref = (imgRef ?? vidRef ?? audRef ?? '').trim();
      bag.push(mediaHtml(ref, Number(w) || 0));
      return `\u0001M${bag.length - 1}\u0001`;
    },
  );
  return render(pre).replace(TOK, (_m: string, i: string) => bag[Number(i)] ?? '');
}

/** Markdown 产物的事后修补：原样 <video> 还原、图片引用统一走媒体库 */
export function mdMediaFix(html: string): string {
  if (!html) return '';
  let s = html;

  // 手写的 <video>/<audio> 被 Markdown 渲染器当普通文本转义了，这里还原成真标签
  s = s.replace(/&lt;(video|audio)([\s\S]*?)&gt;/gi, (_m, tag: string, attrs: string) => {
    const a = attrs.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const extra = /\bpreload\s*=/i.test(a) ? '' : ' preload="metadata"';
    return `<${tag}${a}${extra}></${tag}>`;
  });
  s = s.replace(/&lt;\/(video|audio)&gt;/gi, '');

  // ![视频](clip.mp4) / ![图](name.png) 统一走媒体库；失效的给占位
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (!src) return missBox(/(视频)/.test(alt) ? '视频已丢失' : '图片已丢失');
    if (/^data:/i.test(src)) return tag;
    if (/^https?:\/\//i.test(src) && !/^https?:\/\/riqian\.local\//i.test(src)) return tag;

    const m = mediaBySrc(src);
    if (!m) {
      const hint = `${alt} ${src}`;
      return missBox(
        /视频/.test(hint) || VIDEO_RE.test(src) ? '视频已丢失'
          : /音频/.test(hint) || AUDIO_RE.test(src) ? '音频已丢失' : '图片已丢失',
        src,
      );
    }
    const k = kindOf(m);
    if (k !== 'image') return playerHtml(m, k);
    const url = imgUrl(m.id) || fileUrl(m);
    if (!url) return missBox('图片已丢失', m.name || m.id);
    return `<img src="${escAttr(url)}" alt="${escAttr(alt || m.name || '')}" data-mid="${escAttr(m.id)}">`;
  });

  return s;
}

/* ---------------- 调色引擎：统一把 data-tone 变成 filter ---------------- */

const MEDIA_CSS = `
.rt video,.vid{max-width:100%;border-radius:10px;margin:.4em 0;background:#000;display:block}
.rt audio,.aud{max-width:100%;margin:.4em 0}
.mediamiss{
  display:inline-flex;align-items:center;padding:8px 12px;border:1px dashed var(--line);
  border-radius:10px;background:var(--panel2);color:var(--ink3);font-size:12.5px;line-height:1.4;margin:.3em 0;
}
.imgc video{width:100%;height:100%;object-fit:cover;display:block}
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('mm-style')) return;
  const st = document.createElement('style');
  st.id = 'mm-style';
  st.textContent = MEDIA_CSS;
  document.head.appendChild(st);
}

/**
 * 一遍 DOM 扫描：
 * - [data-tone=媒体id] → 套 filter（缩略图 / 背景 / 任意容器都能用）
 * - 正文里带 data-mid 的 img/video/audio → 套 filter；引用失效就换成占位
 *
 * 为什么要扫 DOM：日记正文是后端存的 HTML 字符串，前端渲染时没有机会逐张套样式。
 */
export function mediaDomPass(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-tone]').forEach((el) => {
    const raw = el.getAttribute('data-tone') || '';
    const f = toneFilter(raw.startsWith('{') ? raw : toneOf(raw));
    if (el.style.filter !== f) el.style.filter = f;
  });

  // 正文里的媒体 + 任何直接指向媒体库的 img/video/audio（含别处自己画的缩略图）
  const SEL = '.rt img, .rt video, .rt audio, .vid, .aud,'
    + ' img[src*="riqian.local"], video[src*="riqian.local"], audio[src*="riqian.local"]';
  root.querySelectorAll<HTMLElement>(SEL).forEach((el) => {
    if (el.hasAttribute('data-tone-live')) return;                 // 调色弹层的实时预览，别覆盖
    const host = el.closest('[data-tone]');
    if (host && host !== el) return;                               // 外层容器已经套过 filter，别叠加

    const mid = el.getAttribute('data-mid') || '';
    let m = mid ? resolveRef(mid) : null;
    if (!m && !mid) {
      // 老内容没有 data-mid：靠 src 反查，能查到就套调色（不回写 DOM，只改样式）
      const src = el.getAttribute('src') || '';
      if (src) m = mediaBySrc(src);
      if (!m) return;
    }
    if (!m) {
      if (el.getAttribute('data-miss') === '1') return;
      el.setAttribute('data-miss', '1');
      const box = document.createElement('span');
      box.className = 'mediamiss';
      const tag = el.tagName.toLowerCase();
      box.textContent = tag === 'video' ? '视频已丢失' : tag === 'audio' ? '音频已丢失' : '图片已丢失';
      el.replaceWith(box);
      return;
    }
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
      const f = toneFilter(m.tone);
      if (el.style.filter !== f) el.style.filter = f;
    }
  });
}

let engineOn = false;

/** 全局装一次：媒体变了 / 页面渲染了，都顺手把调色和失效占位补上 */
function installEngine() {
  if (engineOn || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  engineOn = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    try { mediaDomPass(document); } catch { /* 调色出错不能拖垮界面 */ }
  };
  const obs = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(run, 200);
  });
  const boot = () => {
    injectCss();
    obs.observe(document.body, { childList: true, subtree: true });
    run();
  };
  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot, { once: true });
}

installEngine();

/* ---------------- 记录筛选辅助（记录页 / 流借用） ---------------- */

/**
 * 判断一条日记里有没有某类媒体。api.entry.list 的 hasImg 只认图片，
 * 记录页要支持「带视频 / 带音频」时用它在前端二次过滤 recItems。
 */
export function entryHasMedia(values: Record<string, unknown> | null | undefined, kind: MediaKind): boolean {
  if (!values) return false;
  const hit = (text: string): boolean => {
    if (!text) return false;
    if (kind === 'video') return /<video[\s>]/i.test(text) || /\[video\]/i.test(text);
    if (kind === 'audio') return /<audio[\s>]/i.test(text) || /\[audio\]/i.test(text);
    if (/<img[\s>]/i.test(text) || /\[img[=\]]/i.test(text)) return true;
    return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(text);
  };
  for (const v of Object.values(values)) {
    if (typeof v === 'string') {
      if (hit(v)) return true;
      continue;
    }
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x !== 'string') continue;
        const m = resolveRef(x);
        if (m ? kindOf(m) === kind : hit(x)) return true;
      }
    }
  }
  return false;
}

/* ---------------- 工具条 ---------------- */

function MediaToolbar({ onChanged }: { onChanged: () => void }) {
  const reloadMedia = useStore((s) => s.reloadMedia);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState('');

  /**
   * 第 224 条：这个按钮一直写着「图片 / 音频 / 视频都能导」，
   * 但后端那个文件对话框的 filter 只认图片 —— 用户根本选不到 mp4。
   * 文件对话框那一头已经改了（MainForm.MediaImport），这里只是把结果说清楚。
   */
  const doImport = async () => {
    if (busy) return;
    setBusy('files');
    try {
      const r = await api.media.importFiles();
      const items = r?.items || [];
      if (items.length) {
        const ok = items.filter((x) => x.ok).length;
        const dup = items.filter((x) => x.ok && x.dup).length;
        if (ok) toast(`导入 ${ok} 个${dup ? `，${dup} 个内容重复已去重` : ''}`);
        else toast('这批都没导进来，看看文件是不是被占用着');
      }
      await reloadMedia();
      onChanged();
    } finally { setBusy(''); }
  };

  /** 第 233 条：一次选一个文件夹，连子目录一起导 —— 按原目录结构分好组 */
  const doImportFolder = async () => {
    if (busy) return;
    setBusy('folder');
    try {
      const r = await api.media.importFolder();
      if (r?.ok === false) { toast(r.err || '没导进来'); return; }
      const n = Number(r?.count || 0);
      const skip = Number(r?.skipped || 0);
      toast(n
        ? `从文件夹导入 ${n} 个${skip ? `，跳过 ${skip} 个不是媒体的文件` : ''}`
        : '这个文件夹里没有能导的媒体文件');
      await reloadMedia();
      onChanged();
    } finally { setBusy(''); }
  };

  const doScan = async () => {
    const r = await api.media.scan();
    toast(r?.count ? `扫描到 ${r.count} 个文件` : '投递区是空的（多媒体库_导入）');
    await reloadMedia();
    onChanged();
  };

  return (
    <>
      <button className="btn" data-act="import-files" disabled={!!busy} onClick={() => void doImport()}
        title="选一批文件：图片 / 音频 / 视频都行，相同内容自动去重">
        {busy === 'files' ? '导入中…' : '导入文件'}
      </button>
      <button className="btn" data-act="import-folder" disabled={!!busy} onClick={() => void doImportFolder()}
        title="选一个文件夹，里面的媒体文件连子目录一起导进来">
        {busy === 'folder' ? '导入中…' : '导入文件夹'}
      </button>
      <button className="btn" title="把文件丢进「多媒体库_导入」文件夹后点这里" onClick={() => void doScan()}>扫描投递区</button>
      <button className="btn" onClick={() => void api.media.openImport()}>打开投递区</button>
    </>
  );
}

/* ---------------- 选择器 ---------------- */

function MediaGridCell({
  m, picked, onClick,
}: {
  m: MediaItem;
  picked?: boolean;
  onClick: () => void;
}) {
  const k = kindOf(m);
  return (
    <div className="imgpick" onClick={onClick} title={`${m.name || m.id}\n${kindName(k)} · ${fmtBytes(m.bytes)}`}>
      <div className={`imgc ${picked ? 'sel' : ''}`} data-tone={k === 'image' ? m.id : undefined} style={k === 'image' ? toneStyle(m.id) : undefined}>
        {/* 第 155 条：图片默认是可拖的，一拖就会带着 Files 掉进全局 drop 监听里，
            同一张图被当成「从外面拖进来」再导一遍。这里关掉原生拖拽。 */}
        {k === 'image' ? (
          <img src={thumbUrl(m)} loading="lazy" alt="" draggable={false} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--ink3)' }}>
            <Icon name={k === 'video' ? 'play' : 'music'} size={24} />
            <span style={{ fontSize: 11 }}>{kindName(k)}</span>
          </div>
        )}
      </div>
      <div className="imgmeta" title={m.name}>{m.name || m.id.slice(0, 8)}</div>
    </div>
  );
}

/** 从媒体库挑图（可多选）；kind='video' 时就是挑视频 */
export function MediaPicker({
  single, kind = 'image', onClose, onDone,
}: {
  single?: boolean;
  kind?: MediaKindFilter;
  onClose: () => void;
  onDone: (ids: string[], items?: MediaItem[]) => void;
}) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<MediaItem[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void api.mediaList2(kind, q.trim(), 'new')
        .catch(() => api.media.list(q.trim(), 2000))
        .then((r) => {
          if (!alive) return;
          const arr = Array.isArray(r) ? r : [];
          mergeMediaIndex(arr);
          setList(kind === 'all' ? arr : arr.filter((m) => kindOf(m) === kind));
        })
        .catch(() => { if (alive) setList([]); });
    }, 140);
    return () => { alive = false; clearTimeout(t); };
  }, [q, kind, tick]);

  const pick = (m: MediaItem) => {
    if (single) { onDone([m.id], [m]); return; }
    setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]));
  };

  const label = kind === 'video' ? '视频' : kind === 'audio' ? '音频' : kind === 'all' ? '媒体' : '图片';
  const emptyText = kind === 'video'
    ? '媒体库里还没有视频。从电脑导入 mp4 / webm，或丢进投递区再扫描。'
    : kind === 'audio'
      ? '媒体库里还没有音频。从电脑导入 mp3 / m4a / wav。'
      : '媒体库是空的，先导入几张图片。';

  return (
    <Dialog
      title={single ? `选一个${label}` : `从媒体库选${label}（可多选）`}
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button
          className="btn primary"
          onClick={() => {
            if (!picked.length) return;
            onDone(picked, list.filter((m) => picked.includes(m.id)));
          }}
        >
          加入{picked.length ? ` ${picked.length} 项` : ''}
        </button>
      </>}
    >
      <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <SearchBox
          value={q}
          onChange={setQ}
          onSubmit={setQ}
          placeholder="搜索文件名或 id…"
          style={{ flex: '1 1 220px' }}
        />
        <MediaToolbar onChanged={() => setTick((t) => t + 1)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(104px,1fr))', gap: 10, maxHeight: '56vh', overflow: 'auto' }}>
        {list.length ? list.map((m) => (
          <MediaGridCell key={m.id} m={m} picked={picked.includes(m.id)} onClick={() => pick(m)} />
        )) : <EmptyState grid>{q ? '没有匹配的结果。' : emptyText}</EmptyState>}
      </div>
    </Dialog>
  );
}

/**
 * 第 232 条：详细信息视图。
 *
 * 资源管理器那种表格 —— 缩略图 + 名字 + 类型 + 尺寸 + 大小 + 时间 + 文件夹。
 * 为什么单独写一版而不是复用 MediaRow：列表视图一行要放 4 个数字挤在固定宽度里，
 * 表格要能排序、要能对齐表头、要能整列对齐数字，两边的诉求不一样，硬合并只会两边都难看。
 */
function MediaTable({
  items, pick, sel, onOpen, onCtx, onToggle, onSelAll, dragPropsOf,
}: {
  items: MediaItem[];
  pick?: boolean;
  sel: string[];
  onOpen: (m: MediaItem) => void;
  onCtx: (e: React.MouseEvent, m: MediaItem) => void;
  onToggle: (id: string) => void;
  onSelAll: (on: boolean) => void;
  /** 第 154 条：每行可拖 */
  dragPropsOf?: (m: MediaItem) => Record<string, unknown>;
}) {
  const [sortKey, setSortKey] = useState<'name' | 'kind' | 'bytes' | 'time' | 'folder'>('time');
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const arr = items.slice();
    const sign = asc ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'name': return sign * (a.alias || a.name || '').localeCompare(b.alias || b.name || '', 'zh');
        case 'kind': return sign * kindOf(a).localeCompare(kindOf(b));
        case 'bytes': return sign * ((a.bytes || 0) - (b.bytes || 0));
        case 'folder': return sign * (a.folder || '').localeCompare(b.folder || '', 'zh');
        default: return sign * String(a.createdAt || a.mtime || '').localeCompare(String(b.createdAt || b.mtime || ''));
      }
    });
    return arr;
  }, [items, sortKey, asc]);

  const allOn = items.length > 0 && items.every((m) => sel.includes(m.id));

  const th = (k: typeof sortKey, label: string, cls?: string) => (
    <th
      className={`mth ${cls || ''} ${sortKey === k ? 'on' : ''}`}
      data-th={k}
      onClick={() => { if (sortKey === k) setAsc((v) => !v); else { setSortKey(k); setAsc(false); } }}
      title="点一下按这列排，再点一下反向"
    >
      {label}{sortKey === k ? <span className="mth-a">{asc ? '↑' : '↓'}</span> : null}
    </th>
  );

  return (
    <div className="mtable-wrap">
      <table className="mtable">
        <thead>
          <tr>
            {pick ? (
              <th className="mth mth-ck">
                <button
                  className={`pickbox inline ${allOn ? 'on' : ''}`}
                  title={allOn ? '全不选' : '全选'}
                  onClick={() => onSelAll(!allOn)}
                >{allOn ? '✓' : ''}</button>
              </th>
            ) : null}
            <th className="mth mth-th" />
            {th('name', '名称')}
            {th('kind', '类型', 'num')}
            <th className="mth num">尺寸</th>
            {th('bytes', '大小', 'num')}
            {th('time', '加入时间', 'num')}
            {th('folder', '文件夹')}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const k = kindOf(m);
            return (
              <tr
                key={m.id}
                className="mtr"
                data-media={m.id}
                data-selid={m.id}
                {...(dragPropsOf ? dragPropsOf(m) : {})}
                onDoubleClick={() => onOpen(m)}
                onContextMenu={(e) => onCtx(e, m)}
              >
                {pick ? (
                  <td className="mtd mtd-ck">
                    <button
                      className={`pickbox inline ${sel.includes(m.id) ? 'on' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onToggle(m.id); }}
                    >{sel.includes(m.id) ? '✓' : ''}</button>
                  </td>
                ) : null}
                <td className="mtd mtd-th">
                  <span className="mthumb">
                    {k === 'image'
                      ? <img src={thumbUrl(m)} loading="lazy" alt="" style={{ ...toneStyle(m.id) }} />
                      : <Icon name={k === 'video' ? 'play' : 'music'} size={13} />}
                  </span>
                </td>
                <td className="mtd mtd-name" title={m.alias ? `${m.alias}（原名 ${m.name || m.id}）` : (m.name || m.id)}>
                  {m.alias || m.name || m.id.slice(0, 10)}
                </td>
                <td className="mtd num">{kindName(k)}</td>
                <td className="mtd num">{k === 'image' && m.width && m.height ? `${m.width}×${m.height}` : '—'}</td>
                <td className="mtd num">{fmtBytes(m.bytes)}</td>
                <td className="mtd num">{fmtTime(m.createdAt || m.mtime)}</td>
                <td className="mtd">{m.folder || <span className="muted">未分类</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- 多媒体库 ---------------- */

const KIND_TABS: { v: MediaKindFilter; t: string }[] = [
  { v: 'all', t: '全部' },
  { v: 'image', t: '图片' },
  { v: 'audio', t: '音频' },
  { v: 'video', t: '视频' },
];

/* 第 189 条：排序只留三个维度，升/降由旁边那个开关管 —— 不给每个维度各配两个按钮 */
const SORTS: { v: MediaSort; t: string }[] = [
  { v: 'new', t: '时间' },
  { v: 'name', t: '名称' },
  { v: 'size', t: '大小' },
];

/**
 * 第 232 条：浏览方式。用户原话是「就是和 windows 那个差不多」，
 * 所以按资源管理器那五档来：超大图标 / 大图标 / 列表 / 详细信息，再加上本应用特有的「按月」。
 */
const VIEW_TABS: { v: MediaView; n: string; icon: 'grid' | 'image' | 'list' | 'sliders' | 'calendar'; tip: string }[] = [
  { v: 'xl', n: '超大图标', icon: 'image', tip: '一格 220px，看构图用' },
  { v: 'grid', n: '图标', icon: 'grid', tip: '标准网格，一格 150px' },
  { v: 'list', n: '列表', icon: 'list', tip: '一行一条，带小缩略图' },
  { v: 'detail', n: '详细信息', icon: 'sliders', tip: '表格：类型 / 尺寸 / 大小 / 时间 / 文件夹' },
  { v: 'month', n: '按月', icon: 'calendar', tip: '按月份分组折叠' },
];

/** 列表视图的一行：类型 / 尺寸 / 体积 / 时间，音视频带内联播放 */
function MediaRow({
  m, onOpen, pick, checked, onToggle, dragProps,
}: {
  m: MediaItem;
  onOpen: () => void;
  pick?: boolean;
  checked?: boolean;
  onToggle?: () => void;
  /** 第 154 条：拖拽（只有整理模式下才给） */
  dragProps?: Record<string, unknown>;
}) {
  const k = kindOf(m);
  const [open, setOpen] = useState(false);
  const label = m.alias || m.name || m.id.slice(0, 8);
  return (
    <div style={{ borderBottom: '1px dashed var(--line2)' }} data-selid={m.id} {...dragProps}>
      <div className="mrow" style={{ borderBottom: 0, cursor: 'pointer' }} onClick={onOpen}>
        <div
          style={{
            width: 34, height: 34, flex: '0 0 auto', borderRadius: 8, overflow: 'hidden',
            background: 'var(--panel2)', border: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink3)',
          }}
        >
          {k === 'image'
            ? <img src={thumbUrl(m)} loading="lazy" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', ...toneStyle(m.id) }} />
            : <Icon name={k === 'video' ? 'play' : 'music'} size={15} />}
        </div>
        {pick ? (
          <button
            className={`pickbox inline ${checked ? 'on' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          >{checked ? '✓' : ''}</button>
        ) : null}
        <div
          className="mn"
          style={{ flex: '1 1 auto', minWidth: 0 }}
          title={m.alias ? `${m.alias}（原文件名 ${m.name || m.id}）` : (m.name || m.id)}
        >{label}</div>
        <span style={{ fontSize: 11, color: 'var(--ink3)', width: 34 }}>{kindName(k)}</span>
        <span style={{ fontSize: 11, color: 'var(--ink3)', width: 88, textAlign: 'right' }}>
          {k === 'image' && m.width && m.height ? `${m.width}×${m.height}` : '—'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink3)', width: 70, textAlign: 'right' }}>{fmtBytes(m.bytes)}</span>
        <span style={{ fontSize: 11, color: 'var(--ink3)', width: 122, textAlign: 'right' }}>{fmtTime(m.createdAt || m.mtime)}</span>
        {k !== 'image' ? (
          <button
            className="btn sm ghost"
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          >{open ? '收起' : '播放'}</button>
        ) : null}
      </div>
      {k !== 'image' && open ? (
        <div style={{ padding: '0 4px 10px 43px' }}>
          {k === 'video'
            ? <video className="vid" src={fileUrl(m)} controls preload="metadata" style={{ maxHeight: '32vh' }} />
            : <audio className="aud" src={fileUrl(m)} controls preload="metadata" />}
        </div>
      ) : null}
    </div>
  );
}

/** 月份组头：月份 / 数量 / 体积，右侧折叠箭头（可折叠时才有） */
function MonthBar({
  label, count, bytes, folded, onToggle,
}: {
  label: string;
  count: number;
  bytes: number;
  folded?: boolean;
  onToggle?: () => void;
}) {
  const canFold = !!onToggle;
  return (
    <div
      onClick={onToggle}
      title={canFold ? (folded ? '展开这个月' : '收起这个月') : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', margin: '0 0 8px',
        background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8,
        cursor: canFold ? 'pointer' : 'default', userSelect: 'none',
        position: 'sticky', top: 0, zIndex: 2,
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{count} 项 · {fmtBytes(bytes)}</span>
      {canFold ? (
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink3)', lineHeight: 1 }}>
          {folded ? '›' : '⌄'}
        </span>
      ) : null}
    </div>
  );
}

/** 多媒体库总览：搜索 / 类型 / 排序 / 网格列表 / 单张详情（改名、删除、调色） */
export function MediaManager({ onClose, inline }: { onClose: () => void; inline?: boolean }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<MediaKindFilter>('all');
  const [sort, setSort] = useState<MediaSort>('new');
  /* 第 189 条：方向单独一个开关，别再为"最早/最晚"各来一个按钮 */
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  /* 第 151 条：文件夹筛选 + 清单
     第 220 条：清单改成层级（folder 是全路径，name 是最后一段，depth 用来缩进） */
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<{ folder: string; name?: string; own?: number; n: number; depth?: number }[]>([]);
  /* 第 151 条：标签筛选 + 标签清单 */
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  /* 第 151 条：新建了但还没放文件的文件夹，临时挂在筛选条上，移进文件后自然出现 */
  const [pendingFolder, setPendingFolder] = useState('');
  /* 第 154 条：整理模式（多选） */
  const [pickMode, setPickMode] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  /**
   * 第 232 条：用户要「像 Windows 那样」能换浏览方式 —— 超大图标 / 大图标 / 列表 / 详细信息。
   * 原来只有 grid / list / month 三档，大小固定，缩略图永远是 150px 一格。
   * 现在 grid 一档里再分「超大」和「标准」，detail 走表格式详细信息。
   * 偏好存 settings.mediaView，下次进来还是上次那个看法。
   */
  const [view, setViewState] = useState<MediaView>(() => {
    const v = String((useStore.getState().settings || {}).mediaView || 'grid');
    return (['xl', 'grid', 'list', 'detail', 'month'] as const).includes(v as MediaView) ? (v as MediaView) : 'grid';
  });
  const setView = (v: MediaView) => {
    setViewState(v);
    void useStore.getState().setSetting('mediaView', v);
  };
  /** 按月视图里收起来的月份 key；切类型 / 改搜索词时清空（重新全展开） */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<MediaItem | null>(null);
  const [toneOpen, setToneOpen] = useState(false);

  const reloadMedia = useStore((s) => s.reloadMedia);
  // 订阅一份索引：调色保存后 store 一换，缩略图就会跟着重算
  const indexed = useStore((s) => s.mediaList);
  const toast = useStore((s) => s.toast);

  const reload = useCallback(async (): Promise<MediaItem[]> => {
    setLoading(true);
    try {
      const list = await api.mediaList2(kind, q.trim(), sort, dir, folder, tag);
      const arr = Array.isArray(list) ? list : [];
      mergeMediaIndex(arr);
      setItems(arr);
      return arr;
    } catch {
      // 后端还没上 media.list2 时退回老接口，至少图片库还能用
      try {
        const list = await api.media.list(q.trim(), 2000);
        const raw = Array.isArray(list) ? list : [];
        mergeMediaIndex(raw);
        const arr = kind === 'all' ? raw : raw.filter((m) => kindOf(m) === kind);
        setItems(arr);
        return arr;
      } catch {
        setItems([]);
        return [];
      }
    } finally {
      setLoading(false);
    }
  }, [kind, q, sort, dir, folder, tag]);

  useEffect(() => {
    const t = setTimeout(() => { void reload(); }, 160);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => { void reloadMedia(); }, [reloadMedia]);

  /** 文件夹清单跟着列表一起刷（改完文件夹不用手动刷新页面） */
  useEffect(() => {
    void api.mediaFolders().then((r) => setFolders(Array.isArray(r) ? r : [])).catch(() => setFolders([]));
    void api.mediaTags().then((r) => setTags(Array.isArray(r) ? r : [])).catch(() => setTags([]));
  }, [items]);

  useEffect(() => { mediaDomPass(); }, [indexed, view, items]);

  const counts = useMemo(() => {
    const c = { image: 0, audio: 0, video: 0 };
    for (const m of items) c[kindOf(m)] += 1;
    return c;
  }, [items]);

  const totalBytes = useMemo(() => items.reduce((s, m) => s + (Number(m.bytes) || 0), 0), [items]);
  /** 月份分组：网格「按月」和列表小标题共用一份 */
  const groups = useMemo(() => groupByMonth(items), [items]);

  // 换类型 / 改搜索词后重新全展开，避免上次折叠把结果藏起来
  useEffect(() => { setFolded({}); }, [kind, q]);

  const toggleFold = (key: string) => setFolded((f) => ({ ...f, [key]: !f[key] }));

  /*
   * 第 154 条：框选。只在整理模式下启用 —— 平时在媒体库里拖鼠标应该是选文字 / 拖卡片，
   * 一进来就框选会让人点不开图。
   * preview 阶段只更新界面，commit 时把最后那批认下来（其实 preview 已经把 sel 更新到位，
   * commit 只是走一遍让语义清楚：松手那一刻状态就是结果）。
   */
  const marqRef = useRef<HTMLDivElement | null>(null);
  const marq = useMarquee({
    enabled: pickMode,
    rootRef: marqRef,
    onSelect: (ids, mode) => {
      if (mode === 'preview') { setSel(ids); return; }
      if (mode === 'commit') { setSel(ids); return; }
      setSel([]);
    },
    baseIds: () => sel,
  });

  /*
   * 第 154 条：拖到文件夹 / 标签上。
   * dataTransfer 只放个占位字符串 —— 真数据走模块变量。
   * 原因：WebView2 里在 dragover 阶段读 getData 是拿不到内容的（浏览器安全限制），
   * 而落点高亮恰恰要在 dragover 里决定，靠 dataTransfer 就必然要写两套逻辑。
   */
  const dragIds = useRef<string[]>([]);
  const startDrag = (id: string) => {
    // 拖一个没选中的 → 只拖它自己；拖一个已选中的 → 拖整批
    dragIds.current = sel.includes(id) ? sel : [id];
    if (!sel.includes(id)) setSel([id]);
  };
  const dropHot = useRef<HTMLElement | null>(null);
  const clearHot = () => {
    dropHot.current?.classList.remove('drop-hot');
    dropHot.current = null;
  };
  /** 给 chip 用的三个处理器：允许放下 / 高亮 / 真放下 */
  const droppable = (onDrop: (ids: string[]) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragIds.current.length) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const el = e.currentTarget as HTMLElement;
      if (dropHot.current && dropHot.current !== el) clearHot();
      dropHot.current = el;
      el.classList.add('drop-hot');
    },
    onDragLeave: (e: React.DragEvent) => {
      if ((e.currentTarget as HTMLElement).classList.contains('drop-hot')) clearHot();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      clearHot();
      const ids = dragIds.current;
      dragIds.current = [];
      if (!ids.length) return;
      onDrop(ids);
    },
  });

  const afterChange = async () => {
    setSel([]);
    await reloadMedia();
    const fresh = await reload();
    // store 的 reloadMedia 走的是老接口，可能只回图片；把刚拿到的音视频再并回去
    mergeMediaIndex(fresh);
    mediaDomPass();
  };

  /*
   * 第 234 条：媒体库以前完全没有右键菜单 —— 想删一张图必须点开详情再删。
   * 现在右键直接出菜单，常用的几件事都在里面。
   * 第 235 条说的也是这个意思：右键该有的能力不该被封死。
   */
  const ctx = useContextMenu();

  /**
   * 第 154 条：卡片 / 行能不能被拖。只有整理模式下才允许 ——
   * 平时拖卡片会被全局 drop 监听当成「从外面拖进来一个文件」，反而重复导入。
   */
  const dragProps = (m: MediaItem) => (pickMode ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      startDrag(m.id);
      // 必须给点内容，否则 Chromium 认为这次拖拽无效，dragover 一次都不触发
      e.dataTransfer.setData('text/plain', 'media');
      e.dataTransfer.effectAllowed = 'move';
      (e.currentTarget as HTMLElement).classList.add('media-drag-src');
    },
    onDragEnd: (e: React.DragEvent) => {
      (e.currentTarget as HTMLElement).classList.remove('media-drag-src');
      clearHot();
      dragIds.current = [];
    },
  } : {});

  /**
   * 第 217 条：把存储账本摊开说清楚。
   *
   * 用户对多媒体库最大的疑问就是「它到底省不省空间」。
   * 这里不画图表，就把三个数摆出来，外加一句人话解释：
   *   - 库里 X 条记录，磁盘上 Y 个文件 —— 如果 Y 明显小于记录数，说明去重在起作用
   *   - 真实占用：正文 + 缩略图分开算
   *   - 已删（软删）占了多少 —— 这些是能清的
   */
  const [storage, setStorage] = useState<{
    rows: number; alive: number; deleted: number; bytes: number;
    diskBytes: number; diskFiles: number; thumbFiles: number;
    byKind: Record<string, number>; mediaDir: string;
  } | null>(null);

  const showStorage = async () => {
    try {
      const r = await api.mediaStorage();
      setStorage(r);
    } catch {
      toast('读不到存储信息');
    }
  };

  const menuFor = (m: MediaItem): MenuItem[] => [
    { label: '打开看大图', hint: '双击也行', onClick: () => setDetail(m) },
    {
      label: m.alias ? '改显示名（现在有别名）' : '起个别名',
      onClick: () => setDetail(m),
    },
    {
      label: '复制文件名',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(m.name || m.id);
          toast('文件名已复制');
        } catch { toast('复制失败'); }
      },
    },
    {
      label: '复制媒体 id',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(m.id);
          toast('id 已复制，可以粘到日记里');
        } catch { toast('复制失败'); }
      },
    },
    { sep: true },
    {
      label: '移到文件夹…',
      onClick: async () => {
        /*
         * 第 220 条：这里支持两种写法 ——
         *   「旅行」        → 移到顶层那个文件夹
         *   「旅行/2024」   → 移到子文件夹（不存在就顺手建出来）
         * 用 / 分隔层级，比让用户去点一串按钮快。
         */
        const name = await askText(
          '移到文件夹',
          m.folder || '',
          '留空 = 移出文件夹（未分类）；用 / 分层次，比如 旅行/2024/京都',
        );
        if (name === null) return;
        await api.mediaBulk([m.id], 'folder', name.trim().replace(/^\/+|\/+$/g, ''));
        toast(`已移到「${name.trim() || '未分类'}」`);
        await afterChange();
      },
    },
    {
      label: pickMode ? '取消勾选' : '勾选（整理用）',
      onClick: () => {
        if (!pickMode) setPickMode(true);
        setSel((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]));
      },
    },
    { sep: true },
    {
      label: '删除',
      danger: true,
      confirm: `从媒体库里删掉这个${kindName(kindOf(m))}？\n（只删库记录和文件，已引用它的日记会显示缺图）`,
      onClick: () => void remove(m),
    },
  ];

  const remove = async (m: MediaItem) => {
    if (!(await askConfirm(`从媒体库里删掉这个${kindName(kindOf(m))}？`, {
      body: '只删库记录和文件，已引用它的日记会显示缺图。',
      ok: '删除',
    }))) return;
    await api.media.remove(m.id, 1);
    toast('已删除');
    setDetail(null);
    await afterChange();
  };

  if (detail) {
    const k = kindOf(detail);
    return (
      <>
        <Dialog
          title={detail.name || detail.id}
          wide
          onClose={() => setDetail(null)}
          footer={<>
            {k === 'image' ? (
              <button className="btn" onClick={() => setToneOpen(true)}>
                <Icon name="sliders" size={13} />调整
              </button>
            ) : null}
            {k === 'image' ? (
              <button
                className="btn"
                title="把这一张设为当前这一天的背景（不影响其他日子）"
                onClick={async () => {
                  const st = useStore.getState();
                  await st.setBg(detail.id, '');
                  st.toast('已设为当天背景');
                  setDetail(null);
                  void st.go('today');
                }}
              >
                <Icon name="image" size={13} />设为背景
              </button>
            ) : null}
            {k === 'audio' ? (
              <button
                className="btn"
                title="用作提醒 / 番茄结束时的提示音"
                onClick={async () => {
                  const st = useStore.getState();
                  await st.setSetting('notifySoundId', detail.id);
                  await st.setSetting('notifySound', '1');
                  st.toast('已设为提醒音');
                }}
              >
                <Icon name="bell" size={13} />设为提醒音
              </button>
            ) : null}
            <button className="btn danger" onClick={() => void remove(detail)}>删除</button>
            <button className="btn" onClick={() => setDetail(null)}>关闭</button>
            <button
              className="btn primary"
              onClick={async () => {
                const input = document.getElementById('mmName') as HTMLInputElement | null;
                await api.mediaAlias(detail.id, input?.value ?? '');
                toast('别名已保存');
                setDetail(null);
                await afterChange();
              }}
            >
              保存别名
            </button>
          </>}
        >
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            {k === 'image' ? (
              <img
                src={fileUrl(detail) || thumbUrl(detail)}
                style={{ maxWidth: '100%', maxHeight: '48vh', borderRadius: 10, filter: toneFilter(detail.tone) }}
                alt=""
              />
            ) : k === 'video' ? (
              <video
                className="vid"
                src={fileUrl(detail)}
                controls
                preload="metadata"
                style={{ maxWidth: '100%', maxHeight: '48vh', borderRadius: 10, filter: toneFilter(detail.tone) }}
              />
            ) : (
              <audio className="aud" src={fileUrl(detail)} controls preload="metadata" />
            )}
          </div>
          <div className="set-row"><div className="lbl">别名<small>只影响显示与搜索，磁盘上的文件名和引用都不动</small></div></div>
          <input
            className="inp" id="mmName"
            defaultValue={detail.alias || ''}
            placeholder={detail.name || '（没起别名，显示原文件名）'}
          />
          <div className="set-row">
            <div className="lbl">原文件名</div>
            <span className="val" style={{ wordBreak: 'break-all' }}>{detail.name || '—'}</span>
          </div>
          <div className="set-row">
            <div className="lbl">文件夹</div>
            <span className="val">{detail.folder || '未分类'}</span>
          </div>
          {/* 第 151 条：标签。一个文件可以有多个，比文件夹灵活 */}
          <div className="set-row">
            <div className="lbl">标签<small>多个用逗号隔开，一个文件可以有多个标签</small></div>
            <input
              className="inp" id="mmTags" style={{ maxWidth: 220 }}
              defaultValue={detail.tags || ''}
              placeholder="旅行, 素材, 头像"
            />
            <button
              className="btn sm" data-act="save-tags"
              onClick={async () => {
                const el = document.getElementById('mmTags') as HTMLInputElement | null;
                if (!el) return;
                const r = await api.mediaSetTags(detail.id, el.value);
                toast(r?.tags ? `标签：${r.tags}` : '标签已清空');
                await afterChange();
                setDetail((prev) => (prev && prev.id === detail.id ? { ...prev, tags: r?.tags || '' } : prev));
              }}
            >保存</button>
          </div>
          <div className="set-row" style={{ marginTop: 12 }}>
            <div className="lbl">唯一 id</div>
            <span className="pathbox" style={{ padding: '4px 8px' }}>{detail.id}</span>
          </div>
          <div className="set-row">
            <div className="lbl">类型</div>
            <span className="val">{kindName(k)}{detail.ext ? ` · ${detail.ext.replace(/^\./, '')}` : ''}</span>
          </div>
          <div className="set-row">
            <div className="lbl">尺寸 / 大小</div>
            <span className="val">
              {k === 'image' && detail.width && detail.height ? `${detail.width}×${detail.height} · ` : ''}
              {fmtBytes(detail.bytes)}
            </span>
          </div>
          <div className="set-row">
            <div className="lbl">导入时间</div>
            <span className="val">{fmtTime(detail.createdAt || detail.mtime)}</span>
          </div>
        </Dialog>
        {toneOpen ? (
          <MediaToneDialog
            item={detail}
            onClose={() => setToneOpen(false)}
            onSaved={async (toneJson) => {
              await afterChange();
              // 详情里那张图立刻换成新参数，不用重新打开
              setDetail((prev) => (prev && prev.id === detail.id ? { ...prev, tone: toneJson } : prev));
            }}
          />
        ) : null}
      </>
    );
  }

  const body = (
    <>
      <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <SearchBox
          value={q}
          onChange={setQ}
          onSubmit={setQ}
          placeholder="搜索文件名、扩展名或 id…"
          style={{ flex: '1 1 240px' }}
        />
        <MediaToolbar onChanged={() => { void afterChange(); }} />
        <span className="small muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }} title="当前筛选结果的总项数与总体积">
          合计 {items.length} 项 · {fmtBytes(totalBytes)}
        </span>
      </div>

      {/*
        第 206 条：这条筛选栏以前是「类型 + 排序 + 方向 + 视图」四组挤在一行里，
        还夹了个 margin-left:auto 往右顶。窗口一窄就折行，
        折出来的两截对不齐，看起来就是「粘成一坨」。
        现在按组切成独立的小块，每组自带小标题和左边界，折行时也是整块整块地掉下去。
      */}
      <div className="mfilter">
        <div className="mf-group">
          <span className="mf-k">类型</span>
          <div className="mf-opts">
            {KIND_TABS.map((t) => (
              <button key={t.v} className={`chip ${kind === t.v ? 'on' : ''}`} data-kind={t.v} onClick={() => setKind(t.v)}>{t.t}</button>
            ))}
          </div>
        </div>

        <div className="mf-group">
          <span className="mf-k">排序</span>
          <div className="mf-opts">
            {SORTS.map((t) => (
              <button key={t.v} className={`chip ${sort === t.v ? 'on' : ''}`} data-sort={t.v} onClick={() => setSort(t.v)}>{t.t}</button>
            ))}
            <button
              className="chip mf-dir"
              data-act="toggle-dir"
              data-tip="切换升序 / 降序"
              onClick={() => setDir(dir === 'desc' ? 'asc' : 'desc')}
            >{dir === 'desc' ? '↓ 降序' : '↑ 升序'}</button>
          </div>
        </div>

        <div className="mf-group mf-right">
          <span className="mf-k">看</span>
          <div className="mf-opts">
            {/* 第 232 条：五档浏览方式，和 Windows 资源管理器一个思路 */}
            {VIEW_TABS.map((t) => (
              <button
                key={t.v}
                className={`chip ${view === t.v ? 'on' : ''}`}
                data-view={t.v}
                title={t.tip}
                onClick={() => setView(t.v)}
              ><Icon name={t.icon} size={12} /> {t.n}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 第 151 条：文件夹筛选。这里不写「全部」——上面类型行已经有一个「全部」，
          两行同名的按钮挨着放，人和测试都会点错（写测试时真踩到了）。 */}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
        <span className="small muted">文件夹</span>
        <button
          className={`chip ${folder === '' ? 'on' : ''}`}
          data-folder=""
          onClick={() => setFolder('')}
        >不限</button>
        {folders.filter((f) => f.folder).map((f) => (
          <button
            key={f.folder}
            className={`chip ${folder === f.folder ? 'on' : ''}`}
            data-folder={f.folder}
            data-depth={f.depth ?? 0}
            /* 第 220 条：层级缩进。用 padding 而不是前置空格 —— 空格在按钮里会被压掉 */
            style={(f.depth ?? 0) > 0 ? { paddingLeft: 10 + (f.depth || 0) * 12 } : undefined}
            onClick={() => setFolder(f.folder)}
            /* 第 151 条：右键改文件夹名（一次改一批，不用一个个挪） */
            onContextMenu={async (e) => {
              e.preventDefault();
              /*
               * 第 220 条：有了层级之后，改名/新建都在这一层里做，别让用户手打斜杠。
               * 改名只改最后一段，前缀自动继承 —— 手打「旅行/2024」很容易打错层级。
               */
              const last = f.folder.split('/').pop() || f.folder;
              const name = await askText('重命名文件夹', last, '只改这一层的名字，子文件夹会一起跟过去');
              if (name === null || !name.trim() || name.trim() === last) return;
              const parent = f.folder.includes('/') ? f.folder.slice(0, f.folder.lastIndexOf('/') + 1) : '';
              const next = parent + name.trim();
              await api.mediaRenameFolder(f.folder, next);
              toast(`已改名成「${next}」`);
              if (folder === f.folder || folder.startsWith(f.folder + '/')) {
                setFolder(folder === f.folder ? next : next + folder.slice(f.folder.length));
              }
              await afterChange();
            }}
            title={`${f.folder}${f.own != null && f.n !== f.own ? ` · 本层 ${f.own} 个，含子文件夹共 ${f.n} 个` : ''}\n右键改名，Shift+右键新建这个文件夹的子文件夹`}
          >{f.name || f.folder} <span className="muted">{f.n}</span></button>
        ))}
        {pendingFolder && !folders.some((f) => f.folder === pendingFolder) ? (
          <button
            className={`chip ${folder === pendingFolder ? 'on' : ''}`}
            data-folder={pendingFolder}
            title="新文件夹还是空的，移进来一个文件它就真出现了"
            onClick={() => setFolder(pendingFolder)}
          >{pendingFolder} <span className="muted">0</span></button>
        ) : null}
        <button
          className={`chip ${folder === '__none__' ? 'on' : ''}`}
          data-folder="__none__"
          onClick={() => setFolder('__none__')}
        >未分类</button>
        <button
          className={`chip ${pickMode ? 'on' : ''}`}
          data-act="pickmode"
          style={{ marginLeft: 'auto' }}
          data-tip="进入整理模式：勾选后可以批量移动或删除"
          onClick={() => { setPickMode(!pickMode); setSel([]); }}
        ><Icon name="check-circle" size={12} /> {pickMode ? '完成整理' : '整理'}</button>
        {/* 第 151 条：新建文件夹。原来只能靠「移到文件夹」时随手打一个名字，
            想先建好空文件夹待整理没办法 —— 用户说的「应该可以新建更多文件夹」。 */}
        <button
          className="btn sm"
          data-act="new-folder"
          title="新建一个文件夹；当前选中了某个文件夹时，就建在它里面（第 220 条：可以无限嵌套）"
          onClick={async () => {
            /*
             * 第 220 条：嵌套。当前停在某个文件夹里时，新建默认建在它下面，
             * 这样点两下就能建出「旅行 → 2024 → 京都」这种结构，不用手打斜杠。
             */
            const parent = folder && folder !== '__none__' && !folder.includes('__none__') ? folder : '';
            const name = await askText(
              parent ? `在「${parent}」下新建子文件夹` : '新建文件夹',
              '',
              parent ? '建在选中的文件夹里面；留空取消' : '给这一批文件起个分类名，比如「旅行」「素材」「头像」',
            );
            if (name === null || !name.trim()) return;
            // 名字里带斜杠就等于直接建多层，顺手支持一下
            const full = (parent ? parent + '/' : '') + name.trim().replace(/^\/+|\/+$/g, '');
            const exists = folders.some((f) => f.folder === full);
            if (exists) { setFolder(full); toast(`「${full}」已经在了，直接切过去`); return; }
            setPendingFolder(full);
            toast(`「${full}」还没有文件。把文件移进来它就出现了`);
          }}
        ><Icon name="folder" size={12} /> {folder && folder !== '__none__' ? '新建子文件夹' : '新建文件夹'}</button>
        {folder || tag ? (
          <button
            className="btn sm ghost"
            data-act="clear-filter"
            title="清掉文件夹和标签筛选"
            onClick={() => { setFolder(''); setTag(''); }}
          >清除筛选</button>
        ) : null}
      </div>

      {/* 第 151 条：标签。一个文件可以同时属于多个分类，比文件夹更灵活 ——
          用户原话「新建更多文件夹、分类、标签等」。 */}
      {tags.length ? (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
          <span className="small muted">标签</span>
          <button
            className={`chip ${tag === '' ? 'on' : ''}`}
            data-tag=""
            onClick={() => setTag('')}
          >不限</button>
          {tags.slice(0, 20).map((t) => (
            <button
              key={t.tag}
              className={`chip ${tag === t.tag ? 'on' : ''}`}
              data-tag={t.tag}
              onClick={() => setTag(t.tag === tag ? '' : t.tag)}
              {...droppable(async (ids) => {
                await api.mediaBulk(ids, 'tag', t.tag);
                toast(`已给 ${ids.length} 项打上「${t.tag}」`);
                await afterChange();
              })}
            >{t.tag} <span className="muted">{t.n}</span></button>
          ))}
          {tags.length > 20 ? (
            <span className="small muted">还有 {tags.length - 20} 个</span>
          ) : null}
        </div>
      ) : null}

      {/* 第 154 条：多选后的批量操作条 */}
      {pickMode ? (
        <div className="row lg-bulk" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span className="small">已选 <b>{sel.length}</b> 项</span>
          <button className="btn sm" onClick={() => setSel(items.map((m) => m.id))}>全选</button>
          <button className="btn sm" onClick={() => setSel([])}>清空</button>
          <button
            className="btn sm"
            disabled={!sel.length}
            onClick={async () => {
              const name = await askText('移动到文件夹', '', '留空 = 移出文件夹（变成未分类）');
              if (name === null) return;
              await api.mediaBulk(sel, 'folder', name.trim());
              toast(`已把 ${sel.length} 项移到「${name.trim() || '未分类'}」`);
              await afterChange();
            }}
          >移到文件夹</button>
          {/* 第 151 条：批量打标签 / 去标签 */}
          <button
            className="btn sm"
            disabled={!sel.length}
            data-act="bulk-tag"
            onClick={async () => {
              const t = await askText('给选中的加个标签', tag || '', '多个用逗号隔开；一个文件可以有多个标签');
              if (t === null || !t.trim()) return;
              for (const one of t.split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) {
                await api.mediaBulk(sel, 'tag', one);
              }
              toast(`已给 ${sel.length} 项打上标签`);
              await afterChange();
            }}
          >打标签</button>
          <button
            className="btn sm"
            disabled={!sel.length}
            data-act="bulk-untag"
            onClick={async () => {
              const t = await askText('去掉哪个标签', tag || '', '多个用逗号隔开');
              if (t === null || !t.trim()) return;
              for (const one of t.split(/[,，、]/).map((x) => x.trim()).filter(Boolean)) {
                await api.mediaBulk(sel, 'untag', one);
              }
              toast(`已去掉标签`);
              await afterChange();
            }}
          >去标签</button>
          <button
            className="btn sm danger"
            disabled={!sel.length}
            onClick={async () => {
              if (!(await askConfirm(`删除选中的 ${sel.length} 项？`, {
                body: '只删库记录和文件，已引用它们的日记会显示缺图。',
                ok: '删除',
              }))) return;
              await api.mediaBulk(sel, 'delete');
              toast(`已删除 ${sel.length} 项`);
              await afterChange();
            }}
          >删除</button>
          <span className="small muted">空白处按住拖动可以框选整片；点空白处取消</span>
        </div>
      ) : null}

      <div className="small muted" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {loading
          ? '读取中…'
          : <span>{`共 ${items.length} 项 · 图片 ${counts.image} · 音频 ${counts.audio} · 视频 ${counts.video}`}</span>}
        {/*
          第 217 条：用户问「多媒体库到底符不符合最开始的设想 —— 一次导入多处引用、
          还能省存储空间」。事实是能省（按内容哈希去重，同一文件只有一份），
          但界面上从来没说过这件事。这里给一个入口，把账算给他看。
        */}
        <button className="btn sm ghost" style={{ marginLeft: 'auto' }} data-act="storage" onClick={() => void showStorage()}>
          <Icon name="database" size={12} /> 存储账本
        </button>
      </div>

      {/*
        第 154 条：框选。包一层 .marqwrap 当定位基准，框本身绝对定位在里面。
        ref 只指向「列表区」，不含上面的筛选条 —— 否则从筛选条上拉一下就把整屏选中了。
      */}
      <div className="marqwrap" data-picking={pickMode ? '1' : undefined} ref={marqRef} onMouseDown={marq.onMouseDown}>
        {marq.box ? (
          <div
            className="marq"
            style={{ left: marq.box.x, top: marq.box.y, width: marq.box.w, height: marq.box.h }}
          />
        ) : null}
      {items.length ? (
        (view === 'grid' || view === 'xl') ? (
          /* 第 232 条：同一份数据，只改最小列宽 —— 超大图标 220px，标准 150px */
          <div
            className={`mgrid ${view === 'xl' ? 'xl' : ''}`}
            data-viewname={view}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill,minmax(${view === 'xl' ? 220 : 150}px,1fr))`,
              gap: view === 'xl' ? 16 : 12,
              maxHeight: inline ? 'none' : '58vh',
              overflow: 'auto',
            }}
          >
            {items.map((m) => (
              <MediaCard
                key={m.id}
                m={m}
                onOpen={() => setDetail(m)}
                onCtx={(e) => ctx.open(e, menuFor(m))}
                pick={pickMode}
                checked={sel.includes(m.id)}
                onToggle={() => setSel((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                dragProps={dragProps(m)}
              />
            ))}
          </div>
        ) : view === 'detail' ? (
          /* 第 232 条：详细信息 —— 表格，列可以按需要多看几个字段 */
          <MediaTable
            items={items}
            pick={pickMode}
            sel={sel}
            onOpen={(m) => setDetail(m)}
            onCtx={(e, m) => ctx.open(e, menuFor(m))}
            onToggle={(id) => setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
            onSelAll={(on) => setSel(on ? items.map((m) => m.id) : [])}
            dragPropsOf={pickMode ? dragProps : undefined}
          />
        ) : view === 'month' ? (
          <div style={{ maxHeight: inline ? 'none' : '58vh', overflow: 'auto', paddingRight: 2 }}>
            {groups.map((g) => (
              <section key={g.key} style={{ marginBottom: 14 }}>
                <MonthBar
                  label={g.label}
                  count={g.items.length}
                  bytes={g.bytes}
                  folded={!!folded[g.key]}
                  onToggle={() => toggleFold(g.key)}
                />
                {folded[g.key] ? null : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
                    {g.items.map((m) => (
                      <MediaCard
                key={m.id}
                m={m}
                onOpen={() => setDetail(m)}
                onCtx={(e) => ctx.open(e, menuFor(m))}
                pick={pickMode}
                checked={sel.includes(m.id)}
                onToggle={() => setSel((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
              />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="mlist" style={{ maxHeight: inline ? 'none' : '58vh', overflow: 'auto' }}>
            {groups.map((g) => (
              <div key={g.key}>
                <MonthBar label={g.label} count={g.items.length} bytes={g.bytes} />
                {g.items.map((m) => (
                  <MediaRow
                    key={m.id}
                    m={m}
                    onOpen={() => setDetail(m)}
                    pick={pickMode}
                    checked={sel.includes(m.id)}
                    onToggle={() => setSel((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                    dragProps={dragProps(m)}
                  />
                ))}
              </div>
            ))}
          </div>
        )
      ) : (
        <EmptyState style={{ lineHeight: 1.9 }}>
          {q.trim()
            ? '没有匹配的媒体。换个关键词，或者把搜索框清空。'
            : kind !== 'all'
              ? `库里还没有${kindName(kind)}。切到「全部」看看，或者从电脑导入。`
              : '多媒体库还是空的。点「从电脑导入」挑图片 / 音频 / 视频；也可以把文件拖进「多媒体库_导入」文件夹，再点「扫描投递区」。'}
        </EmptyState>
      )}
      </div>
    </>
  );

  /* 第 217 条：存储账本弹层 */
  const storageNode = storage ? (
    <Dialog
      title="多媒体库 · 存储账本"
      onClose={() => setStorage(null)}
      footer={<button className="btn" onClick={() => setStorage(null)}>知道了</button>}
    >
      <div className="mstat-row">
        <div className="mstat"><b>{storage.alive}</b><span>在库条目</span></div>
        <div className="mstat"><b>{storage.diskFiles}</b><span>磁盘文件</span></div>
        <div className="mstat"><b>{fmtBytes(storage.diskBytes)}</b><span>真实占用</span></div>
      </div>

      <div className="small" style={{ lineHeight: 1.9, margin: '14px 0' }}>
        <b>去重是怎么回事：</b>导入时按文件内容算 SHA-256，用哈希前 16 位当 id。
        同一个文件（哪怕改了名、放在不同文件夹）导多少次，磁盘上都<b>只有一份</b>，
        库表里也只有一行 —— 这就是省空间的地方。日记里引用它一百次也不会多占空间。
      </div>

      <div className="mstat-row">
        <div className="mstat"><b>{fmtBytes(storage.bytes)}</b><span>媒体本体</span></div>
        <div className="mstat"><b>{Math.max(0, storage.diskBytes - storage.bytes)}</b><span>其他（缩略图 / 临时）</span></div>
        <div className="mstat"><b>{storage.deleted}</b><span>已删待清</span></div>
      </div>

      {storage.deleted > 0 ? (
        <div className="small muted" style={{ marginTop: 10, lineHeight: 1.8 }}>
          有 {storage.deleted} 条已删除但文件还留在磁盘上。在「设置 → 存储」里清理缓存可以释放它们。
        </div>
      ) : null}

      <div className="small muted" style={{ marginTop: 14, lineHeight: 1.8, wordBreak: 'break-all' }}>
        文件位置：{storage.mediaDir}
      </div>
    </Dialog>
  ) : null;

  return (
    <>
      {ctx.node}
      {storageNode}
      {inline ? <div className="card">{body}</div> : (
        <Dialog
          title="多媒体库"
          wide
          onClose={onClose}
          footer={<button className="btn" onClick={onClose}>关闭</button>}
        >
          {body}
        </Dialog>
      )}
    </>
  );
}

/** 网格里的一格：图片给缩略图，音视频直接放内联播放器（不自动播放） */
function MediaCard({
  m, onOpen, pick, checked, onToggle, onCtx, dragProps,
}: {
  m: MediaItem;
  onOpen: () => void;
  /** 第 154 条：整理模式下的勾选 */
  pick?: boolean;
  checked?: boolean;
  onToggle?: () => void;
  /** 第 234 条：右键菜单 */
  onCtx?: (e: React.MouseEvent) => void;
  /** 第 154 条：拖拽（只有整理模式下才给） */
  dragProps?: Record<string, unknown>;
}) {
  const k = kindOf(m);
  const label = m.alias || m.name || m.id.slice(0, 8);
  return (
    <div className={`imgpick ${checked ? 'picked' : ''}`} data-id={m.id} data-selid={m.id} style={{ gap: 5 }} onContextMenu={onCtx} {...dragProps}>
      <div style={{ position: 'relative' }}>
        {pick ? (
          <button
            className={`pickbox ${checked ? 'on' : ''}`}
            data-tip={checked ? '取消选择' : '选择'}
            onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          >{checked ? '✓' : ''}</button>
        ) : null}
        {k === 'image' ? (
          <div className="imgc" data-tone={m.id} style={toneStyle(m.id)} onClick={onOpen} title={m.name || m.id}>
            {/* 第 155 条：图片默认是可拖的，一拖就会带着 Files 掉进全局 drop 监听里，
                同一张图被当成「从外面拖进来」再导一遍。这里关掉原生拖拽。 */}
            <img src={thumbUrl(m)} loading="lazy" alt="" draggable={false} />
          </div>
        ) : (
          <div
            className="imgc"
            style={{ cursor: 'pointer' }}
            onClick={onOpen}
            title={`${m.name || m.id} · ${fmtBytes(m.bytes)}`}
          >
            {k === 'video'
              ? <video
                  src={fileUrl(m)}
                  controls
                  preload="metadata"
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', ...toneStyle(m.id) }}
                />
              : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 4 }}>
                  <Icon name="music" size={18} />
                  <audio
                    src={fileUrl(m)}
                    controls
                    preload="metadata"
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: '100%', height: 26 }}
                  />
                </div>
              )}
          </div>
        )}
        <span style={{
          position: 'absolute', left: 5, top: 5, padding: '1px 6px', borderRadius: 20,
          background: 'rgba(0,0,0,.5)', color: '#fff', fontSize: 10, letterSpacing: '.04em',
        }}>{kindName(k)}</span>
      </div>
      <div
        className="imgmeta"
        title={m.alias ? `${m.alias}（原文件名 ${m.name || m.id}）` : (m.name || m.id)}
        onClick={onOpen}
        style={{ cursor: 'pointer' }}
      >
        {label}
      </div>
      <div className="imgmeta" style={{ color: 'var(--ink3)' }}>
        {k === 'image' && m.width ? `${m.width}×${m.height} · ` : ''}{fmtBytes(m.bytes)}
      </div>
    </div>
  );
}

export function ImageViewer({ file, onClose }: { file: string; onClose: () => void }) {
  return (
    <Dialog title="查看图片" wide onClose={onClose} footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div style={{ textAlign: 'center' }}>
        <img src={rawUrl(file)} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 10 }} alt="" />
      </div>
    </Dialog>
  );
}
