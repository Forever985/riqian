import { useEffect, useRef } from 'react';
import { createEngine } from './engine';

/**
 * 把裸文本包进 `<p>`。
 *
 * 不是为了好看 —— 没有块级元素时，回车会在编辑器外面插段落（光标跟着跑出去，
 * 后面打的字全部丢失）。历史数据里存的也常是裸文本，所以载入时统一规整一遍。
 */
export function normalizeBlocks(html: string): string {
  if (!html || !html.trim()) return '<p><br></p>';
  const box = document.createElement('div');
  box.innerHTML = html;
  const first = box.firstElementChild;
  const isBlock = first && /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR)$/.test(first.tagName);
  if (isBlock) return html;
  return `<p>${html}</p>`;
}

let idSeq = 0;

/**
 * 受控 contenteditable（第 73 条重做后的版本）。
 *
 * 分工：
 * - React 只负责「外部值 → DOM」（切日期、切模块、清空）
 * - 打字时 DOM 是唯一事实，输入、格式化、撤销全部走 engine，不经过 React 重渲染
 *
 * 关键点：只要 `html` 是自己刚抛上去的那个值就直接跳过写回 ——
 * 之前用 `document.activeElement` 判断，切开关卡那种"焦点还在但内容已经换人"的情况会漏。
 */
export function RichText({
  html, onChange, placeholder, className = 'rt', style, singleLine, live = true,
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  singleLine?: boolean;
  /** 输入即格式化（Markdown / BBCode / LaTeX 写完就转） */
  live?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const engRef = useRef<ReturnType<typeof createEngine> | null>(null);
  const lastEmit = useRef<string | null>(null);
  const idRef = useRef(`rt${++idSeq}`);

  const cb = useRef(onChange);
  cb.current = onChange;
  const liveRef = useRef(live);
  liveRef.current = live;

  /* 挂载：写入初始内容 + 绑事件。只做一次。 */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const initial = normalizeBlocks(html);
    if (el.innerHTML !== initial) el.innerHTML = initial;
    lastEmit.current = null;

    const eng = createEngine({
      root: () => ref.current,
      emit: (h) => { lastEmit.current = h; cb.current(h); },
      live: () => liveRef.current,
      singleLine,
    });
    engRef.current = eng;
    eng.bind(el);

    return () => { eng.unbind(el); engRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 外部值变化才写回 DOM */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastEmit.current === html) return;          // 就是自己抛上去的，别打架
    const next = normalizeBlocks(html);
    if (el.innerHTML === next) return;
    el.innerHTML = next;
    lastEmit.current = null;
    engRef.current?.resetHistory();
  }, [html]);

  /* 单行模式的回车由 engine 处理（失焦），这里不再重复拦 */

  return (
    <div
      ref={ref}
      id={idRef.current}
      className={className}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-ph={placeholder}
      style={style}
    />
  );
}

/** 富文本工具栏：用 execCommand，保持「所见即所得」的老派手感（够用且无依赖） */
const CMDS: ({ cmd: string; val?: string; label: string; title: string } | 'sep')[] = [
  { cmd: 'bold', label: 'B', title: '粗体 Ctrl+B' },
  { cmd: 'italic', label: 'I', title: '斜体 Ctrl+I' },
  { cmd: 'underline', label: 'U', title: '下划线 Ctrl+U' },
  { cmd: 'strikeThrough', label: 'S', title: '删除线' },
  'sep',
  { cmd: 'formatBlock', val: 'h2', label: 'H2', title: '标题' },
  { cmd: 'formatBlock', val: 'h3', label: 'H3', title: '小标题' },
  { cmd: 'insertUnorderedList', label: '• 列表', title: '列表' },
  { cmd: 'formatBlock', val: 'blockquote', label: '引', title: '引用块' },
  'sep',
  { cmd: 'removeFormat', label: '清格式', title: '清除格式' },
];

export function RichToolbar({ editorRef }: { editorRef: React.RefObject<HTMLDivElement> }) {
  const run = (cmd: string, val?: string) => {
    // ref 可能挂在包裹层上，真正可编辑的是里面的 contenteditable
    const box = editorRef.current;
    const el = (box?.querySelector?.('[contenteditable="true"]') as HTMLElement | null) || box;
    if (!el) return;
    el.focus();
    try {
      document.execCommand(cmd, false, val ?? undefined);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      /* 老 API 偶尔抽风，忽略即可 */
    }
  };

  return (
    <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
      {CMDS.map((c, i) =>
        c === 'sep' ? (
          <span className="sep" key={`s${i}`} />
        ) : (
          <button key={c.label} data-act={`fmt-${c.cmd}${c.val ? "-" + c.val : ""}`} title={c.title} onClick={() => run(c.cmd, c.val)}>
            {c.cmd === 'bold' ? <b>B</b>
              : c.cmd === 'italic' ? <i>I</i>
              : c.cmd === 'underline' ? <u>U</u>
              : c.cmd === 'strikeThrough' ? <s>S</s>
              : c.label}
          </button>
        ),
      )}
    </div>
  );
}
