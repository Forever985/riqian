import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { SearchBox } from '../components/SearchBox';
import { Topbar, Dialog, askText } from '../components/ui';
import { Icon } from '../components/Icons';
import { Guarded, askProtect } from '../components/Lock';
import { RichText } from '../editors/RichText';
import { SortBar, type SortDir, type SortOption } from '../components/SortBar';
import { useDragSort } from '../components/DragSort';
import {
  Highlight, MoveNoteDialog, NewNoteDialog, NotebookDialog,
  NOTE_COLORS, parseTags, snippet, stripHtml,
} from '../features/notes';
import type { NoteRow, Notebook } from '../types';

/**
 * 第 200/201 条：排序维度只表达「按什么排」，升降交给旁边那个开关。
 * 之前的写法是「按更新时间」这种把方向焊死在维度里的标签 ——
 * 于是永远只有一个方向，用户想倒着看办不到。
 */
type SortKey = 'updated' | 'name' | 'chars' | 'manual';

const NOTE_SORTS: SortOption<SortKey>[] = [
  { v: 'updated', n: '更新时间', tip: '最近改过的排前面' },
  { v: 'name', n: '名称', tip: '按标题认字排，认拼音' },
  { v: 'chars', n: '字数', tip: '写得多排前面' },
  /* 第 230 条：手动顺序是自己拖出来的，没有升降之说 */
  { v: 'manual', n: '手动', tip: '自己拖出来的顺序', dir: false },
];

const SORT_LABEL: Record<SortKey, string> = {
  updated: '更新时间',
  name: '名称',
  chars: '字数',
  manual: '手动',
};

interface TextCache {
  plain: string;
  tags: string[];
}

