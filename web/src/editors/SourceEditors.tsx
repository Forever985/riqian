import { useEffect, useRef, useState } from 'react';
import { bbToHtml, BB_WRAP } from '../lib/bbcode';
import { mdToHtml } from '../lib/markdown';
import { renderTexInMarkdown } from '../lib/latex';
import { askText } from '../components/ui';
import { bbMediaWrap, mdMediaFix, MediaPicker } from '../features/media';
import { useStore } from '../store';

/** 让父组件（模块外壳）能往里塞一段源码：插入视频 / 图片时用 */
export type InsertRef = React.MutableRefObject<((text: string) => void) | null>;

/**
 * 第 122 条：Markdown / BBCode 的双栏比例。
 *
 * 原来这两块写死 1fr 1fr，又躺在 --pagew（默认 1080）的 .wrap 里，
 * 减掉 padding 和 gap 之后每栏只剩 ~370px —— 用户原话「只有窄窄一点，也不知道在干啥」。
 *
 * 这里给三件事：
 *   ① 中间加一条能拖的分隔条（25%–75%，拖完记住）
 *   ② 双击分隔条回到 50/50
 *   ③ 一个「专注写作」开关，把「今天」页右边的边栏收掉，正文吃满整个窗口
 */
const SPLIT_MIN = 25;
const SPLIT_MAX = 75;

function useSplit() {
  const setSetting = useStore((s) => s.setSetting);
  const saved = Number(useStore((s) => s.settings.mdSplit)) || 50;
  const pct = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, saved));
  const [dragging, setDragging] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // 进页面时按存着的比例铺开
  useEffect(() => {
    document.documentElement.style.setProperty('--mdsplit', `${pct}%`);
  }, [pct]);

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const host = (e.currentTarget as HTMLElement).parentElement;
    if (!host) return;
    setDragging(true);
    const move = (ev: MouseEvent) => {
      const r = host.getBoundingClientRect();
      if (!r.width) return;
      const raw = ((ev.clientX - r.left) / r.width) * 100;
      const next = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, raw));
      // 拖的时候只改 CSS 变量；每动一像素写一次库会把 RPC 打满
      document.documentElement.style.setProperty('--mdsplit', `${next.toFixed(1)}%`);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => { void setSetting('mdSplit', next.toFixed(0)); }, 400);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return {
    dragging,
    onDown,
    reset: () => {
      void setSetting('mdSplit', '50');
      document.documentElement.style.setProperty('--mdsplit', '50%');
    },
  };
}

/** 中间的拖拽条。窄屏时 CSS 会把它藏掉（那时候是上下堆叠，没有左右可分） */
function SplitGrip({ dragging, onDown, onReset }: {
  dragging: boolean; onDown: (e: React.MouseEvent) => void; onReset: () => void;
}) {
  return (
    <div
      className={`md-grip ${dragging ? 'on' : ''}`}
      data-md-grip="1"
      onMouseDown={onDown}
      onDoubleClick={onReset}
      title="拖动调整左右比例（双击回到一半一半）"
    />
  );
}

/** Markdown 的渲染入口：先抽公式再走 Markdown，最后把媒体引用统一交给媒体库解析 */
export const mdRender = (src: string) => mdMediaFix(renderTexInMarkdown(src, mdToHtml));

/** BBCode 的渲染入口：[img]/[video]/[audio] 先换成占位，渲染完再塞回媒体库解析出的标签 */
export const bbRender = (src: string) => bbMediaWrap(src, bbToHtml);

/** Markdown：左写右预览，Typora 那种手感 */
export function MarkdownEditor({
  src, onChange, insertRef,
}: {
  src: string;
  onChange: (src: string, html: string) => void;
  insertRef?: InsertRef;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const split = useSplit();

  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => {
      const ta = taRef.current;
      if (!ta) return;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const next = ta.value.slice(0, s) + text + ta.value.slice(e);
      onChange(next, mdRender(next));
      const caret = s + text.length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(caret, caret);
      });
    };
    return () => { if (insertRef) insertRef.current = null; };
  }, [insertRef, onChange]);

  return (
    <div className="md-split">
      <textarea
        ref={taRef}
        className="inp md-src"
        value={src}
        style={{
          minHeight: 260, fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 13.5, lineHeight: 1.75, resize: 'vertical',
        }}
        placeholder={'# 支持 Markdown\n**粗体** *斜体* ~~删除~~ 反引号包代码\n- 列表\n> 引用\n![图片名](文件名.png)\n视频：![视频](文件名.mp4) 或直接写 <video src="..."></video>\n行内公式 $E=mc^2$，块级用 $$\\int_0^1 x^2 dx$$'}
        onChange={(e) => onChange(e.target.value, mdRender(e.target.value))}
      />
      <SplitGrip dragging={split.dragging} onDown={split.onDown} onReset={split.reset} />
      <div
        className="rt"
        style={{ minHeight: 240, borderLeft: '1px solid var(--line2)', paddingLeft: 16 }}
        dangerouslySetInnerHTML={{ __html: mdRender(src) }}
      />
    </div>
  );
}

