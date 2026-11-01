import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { setPendingToastAction } from '../components/ui';
import type { Habit, JournalModule, MediaItem, ModuleType, QuoteRef } from '../types';
import { MOODS, WEATHERS, TYPE_NAME } from '../lib/const';
import { imgUrl, rawUrl, resolveRef } from '../lib/media';
import { HabitWidget, habitIsDone } from './HabitWidget';
import { RichText, RichToolbar } from '../editors/RichText';
import { BBCodeEditor, MarkdownEditor, bbRender, mdRender } from '../editors/SourceEditors';
import { MediaPicker, ImageViewer, mediaDomPass, toneStyle } from '../features/media';
import { TexDialog } from '../features/TexDialog';
import { texNodeHtml } from '../lib/latex';
import { importImageFiles, imageFilesFromDataTransfer, pickImageFiles } from '../lib/upload';
import { Icon } from '../components/Icons';
import { htmlToBb, htmlToMd } from '../lib/htmlToSource';
import { moduleBgStyle, readModuleBg, veilStyle, writeModuleBg } from '../features/bgRotate';

/* ---------------- 单模块外壳 ---------------- */

/**
 * 「今天」页里的模块只负责显示与填写。
 * 排序、改名、增删全部收到「设置 → 日记与模块」里 —— 主编辑区越干净越好，
 * 这也是用户第 36 条明确要求的：具体应用页保持固定，灵活性放在设置里。
 *
 * 第 237 条改了两件事：
 *  1. 关掉后给撤回窗口（走 Toast 的撤回槽），而且**推迟执行** ——
 *     在用户确认之前压根没改数据，所以「撤回」不需要回滚逻辑。
 *  2. 这里的 ✕ 只关掉**这一篇日记**里的模块（`modules.hideOn`），
 *     不再写全局 `modules.enabled`。用户原话：
 *     「在该页面中关闭，不应该影响未来或者从前的每一天。」
 *     想长期关掉，去「设置 → 日记与模块」，那里的开关才是全局的。
 */
const HideCtx = createContext<(id: string, title: string) => void>(() => {});

function ModuleShell({
  m, hint, extraTools, children,
}: {
  m: JournalModule;
  hint?: string;
  extraTools?: React.ReactNode;
  children: React.ReactNode;
}) {
  const settings = useStore((s) => s.settings);
  const onHide = useContext(HideCtx);

  const quiet = String(settings.moduleTools ?? '1') === '0';
  /* 第 179 条：模块自己的背景。存在 modules.config 里，模块删了就跟着走。 */
  const bg = readModuleBg(m.config);
  const [bgOpen, setBgOpen] = useState(false);
  const reloadModules = useStore((s) => s.reloadModules);

  const setBg = async (next: typeof bg) => {
    /* 合并写回：config 里还有这个模块自己的别的参数，不能整份盖掉 */
    await api.modules.update({ id: m.id, config: writeModuleBg(m.config, next) });
    await reloadModules();
  };

  return (
    <div className={`mod ${quiet ? 'quiet' : ''} ${bg.src ? 'has-bg' : ''}`} data-mod={m.id} style={{ position: 'relative', overflow: 'hidden' }}>
      {bg.src ? (
        <>
          <div style={moduleBgStyle(bg)} aria-hidden />
          <div style={veilStyle(bg)} aria-hidden />
        </>
      ) : null}
      <div className="mod-head" style={bg.src ? { position: 'relative', zIndex: 2 } : undefined}>
        <span className="t">{m.title || TYPE_NAME[m.type] || m.type}</span>
        {hint ? <span className="hint">{hint}</span> : null}
        <span className="mod-tools">
          {extraTools}
          {/* 第 179 条：每个模块单独设背景，只影响这一块 */}
          <button
            title="给这个模块单独设背景"
            onClick={() => setBgOpen(true)}
            style={bg.src ? { color: 'var(--accent)' } : undefined}
          >
            <Icon name="image" size={12} />
          </button>
          <button
            title="在这篇日记里隐藏（只影响这一篇，可在设置里长期关闭）"
            onClick={() => onHide(m.id, m.title || TYPE_NAME[m.type] || m.type)}
          >
            ✕
          </button>
        </span>
      </div>
      {/* 有背景图时内容要抬到蒙层之上，否则一片灰压着字 */}
      <div style={bg.src ? { position: 'relative', zIndex: 2 } : { display: 'contents' }}>
        {children}
      </div>

      {bgOpen ? (
        <ModuleBgDialog
          current={bg}
          onClose={() => setBgOpen(false)}
          onDone={(next) => { setBgOpen(false); void setBg(next); }}
        />
      ) : null}
    </div>
  );
}

/**
 * 第 179 条：模块背景设置弹层。
 *
 * 只给「图 / 色」两选，不做全套调色 —— 只有一个 12px 高的模块头，
 * 调色板放上来反而更难对。压暗和透明度两个滑杆够用了。
 */