/** 备忘录：分组 → 笔记本 → 笔记 → 编辑器；搜索、标签、排序都在前端算 */
export function NotesView() {
  const activeNoteId = useStore((s) => s.activeNoteId);
  const setActiveNote = useStore((s) => s.setActiveNote);
  const openTab = useStore((s) => s.openTab);
  const toast = useStore((s) => s.toast);

  const [books, setBooks] = useState<Notebook[]>([]);
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [nb, setNb] = useState<string>('');            // '' = 全部
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  /* 第 201 条：排序方式以前只有三个焊死方向的选项，现在维度和方向分开，且记进 settings */
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const rawSort = String(settings?.noteSort || 'updated');
  const sort: SortKey = (['updated', 'name', 'chars', 'manual'] as const).includes(rawSort as SortKey)
    ? (rawSort as SortKey) : 'updated';
  const rawDir = String(settings?.noteSortDir || 'desc');
  const dir: SortDir = rawDir === 'asc' ? 'asc' : 'desc';
  const setSort = (v: SortKey) => { void setSetting('noteSort', v); };
  const setDir = (d: SortDir) => { void setSetting('noteSortDir', d); };
  const [folded, setFolded] = useState<string[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<{ id: string; title: string; at: string }[]>([]);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<NoteRow | null>(null);
  const [bookEdit, setBookEdit] = useState<Notebook | null>(null);

  // 编辑器
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(0);
  const [noteBook, setNoteBook] = useState('');
  const [editorTags, setEditorTags] = useState<string[]>([]);
  /*
   * 加了锁的笔记，列表里**不能**再露正文摘要和标签。
   * 之前只是把编辑器包了 <Guarded>，左边列表照样把第一行显示出来 ——
   * 加了个密码，结果摘要里什么都看得到，等于白加。
   */
  const vaultRules = useStore((st) => st.vault?.rules ?? []);
  const isProtected = (id: string) => vaultRules.some((r) => r.scope === 'note' && (r.target === id || r.target === ''));
  /** 输入即格式化，跟「设置 → 日记与模块」里那个开关是同一个 */
  const liveMarkup = useStore((st) => String(st.settings.liveMarkup ?? '1') === '1');
  const [tagInput, setTagInput] = useState('');
  const [saved, setSaved] = useState('');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 防抖回调里必须读到"最新"的标题 / 归属，否则会晚一个字
  const titleRef = useRef('');
  const bookRef = useRef('');
  const pinRef = useRef(0);

  // 正文缓存：搜索、标签、字数都靠它（列表接口只给摘要）
  const cache = useRef<Record<string, TextCache>>({});
  const [tick, setTick] = useState(0);

  const loadBooks = async () => setBooks(await api.notebooks.list().catch(() => [] as Notebook[]));

  const hydrate = async (list: NoteRow[]) => {
    let n = 0;
    for (const r of list) {
      if (cache.current[r.id]) continue;
      try {
        const d = await api.notes.get(r.id);
        const plain = (d.plain || stripHtml(d.body || '')).trim();
        cache.current[r.id] = { plain, tags: parseTags(plain) };
      } catch {
        cache.current[r.id] = { plain: '', tags: [] };
      }
      n += 1;
      if (n % 6 === 0) setTick((t) => t + 1);
    }
    if (n) setTick((t) => t + 1);
  };

  const loadRows = async () => {
    // notebookId 传空 = 全部；筛选、搜索都在本地做，切笔记本不用重新请求
    const list = await api.notes.list({ notebookId: '', q: '' }).catch(() => [] as NoteRow[]);
    setRows(list);
    void hydrate(list);
  };

  useEffect(() => {
    void loadBooks();
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 编辑器加载 / 保存 ---------------- */

  /** 当前编辑器里放着哪篇笔记：切走的一瞬间要先把上一篇写掉 */
  const editingId = useRef<string | null>(null);

  useEffect(() => {
    const prev = editingId.current;
    if (prev && prev !== activeNoteId && timer.current) {
      // 从侧栏 / 选项卡切走时也保住最后一次输入
      clearTimeout(timer.current);
      timer.current = null;
      void api.notes.save({
        id: prev, notebookId: bookRef.current, title: titleRef.current,
        body, pinned: pinRef.current,
      }).catch(() => null);
    }
    editingId.current = activeNoteId;

    if (!activeNoteId) {
      setTitle(''); setBody(''); setPinned(0); setNoteBook(''); setEditorTags([]);
      titleRef.current = ''; bookRef.current = ''; pinRef.current = 0;
      return;
    }
    void (async () => {
      const n = await api.notes.get(activeNoteId);
      if (!n.ok) { toast('笔记不存在'); return; }
      setTitle(n.title);
      setBody(n.body);
      setPinned(n.pinned);
      setNoteBook(n.notebookId);
      titleRef.current = n.title;
      bookRef.current = n.notebookId;
      pinRef.current = n.pinned;
      const plain = (n.plain || stripHtml(n.body || '')).trim();
      cache.current[n.id] = { plain, tags: parseTags(plain) };
      setEditorTags(cache.current[n.id].tags);
      setTick((t) => t + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  const flush = async (silent = true) => {
    if (!activeNoteId) return null;
    const html = body;
    setSaved('保存中…');
    try {
      const r = await api.notes.save({
        id: activeNoteId, notebookId: bookRef.current, title: titleRef.current, body: html, pinned: pinRef.current,
      });
      setBody(html);
      const plain = stripHtml(html);
      cache.current[activeNoteId] = { plain, tags: parseTags(plain) };
      setEditorTags(cache.current[activeNoteId].tags);
      setSaved('已保存');
      if (!silent) toast('已保存');
      await loadRows();
      return r;
    } catch (e) {
      setSaved('保存失败');
      toast('保存失败：' + (e as Error).message);
      return null;
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const schedule = () => {
    setSaved('输入中…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current(); }, 700);
  };

  // 关掉页面 / 切走时把没写完的一起落盘
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void flushRef.current();
    }
  }, []);

  const flushNow = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await flushRef.current();
  };

  const openNote = async (id: string) => {
    if (id === activeNoteId) return;
    if (timer.current) await flushNow();
    setMenuFor(null);
    setActiveNote(id);
    openTab('notes', { noteId: id, title: '笔记' });
  };

  const remove = async (id: string) => {
    // 还没落盘的防抖得先掐掉，否则删完又被保存回来
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    await api.notes.remove(id);
    delete cache.current[id];
    if (activeNoteId === id) setActiveNote(null);
    await loadRows();
    await loadBooks();
    toast('已移入回收站');
  };

  /* ---------------- 单条笔记的操作 ---------------- */

  /** 只改一个字段也要带上完整正文（save 是全量覆盖） */
  const saveDetail = async (id: string, patch: { title?: string; notebookId?: string; pinned?: number }) => {
    const d = await api.notes.get(id);
    return api.notes.save({
      id,
      notebookId: patch.notebookId ?? d.notebookId,
      title: patch.title ?? d.title,
      body: d.body || '',
      pinned: patch.pinned ?? d.pinned,
    });
  };

  const rename = async (r: NoteRow) => {
    const v = await askText('重命名笔记', r.title || '', '新标题');
    if (!v || !v.trim()) return;
    if (r.id === activeNoteId) await flushNow();
    await saveDetail(r.id, { title: v.trim() });
    if (r.id === activeNoteId) {
      setTitle(v.trim());
      titleRef.current = v.trim();
    }
    await loadRows();
    toast('已重命名');
  };

  const duplicate = async (r: NoteRow) => {
    if (r.id === activeNoteId) await flushNow();
    const d = await api.notes.get(r.id);
    const t = `${d.title || '未命名'} 副本`;
    const res = await api.notes.save({ id: '', notebookId: d.notebookId, title: t, body: d.body || '', pinned: 0 });
    cache.current[res.id] = { plain: (d.plain || stripHtml(d.body || '')).trim(), tags: [] };
    cache.current[res.id].tags = parseTags(cache.current[res.id].plain);
    await loadRows();
    toast('已复制一份');
    setActiveNote(res.id);
    openTab('notes', { noteId: res.id, title: t });
  };

  const togglePin = async (r: NoteRow) => {
    const next = r.pinned ? 0 : 1;
    if (r.id === activeNoteId) {
      await flushNow();
      setPinned(next);
      pinRef.current = next;
      await api.notes.save({
        id: r.id, notebookId: bookRef.current, title: titleRef.current,
        body, pinned: next,
      });
    } else {
      await saveDetail(r.id, { pinned: next });
    }
    await loadRows();
    toast(next ? '已置顶' : '已取消置顶');
  };

  const copyLink = async (r: NoteRow) => {
    const text = `${r.title || '未命名'}\nriqian://note/${r.id}`;
    try {
      await api.share.copyText(text);
    } catch {
      try { await navigator.clipboard.writeText(text); } catch { toast('复制失败'); return; }
    }
    toast('已复制笔记链接');
  };

  /* ---------------- 搜索 / 筛选 / 排序 ---------------- */

  const textOf = (r: NoteRow): TextCache => cache.current[r.id] || { plain: r.excerpt || '', tags: [] };

  const kw = q.trim();

  const filtered = useMemo(() => {
    const lk = kw.toLowerCase();
    return rows.filter((r) => {
      if (nb && r.notebookId !== nb) return false;
      const c = cache.current[r.id];
      if (tag && !(c?.tags || []).includes(tag)) return false;
      if (!lk) return true;
      const hay = `${r.title || ''} ${c?.plain || r.excerpt || ''} ${(c?.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(lk);
    });
    // tick：正文是异步补进来的，缓存变了要重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, nb, tag, kw, tick]);

  const sorted = useMemo(() => {
    const list = filtered.slice();
    const mul = dir === 'asc' ? 1 : -1;

    /* 第 230 条：手动模式下顺序完全按笔记自己的 sort 走，不再拿置顶和时间插队 */
    if (sort === 'manual') {
      list.sort((a, b) => (a.sort || 0) - (b.sort || 0) || (a.title || '').localeCompare(b.title || '', 'zh'));
      return list;
    }

    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return b.pinned - a.pinned;      // 置顶永远在上
      if (sort === 'name') {
        const x = (a.title || '').trim();
        const y = (b.title || '').trim();
        /* 没标题的别因为升降翻转跑到最前面 —— 它本来就该垫底 */
        if (!x && !y) return 0;
        if (!x) return 1;
        if (!y) return -1;
        return mul * x.localeCompare(y, 'zh');
      }
      if (sort === 'chars') return mul * ((a.chars || 0) - (b.chars || 0));
      /* 更新时间：ISO 字符串比大小就是时间比大小 */
      const x = a.updatedAt || '';
      const y = b.updatedAt || '';
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return mul * x.localeCompare(y);
    });
    return list;
  }, [filtered, sort, dir]);

  /**
   * 第 230 条：笔记列表拖动排序。
   *
   * 只把「当前视图看到的这些」重新排，但发回去的是**整个可见列表的顺序** ——
   * 和待办那边（第 163 条）踩过的坑一样：只发部分 id 的话，
   * 剩下那些的 sort 还是老值，换个笔记本顺序就乱了。
   * 分页/筛选下拖也只影响当前这一段，符合直觉。
   */
  const noteDrag = useDragSort({
    keys: sorted.map((r) => r.id),
    disabled: sort !== 'manual',
    onReorder: async (from, to) => {
      const ids = sorted.map((r) => r.id);
      if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
      const next = ids.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      // 先本地乐观更新，拖完立刻就在新位置，不用等后端回来再跳一下
      setRows((prev) => {
        const pos = new Map(next.map((id, k) => [id, k * 10]));
        return prev.map((r) => (pos.has(r.id) ? { ...r, sort: pos.get(r.id) } : r));
      });
      try {
        await api.notes.reorder(next);
        toast('顺序已保存');
      } catch {
        toast('顺序没存上，再试一次');
        setRows(await api.notes.list({ notebookId: '', q: '' }).catch(() => [] as NoteRow[]));
      }
    },
  });

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => (cache.current[r.id]?.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
    // tick：缓存补齐后标签统计才会完整
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tick]);

  /* ---------------- 笔记本（两层） ---------------- */

  const roots = useMemo(() => {
    const ids = new Set(books.map((b) => b.id));
    return books
      .filter((b) => !b.parentId || !ids.has(b.parentId))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'zh'));
  }, [books]);

  const kidsOf = (id: string) => books
    .filter((b) => b.parentId === id)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'zh'));

  const countOf = (id: string) => rows.filter((r) => r.notebookId === id).length;

  /** 这个笔记本连同它下面所有子本里的笔记数（第 220 条：层级深了，只看本层就不知道底下有多少） */
  const deepCount = (id: string): number => {
    let n = countOf(id);
    for (const k of kidsOf(id)) n += deepCount(k.id);
    return n;
  };

  /**
   * 递归铺笔记本树（第 220 条）。
   *
   * 层级没有上限，所以不能用「map 一层再 map 一层」那种写法。
   * 缩进跟着层数走，但封顶在 6 层 —— 再往右缩名字就没了，
   * 那时候不是「嵌套得深」，是「看不清了」，不如就此打住。
   */
  const renderBooks = (parentId: string, depth: number): React.ReactNode => {
    if (depth > 6) return null;
    const list = parentId
      ? kidsOf(parentId)
      : roots;
    return list.map((b) => {
      const kids = kidsOf(b.id);
      const open = !folded.includes(b.id);
      const pad = 9 + depth * 12;
      return (
        <div key={b.id}>
          <div className="nbookrow">
            <button
              className={`nbook ${nb === b.id ? 'on' : ''}`}
              style={{ paddingLeft: pad, fontSize: depth ? 12.5 : undefined }}
              title={kids.length ? '点名字看这一层的笔记，点箭头展开下一层' : '点名字看这个笔记本里的笔记'}
              onClick={() => setNb(b.id)}
            >
              {kids.length ? (
                <span
                  style={{ flex: '0 0 12px', textAlign: 'center', color: 'var(--ink3)', fontSize: 10 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFolded(open ? [...folded, b.id] : folded.filter((x) => x !== b.id));
                  }}
                >{open ? '▾' : '▸'}</span>
              ) : (
                <span style={{ flex: '0 0 12px' }} />
              )}
              <span className="dot" style={{ background: b.color, width: depth ? 6 : 8, height: depth ? 6 : 8 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              {/* 第 32 条：加过密码的笔记本标一把小锁，不然「点进去要密码」会让人懵 */}
              {vaultRules.some((r) => r.scope === 'notebook' && r.target === b.id) ? (
                <span style={{ flex: '0 0 auto', color: 'var(--ink3)', opacity: 0.8 }} title="这个笔记本加过密码">
                  <Icon name="lock" size={10} />
                </span>
              ) : null}
              <span className="n">{deepCount(b.id)}</span>
            </button>
            <button className="nbookmenu" title="笔记本设置" onClick={() => setBookEdit(b)}>⋯</button>
          </div>
          {open ? renderBooks(b.id, depth + 1) : null}
        </div>
      );
    });
  };

  const addBook = async () => {
    const v = await askText('新建笔记本 / 分组', '', '例如：读书摘录');
    if (!v || !v.trim()) return;
    await api.notebookAdd2(v.trim(), NOTE_COLORS[books.length % NOTE_COLORS.length], '');
    await loadBooks();
    toast('已新建，点它的 ⋯ 可以在下面加子笔记本');
  };

  const openTrash = async () => {
    setTrash(await api.notes.trash().catch(() => []));
    setTrashOpen(true);
  };

  const cur = rows.find((r) => r.id === activeNoteId);
  const curBook = books.find((b) => b.id === (noteBook || cur?.notebookId));

  const addTag = () => {
    const raw = tagInput.trim().replace(/^#/, '');
    if (!raw) return;
    if (!/^[\p{L}\p{N}_-]{1,24}$/u.test(raw)) { toast('标签只能用文字、数字、下划线和短横线'); return; }
    if (editorTags.includes(raw)) { setTagInput(''); return; }
    const next = `${body}<p>#${raw}</p>`;
    setBody(next);
    setEditorTags(parseTags(stripHtml(next)));
    setTagInput('');
    schedule();
  };

  const removeTag = (t: string) => {
    try {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = body.replace(new RegExp(`#${esc}(?![\\p{L}\\p{N}_-])`, 'gu'), '');
      setBody(next);
      setEditorTags(parseTags(stripHtml(next)));
      schedule();
      toast('已从正文里删掉这个标签');
    } catch {
      toast('删除标签失败');
    }
  };

  const exec = (cmd: string, val?: string) => {
    // 编辑器现在是 RichText，内部元素照旧带 .nbody，聚焦后 execCommand 仍然有效
    document.querySelector<HTMLElement>('.nbody[contenteditable="true"]')?.focus();
    document.execCommand(cmd, false, val);
    document.querySelector<HTMLElement>('.nbody[contenteditable="true"]')
      ?.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const createBlank = () => {
    setCreateOpen(true);
  };

  return (
    <>
      <Topbar
        title="笔记"
        sub={`${rows.length} 篇 · ${books.length} 个笔记本`}
        right={<>
          <button className="btn sm" onClick={() => void openTrash()}><Icon name="trash" size={13} />回收站</button>
          <button className="btn sm primary" onClick={createBlank}><Icon name="plus" size={13} />新建</button>
        </>}
      />
      <div className="wrap">
        <div className="notes">
          {/* 左栏：分组 → 笔记本 */}
          <div className="nbooks">
            <button className={`nbook ${nb === '' ? 'on' : ''}`} onClick={() => setNb('')}>
              <Icon name="book" size={14} /><span>全部笔记</span>
              <span className="n">{rows.length}</span>
            </button>

            {/*
              第 220 条：以前这里是「顶层 map 一层 + 里面再 map 一层」，写死两层。
              现在改成递归渲染：一层一层往下降，想套多深就套多深。
              缩进按层数算（每层 12px），到第三层就往右拐不下了，所以封顶 6 层的样子：
              再深的话缩进会把名字挤没，那时候用户自己也看不清了。
            */
            renderBooks('', 0)}

            <button className="nbook ghost" onClick={() => void addBook()}>
              <Icon name="plus" size={13} /><span>新建笔记本</span>
            </button>
            <div className="small muted" style={{ padding: '2px 9px', fontSize: 11, lineHeight: 1.6 }}>
              可以一层层往下嵌套。点 ⋯ 能改名、调颜色、换上级、往下新建。
            </div>
          </div>

          {/* 中栏：搜索 + 排序 + 列表 */}
          <div className="nlist" ref={noteDrag.boxRef}>
            <div style={{ marginBottom: 8 }}>
              <SearchBox
                value={q}
                onChange={setQ}
                onSubmit={setQ}
                placeholder="搜标题、正文、标签"
              />
            </div>

            {/* 第 201/230 条：排序维度和方向分开；手动模式下这一栏还能拖着排 */}
            <div className="row" style={{ gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <SortBar
                options={NOTE_SORTS}
                sort={sort}
                dir={dir}
                onSort={setSort}
                onDir={setDir}
                compact
              />
              <span className="small muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{sorted.length} 篇</span>
            </div>

            {sort === 'manual' && sorted.length > 1 ? (
              <div className="small muted" style={{ fontSize: 11, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="grip" size={11} />按住任意一条拖动可以换顺序，松手自动保存
              </div>
            ) : null}

            {tagCounts.length ? (
              <div className="row" style={{ gap: 4, marginBottom: 8 }}>
                {tagCounts.map(([t, n]) => (
                  <button
                    key={t}
                    className={`chip ${tag === t ? 'on' : ''}`}
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => setTag(tag === t ? '' : t)}
                    title={`按标签 #${t} 过滤（${n} 篇）`}
                  >#{t}<span style={{ opacity: 0.65, marginLeft: 3 }}>{n}</span></button>
                ))}
                {tag ? (
                  <button className="chip" style={{ fontSize: 11, padding: '2px 7px' }} onClick={() => setTag('')}>
                    清除
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* 第 32 条：整个笔记本加锁。锁的是「这一本集合」，不是单篇 ——
                包在列表外面，解锁前连标题都不渲染（不是模糊遮挡）。 */}
            <Guarded scope="notebook" target={nb} label={books.find((b) => b.id === nb)?.name || '这个笔记本'} mode="block">
            {sorted.length ? sorted.map((r, i) => {
              const c = textOf(r);
              const locked = isProtected(r.id);
              const hitBody = !locked && !!kw && !!c.plain && c.plain.toLowerCase().includes(kw.toLowerCase());
              const excerpt = locked
                ? '已加锁 · 点开要输密码'
                : hitBody ? snippet(c.plain, kw) : (r.excerpt || '（空白笔记）');
              /* 第 230 条：手动模式下挂上拖动手柄；其它模式 dragProps 返回空对象，等于没开 */
              const dp = sort === 'manual' ? noteDrag.props(i) : {};
              return (
                <div
                  key={r.id}
                  {...dp}
                  className={`nrow ${r.id === activeNoteId ? 'on' : ''} ${sort === 'manual' ? 'draggable' : ''}`}
                  onClick={() => void openNote(r.id)}
                  onContextMenu={(e) => { e.preventDefault(); setMenuFor(menuFor === r.id ? null : r.id); }}
                >
                  <div className="nrow-h">
                    {r.pinned ? <Icon name="pin" size={11} /> : null}
                    {locked ? <Icon name="lock" size={11} /> : null}
                    <span className="nt"><Highlight text={r.title || '未命名'} kw={kw} /></span>
                    <span className="nd">{r.updatedAt.slice(5, 10)}</span>
                    <button
                      className="nbookmenu"
                      style={{ opacity: 1 }}
                      title="更多"
                      onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === r.id ? null : r.id); }}
                    >⋯</button>
                  </div>
                  <div className="ne"><Highlight text={excerpt} kw={hitBody ? kw : ''} /></div>
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    {!locked && c.tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="chip"
                        style={{ fontSize: 10.5, padding: '0 6px' }}
                        onClick={(e) => { e.stopPropagation(); setTag(t); }}
                        title="按这个标签过滤"
                      >#{t}</span>
                    ))}
                    {!locked ? <span className="small muted" style={{ fontSize: 10.5, marginLeft: 'auto' }}>{r.chars} 字</span> : null}
                  </div>

                  {menuFor === r.id ? (
                    <div
                      className="rowmenu"
                      style={{
                        position: 'static', marginTop: 6, minWidth: 0, boxShadow: 'none',
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => { setMenuFor(null); void rename(r); }}>重命名</button>
                      <button onClick={() => { setMenuFor(null); setMoveTarget(r); }}>移到笔记本</button>
                      <button onClick={() => { setMenuFor(null); void duplicate(r); }}>复制</button>
                      <button onClick={() => { setMenuFor(null); void copyLink(r); }}>复制链接</button>
                      <button onClick={() => { setMenuFor(null); void togglePin(r); }}>{r.pinned ? '取消置顶' : '置顶'}</button>
                      <button onClick={async () => { setMenuFor(null); await askProtect('note', r.id, r.title || '这篇笔记'); toast('已加密码保护'); }}>加密码</button>
                      <button onClick={() => { setMenuFor(null); void api.exportNote(r.id).then((x) => toast(x.ok ? '已导出到导出目录' : '导出失败')); }}>导出 HTML</button>
                      <button style={{ color: 'var(--bad)' }} onClick={() => { setMenuFor(null); void remove(r.id); }}>移到回收站</button>
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <div className="empty small">
                {kw
                  ? <>没有找到包含「{kw}」的笔记{tag ? `（标签 #${tag}）` : ''}。换个关键词，或者清掉标签筛选试试。</>
                  : tag
                    ? <>标签 #{tag} 下还没有笔记。</>
                    : nb
                      ? '这个笔记本还是空的，点右上角「新建」写第一篇。'
                      : '还没有笔记。点右上角「新建」开始。'}
              </div>
            )}
            </Guarded>
          </div>

          {/* 右栏：编辑器 */}
          <div className="nedit">
            {activeNoteId ? (
              /*
                用 block 而不是 overlay：overlay 只是把正文糊一层模糊，
                文字仍然实实在在留在 DOM 里 —— 加密码等于没加。
                block 是压根不渲染，解锁之后才挂编辑器。
              */
              <Guarded scope="note" target={activeNoteId} label={cur?.title || '这篇笔记'} mode="block">
                <div className="nedit-h">
                  <input
                    className="ntitle"
                    value={title}
                    placeholder="标题"
                    onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; schedule(); }}
                  />
                  <button
                    className={`btn sm ghost ${pinned ? 'primary' : ''}`}
                    title={pinned ? '取消置顶' : '置顶'}
                    onClick={() => {
                      const next = pinned ? 0 : 1;
                      setPinned(next); pinRef.current = next; schedule();
                    }}
                  ><Icon name="pin" size={13} /></button>
                  <button className="btn sm ghost" title="加密码" onClick={async () => { await askProtect('note', activeNoteId, title || '这篇笔记'); toast('已加密码保护'); }}>
                    <Icon name="lock" size={13} />
                  </button>
                  <button className="btn sm ghost" title="移到回收站" onClick={() => void remove(activeNoteId)}>
                    <Icon name="trash" size={13} />
                  </button>
                </div>

                <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <span className="small muted">
                    在「{curBook?.name || '笔记本'}」
                  </span>
                  {cur ? (
                    <button className="btn sm ghost" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => setMoveTarget(cur)}>
                      换笔记本
                    </button>
                  ) : null}
                </div>

                <div className="row" style={{ gap: 5, marginBottom: 8 }}>
                  <span className="small muted" style={{ fontSize: 11 }}>标签</span>
                  {editorTags.map((t) => (
                    <span
                      key={t}
                      className="chip"
                      style={{ fontSize: 11, padding: '1px 7px', cursor: 'pointer' }}
                      title="点一下从正文里删掉这个标签"
                      onClick={() => removeTag(t)}
                    >#{t}<span className="x">×</span></span>
                  ))}
                  <input
                    className="inp"
                    style={{ width: 118, padding: '2px 8px', fontSize: 12 }}
                    placeholder="＋标签，回车"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  />
                  <span className="small muted" style={{ fontSize: 11 }}>正文里写 #标签 也算</span>
                </div>

                {/* 第 152 条：工具栏只写 B / I / H2 是不说人话的，悬停补一句 */}
                <div className="ntools">
                  <button data-tip="加粗  Ctrl+B" onClick={() => exec('bold')}><b>B</b></button>
                  <button data-tip="斜体  Ctrl+I" onClick={() => exec('italic')}><i>I</i></button>
                  <button data-tip="下划线  Ctrl+U" onClick={() => exec('underline')}><u>U</u></button>
                  <button data-tip="删除线" onClick={() => exec('strikeThrough')}><s>S</s></button>
                  <span className="sep" />
                  <button data-tip="大标题" onClick={() => exec('formatBlock', 'h2')}>H2</button>
                  <button data-tip="小标题" onClick={() => exec('formatBlock', 'h3')}>H3</button>
                  <button data-tip="变回普通段落" onClick={() => exec('formatBlock', 'p')}>正文</button>
                  <span className="sep" />
                  <button data-tip="无序列表" onClick={() => exec('insertUnorderedList')}>• 列表</button>
                  <button data-tip="有序列表" onClick={() => exec('insertOrderedList')}>1. 列表</button>
                  <button data-tip="引用一段话" onClick={() => exec('formatBlock', 'blockquote')}>❝ 引用</button>
                  <span className="sp" />
                  <span className="small muted">{saved}</span>
                </div>
                {/*
                  第 167 条：笔记正文不再自己造一套 contenteditable + execCommand，
                  直接用日记那套编辑器内核 —— 撤销栈、回车分段、输入即格式化、
                  粘贴只收纯文本，全都跟着一起有了。
                */}
                <RichText
                  html={body}
                  live={liveMarkup}
                  className="nbody rt"
                  placeholder="开始写…"
                  onChange={(h) => {
                    setBody(h);
                    setEditorTags(parseTags(stripHtml(h)));
                    schedule();
                  }}
                />
              </Guarded>
            ) : (
              <div className="nempty">
                <Icon name="book" size={26} />
                <div>左侧选一篇，或者新建</div>
                <button className="btn primary" onClick={createBlank}>新建笔记</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 回收站 */}
      {trashOpen ? (
        <Dialog
          title="笔记回收站"
          onClose={() => setTrashOpen(false)}
          footer={<>
            <button
              className="btn danger"
              disabled={!trash.length}
              onClick={async () => {
                if (!trash.length) return;
                if (!confirm(`清空回收站？${trash.length} 篇笔记会被彻底删除，无法恢复。`)) return;
                const r = await api.notePurgeAll();
                await openTrash();
                await loadRows();
                await loadBooks();
                toast(`已彻底删除 ${r.removed ?? trash.length} 篇`);
              }}
            >清空回收站</button>
            <button className="btn" onClick={() => setTrashOpen(false)}>关闭</button>
          </>}
        >
          {trash.length ? trash.map((t) => (
            <div className="row" key={t.id} style={{ padding: '6px 0', borderBottom: '1px dashed var(--line2)' }}>
              <span className="nm" style={{ flex: 1 }}>{t.title || '未命名'}</span>
              <span className="small muted">{t.at.slice(0, 16)}</span>
              <button
                className="btn sm"
                onClick={async () => {
                  await api.notes.restore(t.id);
                  await openTrash();
                  await loadRows();
                  await loadBooks();
                  toast('已恢复');
                }}
              >恢复</button>
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (!confirm(`彻底删除「${t.title || '未命名'}」？删除后无法恢复。`)) return;
                  await api.notePurge(t.id);
                  await openTrash();
                  toast('已彻底删除');
                }}
              >彻底删除</button>
            </div>
          )) : <div className="empty small">回收站是空的。删掉的笔记会先来这里。</div>}
        </Dialog>
      ) : null}

      {createOpen ? (
        <NewNoteDialog
          books={books}
          defaultNotebookId={nb}
          onClose={() => setCreateOpen(false)}
          onCreated={async (id) => {
            await loadBooks();
            await loadRows();
            setActiveNote(id);
            openTab('notes', { noteId: id, title: '笔记' });
            toast('已新建笔记');
          }}
        />
      ) : null}

      {moveTarget ? (
        <MoveNoteDialog
          note={moveTarget}
          books={books}
          onClose={() => setMoveTarget(null)}
          onDone={async () => {
            await loadRows();
            await loadBooks();
          }}
        />
      ) : null}

      {bookEdit ? (
        <NotebookDialog
          book={bookEdit}
          books={books}
          onClose={() => setBookEdit(null)}
          onChanged={async () => {
            await loadBooks();
            await loadRows();
          }}
        />
      ) : null}
    </>
  );
}
