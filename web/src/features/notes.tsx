/**
 * 笔记的零件：模板、#标签 解析、搜索高亮、新建 / 移动面板。
 * 后端没有「标签表」，所以标签一律从前端正文里解析，不编字段。
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { askText, Dialog } from '../components/ui';
import { askProtect } from '../components/Lock';
import { Icon } from '../components/Icons';
import type { NoteRow, Notebook } from '../types';

export const NOTE_COLORS = ['#b8623a', '#4a7396', '#5f8256', '#8e6a9e', '#b8863a', '#4f8a86', '#a55a72', '#7a7469'];

/** 高亮底色：跟随主题的强调色，暗色主题下也不会刺眼 */
const MARK: CSSProperties = {
  background: 'color-mix(in srgb, var(--warn) 34%, transparent)',
  color: 'inherit',
  borderRadius: 3,
  padding: '0 2px',
};

/* ---------------- 模板 ---------------- */

export interface NoteTemplate {
  key: string;
  label: string;
  hint: string;
  body: string;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    key: 'blank', label: '空白', hint: '什么都不带，直接写',
    body: '',
  },
  {
    key: 'meeting', label: '会议记录', hint: '时间 / 参与人 / 议题 / 结论 / 待办',
    body: '<h2>会议记录</h2><p><b>时间：</b></p><p><b>参与人：</b></p>'
      + '<h3>议题</h3><ul><li></li></ul>'
      + '<h3>结论</h3><p></p>'
      + '<h3>待办</h3><ul><li></li></ul>',
  },
  {
    key: 'reading', label: '读书笔记', hint: '书名 / 摘录 / 想法',
    body: '<h2>书名</h2><p><b>作者：</b></p>'
      + '<h3>摘录</h3><blockquote></blockquote>'
      + '<h3>想法</h3><p></p>',
  },
  {
    key: 'checklist', label: '待办清单', hint: '一列勾选项，适合按天列任务',
    body: '<h2>待办清单</h2><ul><li>第一件事</li><li>第二件事</li><li>第三件事</li></ul>',
  },
  {
    key: 'idea', label: '灵感', hint: '一句话 + 为什么值得记',
    body: '<h2>灵感</h2><p></p><h3>为什么值得记</h3><p></p>',
  },
];

/* ---------------- 文本工具 ---------------- */