function ModuleBgDialog({
  current, onClose, onDone,
}: {
  current: ReturnType<typeof readModuleBg>;
  onClose: () => void;
  onDone: (next: ReturnType<typeof readModuleBg>) => void;
}) {
  const media = useStore((s) => s.mediaList);
  const [src, setSrc] = useState(current.src);
  const [veil, setVeil] = useState(current.veil);
  const [alpha, setAlpha] = useState(current.alpha);
  const images = media.filter((m) => (m.kind || 'image') === 'image');

  return (
    <div className="mask" style={{ zIndex: 320 }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" style={{ width: 'min(560px,94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="h">
          <h3><Icon name="image" size={14} />这个模块的背景</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="b">
          <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="small muted">底色</span>
            {['', '#f7f3ea', '#eef2f6', '#f3eee9', '#eaf0ea', '#f0ecf5'].map((c) => (
              <button
                key={c || 'none'}
                className={`chip ${src === c ? 'on' : ''}`}
                style={c ? { background: c, borderColor: 'var(--line)' } : undefined}
                onClick={() => setSrc(c)}
              >{c || '不设'}</button>
            ))}
          </div>

          <div className="small muted" style={{ marginBottom: 6 }}>或者从多媒体库选一张图（{images.length} 张）</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(66px,1fr))', gap: 6, maxHeight: '24vh', overflow: 'auto', marginBottom: 10 }}>
            {images.length ? images.map((m) => (
              <div
                key={m.id}
                onClick={() => setSrc(m.id)}
                style={{
                  cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
                  border: `2px solid ${src === m.id ? 'var(--accent)' : 'var(--line)'}`,
                }}
              >
                <div style={{ aspectRatio: '1/1' }}>
                  {m.thumb ? <img src={imgUrl(m.thumb)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={imgUrl(m.id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
              </div>
            )) : <div className="empty small" style={{ gridColumn: '1/-1' }}>多媒体库里还没有图片</div>}
          </div>

          {src ? (
            <div className="card" style={{ padding: 12, background: 'var(--panel2)' }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <span className="small muted" style={{ width: 52 }}>压暗</span>
                <input
                  type="range" min={0} max={0.8} step={0.05} value={veil}
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                  onChange={(e) => setVeil(Number(e.target.value))}
                />
                <span className="small muted" style={{ width: 38, textAlign: 'right' }}>{Math.round(veil * 100)}%</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <span className="small muted" style={{ width: 52 }}>透明度</span>
                <input
                  type="range" min={0} max={0.9} step={0.05} value={alpha}
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                  onChange={(e) => setAlpha(Number(e.target.value))}
                />
                <span className="small muted" style={{ width: 38, textAlign: 'right' }}>{Math.round(alpha * 100)}%</span>
              </div>
              <div className="small muted" style={{ marginTop: 6, lineHeight: 1.7 }}>
                透明度越高，模块底色透出来越多、图越淡，字也越好读。
              </div>
            </div>
          ) : null}
        </div>
        <div className="h" style={{ borderTop: '1px solid var(--line2)', borderBottom: 0, justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn sm" onClick={() => onDone({ src: '', veil, alpha })}>去掉背景</button>
          <button className="btn sm" onClick={onClose}>取消</button>
          <button className="btn primary sm" onClick={() => onDone({ src, veil, alpha })}>应用</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 各类型模块 ---------------- */

function RichTextModule({ m, showToolbar }: { m: JournalModule; showToolbar: boolean }) {
  const values = useStore((s) => s.draft.values);
  const setValue = useStore((s) => s.setValue);
  const setSource = useStore((s) => s.setSource);
  const reloadModules = useStore((s) => s.reloadModules);
  const scheduleSave = useStore((s) => s.scheduleSave);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  /** 输入即格式化（设置 → 日记 → 输入即格式化，默认开） */
  const liveMarkup = useStore((s) => String(s.settings.liveMarkup ?? '1') === '1');
  const editorRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<Range | null>(null);
  const editNodeRef = useRef<HTMLElement | null>(null);
  /** Markdown / BBCode 编辑器暴露出来的「插入一段源码」口子 */
  const mdIns = useRef<((text: string) => void) | null>(null);
  const bbIns = useRef<((text: string) => void) | null>(null);
  const [texOpen, setTexOpen] = useState(false);
  const [texInit, setTexInit] = useState('');
  const [texBlock, setTexBlock] = useState(false);
  const [pickKind, setPickKind] = useState<null | 'image' | 'video'>(null);

  const fmt = (m.config?.format as string) === 'md' ? 'md' : (m.config?.format as string) === 'bb' ? 'bb' : 'rich';
  const html = typeof values[m.id] === 'string' ? (values[m.id] as string) : '';

  /**
   * 切换输入方式（第 73 条）。
   *
   * 以前这里只改 config，切过去读到的是"另一份还没写过的源码" —— 所以看起来像清空。
   * 现在 HTML 是唯一事实：切到 Markdown / BBCode 时用当前 HTML 现场转一份源码；
   * 切回富文本时，用当前源码重新渲染 HTML。两边始终是同一份内容，只是写法不同。
   */
  const cycleFormat = async () => {
    const next = fmt === 'rich' ? 'md' : fmt === 'md' ? 'bb' : 'rich';
    const html = String(values[m.id] || '');
    const mdSrc = typeof values[`${m.id}:md`] === 'string' ? String(values[`${m.id}:md`]) : '';
    const bbSrc = typeof values[`${m.id}:bb`] === 'string' ? String(values[`${m.id}:bb`]) : '';
    const patch: Record<string, string> = {};

    if (next === 'rich') {
      // 从源码回填：改完 Markdown / BBCode 切回来，得能看到改动
      if (fmt === 'md' && mdSrc.trim()) patch[m.id] = mdRender(mdSrc);
      else if (fmt === 'bb' && bbSrc.trim()) patch[m.id] = bbRender(bbSrc);
    } else if (next === 'md') {
      patch[`${m.id}:md`] = htmlToMd(html) || mdSrc;
    } else {
      // 从 md 切到 bb：先用 md 渲染出最新 HTML，再转 BBCode
      const base = fmt === 'md' && mdSrc.trim() ? mdRender(mdSrc) : html;
      patch[`${m.id}:bb`] = htmlToBb(base) || bbSrc;
    }

    const cfg = { ...(m.config || {}), format: next };
    useStore.getState().patchDraft({ values: { ...values, ...patch } });
    scheduleSave();
    await api.modules.update({ id: m.id, config: cfg });
    await reloadModules();

    const empty = next !== 'rich' && !String(patch[`${m.id}:${next}`] ?? '').trim();
    toast(
      next === 'md' ? (empty ? '已切成 Markdown（这一天还没有内容）' : '已切成 Markdown，内容原样带过来了')
        : next === 'bb' ? (empty ? '已切成 BBCode（这一天还没有内容）' : '已切成 BBCode，内容原样带过来了')
          : '已切回所见即所得',
    );
  };

  /* ---- LaTeX：插入 / 编辑 ---- */
  /** editorRef 挂在外壳上，真正可编辑的是里面那个 .rt[contenteditable] */
  const editable = () => editorRef.current?.querySelector('[contenteditable="true"]') as HTMLElement | null;

  const rememberCaret = () => {
    const el = editable();
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount) { rangeRef.current = null; return; }
    const r = sel.getRangeAt(0);
    rangeRef.current = el.contains(r.commonAncestorContainer) ? r.cloneRange() : null;
  };

  const openNewTex = () => {
    editNodeRef.current = null;
    setTexInit('');
    setTexBlock(false);
    rememberCaret();
    setTexOpen(true);
  };

  const openEditTex = (node: HTMLElement) => {
    editNodeRef.current = node;
    setTexInit(node.getAttribute('data-tex') || '');
    setTexBlock(node.getAttribute('data-display') === '1');
    setTexOpen(true);
  };

  const applyTex = (tex: string, block: boolean) => {
    const el = editable();
    if (!el) return;
    const node = editNodeRef.current;
    if (node && el.contains(node)) {
      // 改已有公式：整块换掉，旁边的文字一个不动
      node.outerHTML = texNodeHtml(tex, block);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    el.focus();
    const holder = document.createElement('div');
    holder.innerHTML = texNodeHtml(tex, block);
    const fresh = holder.firstElementChild as HTMLElement;
    const range = rangeRef.current;
    if (range && el.contains(range.commonAncestorContainer)) {
      const sel = window.getSelection();
      range.deleteContents();
      range.insertNode(fresh);
      range.setStartAfter(fresh);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else {
      el.appendChild(fresh);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /** 在光标处塞一段 HTML（视频 / 图片都走这里）；没有光标就追加到末尾 */
  const insertHtml = (markup: string) => {
    const el = editable();
    if (!el) return;
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    const fresh = holder.firstElementChild as HTMLElement | null;
    if (!fresh) return;
    el.focus();
    const range = rangeRef.current;
    if (range && el.contains(range.commonAncestorContainer)) {
      const sel = window.getSelection();
      range.deleteContents();
      range.insertNode(fresh);
      range.setStartAfter(fresh);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else {
      el.appendChild(fresh);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /** 从媒体库挑中的图片 / 视频，按当前输入方式插成对应的标记 */
  const fillMedia = (it: MediaItem, kind: 'image' | 'video') => {
    setPickKind(null);
    if (fmt === 'md') {
      const name = it.name || it.file || it.id;
      mdIns.current?.(kind === 'video' ? `\n![视频](${name})\n` : `\n![${it.name || '图片'}](${name})\n`);
      return;
    }
    if (fmt === 'bb') {
      bbIns.current?.(kind === 'video' ? `[video]${it.id}[/video]` : `[img]${it.id}[/img]`);
      return;
    }
    const src = kind === 'video' ? (it.file ? rawUrl(it.file) : '') : (imgUrl(it.id) || (it.file ? rawUrl(it.file) : ''));
    if (!src) { toast('这个文件找不到了，换一个试试'); return; }
    const alt = (it.name || '').replace(/"/g, '');
    insertHtml(kind === 'video'
      ? `<video class="vid" src="${src}" controls preload="metadata" data-mid="${it.id}"></video>`
      : `<img src="${src}" alt="${alt}" data-mid="${it.id}">`);
    mediaDomPass();
  };

  const label = fmt === 'md' ? 'MD' : fmt === 'bb' ? 'BBCode' : '富文本';
  /**
   * 第 122 条：写 Markdown / BBCode 时，「今天」页右边那 300px 的边栏一直在抢宽度。
   * 这里给一个开关把它收掉，让双栏真正用得上整个窗口。
   * 用 app 上的 data 属性而不是折叠 DOM —— 开关只改一个属性，不触发整棵树重排。
   */
  const focusWrite = String(settings.focusWrite ?? '0') === '1';
  const toggleFocus = () => {
    const next = !focusWrite;
    void setSetting('focusWrite', next ? '1' : '0');
    document.getElementById('app')?.setAttribute('data-focus-write', next ? '1' : '0');
  };

  const tools = (
    <>
      <button data-act="toggle-source" title="切换输入方式：富文本 → Markdown → BBCode" onClick={() => void cycleFormat()}>{label}</button>
      {fmt !== 'rich' ? (
        <button
          data-act="focus-write"
          title={focusWrite ? '退出专注写作，右边边栏回来' : '专注写作：收掉右边边栏，正文吃满窗口'}
          style={focusWrite ? { color: 'var(--accent)' } : undefined}
          onClick={toggleFocus}
        >专注</button>
      ) : null}
      <button
        title="从媒体库插入图片"
        onMouseDown={(e) => { e.preventDefault(); rememberCaret(); }}
        onClick={() => setPickKind('image')}
      >图片</button>
      <button
        title="从媒体库插入视频（不会自动播放）"
        onMouseDown={(e) => { e.preventDefault(); rememberCaret(); }}
        onClick={() => setPickKind('video')}
      >视频</button>
      {fmt === 'rich' ? (
        <button
          data-act="insert-latex" title="插入 LaTeX 公式"
          onMouseDown={(e) => { e.preventDefault(); rememberCaret(); }}
          onClick={openNewTex}
        >∑</button>
      ) : null}
    </>
  );

  const picker = pickKind ? (
    <MediaPicker
      single
      kind={pickKind}
      onClose={() => setPickKind(null)}
      onDone={(ids, picked) => {
        const it = picked?.[0] || (ids[0] ? resolveRef(ids[0]) : null);
        if (it) fillMedia(it, pickKind);
        else setPickKind(null);
      }}
    />
  ) : null;

  if (fmt === 'md') {
    const src = typeof values[`${m.id}:md`] === 'string' ? (values[`${m.id}:md`] as string) : '';
    return (
      <ModuleShell m={m} hint="Markdown" extraTools={tools}>
        <MarkdownEditor
          src={src}
          insertRef={mdIns}
          onChange={(s, h) => { setSource(m.id, 'md', s, h); scheduleSave(); }}
        />
        {picker}
      </ModuleShell>
    );
  }

  if (fmt === 'bb') {
    const src = typeof values[`${m.id}:bb`] === 'string' ? (values[`${m.id}:bb`] as string) : '';
    return (
      <ModuleShell m={m} hint="BBCode" extraTools={tools}>
        <BBCodeEditor
          src={src}
          insertRef={bbIns}
          onChange={(s, h) => { setSource(m.id, 'bb', s, h); scheduleSave(); }}
        />
        {picker}
      </ModuleShell>
    );
  }

  return (
    <ModuleShell m={m} extraTools={tools}>
      {showToolbar ? <RichToolbar editorRef={editorRef} /> : null}
      <div
        ref={editorRef}
        // 双击才编辑公式：单击就弹窗太容易误触 —— 在正文里点一下（恰好点在公式上）就把编辑器抢走，
        // 用户会以为"点哪里都在弹这个框"
        onDoubleClick={(e) => {
          const hit = (e.target as HTMLElement).closest('.tex') as HTMLElement | null;
          if (hit) { e.preventDefault(); openEditTex(hit); }
        }}
      >
        <RichText
          html={html}
          live={liveMarkup}
          placeholder="今天发生了什么？想到什么就写什么。"
          onChange={(h) => { setValue(m.id, h); scheduleSave(); }}
        />
      </div>
      {texOpen ? (
        <TexDialog
          initial={texInit}
          block={texBlock}
          onClose={() => { setTexOpen(false); editNodeRef.current = null; }}
          onOk={applyTex}
        />
      ) : null}
      {picker}
    </ModuleShell>
  );
}

/**
 * 图片模块（第 225 / 231 条重做）。
 *
 * 这一块原来问题最多，三条都得修：
 *
 * 1. **拖动已导入的图会误报「已导入 1 张」**：
 *    根因不在里，而在 App.tsx 的全局 drop —— 原生拖 <img> 不 preventDefault，
 *    冒到 window 就被当成拖文件。那边已经加了「必须带 Files」的判据。
 *    这里再做一层：整个容器 onDragOver 就拦掉，让事件根本不往上冒。
 *
 * 2. **选中图按 Delete / 退格删不掉**：
 *    以前压根没有键盘处理。现在容器带 tabIndex，点图即选中，
 *    Delete / Backspace 删选中（多选就批量删），Esc 取消选中。
 *
 * 3. **批量加图 + 缩放旋转翻转**（第 231 条）：
 *    多选靠 Ctrl/Cmd 点、Shift 点连选。
 *    每张图的变换（缩放 / 旋转 / 镜像）存在模块值里，跟着日记一起存 ——
 *    不进数据库加字段，因为它只是「这张日记里怎么摆」，不是图本身的属性。
 */

/** 一张图在这篇日记里的摆法。不存的就是默认（原样铺满格子） */
interface ImgTone {
  /** 缩放 0.5~3 */
  s?: number;
  /** 旋转角度，0/90/180/270 */
  r?: number;
  /** 水平镜像 */
  fx?: boolean;
  /** 垂直镜像 */
  fy?: boolean;
}

function ImagesModule({ m }: { m: JournalModule }) {
  const values = useStore((s) => s.draft.values);
  const setValue = useStore((s) => s.setValue);
  const scheduleSave = useStore((s) => s.scheduleSave);
  const reloadMedia = useStore((s) => s.reloadMedia);
  const toast = useStore((s) => s.toast);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  /** 选中集合（多选） */
  const [sel, setSel] = useState<string[]>([]);
  /** 当前在调变换的那一张 */
  const [tune, setTune] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const arr = Array.isArray(values[m.id]) ? (values[m.id] as string[]) : [];
  /**
   * 变换表：存在同一个模块值里的特殊键，避免动数据库结构。
   * 存 JSON 字符串而不是对象 —— ModuleValue 只允许 string / number / string[] / QuoteRef[]，
   * 而且这样它天然能落库、能随草稿一起导出导入。
   */
  const toneKey = `__tone_${m.id}`;
  const tones: Record<string, ImgTone> = (() => {
    const raw = values[toneKey];
    if (typeof raw !== 'string' || !raw) return {};
    try {
      const o = JSON.parse(raw) as unknown;
      return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, ImgTone>) : {};
    } catch { return {}; }
  })();

  const commit = (next: string[]) => {
    setValue(m.id, next);
    scheduleSave();
  };

  const setTone = (id: string, patch: ImgTone) => {
    const next = { ...tones, [id]: { ...(tones[id] || {}), ...patch } };
    setValue(toneKey, JSON.stringify(next));
    scheduleSave();
  };

  const append = (ids: string[]) => {
    const next = [...arr];
    ids.forEach((id) => { if (!next.includes(id)) next.push(id); });
    commit(next);
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    const ids = await importImageFiles(files);
    await reloadMedia();
    if (ids.length) {
      append(ids);
      toast(`已导入 ${ids.length} 张`);
    } else {
      toast('没有可导入的图片');
    }
  };

  const removeMany = (ids: string[]) => {
    if (!ids.length) return;
    commit(arr.filter((x) => !ids.includes(x)));
    setSel((prev) => prev.filter((x) => !ids.includes(x)));
    if (viewing && ids.includes(viewing)) setViewing(null);
    if (tune && ids.includes(tune)) setTune(null);
    toast(ids.length > 1 ? `已移出 ${ids.length} 张（多媒体库里的文件还在）` : '已移出这一张');
  };

  /** 点一下：默认选中；Ctrl/Cmd 点加选；Shift 点从上一个到这儿连选 */
  const click = (id: string, e: React.MouseEvent) => {
    const multi = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (range && sel.length) {
      const a = arr.indexOf(sel[sel.length - 1]);
      const b = arr.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSel(arr.slice(lo, hi + 1));
        return;
      }
    }
    if (multi) {
      setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      return;
    }
    setSel([id]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setSel([]); setTune(null); return; }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!sel.length) return;
    e.preventDefault();
    removeMany(sel);
  };

  const curTone = tune ? (tones[tune] || {}) : null;

  return (
    <ModuleShell m={m} hint={arr.length ? `${arr.length} 张${sel.length ? ` · 选中 ${sel.length}` : ''}` : undefined}>
      <div
        ref={boxRef}
        className={`imgs ${over ? 'dropzone-on' : ''} ${sel.length ? 'has-sel' : ''}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          /*
           * 第 225 条：只要在图片区里，dragOver 就一律拦掉并停止冒泡。
           * 这样无论是「从资源管理器拖文件」还是「拖页面里已有的图」，
           * 都不会再让它冒到 App.tsx 的全局 drop 里被当成导入。
           * 真正的导入仍走下面的 onDrop（只认带 Files 的）。
           */
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          // 拖的是页面内的图 → 什么都不做（不是导入）
          const files = imageFilesFromDataTransfer(e.dataTransfer);
          if (!files.length) return;
          await upload(files);
        }}
      >
        {arr.map((ref) => {
          const mm = resolveRef(ref);
          const on = sel.includes(ref);
          const t = tones[ref] || {};
          const tf = [
            t.s && t.s !== 1 ? `scale(${t.s})` : '',
            t.r ? `rotate(${t.r}deg)` : '',
            t.fx ? 'scaleX(-1)' : '',
            t.fy ? 'scaleY(-1)' : '',
          ].filter(Boolean).join(' ');
          if (!mm) {
            return (
              <div className={`imgc miss ${on ? 'on' : ''}`} key={ref} title={`引用已失效：${ref}`} onClick={(e) => click(ref, e)}>
                <button className="del" onClick={(e) => { e.stopPropagation(); removeMany([ref]); }}>✕</button>
              </div>
            );
          }
          return (
            <div
              className={`imgc ${on ? 'on' : ''}`}
              key={ref}
              title={`${mm.name || mm.id}${on ? '（已选中）' : ''}`}
              onClick={(e) => click(ref, e)}
              onDoubleClick={() => setViewing(mm.file)}
            >
              <div className="imgc-w">
                <img
                  src={imgUrl(ref, true)}
                  alt={mm.name || ''}
                  draggable={false}
                  data-tone={mm.id}
                  style={{ cursor: 'zoom-in', transform: tf, ...toneStyle(mm.id) }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              {on ? <span className="imgc-sel" aria-hidden>✓</span> : null}
              <button
                className="del"
                title="从今天的图片里移出（多媒体库里的文件不动）"
                onClick={(e) => { e.stopPropagation(); removeMany([ref]); }}
              >✕</button>
              <button
                className="imgc-tune"
                title="缩放 / 旋转 / 翻转"
                onClick={(e) => { e.stopPropagation(); setSel([ref]); setTune(tune === ref ? null : ref); }}
              ><Icon name="sliders" size={11} /></button>
            </div>
          );
        })}
        <button className="imgadd" onClick={() => setPicking(true)} title="从多媒体库挑已有的图（可多选）">
          <Icon name="image" size={14} /><span style={{ fontSize: 11 }}>选图</span>
        </button>
        {/* 第 231 条：批量上传 —— 文件选择框本来就 multiple，这里把文案说清 */}
        <button
          className="imgadd" title="一次选多张（按住 Ctrl / Shift）"
          onClick={async () => { await upload(await pickImageFiles()); }}
        >
          <Icon name="plus" size={14} /><span style={{ fontSize: 11 }}>批量上传</span>
        </button>
      </div>

      {/* 选中时的批量条 */}
      {sel.length ? (
        <div className="imgbar">
          <span>已选中 <b>{sel.length}</b> 张</span>
          <button className="btn sm ghost" type="button" onClick={() => setSel(arr)}>全选</button>
          <button className="btn sm ghost" type="button" onClick={() => setSel([])}>取消选中</button>
          <div style={{ flex: 1 }} />
          <button className="btn sm" type="button" onClick={() => { sel.forEach((id) => setTone(id, { s: 1, r: 0, fx: false, fy: false })); toast('已还原选中图片的变换'); }}>还原变换</button>
          <button className="btn sm danger" type="button" onClick={() => removeMany(sel)}>移出选中</button>
        </div>
      ) : null}

      {/* 单张变换面板 */}
      {tune && curTone ? (
        <div className="imgtune">
          <span className="small muted">缩放</span>
          <input
            type="range" min={0.5} max={3} step={0.05}
            value={curTone.s || 1}
            style={{ width: 130, accentColor: 'var(--accent)' }}
            onChange={(e) => setTone(tune, { s: Number(e.target.value) })}
          />
          <span className="val">{(curTone.s || 1).toFixed(2)}×</span>
          <span className="small muted" style={{ marginLeft: 8 }}>旋转</span>
          {[0, 90, 180, 270].map((r) => (
            <button
              key={r}
              type="button"
              className={`chip ${(curTone.r || 0) === r ? 'on' : ''}`}
              onClick={() => setTone(tune, { r })}
            >{r}°</button>
          ))}
          <button
            type="button"
            className={`chip ${curTone.fx ? 'on' : ''}`}
            title="左右镜像"
            onClick={() => setTone(tune, { fx: !curTone.fx })}
          >左右翻</button>
          <button
            type="button"
            className={`chip ${curTone.fy ? 'on' : ''}`}
            title="上下翻转"
            onClick={() => setTone(tune, { fy: !curTone.fy })}
          >上下翻</button>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => setTone(tune, { s: 1, r: 0, fx: false, fy: false })}
          >还原</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn sm" onClick={() => setTune(null)}>收起</button>
        </div>
      ) : null}

      <div className="small muted" style={{ marginTop: 6, fontSize: 11 }}>
        拖图进来或 Ctrl+V 粘贴都能加；点一下选中，<b>Delete 移出</b>，Ctrl 点加选、Shift 点连选。
      </div>

      {picking ? (
        <MediaPicker
          onClose={() => setPicking(false)}
          onDone={(ids) => {
            append(ids);
            setPicking(false);
          }}
        />
      ) : null}
      {viewing ? <ImageViewer file={viewing} onClose={() => setViewing(null)} /> : null}
    </ModuleShell>
  );
}
function TagsModule({ m }: { m: JournalModule }) {
  const draft = useStore((s) => s.draft);
  const patchDraft = useStore((s) => s.patchDraft);
  const scheduleSave = useStore((s) => s.scheduleSave);
  const settings = useStore((s) => s.settings);
  const [input, setInput] = useState('');

  const tags = Array.isArray(draft.values[m.id]) ? (draft.values[m.id] as string[]) : [];
  // 设置里的预设标签：一键加，不用每次手打（第 116 条）
  const presets = String(settings.tagPresets || '')
    .split(/[,，]/).map((x) => x.trim()).filter((x) => x && !tags.includes(x));

  const commit = (next: string[]) => {
    const values = { ...draft.values, [m.id]: next };
    patchDraft({ values, tags: next });
    scheduleSave();
  };

  return (
    <ModuleShell m={m} hint={tags.length ? `${tags.length} 个` : undefined}>
      <div className="row">
        {tags.map((t) => (
          <span className="chip on" key={t}>
            {t}
            <span className="x" onClick={() => commit(tags.filter((x) => x !== t))}>✕</span>
          </span>
        ))}
        <input
          className="inp"
          style={{ width: 170, padding: '3px 10px', borderRadius: 20 }}
          placeholder="加标签，回车确认（可用 工作/项目A）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const val = input.trim();
            if (!val) return;
            const next = [...tags];
            val.split(/[,，]/).forEach((x) => {
              const s = x.trim();
              if (s && !next.includes(s)) next.push(s);
            });
            commit(next);
            setInput('');
          }}
        />
      </div>
      {presets.length ? (
        <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
          <span className="small muted">常用</span>
          {presets.map((p) => (
            <button
              key={p}
              className="chip"
              title={`加上「${p}」`}
              onClick={() => commit([...tags, p])}
            >
              + {p}
            </button>
          ))}
        </div>
      ) : null}
    </ModuleShell>
  );
}

function HabitsModule({ m }: { m: JournalModule }) {
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.logs);
  const notes = useStore((s) => s.habitNotes);
  const setLog = useStore((s) => s.setLog);
  const setHabitNote = useStore((s) => s.setHabitNote);
  const go = useStore((s) => s.go);

  const active = habits.filter((h) => !h.archived);
  const done = active.filter((h) => habitIsDone(h, logs[h.id])).length;

  return (
    <ModuleShell
      m={m}
      hint={`${done} / ${active.length}`}
      extraTools={<button title="打开打卡页" onClick={() => void go('habits')}>全部</button>}
    >
      {active.length ? (
        <div className="hlog">
          {active.map((h: Habit) => {
            const vv = logs[h.id];
            const on = habitIsDone(h, vv);
            return (
              <div className={`hcard ${on ? 'done' : ''}`} key={h.id}>
                <div className="top">
                  <span className="ico">{h.icon || '·'}</span>
                  <span className="nm">{h.name}</span>
                  {h.type === 'bool' && vv != null ? <span className="val">已打卡</span> : null}
                  <span className="goal">{on ? '✓' : h.streak ? `${h.streak} 天` : ''}</span>
                </div>
                <div className="body">
                  <HabitWidget
                    habit={h}
                    value={vv}
                    compact
                    onCommit={(v) => void setLog(h.id, v)}
                    note={notes[h.id]}
                    onNote={(v) => void setHabitNote(h.id, v)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">还没有习惯，去「打卡」页添加。</div>
      )}
    </ModuleShell>
  );
}

function TodoModule({ m, date }: { m: JournalModule; date: string }) {
  const todos = useStore((s) => s.todos);
  const reloadTodos = useStore((s) => s.reloadTodos);
  const [text, setText] = useState('');
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const mine = todos.filter((t) => !t.done && (t.due === date || t.due === '' || t.due === todayKey));
  const uniq = mine.filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);

  return (
    <ModuleShell m={m} hint={uniq.length ? `${uniq.length} 条` : undefined}>
      <div className="tlist">
        {uniq.length ? uniq.map((t) => (
          <div className={`titem ${t.done ? 'done' : ''}`} key={t.id}>
            <div className="ck" onClick={async () => { await api.todos.update({ id: t.id, done: t.done ? 0 : 1 }); await reloadTodos(); }}>
              {t.done ? '✓' : ''}
            </div>
            <div className="tx">{t.title}</div>
            {t.due ? <div className="due">{t.due === date ? '今天' : t.due.slice(5)}</div> : null}
          </div>
        )) : <div className="empty">今天还没有待办。</div>}
      </div>
      <input
        className="inp"
        style={{ marginTop: 8 }}
        placeholder="加一条待办，回车确认（会记到这一天）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== 'Enter') return;
          const v = text.trim();
          if (!v) return;
          await api.todos.add({ title: v, due: date, priority: 1 });
          setText('');
          await reloadTodos();
        }}
      />
    </ModuleShell>
  );
}

/* ---------------- 主入口 ---------------- */

export function ModuleBody({ m, date, showToolbar }: { m: JournalModule; date: string; showToolbar: boolean }) {
  const values = useStore((s) => s.draft.values);
  const setValue = useStore((s) => s.setValue);
  const scheduleSave = useStore((s) => s.scheduleSave);
  const modules = useStore((s) => s.modules);
  const reloadModules = useStore((s) => s.reloadModules);

  const val = values[m.id];
  const type = m.type as ModuleType;

  const set = (v: unknown) => { setValue(m.id, v as never); scheduleSave(); };

  switch (type) {
    case 'richtext':
      return <RichTextModule m={m} showToolbar={showToolbar} />;

    case 'heading':
      return (
        <ModuleShell m={m}>
          <RichText
            html={typeof val === 'string' ? val : ''}
            placeholder="（小标题）"
            singleLine
            live={false}
            style={{ minHeight: 'auto', fontSize: '1.2em', fontWeight: 600 }}
            onChange={(h) => set(h)}
          />
        </ModuleShell>
      );

    case 'divider':
      return (
        <div className="mod">
          <hr style={{ border: 0, borderTop: '1px solid var(--line2)', margin: '6px 0' }} />
        </div>
      );

    case 'mood': {
      const cur = Number(val) || 0;
      return (
        <ModuleShell m={m} hint={cur ? '再点一次取消' : undefined}>
          <div className="moodrow">
            {MOODS.map((x) => (
              <button key={x.v} className={`mood ${cur === x.v ? 'on' : ''}`} onClick={() => set(cur === x.v ? 0 : x.v)}>
                {x.e}<small>{x.t}</small>
              </button>
            ))}
          </div>
        </ModuleShell>
      );
    }

    case 'weather': {
      const cur = typeof val === 'string' ? val : '';
      return (
        <ModuleShell m={m}>
          <div className="row">
            {WEATHERS.map((w) => (
              <button key={w} className={`chip ${cur === w ? 'on' : ''}`} onClick={() => set(cur === w ? '' : w)}>
                {w}
              </button>
            ))}
          </div>
        </ModuleShell>
      );
    }

    case 'rating': {
      const max = Number(m.config?.max) || 10;
      const cur = Number(val) || 0;
      return (
        <ModuleShell m={m} hint={cur ? `${cur} / ${max}` : '点星星打分'}>
          <div className="stars">
            {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
              <b key={i} className={i <= cur ? 'on' : ''} onClick={() => set(i)}>★</b>
            ))}
          </div>
        </ModuleShell>
      );
    }

    case 'sleep':
    case 'energy': {
      const isSleep = type === 'sleep';
      const cur = Number(val) || 0;
      const max = isSleep ? 12 : 5;
      const label = isSleep ? (cur ? `${cur} 小时` : '—') : (cur ? '★'.repeat(cur) : '—');
      return (
        <ModuleShell m={m}>
          <div className="slider">
            <input
              type="range"
              min={0}
              max={max}
              step={isSleep ? 0.5 : 1}
              value={cur}
              onChange={(e) => set(Number(e.target.value))}
            />
            <span className="v">{label}</span>
          </div>
        </ModuleShell>
      );
    }

    case 'tags':
      return <TagsModule m={m} />;

    case 'habits':
      return <HabitsModule m={m} />;

    case 'todo':
      return <TodoModule m={m} date={date} />;

    case 'images':
      return <ImagesModule m={m} />;

    case 'quote': {
      const arr = Array.isArray(val) ? (val as QuoteRef[]) : [];
      return (
        <ModuleShell m={m}>
          {arr.length ? arr.map((q, i) => (
            <div className="refcard" key={`${q.date}-${i}`}>
              <div className="b">
                <div className="src">引自 {q.date}</div>
                <div className="txt">{q.text}</div>
              </div>
              <button onClick={() => set(arr.filter((_, k) => k !== i))}>✕</button>
            </div>
          )) : <div className="empty">还没有引用。</div>}
        </ModuleShell>
      );
    }

    default:
      return null;
  }
}

/** 今天页用：按顺序渲染所有启用的模块，第一个正文模块带工具栏 */
export function ModuleList({ date }: { date: string }) {
  const modules = useStore((s) => s.modules);
  const toast = useStore((s) => s.toast);
  const reloadModules = useStore((s) => s.reloadModules);
  /**
   * 第 237 条：这一篇日记里临时藏掉的模块 id。
   *
   * 存在本地 state 而不是 store：它是「这一篇日记的界面状态」，
   * 切日期就该跟着换，没有跨页面共享的必要。
   * 初始值从后端 module_hidden 表读 —— 所以关掉之后**重开软件也还是关着的**，
   * 而不是一刷新就冒出来。
   */
  const [hidden, setHidden] = useState<string[]>([]);
  /** 第 237 条：这一篇里临时**多显示**的模块（全局关掉的那些） */
  const [shown, setShown] = useState<string[]>([]);
  /** 第 237 条：展开「临时加个模块」的类型清单 */
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.modules.shownOn(date)
      .then((r) => { if (alive) setShown(r.ids || []); })
      .catch(() => { if (alive) setShown([]); });
    return () => { alive = false; };
  }, [date]);

  useEffect(() => {
    let alive = true;
    void api.modules.hiddenOn(date)
      .then((r) => { if (alive) setHidden(r.ids || []); })
      .catch(() => { if (alive) setHidden([]); });
    return () => { alive = false; };
  }, [date]);

  /**
   * 点 ✕ —— 先不动数据，只把模块从界面上摘掉，并挂一条带「撤回」的提示。
   * 用户点了撤回就什么都不写库；超时或手动关掉提示才真正落盘。
   */
  const hide = (id: string, title: string) => {
    // 如果这个模块本来就是「这一篇临时加上来的」，点 ✕ 的正确含义是
    // 「取消临时显示」，而不是往 hidden 表里再记一条 —— 否则会变成
    // 全局关着 + 本篇临时显示 + 本篇隐藏，三条记录打架。
    if (shown.includes(id)) {
      setShown((arr) => arr.filter((x) => x !== id));
      setPendingToastAction({
        label: '撤回',
        undo: () => setShown((arr) => (arr.includes(id) ? arr : [...arr, id])),
        run: async () => {
          try { await api.modules.showOn(date, id, 0); }
          catch (e) {
            setShown((arr) => (arr.includes(id) ? arr : [...arr, id]));
            toast('没取消掉：' + (e as Error).message);
          }
        },
      });
      toast(`这一篇里撤掉了「${title}」`);
      return;
    }

    setHidden((arr) => (arr.includes(id) ? arr : [...arr, id]));

    setPendingToastAction({
      label: '撤回',
      // 界面已经先摘掉了，撤回时只需把它放回来
      undo: () => setHidden((arr) => arr.filter((x) => x !== id)),
      run: async () => {
        try {
          await api.modules.hideOn(date, id, 1);
        } catch (e) {
          // 写库失败要把模块放回来，否则用户会以为关掉了、下次又出现
          setHidden((arr) => arr.filter((x) => x !== id));
          toast('没关掉：' + (e as Error).message);
        }
      },
    });
    toast(`已隐藏「${title}」`);
  };

  /*
   * 三个集合的算法（第 237 条）：
   *   enabled     = 全局开着的，减去这一篇隐藏的
   *   extraShown  = 全局关着、但这一篇临时加回来的
   *   合并后按 modules 原始顺序排，保证位置稳定，不会因为临时加上就跑到最后
   */
  const extraShown = modules.filter((m) => m.enabled !== 1 && shown.includes(m.id));
  const enabled = modules.filter(
    (m) => (m.enabled === 1 && !hidden.includes(m.id)) || extraShown.some((x) => x.id === m.id),
  );
  /** 被藏起来的（这一篇里的），用来做「临时添加」的回选列表 */
  const hiddenOnes = modules.filter((m) => m.enabled === 1 && hidden.includes(m.id));
  /** 全局关着、可以临时加回来的 */
  const offModules = modules.filter((m) => m.enabled !== 1 && !shown.includes(m.id));
  let rtSeen = false;

  const restore = async (id: string) => {
    setHidden((arr) => arr.filter((x) => x !== id));
    try { await api.modules.hideOn(date, id, 0); }
    catch (e) { toast('恢复失败：' + (e as Error).message); }
  };

  /**
   * 第 237 条：在「今天」里临时多显示一个模块。
   *
   * 第一版这里直接调 modules.add —— 那是**全局永久新增**，所有日子都会多出来，
   * 和用户要的「只在这一篇临时加上」完全不是一回事。已改为写 module_shown 表，
   * 只对当前这一篇日记生效，切到别的日子照旧。
   *
   * 这里只能挑「已经存在但全局关掉」的模块；真要一个全新的模块还是得去设置页，
   * 因为新建必然改 modules 表，天然就是全局的。
   */
  const showHere = async (id: string, title: string) => {
    setShown((arr) => (arr.includes(id) ? arr : [...arr, id]));
    try {
      await api.modules.showOn(date, id, 1);
      toast(`这一篇里加上了「${title}」，其他日子不受影响`);
    } catch (e) {
      setShown((arr) => arr.filter((x) => x !== id));
      toast('没加上：' + (e as Error).message);
    }
    setAdding(false);
  };

  if (!modules.some((m) => m.enabled === 1) && !shown.length) {
    return <div className="empty">所有模块都被隐藏了，去「设置 → 日记与模块」打开几个。</div>;
  }

  return (
    <HideCtx.Provider value={hide}>
      {enabled.map((m) => {
        const showToolbar = m.type === 'richtext' && !rtSeen;
        if (m.type === 'richtext') rtSeen = true;
        return <ModuleBody key={m.id} m={m} date={date} showToolbar={showToolbar} />;
      })}

      {/* 第 237 条后半段：这里也要能「简单临时添加模块」——
          关掉之后总得有个地方点回来，不能逼用户跑去设置页。
          这一排只在真的藏过东西、或用户主动展开了列表时出现，平时不占位置。 */}
      {hiddenOnes.length || adding ? (
        <div className="mod-add-bar">
          {hiddenOnes.length ? (
            <>
              <span className="small muted">这一篇里收起了：</span>
              {hiddenOnes.map((m) => (
                <button key={m.id} className="chip" onClick={() => void restore(m.id)}>
                  <Icon name="plus" size={10} />{m.title || TYPE_NAME[m.type] || m.type}
                </button>
              ))}
            </>
          ) : null}
          {adding ? (
            <>
              <span className="small muted" style={{ marginLeft: hiddenOnes.length ? 8 : 0 }}>
                {offModules.length ? '这一篇里加上（只管这一篇）：' : '没有可以临时加上的模块'}
              </span>
              {offModules.map((m) => (
                <button
                  key={m.id}
                  className="chip"
                  title="只在这一篇日记里显示，其他日子不受影响"
                  onClick={() => void showHere(m.id, m.title || TYPE_NAME[m.type] || m.type)}
                >
                  <Icon name="plus" size={10} />{m.title || TYPE_NAME[m.type] || m.type}
                </button>
              ))}
              <button className="chip" onClick={() => setAdding(false)}>收起</button>
              <span className="small muted" style={{ width: '100%', marginTop: 4 }}>
                想要一个全新的模块（所有日子都有），去「设置 → 日记与模块」新建。
              </span>
            </>
          ) : (
            <button className="chip" onClick={() => setAdding(true)} style={{ marginLeft: 'auto' }}>
              <Icon name="plus" size={10} />临时加个模块
            </button>
          )}
        </div>
      ) : null}
    </HideCtx.Provider>
  );
}

export { habitIsDone };