const BB_TOOLS: { cmd: string; label: string; title: string; node?: React.ReactNode }[] = [
  { cmd: 'b', label: 'B', title: '粗体' },
  { cmd: 'i', label: 'I', title: '斜体' },
  { cmd: 'u', label: 'U', title: '下划线' },
  { cmd: 's', label: 'S', title: '删除线' },
  { cmd: 'size=4', label: 'A+', title: '大字号' },
  { cmd: 'size=2', label: 'A-', title: '小字号' },
  { cmd: 'color', label: '■', title: '颜色' },
  { cmd: 'quote', label: '引', title: '引用' },
  { cmd: 'code', label: '代码', title: '代码' },
  { cmd: 'list', label: '• 列表', title: '无序列表' },
  { cmd: 'center', label: '居中', title: '居中' },
  { cmd: 'url', label: '链接', title: '链接' },
  { cmd: 'img', label: '图片', title: '从媒体库选图片（[img]id[/img]）' },
  { cmd: 'video', label: '视频', title: '从媒体库选视频（[video]id[/video]）' },
  { cmd: 'tex', label: '∑', title: 'LaTeX 公式（[tex]行内[/tex]，块级用 [texblock]）' },
];

/** BBCode：论坛那种模式，点按钮插标签，不用手敲 */
export function BBCodeEditor({
  src, onChange, insertRef,
}: {
  src: string;
  onChange: (src: string, html: string) => void;
  insertRef?: InsertRef;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const split = useSplit();
  /** 弹选择器时输入框会失焦，先把光标位置记下来 */
  const caretRef = useRef<[number, number]>([0, 0]);
  const [picking, setPicking] = useState<null | 'img' | 'video'>(null);

  const put = (text: string, at?: [number, number]) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = at ? at[0] : ta.selectionStart;
    const e = at ? at[1] : ta.selectionEnd;
    const next = ta.value.slice(0, s) + text + ta.value.slice(e);
    const caret = s + text.length;
    onChange(next, bbRender(next));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => put(text);
    return () => { if (insertRef) insertRef.current = null; };
    // put 是每次渲染新建的闭包，跟着 onChange 一起刷新即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRef, onChange, src]);

  const command = async (cmd: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    caretRef.current = [ta.selectionStart, ta.selectionEnd];

    const wrap = BB_WRAP[cmd];
    if (wrap) {
      const [o, c, ph] = wrap;
      put(o + (sel || ph) + c);
      return;
    }
    if (cmd.startsWith('size=')) {
      put(`[size=${cmd.split('=')[1]}]${sel || '文字'}[/size]`);
      return;
    }
    if (cmd === 'color') {
      const c = await askText('颜色（英文名或 #hex）', 'red');
      if (c) put(`[color=${c.trim()}]${sel || '文字'}[/color]`);
      return;
    }
    if (cmd === 'url') {
      const u = await askText('链接地址', 'https://');
      if (u) put(`[url=${u.trim()}]${sel || u.trim()}[/url]`);
      return;
    }
    if (cmd === 'img') {
      setPicking('img');
      return;
    }
    if (cmd === 'video') {
      setPicking('video');
    }
  };

  return (
    <>
      <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
        {BB_TOOLS.map((t) => (
          <button key={t.cmd} data-act={`bb-${t.cmd}`} title={t.title} onClick={() => void command(t.cmd)}
            style={t.cmd === 'color' ? { color: 'var(--accent)' } : undefined}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="bbwrap">
        <textarea
          ref={taRef}
          value={src}
          placeholder={'点上面的按钮插入 BBCode 标签，不用手敲。\n例：[b]加粗[/b]  [color=red]红字[/color]  [img]媒体id[/img]  [video]媒体id[/video]'}
          onChange={(e) => onChange(e.target.value, bbRender(e.target.value))}
        />
        <SplitGrip dragging={split.dragging} onDown={split.onDown} onReset={split.reset} />
        <div className="bbpreview rt" dangerouslySetInnerHTML={{ __html: bbRender(src) }} />
      </div>
      {picking ? (
        <MediaPicker
          single
          kind={picking === 'video' ? 'video' : 'image'}
          onClose={() => setPicking(null)}
          onDone={(ids) => {
            const id = ids[0];
            const at = caretRef.current;
            setPicking(null);
            if (!id) return;
            put(picking === 'video' ? `[video]${id}[/video]` : `[img]${id}[/img]`, at);
          }}
        />
      ) : null}
    </>
  );
}