export const stripHtml = (html: string): string =>
  (html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const TAG_RE = /#([\p{L}\p{N}_-]{1,24})/gu;

/** 从正文里抠出 #标签（去重、保持出现顺序） */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const m of (text || '').matchAll(TAG_RE)) {
    const t = m[1];
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 关键词高亮：大小写不敏感，最多切 60 段，避免超长文本卡住 */
export function Highlight({ text, kw }: { text: string; kw: string }) {
  const k = kw.trim();
  if (!k || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const lk = k.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(lk);
  let n = 0;
  while (at >= 0 && n < 60) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={`m${n}`} style={MARK}>{text.slice(at, at + k.length)}</mark>);
    from = at + k.length;
    n += 1;
    at = lower.indexOf(lk, from);
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** 命中位置附近的一小段，用来在列表里展示"为什么这条被搜到" */
export function snippet(text: string, kw: string, len = 96): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const k = kw.trim();
  if (!k) return t.slice(0, len);
  const at = t.toLowerCase().indexOf(k.toLowerCase());
  if (at < 0) return t.slice(0, len);
  const start = Math.max(0, at - 24);
  const end = Math.min(t.length, at + k.length + 64);
  return `${start > 0 ? '…' : ''}${t.slice(start, end)}${end < t.length ? '…' : ''}`;
}

/* ---------------- 新建笔记 ---------------- */

export function NewNoteDialog({
  books, defaultNotebookId, onClose, onCreated,
}: {
  books: Notebook[];
  defaultNotebookId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useStore((s) => s.toast);
  const roots = books.filter((b) => !b.parentId);
  const first = defaultNotebookId || roots[0]?.id || books[0]?.id || '';

  const [title, setTitle] = useState('');
  const [nbId, setNbId] = useState(first);
  const [newName, setNewName] = useState('');
  const [color, setColor] = useState(books.find((b) => b.id === first)?.color || NOTE_COLORS[0]);
  /*
   * 第 128 条：这篇笔记**自己**的标识，独立于笔记本颜色。
   * 早先这个对话框里那个调色板改的其实是笔记本颜色 —— 用户以为在给笔记选色，
   * 一选整本都变了。所以这里拆成两个：`color` 管笔记本，`markColor` 管这一篇。
   */
  const [markColor, setMarkColor] = useState('');
  const [markIcon, setMarkIcon] = useState('');
  const [tpl, setTpl] = useState('blank');
  const [busy, setBusy] = useState(false);

  const pickBook = (id: string) => {
    setNbId(id);
    const b = books.find((x) => x.id === id);
    if (b) setColor(b.color || NOTE_COLORS[0]);
  };

  const create = async () => {
    const t = title.trim();
    if (!t) { toast('先给笔记起个标题'); return; }
    if (busy) return;
    setBusy(true);
    try {
      let bookId = nbId;
      if (!bookId) {
        const nm = newName.trim() || '新笔记本';
        const r = await api.notebookAdd2(nm, color, '');
        bookId = r.id;
      } else {
        const cur = books.find((b) => b.id === bookId);
        if (cur && cur.color !== color) await api.notebooks.update({ id: bookId, color });
      }
      const body = NOTE_TEMPLATES.find((x) => x.key === tpl)?.body || '';
      const r = await api.notes.save({
        id: '', notebookId: bookId, title: t, body, pinned: 0,
        /* 第 128 条：新建时就把标识写进去，不用建完再去改一次 */
        color: markColor, icon: markIcon,
      });
      onCreated(r.id);
      onClose();
    } catch (e) {
      toast('新建失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="新建笔记"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={() => void create()}>创建</button>
      </>}
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label>标题</label>
        <input
          className="inp" autoFocus value={title}
          placeholder="比如：10 月复盘 / 读书摘录"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
        />
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>放在哪</label>
        <select className="inp" value={nbId} onChange={(e) => pickBook(e.target.value)}>
          {roots.length ? <optgroup label="笔记本">
            {roots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </optgroup> : null}
          {books.filter((b) => b.parentId).length ? (
            <optgroup label="分组里的笔记本">
              {books.filter((b) => b.parentId).map((b) => (
                <option key={b.id} value={b.id}>
                  {roots.find((r) => r.id === b.parentId)?.name || '分组'} / {b.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value="">＋ 新建笔记本</option>
        </select>
        {!nbId ? (
          <input
            className="inp" style={{ marginTop: 6 }} value={newName}
            placeholder="新笔记本的名字"
            onChange={(e) => setNewName(e.target.value)}
          />
        ) : null}
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>笔记本颜色<span className="small muted" style={{ marginLeft: 6 }}>（记在笔记本上，左栏的圆点）</span></label>
        <div className="row" style={{ gap: 7 }}>
          {NOTE_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
                border: `2px solid ${color === c ? 'var(--ink)' : 'transparent'}`,
              }}
            />
          ))}
        </div>
      </div>

      {/* 第 128 条：这一篇自己的颜色 / 图标 —— 用户原来抱怨的就是缺这个 */}
      <div className="field" style={{ marginBottom: 12 }}>
        <label>
          这篇笔记的颜色
          <span className="small muted" style={{ marginLeft: 6 }}>（只在列表里给这一篇做标记）</span>
        </label>
        <div className="row" style={{ gap: 7, marginBottom: 8 }}>
          <span
            onClick={() => setMarkColor('')}
            title="跟随笔记本"
            style={{
              width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', boxSizing: 'border-box',
              background: color || 'var(--panel2)',
              border: `2px dashed ${!markColor ? 'var(--ink)' : 'var(--line)'}`,
            }}
          />
          {NOTE_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => setMarkColor(c)}
              title={c}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
                boxSizing: 'border-box',
                border: `2px solid ${markColor === c ? 'var(--ink)' : 'transparent'}`,
              }}
            />
          ))}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {NOTE_ICONS.map((it) => (
            <button
              key={it.k || 'none'}
              className={`btn sm ghost ${markIcon === it.k ? 'primary' : ''}`}
              title={it.n}
              style={{ padding: '3px 6px', minWidth: 28 }}
              onClick={() => setMarkIcon(it.k)}
            >
              {it.k ? <Icon name={it.k as never} size={13} /> : <span style={{ fontSize: 11 }}>无</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>类型</label>
        <div className="row" style={{ gap: 6 }}>
          {NOTE_TEMPLATES.map((t) => (
            <button
              key={t.key}
              className={`chip ${tpl === t.key ? 'on' : ''}`}
              onClick={() => setTpl(t.key)}
              title={t.hint}
            >{t.label}</button>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {NOTE_TEMPLATES.find((t) => t.key === tpl)?.hint}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------- 第 128 条：笔记自己的颜色 / 图标 ---------------- */

/**
 * 单篇笔记的色点。
 *
 * 为什么不是「编辑器里一个取色器」：用户原话是「老的那些笔记有颜色图标，
 * 但新建笔记没有」—— 他要的其实是**一堆笔记放在一起时能一眼分辨**，
 * 所以重点不是调色调得多细，而是列表里那颗圆点能不能点、点了马上变。
 *
 * 空串的处理：`color=''` 表示跟随笔记本，显示的是笔记本颜色但点稍微淡一点，
 * 让「这篇自己没设色」和「这篇自己就是这个色」在视觉上能分开 —— 但不必给
 * 用户解释这套继承语义，他只看得到色点。
 */
export function NoteDot({
  color, inherited, size = 9, onClick, title,
}: {
  color: string;
  inherited?: boolean;
  size?: number;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  if (!color) return null;
  return (
    <span
      onClick={onClick}
      title={title}
      style={{
        width: size, height: size, borderRadius: '50%', background: color,
        flex: '0 0 auto', display: 'inline-block', cursor: onClick ? 'pointer' : 'default',
        /* 继承来的用虚线描边：不是「没颜色」，是「这个颜色不是它自己的」 */
        boxShadow: inherited ? `inset 0 0 0 1.5px color-mix(in srgb, var(--panel) 70%, transparent)` : 'none',
        opacity: inherited ? 0.62 : 1,
      }}
    />
  );
}

/** 笔记能选的图标（都是语义名，跟 Icons.tsx 那套对得上） */
export const NOTE_ICONS: { k: string; n: string }[] = [
  { k: '', n: '无' },
  { k: 'star', n: '星标' },
  { k: 'book', n: '读书' },
  { k: 'sparkle', n: '灵感' },
  { k: 'todo', n: '清单' },
  { k: 'tag', n: '标签' },
  { k: 'clock', n: '时间' },
  { k: 'link', n: '链接' },
  { k: 'image', n: '图片' },
  { k: 'key', n: '密钥' },
  { k: 'chart', n: '数据' },
  { k: 'note', n: '普通' },
];

/**
 * 色点 + 图标的小面板。列表行右键 / 编辑器工具栏都调它。
 *
 * 为什么不塞进 `Dialog`：这是「点一下就换个颜色」的轻操作，
 * 弹个带标题带确定取消的模态框，点一次颜色要走三步，比不改还累。
 */
export function NoteMarkPicker({
  color, icon, bookColor, onPick, onClose,
}: {
  color: string;
  icon: string;
  bookColor?: string;
  onPick: (patch: { color?: string; icon?: string }) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="rowmenu"
      style={{ minWidth: 188, padding: 8, display: 'block' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="small muted" style={{ marginBottom: 5 }}>颜色</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {/* 第一颗是「跟随笔记本」：清掉自己的色，回到笔记本那个色 */}
        <span
          onClick={() => { onPick({ color: '' }); onClose(); }}
          title={`跟随笔记本${bookColor ? `（${bookColor}）` : ''}`}
          style={{
            width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
            background: bookColor || 'var(--panel2)',
            border: `2px dashed ${!color ? 'var(--ink)' : 'var(--line)'}`,
            boxSizing: 'border-box',
          }}
        />
        {NOTE_COLORS.map((c) => (
          <span
            key={c}
            onClick={() => { onPick({ color: c }); onClose(); }}
            title={c}
            style={{
              width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
              border: `2px solid ${color === c ? 'var(--ink)' : 'transparent'}`,
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>

      <div className="small muted" style={{ margin: '9px 0 5px' }}>图标</div>
      <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
        {NOTE_ICONS.map((it) => (
          <button
            key={it.k || 'none'}
            className="btn sm ghost"
            title={it.n}
            style={{
              padding: 4, minWidth: 26,
              ...(icon === it.k ? { background: 'var(--panel2)', color: 'var(--ink)' } : null),
            }}
            onClick={() => { onPick({ icon: it.k }); onClose(); }}
          >
            {it.k ? <Icon name={it.k as never} size={13} /> : <span style={{ fontSize: 11 }}>无</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 移动笔记 ---------------- */

export function MoveNoteDialog({
  note, books, onClose, onDone,
}: {
  note: NoteRow;
  books: Notebook[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const [target, setTarget] = useState(note.notebookId || '');
  const [busy, setBusy] = useState(false);

  const roots = books.filter((b) => !b.parentId);

  const move = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 移动要带上完整正文，后端 save 是全量覆盖
      const d = await api.notes.get(note.id);
      await api.notes.save({
        id: note.id, notebookId: target,
        title: d.title || note.title, body: d.body || '', pinned: d.pinned || 0,
      });
      toast('已移动到「' + (books.find((b) => b.id === target)?.name || '笔记本') + '」');
      onDone();
      onClose();
    } catch (e) {
      toast('移动失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`移动「${note.title || '未命名'}」`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy || !target} onClick={() => void move()}>移动</button>
      </>}
    >
      <div className="field">
        <label>目标笔记本</label>
        <select className="inp" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">请选择</option>
          {roots.map((b) => (
            <optgroup key={b.id} label={b.name}>
              <option value={b.id}>{b.name}（本层）</option>
              {books.filter((x) => x.parentId === b.id).map((x) => (
                <option key={x.id} value={x.id}>{b.name} / {x.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </Dialog>
  );
}

/* ---------------- 笔记本管理（含分组） ---------------- */

export function NotebookDialog({
  book, books, onClose, onChanged,
}: {
  book: Notebook;
  books: Notebook[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useStore((s) => s.toast);
  /* 第 32 条：这一本有没有加过密码。vault.remove 收的是规则 id，不是 scope+target，
     所以这里连 id 一起找出来，取消保护时才删得准。 */
  const vaultRules = useStore((s) => s.vault?.rules ?? []);
  const lockRule = vaultRules.find((r) => r.scope === 'notebook' && r.target === book.id);
  const bookLocked = !!lockRule;
  const [name, setName] = useState(book.name);
  const [color, setColor] = useState(book.color || NOTE_COLORS[0]);
  const [parent, setParent] = useState(book.parentId || '');
  const [busy, setBusy] = useState(false);

  const isRoot = !book.parentId;
  const hasKids = books.some((b) => b.parentId === book.id);

  /**
   * 第 220 条：层级不再限两层。
   *
   * 可选父节点 = 全部笔记本里，去掉自己、去掉自己的所有子孙。
   * 去掉子孙这一步是必须的：不然用户在下拉里选了自己的孙子，
   * 提交上去就成环了。后端也会拦（notebook.parent2 会一路往上爬着查），
   * 但前端先把明显不合理的选项藏掉，比让用户点了再挨一顿报错好。
   */
  const family = useMemo(() => {
    const kids = new Map<string, string[]>();
    for (const b of books) {
      const p = b.parentId || '';
      if (!p) continue;
      const arr = kids.get(p);
      if (arr) arr.push(b.id); else kids.set(p, [b.id]);
    }
    const banned = new Set<string>([book.id]);
    const stack = [book.id];
    let guard = 0;
    while (stack.length && guard++ < 500) {
      const cur = stack.pop()!;
      for (const k of kids.get(cur) || []) {
        if (banned.has(k)) continue;
        banned.add(k);
        stack.push(k);
      }
    }
    return books.filter((b) => !banned.has(b.id));
  }, [books, book.id]);

  /** 拼出「A / B / C」这样的路径，供下拉里区分同名笔记本 */
  const pathOf = (id: string): string => {
    const byId = new Map(books.map((b) => [b.id, b]));
    const names: string[] = [];
    let cur = id;
    let guard = 0;
    while (cur && guard++ < 32) {
      const b = byId.get(cur);
      if (!b) break;
      names.unshift(b.name);
      cur = b.parentId || '';
    }
    return names.join(' / ');
  };

  const save = async () => {
    if (!name.trim()) { toast('名字不能空'); return; }
    if (busy) return;
    setBusy(true);
    try {
      await api.notebooks.update({ id: book.id, name: name.trim(), color });
      if ((book.parentId || '') !== parent) {
        /* 第 220 条：走带防环校验的那个，失败了把原因原样告诉用户 */
        const r = await api.notebooks.setParent(book.id, parent);
        if (!r.ok) { toast(r.err || '不能放到那个位置'); setBusy(false); return; }
      }
      onChanged();
      toast('已保存');
      onClose();
    } catch (e) {
      toast('保存失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addChild = async () => {
    const v = await askText(`在「${book.name}」下新建笔记本`, '', '例如：第二季度');
    if (!v || !v.trim()) return;
    await api.notebookAdd2(v.trim(), NOTE_COLORS[books.length % NOTE_COLORS.length], book.id);
    onChanged();
    toast('已新建子笔记本');
  };

  const removeBook = async () => {
    const msg = hasKids
      ? `删除分组「${book.name}」？先把下面的子笔记本和笔记整理好，删除后无法撤销。`
      : `删除笔记本「${book.name}」？里面的笔记会一并处理，删除后无法撤销。`;
    if (!window.confirm(msg)) return;
    await api.notebooks.remove(book.id);
    onChanged();
    toast('已删除');
    onClose();
  };

  return (
    <Dialog
      title="笔记本设置"
      onClose={onClose}
      footer={<>
        <button className="btn danger" onClick={() => void removeBook()}>删除</button>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>保存</button>
      </>}
    >
      <div className="field" style={{ marginBottom: 12 }}>
        <label>{isRoot ? '分组 / 笔记本名称' : '笔记本名称'}</label>
        <input
          className="inp" autoFocus value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
        />
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>颜色</label>
        <div className="row" style={{ gap: 7 }}>
          {NOTE_COLORS.map((c) => (
            <span
              key={c}
              onClick={() => setColor(c)}
              style={{
                width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer',
                border: `2px solid ${color === c ? 'var(--ink)' : 'transparent'}`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
        <label>放在哪个笔记本下面</label>
        <select className="inp" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">顶级（不放任何人下面）</option>
          {family.map((b: Notebook) => (
            <option key={b.id} value={b.id}>{pathOf(b.id)}</option>
          ))}
        </select>
        <div className="small muted" style={{ marginTop: 4 }}>
          想套多少层套多少层。自己和自己下面的本子不会出现在这个列表里 ——
          不然就成了「我自己的子目录又装着我」那种死循环。
        </div>
      </div>

      <button className="btn sm" onClick={() => void addChild()}>
        <Icon name="plus" size={12} />在「{book.name}」下面新建
      </button>

      {/* 第 32 条：整个笔记本加密码。
          原来只能给单篇笔记加，整个本子想藏起来做不到 —— 而「这一本都别让人看见」
          才是更常见的需求（私密日记本、工作笔记分开）。 */}
      <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
        <label>密码保护</label>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {bookLocked ? (
            <>
              <span className="small" style={{ color: 'var(--ok)' }}>
                <Icon name="lock" size={11} /> 这个笔记本已加密码
              </span>
              <button
                className="btn sm ghost" disabled={busy}
                onClick={async () => {
                  if (!window.confirm(`取消「${book.name}」的密码保护？之后打开这个笔记本不再要密码。`)) return;
                  setBusy(true);
                  try {
                    await api.vault.remove(lockRule.id);
                    await useStore.getState().reloadVault().catch(() => null);
                    toast('已取消密码保护');
                    onChanged();
                  } catch { toast('取消失败，稍后再试'); }
                  finally { setBusy(false); }
                }}
              >取消保护</button>
            </>
          ) : (
            <>
              <span className="small muted">打开这一本（无论从哪进）都要先输密码</span>
              <button
                className="btn sm" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const ok = await askProtect('notebook', book.id, book.name || '这个笔记本');
                    if (ok) { toast('已加密码保护'); onChanged(); }
                  } catch { toast('加密码失败，稍后再试'); }
                  finally { setBusy(false); }
                }}
              >加密码</button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
