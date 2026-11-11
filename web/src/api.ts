/**
 * 与 C# 宿主之间的 RPC 桥。
 * 走 WebView2 的进程内消息通道，不开任何端口、不起本地服务。
 */
import type {
  Bootstrap, CalendarDay, CalendarMonth, CacheStats, Countdown, CountdownTrash, DateKey, Diagnostics, Entry, EntryListItem,
  FestivalItem, Habit, HabitHistory, HabitValue, JournalModule, MediaItem, ModuleValue, MusicItem,
  NoteDetail, NoteRow, Notebook, OnThisDay, Overview, PomodoroStats, RevisionDetail, RevisionRow,
  AccountItem, AlarmItem, AppFacts, DraftItem, EncourageItem, HabitStatData, LedgerData, LedgerInsight,
  PomoInsight, PomoDay, PomoMonth, RankData, RankExtraData, RecurItem, ReviewDay, ReviewRange, Settings, SummaryRow, TagCount,
  Template, Todo, TodoList, TodoSortMode, UserProfile, VaultQa, VaultStatus, DiagStats,
  Wish, WishStats,
  DrawingMeta, DrawingFull, Jar, JarDetail, JarPreset,
} from './types';
import type { ImportedFont } from './lib/fonts';

interface HostBridge {
  postMessage: (msg: unknown) => void;
  addEventListener: (t: 'message', cb: (e: { data: unknown }) => void) => void;
}

declare global {
  interface Window {
    chrome?: { webview?: HostBridge };
    __FLUSH__?: () => void;
    /** 宿主（托盘 / 全局热键 / 悬浮球）→ 界面 的命令入口，见 store.ts */
    __HOST_CMD__?: (cmd: string) => void;
  }
}

/**
 * 安卓宿主桥。
 *
 * 安卓那边是 WebView + @JavascriptInterface：调用是**同步**的，
 * window.RiqianHost.call(json) 直接把结果字符串返回。
 * 和 WebView2 的 postMessage 完全是两种形态，但对外都包成 Promise，
 * 上面 4 万行界面代码一行都不用改 —— 这正是「换壳不重写」能成立的关键。
 */
interface AndroidHost {
  call: (payload: string) => string;
}

declare global {
  interface Window {
    RiqianHost?: AndroidHost;
  }
}

const WEBVIEW2: HostBridge | null = window.chrome?.webview ?? null;
const ANDROID: AndroidHost | null = (typeof window !== 'undefined' && window.RiqianHost) || null;

/** 桌面形态的桥（安卓为 null） */
const HOST = WEBVIEW2;

let seq = 0;
const pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();

function rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise<T>((res, rej) => {
    /*
     * 安卓：同步调用，拿到什么就是什么。
     *
     * 注意这里包了 try —— JavascriptInterface 那头如果抛异常，
     * 传回来的是一段 JSON {ok:false,err}，但连接本身也可能断（页面正在卸载）。
     * 不包的话这个 Promise 永远不会 settle，界面就卡在「加载中」。
     */
    if (ANDROID) {
      try {
        const raw = ANDROID.call(JSON.stringify({ id: ++seq, m: method, a: args }));
        const d = JSON.parse(raw) as { ok?: boolean; data?: unknown; err?: string } | null;
        if (d && d.ok) res(d.data as T);
        else rej(new Error((d && d.err) || '出错了'));
      } catch (e) {
        rej(e instanceof Error ? e : new Error(String(e)));
      }
      return;
    }

    if (!HOST) {
      rej(new Error('需要在日签程序里运行（浏览器直接打开没有数据）'));
      return;
    }
    const id = ++seq;
    pending.set(id, { res: res as (v: unknown) => void, rej });
    HOST.postMessage({ id, m: method, a: args });
  });
}

if (HOST) {
  HOST.addEventListener('message', (e) => {
    const d = e.data as { id?: number; ok?: boolean; data?: unknown; err?: string } | null;
    if (!d || !d.id) return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.res(d.data);
    else p.rej(new Error(d.err || '出错了'));
  });
}

export const hasHost = !!(HOST || ANDROID);
/** 当前是不是在手机端跑（有些按钮在手机上该换文案或隐藏） */
export const isAndroid = !!ANDROID;

/* ---------------- 强类型封装 ---------------- */

export const api = {
  bootstrap: () => rpc<Bootstrap>('bootstrap'),
  settingSet: (k: string, v: string) => rpc<{ ok: boolean }>('setting.set', { k, v }),
  diagnostics: () => rpc<Diagnostics>('app.diagnostics'),

  modules: {
    list: () => rpc<JournalModule[]>('modules.list'),
    add: (type: string, title: string) => rpc<{ ok: boolean; id: string }>('modules.add', { type, title }),
    update: (p: { id: string; title?: string; enabled?: number; config?: unknown }) =>
      rpc<{ ok: boolean }>('modules.update', p),
    remove: (id: string) => rpc<{ ok: boolean }>('modules.delete', { id }),
    reorder: (ids: string[]) => rpc<{ ok: boolean }>('modules.reorder', { ids }),
    /** 第 237 条：某一天临时关掉了哪些模块（只影响那一篇日记） */
    hiddenOn: (date: DateKey) => rpc<{ ok: boolean; ids: string[] }>('modules.hiddenOn', { date }),
    /** 第 237 条：在某一天里隐藏（hidden=1）/ 恢复（hidden=0）一个模块 */
    hideOn: (date: DateKey, id: string, hidden = 1) =>
      rpc<{ ok: boolean; err?: string }>('modules.hideOn', { date, id, hidden }),
    /** 第 237 条：某一天临时**多显示**了哪些（全局关掉、但这一篇想要的）模块 */
    shownOn: (date: DateKey) => rpc<{ ok: boolean; ids: string[] }>('modules.shownOn', { date }),
    showOn: (date: DateKey, id: string, shown = 1) =>
      rpc<{ ok: boolean; err?: string }>('modules.showOn', { date, id, shown }),
  },

  entry: {
    get: (date: DateKey) => rpc<Entry>('entry.get', { date }),
    save: (p: { date: DateKey; values: Record<string, ModuleValue>; fav: number; bg: string; title?: string; bgTone?: string }) =>
      rpc<{ ok: boolean; plain: string; chars: number; skipped?: boolean; exists?: boolean }>('entry.save', p),
    /** 定稿 / 改回草稿 */
    publish: (date: DateKey, published: boolean) =>
      rpc<{ ok: boolean; status: string; publishedAt: string }>('entry.publish', { date, published: published ? 1 : 0 }),
    status: (date: DateKey) =>
      rpc<{ date: string; status: string; publishedAt: string; title: string }>('entry.status', { date }),
    /** 草稿箱：有内容但还没定稿的日子 */
    drafts: () => rpc<DraftItem[]>('entry.drafts'),
    list: (p: {
      q?: string; from?: string; to?: string; mood?: number; tag?: string;
      fav?: number; hasImg?: number; limit?: number; offset?: number;
    }) => rpc<EntryListItem[]>('entry.list', p),
    fav: (date: DateKey, fav: number) => rpc<{ ok: boolean }>('entry.fav', { date, fav }),
    /** 只改背景；tone 省略 = 不动调色，传空串 = 恢复原样 */
    bg: (date: DateKey, bg: string, tone?: string) =>
      rpc<{ ok: boolean }>('entry.bg', tone === undefined ? { date, bg } : { date, bg, tone }),
    /** 硬删除这一天（连同各模块内容、标签、关联、历史版本），没有回收站 */
    remove: (date: DateKey) => rpc<{ ok: boolean; err?: string }>('entry.delete', { date }),
  },

  rev: {
    list: (date: DateKey) => rpc<RevisionRow[]>('rev.list', { date }),
    get: (id: number) => rpc<RevisionDetail>('rev.get', { id }),
    restore: (id: number) => rpc<{ ok: boolean }>('rev.restore', { id }),
  },

  tags: {
    list: () => rpc<TagCount[]>('tags.list'),
    set: (date: DateKey, tags: string[]) => rpc<{ ok: boolean }>('tag.set', { date, tags }),
  },

  link: {
    add: (from: DateKey, to: DateKey, kind: string, quote = '') =>
      rpc<{ ok: boolean }>('link.add', { from, to, kind, quote }),
    addMany: (from: DateKey, dates: DateKey[], kind = 'related') =>
      rpc<{ ok: boolean }>('link.addMany', { from, dates, kind }),
    remove: (id: number) => rpc<{ ok: boolean }>('link.delete', { id }),
    backlinks: (date: DateKey) => rpc<EntryListItem[]>('backlinks', { date }),
  },

  todos: {
    /**
     * 第 163 条：排序方式下推给 SQL。
     * manual = 用户拖动出来的顺序；quad = 四象限（优先级 + 紧急度）；due = 截止日期。
     */
    list: (sort: TodoSortMode = 'manual') => rpc<Todo[]>('todos.list', { sort }),
    /** 一次拖动只发一条 RPC，后端用一条 CASE 表达式批量写 sort（0/10/20…） */
    reorder: (ids: string[]) => rpc<{ ok: boolean; n: number }>('todos.reorder', { ids }),
    add: (p: { title: string; due?: string; dueTime?: string; priority?: number; note?: string; listId?: string; repeat?: string }) =>
      rpc<{ ok: boolean; id: string }>('todo.add', p),
    update: (p: {
      id: string; title?: string | null; done?: number; due?: string | null;
      dueTime?: string | null; priority?: number; note?: string | null;
      listId?: string | null; trashed?: number;
      /** 手动排序用：0/10/20… 递增（第 84 条） */
      sort?: number;
    }) => rpc<{ ok: boolean }>('todo.update', p),
    trash: (id: string, trashed = 1) => rpc<{ ok: boolean }>('todo.trash', { id, trashed }),
    setRepeat: (id: string, repeat: string) => rpc<{ ok: boolean }>('todo.repeat', { id, repeat }),
    moveList: (id: string, listId: string) => rpc<{ ok: boolean }>('todo.movelist', { id, listId }),
    remove: (id: string) => rpc<{ ok: boolean }>('todo.delete', { id }),
    /** 回收站：真删除前的暂存，与「垃圾桶」（trashed）不是一回事 */
    recycle: () => rpc<Todo[]>('todos.recycle'),
    restore: (id: string) => rpc<{ ok: boolean }>('todo.restore', { id }),
    purge: (id: string) => rpc<{ ok: boolean }>('todo.purge', { id }),
    purgeAll: () => rpc<{ ok: boolean; removed: number }>('todo.purgeAll'),
    clearDone: () => rpc<{ ok: boolean }>('todo.clearDone'),

    lists: () => rpc<TodoList[]>('todo.lists'),
    addList: (name: string, color?: string) => rpc<{ ok: boolean; id?: string; err?: string }>('todo.list.add', { name, color }),
    updateList: (p: { id: string; name?: string; color?: string; sort?: number }) =>
      rpc<{ ok: boolean }>('todo.list.update', p),
    removeList: (id: string) => rpc<{ ok: boolean }>('todo.list.delete', { id }),
  },

  /** 第 218 条：清单描述（问答式短说明，不跟名字挤在一起） */
  todoListNote: (id: string, note: string) =>
    rpc<{ ok: boolean }>('todo.list.note', { id, note }),
  /** 第 220 条：清单也能挂到另一个清单下面，无限层 */
  todoListParent: (id: string, parentId: string) =>
    rpc<{ ok: boolean; err?: string }>('todo.list.parent', { id, parentId }),

  cd: {
    list: () => rpc<Countdown[]>('cd.list'),
    add: (p: { title: string; date: string; repeat: string; color: string; note: string }) =>
      rpc<{ ok: boolean; id: string }>('cd.add', p),
    update: (p: Record<string, unknown>) => rpc<{ ok: boolean }>('cd.update', p),
    setRepeat: (id: string, repeat: string) => rpc<{ ok: boolean }>('cd.repeat', { id, repeat }),
    remove: (id: string) => rpc<{ ok: boolean }>('cd.delete', { id }),
    /* 第 145 条：回收站 */
    trash: () => rpc<CountdownTrash[]>('cd.trash'),
    restore: (id: string) => rpc<{ ok: boolean }>('cd.restore', { id }),
    purge: (id: string) => rpc<{ ok: boolean }>('cd.purge', { id }),
  },

  habits: {
    list: () => rpc<Habit[]>('habits.list'),
    add: (p: { name: string; color?: string; type?: string; unit?: string; options?: string[]; goal?: number; icon?: string }) =>
      rpc<{ ok: boolean; id: string }>('habit.add', p),
    update: (p: Record<string, unknown>) => rpc<{ ok: boolean }>('habit.update', p),
    remove: (id: string) => rpc<{ ok: boolean }>('habit.delete', { id }),
    log: (date: DateKey, habitId: string, val: HabitValue, note?: string | null) =>
      rpc<{ ok: boolean }>('habit.log', { date, habitId, val, note }),
    logs: (date: DateKey) => rpc<Record<string, HabitValue>>('habit.logs', { date }),
    notes: (date: DateKey) => rpc<Record<string, string>>('habit.notes', { date }),
    history: (habitId: string, days = 30) => rpc<HabitHistory>('habit.history', { habitId, days }),
    checkToggle: (date: DateKey, habitId: string) =>
      rpc<{ ok: boolean; on: boolean }>('check.toggle', { date, habitId }),
    checksFor: (date: DateKey) => rpc<string[]>('checks.for', { date }),
    reorder: (ids: string[]) => rpc<{ ok: boolean }>('habit.reorder', { ids }),
  },

  pomodoro: {
    add: (minutes: number, kind: string, task: string) =>
      rpc<{ ok: boolean }>('pomodoro.add', { minutes, kind, task }),
    /** 第 8 / 130 条：可传 from/to 走自定义区间；只传 days 时行为不变 */
    stats: (days = 7, from = '', to = '') => rpc<PomodoroStats>('pomodoro.stats', { days, from, to }),
    /** 删掉误记的一颗。只按 id 删单条，没有批量清空 */
    remove: (id: string) => rpc<{ ok: boolean; n: number }>('pomodoro.delete', { id }),
    /** 第 228 条：手动补录。忘了开计时器、昨天在图书馆学的，都能补进去 */
    manual: (p: { date: string; startHm: string; minutes: number; task?: string; note?: string }) =>
      rpc<{ ok: boolean; id: string; err?: string }>('pomodoro.manual', p),
    /** 第 228 条：计时器。up=1 正数，up=0 倒数；统一记实际经过的分钟 */
    timer: (p: { date: string; minutes: number; task?: string; note?: string; up?: number }) =>
      rpc<{ ok: boolean; id: string; err?: string }>('pomodoro.timer', p),
    /** 改一颗已记的：只改时长 / 任务 / 备注，不改日期 */
    edit: (p: { id: string; minutes?: number; task?: string; note?: string }) =>
      rpc<{ ok: boolean }>('pomodoro.edit', p),
  },

  /** 第 227 条：草稿箱回收站 */
  drafts: {
    trash: (date: string) => rpc<{ ok: boolean; err?: string }>('draft.trash', { date }),
    restore: (date: string) => rpc<{ ok: boolean; err?: string }>('draft.restore', { date }),
    trashList: () => rpc<{
      date: string; title: string; excerpt: string; chars: number;
      updatedAt: string; deletedAt: string;
    }[]>('draft.trashList'),
    purge: (date: string) => rpc<{ ok: boolean; n: number; err?: string }>('draft.purge', { date }),
  },

  templates: {
    list: () => rpc<Template[]>('templates.list'),
    save: (name: string, body: string) => rpc<{ ok: boolean }>('templates.save', { name, body }),
    remove: (id: string) => rpc<{ ok: boolean }>('templates.delete', { id }),
    apply: (date: DateKey, id: string) =>
      rpc<{ ok: boolean; err?: string }>('template.apply', { date, id }),
  },

  media: {
    list: (q = '', limit = 2000) => rpc<MediaItem[]>('media.list', { q, limit }),
    resolve: (refs: string[]) => rpc<(MediaItem | null)[]>('media.resolve', { refs }),
    importFiles: () =>
      rpc<{ ok: boolean; items: { ok: boolean; dup?: boolean; id?: string; name?: string }[] }>('media.import'),
    /** 第 233 条：整个文件夹连子目录一起导（按相对路径当分组） */
    importFolder: () =>
      rpc<{ ok: boolean; count: number; skipped?: number; err?: string }>('media.importFolderDlg'),
    saveBase64: (name: string, data: string) =>
      rpc<{ ok: boolean; id?: string; name?: string; dup?: boolean; err?: string }>('media.saveBase64', { name, data }),
    scan: () => rpc<{ ok: boolean; count: number }>('media.scan'),
    rename: (id: string, name: string) => rpc<{ ok: boolean }>('media.rename', { id, name }),
    remove: (id: string, hard = 1) => rpc<{ ok: boolean }>('media.delete', { id, hard }),
    rebuildThumbs: () => rpc<{ ok: boolean; count: number }>('media.rebuildThumbs'),
    openFolder: () => rpc<{ ok: boolean }>('media.openFolder'),
    openImport: () => rpc<{ ok: boolean }>('media.openImport'),
  },

  /**
   * 第 107 / 170 条：字体库。
   *
   * 导入走宿主文件框（能拿到真实路径、能多选），读字节走 font.bytes ——
   * 不用 URL 是因为字体文件跟页面不同源，@font-face 会被 CORS 拦，
   * FontFace 吃 ArrayBuffer 就没这问题。详见 lib/fonts.ts。
   */
  font: {
    list: () =>
      rpc<{ ok: boolean; dir: string; items: ImportedFont[]; err?: string }>('font.list'),
    importFiles: () =>
      rpc<{ ok: boolean; items: { ok: boolean; name?: string; label?: string; err?: string }[] }>('font.import'),
    remove: (file: string) => rpc<{ ok: boolean; err?: string }>('font.delete', { file }),
    bytes: (file: string) =>
      rpc<{ ok: boolean; file?: string; label?: string; format?: string; data?: string; err?: string }>(
        'font.bytes', { file },
      ),
  },

  stats: {
    overview: (p?: { from?: string; to?: string }) => rpc<Overview>('stats.overview', p || {}),
    /** 第 157 条：重置统计。只清番茄/打卡记录，日记正文绝不会被删 */
    reset: (what: 'pomodoro' | 'habits' | 'all') =>
      rpc<{ ok: boolean; pomodoro?: number; habits?: number; err?: string }>('stats.reset', { what }),
    calendar: (ym: string) => rpc<CalendarDay[]>('stats.calendar', { ym }),
    /** 第 182 条：按月汇总，给年/月快跳面板打点用 */
    calMonths: () => rpc<CalendarMonth[]>('stats.calMonths'),
    /** #249：传哪一天就算哪一天的历史上今天；不传 = 今天 */
    onThisDay: (date?: string) => rpc<OnThisDay[]>('onthisday', date ? { date } : {}),
  },

  exportAs: (kind: 'json' | 'md' | 'csv' | 'html') =>
    rpc<{ ok: boolean; path: string }>(`export.${kind}`),
  exportNote: (id: string) => rpc<{ ok: boolean; path: string }>('export.note', { id }),

  /* ---------- v7 ---------- */

  notify: {
    push: (p: {
      title: string; body: string; kind?: string; duration?: number;
      /** 第 143 条：单条提醒覆盖全局开关。不传 = 跟随设置，1 = 强制开，0 = 强制关 */
      desktop?: number; tray?: number;
    }) => rpc<{ ok: boolean; desktop: boolean; tray: boolean }>('notify.push', p),
    test: () => rpc<{ ok: boolean }>('notify.test'),
  },

  window: {
    hide: () => rpc<{ ok: boolean }>('app.hide'),
    quit: () => rpc<{ ok: boolean }>('app.quit'),
    minimize: () => rpc<{ ok: boolean }>('app.minimize'),
  },

  notebooks: {
    list: () => rpc<Notebook[]>('notebooks.list'),
    add: (name: string, color: string) => rpc<{ ok: boolean; id: string }>('notebook.add', { name, color }),
    update: (p: { id: string; name?: string; color?: string }) => rpc<{ ok: boolean }>('notebook.update', p),
    remove: (id: string) => rpc<{ ok: boolean }>('notebook.delete', { id }),
    /** 第 220 条：无限层级。改上级时后端会防环，拖进自己的子孙里会被拒 */
    setParent: (id: string, parentId: string) =>
      rpc<{ ok: boolean; err?: string }>('notebook.parent2', { id, parentId }),
    /** 一次写完整个顺序（一条 CASE 语句，不是循环） */
    reorder: (ids: string[]) => rpc<{ ok: boolean; n: number }>('notebook.reorder', { ids }),
    /** 平铺的树，每项带 depth 和 parentId，前端自己递归到任意层 */
    tree: () => rpc<{ id: string; name: string; color: string; parentId: string; sort: number; depth: number }[]>('notebook.tree'),
  },

  /* 第 178 条：画板。笔画是 JSON 字符串，进出都不在前端做结构化 ——
     一张画板几百个点，结构化编解码反而更慢，也更容易把顺序搞乱。 */
  draw: {
    list: () => rpc<{ ok: boolean; items: DrawingMeta[] }>('draw.list'),
    get: (id: string) => rpc<DrawingFull>('draw.get', { id }),
    save: (p: {
      id: string; title: string; w: number; h: number;
      strokes: string; thumb: string; note: string;
    }) => rpc<{ ok: boolean; id?: string; err?: string }>('draw.save', p),
    remove: (id: string, hard = 0) => rpc<{ ok: boolean }>('draw.delete', { id, hard }),
    trash: () => rpc<{ ok: boolean; items: { id: string; title: string; thumb: string; deletedAt: string }[] }>('draw.trash'),
    restore: (id: string) => rpc<{ ok: boolean }>('draw.restore', { id }),
    rename: (id: string, title: string) => rpc<{ ok: boolean }>('draw.rename', { id, title }),
    toMedia: (id: string, data: string, name: string) =>
      rpc<{ ok: boolean; id?: string; dup?: boolean; err?: string }>('draw.toMedia', { id, data, name }),
  },

  notes: {
    list: (p: { notebookId?: string; q?: string; limit?: number } = {}) => rpc<NoteRow[]>('notes.list', p),
    get: (id: string) => rpc<NoteDetail>('note.get', { id }),
    save: (p: {
      id: string; notebookId: string; title: string; body: string; pinned: number;
      /** 第 128 条：不传 = 不动它（自动保存走这条，免得把用户选的色点抹掉） */
      color?: string; icon?: string;
    }) =>
      rpc<{ ok: boolean; id: string; plain: string; chars: number }>('note.save', p),
    remove: (id: string) => rpc<{ ok: boolean }>('note.delete', { id }),
    restore: (id: string) => rpc<{ ok: boolean }>('note.restore', { id }),
    trash: () => rpc<{ id: string; title: string; at: string }[]>('notes.trash'),
    /** 第 230 条：手动排序。传当前视图从上到下的 id 列表 */
    reorder: (ids: string[]) => rpc<{ ok: boolean; n: number }>('note.reorder', { ids }),
  },

  user: {
    get: () => rpc<UserProfile>('user.get'),
    save: (p: { nickname: string; signature: string; avatar: string; birthday: string; lunarBirthday: string }) =>
      rpc<{ ok: boolean }>('user.save', p),
  },

  vault: {
    status: () => rpc<VaultStatus>('vault.status'),
    setMain: (password: string) => rpc<{ ok: boolean }>('vault.setMain', { password }),
    clearMain: (password: string) => rpc<{ ok: boolean; err?: string }>('vault.clearMain', { password }),
    add: (p: { scope: string; target: string; label: string; password: string }) =>
      rpc<{ ok: boolean; id?: string; err?: string }>('vault.add', p),
    remove: (id: string) => rpc<{ ok: boolean }>('vault.remove', { id }),
    check: (scope: string, target = '') => rpc<{ locked: boolean; label?: string; own?: boolean }>('vault.check', { scope, target }),
    unlock: (scope: string, target: string, password: string, minutes = 0) =>
      rpc<{ ok: boolean; token?: string; err?: string; minutes?: number }>('vault.unlock', { scope, target, password, minutes }),
    lock: () => rpc<{ ok: boolean }>('vault.lock'),

    /* v8：提示 / 密保 / 找回 */
    setHint: (hint: string) => rpc<{ ok: boolean }>('vault.hint', { hint }),
    qaList: () => rpc<VaultQa[]>('vault.qa.list'),
    qaSave: (list: { question: string; answer: string }[]) =>
      rpc<{ ok: boolean; count?: number; err?: string }>('vault.qa.save', { list }),
    qaVerify: (answers: string[]) =>
      rpc<{ ok: boolean; matched: number; total: number; err?: string }>('vault.qa.verify', { answers }),
    qaReset: (answers: string[], password: string) =>
      rpc<{ ok: boolean; cleared?: boolean; err?: string }>('vault.qa.reset', { answers, password }),
  },

  /** 番茄钟洞察统计 */
  /** 第 131 条：传了 from 就按绝对日期取（统计页的今年/去年/自定义），否则按天数 */
  pomoInsight: (days: number, from?: string, to?: string) =>
    rpc<PomoInsight>('pomo.insight', from ? { days, from, to } : { days }),
  /** 某一天的番茄明细（第 186 条） */
  pomoDay: (date: string) => rpc<PomoDay>('pomo.day', { date }),
  /** 哪几个月有番茄记录 */
  pomoMonths: () => rpc<PomoMonth[]>('pomo.months'),

  /** 反馈落盘 + 本机概况 */
  feedback: (text: string, contact: string) =>
    rpc<{ ok: boolean; path?: string; err?: string }>('feedback.save', { text, contact }),
  facts: () => rpc<AppFacts>('app.facts'),

  /* v10：打卡回收站 / 笔记分组 / 媒体分类与调色 / 记账 / 提醒 / 打气话 / 排行 */
  habitDelete: (id: string) => rpc<{ ok: boolean }>('habit.delete', { id }),
  habitRestore: (id: string) => rpc<{ ok: boolean }>('habit.restore', { id }),
  habitPurge: (id: string) => rpc<{ ok: boolean }>('habit.purge', { id }),
  habitTrash: () => rpc<{ id: string; name: string; color: string; deletedAt: string }[]>('habit.trash'),
  habitStats: (days = 30) => rpc<HabitStatData>('habit.stats', { days }),

  notePurge: (id: string) => rpc<{ ok: boolean }>('note.purge', { id }),
  notePurgeAll: () => rpc<{ ok: boolean; removed: number }>('note.purgeAll'),
  notebookAdd2: (name: string, color: string, parentId = '') =>
    rpc<{ ok: boolean; id: string }>('notebook.add2', { name, color, parentId }),
  notebookParent: (id: string, parentId: string) => rpc<{ ok: boolean }>('notebook.parent', { id, parentId }),

  mediaList2: (kind = 'all', q = '', sort = 'new', dir = 'desc', folder = '', tag = '') =>
    rpc<MediaItem[]>('media.list2', { kind, q, sort, dir, folder, tag }),
  /* 第 151 / 154 条：别名、批量操作、文件夹 */
  mediaAlias: (id: string, alias: string) => rpc<{ ok: boolean }>('media.alias', { id, alias }),
  mediaBulk: (ids: string[], action: 'delete' | 'folder' | 'tag' | 'untag', value = '') =>
    rpc<{ ok: boolean; n: number }>('media.bulk', { ids: ids.join(','), action, value }),
  /**
   * 第 220 条：文件夹改成层级路径（`旅行/2024/京都`）。
   *   name  = 最后一段，用来显示
   *   own   = 只属于这一层的文件数
   *   n     = 含子层的总数
   *   depth = 层级深度，前端据此缩进
   */
  mediaFolders: () => rpc<{ folder: string; name?: string; own?: number; n: number; depth?: number }[]>('media.folders'),
  /* 第 151 条：标签（一个文件可属多个分类）与文件夹改名 */
  mediaTags: () => rpc<{ tag: string; n: number }[]>('media.tags'),
  mediaSetTags: (id: string, tags: string) => rpc<{ ok: boolean; tags: string }>('media.setTags', { id, tags }),
  mediaRenameFolder: (from: string, to: string) => rpc<{ ok: boolean; n: number }>('media.renameFolder', { from, to }),
  /**
   * 第 165 条：快捷浮窗。
   * popup 让宿主弹那个独立小窗（不唤主窗口）；capture 是不弹窗直接落库的那条路，
   * 和浮窗用的是同一个后端方法，行为完全一致。
   */
  quickPopup: (kind: 'todo' | 'note' | 'diary') => rpc<{ ok: boolean }>('quick.popup', { kind }),
  quickCapture: (kind: 'todo' | 'note' | 'diary', text: string) =>
    rpc<{ ok: boolean; err?: string; n: number }>('quick.capture', { kind, text }),
  /**
   * 第 217 条：存储账本。用户怀疑「多媒体库到底有没有真的省空间」，
   * 后端把行数、磁盘占用、类型分布都算出来给界面看。
   */
  mediaStorage: () => rpc<{
    ok: boolean; rows: number; alive: number; deleted: number;
    bytes: number; diskBytes: number; diskFiles: number; thumbFiles: number;
    byKind: Record<string, number>; byExt: Record<string, number>; mediaDir: string;
  }>('media.storage'),
  mediaTone: (id: string, tone: string) => rpc<{ ok: boolean }>('media.tone', { id, tone }),

  ledgerAdd: (p: { date: string; kind: string; amount: number; cat: string; note: string; accountId?: string }) =>
    rpc<{ ok: boolean; id: string }>('ledger.add', p),
  ledgerDelete: (id: string) => rpc<{ ok: boolean }>('ledger.delete', { id }),
  /* 第 159 条：改一笔账 */
  ledgerUpdate: (p: { id: string; date?: string; kind?: string; amount?: number; cat?: string; note?: string; accountId?: string }) =>
    rpc<{ ok: boolean }>('ledger.update', p),
  ledgerList: (from: string, to: string, f?: { kind?: string; cat?: string; kw?: string }) =>
    rpc<LedgerData>('ledger.list', { from, to, ...(f || {}) }),
  /* 第 159 条：分类改名 / 删除 */
  ledgerCatRename: (from: string, to: string) => rpc<{ ok: boolean }>('ledger.catRename', { from, to }),
  ledgerCatDrop: (cat: string, to = '其他') => rpc<{ ok: boolean }>('ledger.catDrop', { cat, to }),

  alarmList: () => rpc<AlarmItem[]>('alarm.list'),
  alarmSave: (p: {
    id?: string; kind: string; title: string; atTime: string; repeat: string; enabled: number;
    /** repeat=every 时是分钟数；repeat=interval 时是天数 */
    intervalMin?: number;
    /** 第 143 条：方式 / 声音 / 提前量。不传 = 后端保留原值 */
    mode?: string;
    sound?: string;
    advance?: number;
  }) => rpc<{ ok: boolean; id: string }>('alarm.save', p),
  alarmDelete: (id: string) => rpc<{ ok: boolean }>('alarm.delete', { id }),
  /** 第 143 条：稍后提醒（贪睡）。5 / 10 / 30 分钟 */
  alarmSnooze: (id: string, minutes: number) =>
    rpc<{ ok: boolean; until: string; minutes: number }>('alarm.snooze', { id, minutes }),

  encourageList: () => rpc<EncourageItem[]>('encourage.list'),
  encourageSave: (p: { id?: string; kind: string; text: string; mediaId: string; enabled: number }) =>
    rpc<{ ok: boolean; id: string }>('encourage.save', p),
  encourageDelete: (id: string) => rpc<{ ok: boolean }>('encourage.delete', { id }),

  /* ---------------- 诊断（本轮新增） ---------------- */

  /** 前端错误上报。绝不 reject —— 通道坏了不能反过来把界面搞崩 */
  diagFrontend: (p: { level: string; src: string; msg: string; stack?: string }) =>
    rpc<{ ok: boolean }>('diag.frontend', p).catch(() => ({ ok: false })),
  /** 记一笔用户动作，崩溃时还原现场 */
  diagAction: (what: string) => rpc<{ ok: boolean }>('diag.action', { what }).catch(() => ({ ok: false })),
  /** 读日志（设置页「查看日志」和 AI 都用） */
  diagLogs: (lines = 300, day = '') =>
    rpc<{ ok: boolean; text: string; stats: DiagStats }>('diag.logs', { lines, day }),
  diagStats: () => rpc<{ ok: boolean; stats: DiagStats; env: string }>('diag.stats'),
  diagConfig: (p: { level?: string; keepDays?: number }) =>
    rpc<{ ok: boolean; level: string; keepDays: number }>('diag.config', p),
  /** 方法清单，AI 自助发现接口用 */
  diagMethods: () => rpc<{
    ok: boolean; catalogued: number; returned: number; groups: string[];
    writes: string[]; methods: { name: string; group: string; desc: string; args: string; write: boolean }[];
  }>('diag.methods', {}),
  diagMethod: (name: string) => rpc<Record<string, unknown>>('diag.method', { name }),
  /** 打开日志目录（不能复用 openRoot —— 那是数据目录，日志在 %LOCALAPPDATA%） */
  diagOpenDir: () => rpc<{ ok: boolean; dir: string }>('diag.openDir'),
  /** AI 调试网关：on 传 '1'/'0' 开关，不传只查状态 */
  diagApi: (p: { on?: '0' | '1'; port?: number } = {}) =>
    rpc<{ ok: boolean; err?: string; running: boolean; port: number; token: string; info: string; url: string }>(
      'diag.api', p),
  diagApiInfo: () => rpc<{ ok: boolean; path: string; text: string }>('diag.apiInfo'),

  statsRank: (top = 8) => rpc<RankData>('stats.rank', { top }),
  /** 打卡 / 番茄的连续与 Top（第 126 条） */
  statsRankExtra: (top = 5) => rpc<RankExtraData>('stats.rankExtra', { top }),

  /* v10.1：账户与周期账单（第 97 条） */
  ledgerAccounts: () => rpc<AccountItem[]>('ledger.accounts'),
  /** 第 205 条：记账本图表数据，一条拿全九组 */
  ledgerInsight: (ym: string) => rpc<LedgerInsight>('ledger.insight', { ym }),
  accountSave: (p: {
    id?: string; name: string; kind: string; init: number;
    /** 第 221 条：币种 / 看图标记 / 备注，都不传就沿用原值 */
    currency?: string; icon?: string; note?: string;
  }) => rpc<{ ok: boolean; id: string }>('account.save', p),
  accountDelete: (id: string) => rpc<{ ok: boolean }>('account.delete', { id }),
  /** 第 221 条：账户能拖着换顺序，一次写完整个顺序 */
  accountReorder: (ids: string[]) => rpc<{ ok: boolean; n: number }>('account.reorder', { ids }),
  /** 第 221 条：停用的账户不出现在记账下拉里，但历史记录和余额还在 */
  accountToggle: (id: string, enabled: number) =>
    rpc<{ ok: boolean; enabled: number }>('account.toggle', { id, enabled }),
  ledgerRecurList: () => rpc<RecurItem[]>('ledger.recur.list'),
  ledgerRecurSave: (p: {
    id?: string; kind: string; amount: number; cat: string; note: string;
    accountId?: string; day: number; enabled: number;
  }) => rpc<{ ok: boolean; id: string }>('ledger.recur.save', p),
  ledgerRecurDelete: (id: string) => rpc<{ ok: boolean }>('ledger.recur.delete', { id }),
  /** 生成某月周期账单（幂等：同一规则同一个月只生成一次） */
  ledgerRecurRun: (month: string) => rpc<{ ok: boolean; made: number; month: string }>('ledger.recur.run', { month }),

  /* ---------------- 储蓄罐（第 97 条） ---------------- */
  jarList: () => rpc<{ jars: Jar[]; total: number }>('jar.list'),
  jarDetail: (id: string) => rpc<JarDetail>('jar.detail', { id }),
  jarAdd: (p: {
    name: string; target: number; mode: string; period: string;
    baseAmount: number; stepAmount: number; color?: string; icon?: string; note?: string;
  }) => rpc<{ ok: boolean; id: string; err?: string }>('jar.add', p),
  jarUpdate: (p: {
    id: string; name: string; target: number; mode: string; period: string;
    baseAmount: number; stepAmount: number; color?: string; icon?: string; note?: string;
  }) => rpc<{ ok: boolean; err?: string }>('jar.update', p),
  /** dir: in 存入 / out 取出。取出超过余额会被后端拒绝。accountId 传了才会动账户余额 */
  jarDeposit: (p: { id: string; dir: 'in' | 'out'; amount: number; date?: string; note?: string; accountId?: string }) =>
    rpc<{ ok: boolean; id?: string; err?: string }>('jar.deposit', p),
  jarRemoveItem: (id: string) => rpc<{ ok: boolean }>('jar.removeItem', { id }),
  jarDelete: (id: string) => rpc<{ ok: boolean }>('jar.delete', { id }),
  jarArchive: (id: string, archived: number) => rpc<{ ok: boolean }>('jar.archive', { id, archived }),
  jarReorder: (ids: string[]) => rpc<{ ok: boolean }>('jar.reorder', { ids }),
  jarPresets: () => rpc<JarPreset[]>('jar.presets'),
  revDedup: (date: string) =>
    rpc<{ id: number; createdAt: string; chars: number; sameAsPrev: boolean }[]>('rev.dedup', { date }),

  /* v8：总结留存与回顾聚合 */
  summary: {
    list: () => rpc<SummaryRow[]>('summary.list'),
    get: (id: string) => rpc<SummaryRow>('summary.get', { id }),
    save: (p: { id?: string; kind: string; from: string; to: string; title: string; body: string; plain: string }) =>
      rpc<{ ok: boolean; id: string }>('summary.save', p),
    remove: (id: string) => rpc<{ ok: boolean }>('summary.delete', { id }),
    pin: (id: string, pinned: number) => rpc<{ ok: boolean }>('summary.pin', { id, pinned }),
  },

  review: {
    day: (date: string) => rpc<ReviewDay>('review.day', { date }),
    range: (from: string, to: string) => rpc<ReviewRange>('review.range', { from, to }),
  },

  /* v8：分享落盘 */
  share: {
    saveImage: (data: string, name: string) =>
      rpc<{ ok: boolean; path?: string; kb?: number; err?: string }>('share.image', { data, name }),
    copyImage: (data: string) => rpc<{ ok: boolean; err?: string }>('share.copyImage', { data }),
    copyText: (text: string) => rpc<{ ok: boolean }>('share.copyText', { text }),
    saveHtml: (html: string, name: string) => rpc<{ ok: boolean; path?: string }>('share.html', { html, name }),
  },

  /* v8：宿主外壳（热键 / 托盘 / 悬浮球 / 老板键） */
  shell: {
    applyHotkeys: () =>
      rpc<{ ok: boolean; disabled?: boolean; failed: { key: string; combo: string; name: string; reason: string }[]; registered: string[] }>('hotkey.apply'),
    apply: () => rpc<{ ok: boolean }>('shell.apply'),
    state: () => rpc<{ enabled: boolean; registered: number; boss: boolean; orb: boolean }>('shell.hotkeyState'),
    /** 第 191 条：开机自启，写 HKCU 的 Run 键 */
    setAutostart: (on: number) => rpc<{ ok: boolean; on?: number; err?: string }>('shell.autostart', { on }),
    autostartGet: () => rpc<{ ok: boolean; on: number }>('shell.autostartGet'),
    /** 第 75 条：把「现在锁着没」告诉宿主，托盘图标据此叠小锁角标 */
    lockState: (locked: number) => rpc<{ ok: boolean; locked?: boolean; icon?: string }>('shell.lockState', { locked }),
    /** 第 90 条：交给系统默认程序打开 http/https/mailto（WebView2 里点 mailto 不动） */
    openUrl: (url: string) => rpc<{ ok: boolean; err?: string }>('shell.openUrl', { url }),
    boss: () => rpc<{ ok: boolean; on: boolean }>('boss.toggle'),
    orb: (on: boolean) => rpc<{ ok: boolean }>('orb.toggle', { on: on ? 1 : 0 }),
  },

  cache: {
    stats: () => rpc<CacheStats>('cache.stats'),
    prune: (days = 0, maxMB = 0) => rpc<{ ok: boolean; removed: number; freedMB: number }>('cache.prune', { days, maxMB }),
    clear: (what: 'cache' | 'thumbs' | 'backup' | 'all') => rpc<{ ok: boolean; removed: number; freedMB: number }>('cache.clear', { what }),
    open: () => rpc<{ ok: boolean }>('cache.open'),
  },

  /**
   * 第 42 条：桌面常驻便签。
   * 和「快捷浮窗」不同 —— 它是钉在桌面上的一个小窗，不随主窗口隐藏，失焦也不关。
   */
  sticky: {
    open: (id: string) => rpc<{ ok: boolean; already?: boolean; n?: number; err?: string }>('sticky.open', { id }),
    close: (id: string) => rpc<{ ok: boolean; n: number }>('sticky.close', { id }),
    list: () => rpc<{ ok: boolean; items: { id: string; visible: boolean }[]; n: number }>('sticky.list'),
  },

  settingsIO: {
    exportFile: () => rpc<{ ok: boolean; path: string; count: number }>('settings.export'),
    importFile: (json: string) => rpc<{ ok: boolean; count?: number; err?: string }>('settings.import', { json }),
  },

  festival: {
    upcoming: (days = 30) => rpc<FestivalItem[]>('festival.upcoming', { days }),
    add: (p: { name: string; date: string; lunarMonth: number; lunarDay: number }) =>
      rpc<{ ok: boolean; id: string }>('festival.add', p),
    remove: (id: string) => rpc<{ ok: boolean }>('festival.delete', { id }),
    day: (date: string) => rpc<string[]>('festival.day', { date }),
    month: (ym: string) => rpc<{ date: string; name: string; lunar: boolean }[]>('festival.month', { ym }),
    /** 第 21 条：设置页「试算一次」，看接下来的节日提醒会长什么样 */
    remindPreview: () =>
      rpc<{ on: boolean; lead: number; at: string; count: number; names: string[]; days: number[] }>('festival.remindPreview'),
  },

  music: {
    list: () => rpc<MusicItem[]>('music.list'),
    import: () => rpc<{ ok: boolean; items: { ok: boolean; id?: string; name?: string; kind?: string; err?: string }[] }>('music.import'),
    addUrl: (url: string, name: string) => rpc<{ ok: boolean; id?: string; err?: string }>('music.addUrl', { url, name }),
    /** 第 26/27 条：把网络链接真的下载到本地；受「缓存网络音频」和「允许缓存的后缀」两个开关约束 */
    cacheUrl: (id: string) =>
      rpc<{ ok: boolean; bytes?: number; err?: string; off?: boolean; blocked?: boolean; already?: boolean }>('media.cacheUrl', { id }),
    /** 一次性把所有还没缓存的网络音频都下载下来 */
    cacheAll: () =>
      rpc<{ ok: boolean; total: number; done: number; failed: number; err?: string }>('media.cacheAll'),
  },

  app: {
    openRoot: () => rpc<{ ok: boolean }>('app.openRoot'),
    openMedia: () => rpc<{ ok: boolean }>('app.openMedia'),
    openExport: () => rpc<{ ok: boolean }>('app.openExport'),
    pickFolder: () => rpc<{ ok: boolean; path?: string }>('app.pickFolder'),
    changeRoot: () => rpc<{ ok: boolean; root?: string; err?: string }>('app.changeRoot'),
    /** 第 195 / 164 条：把皮肤色同步给窗口标题栏和托盘菜单 */
    chrome: (p: { panel: string; ink: string; line: string; accent: string; dark: number }) =>
      rpc<{ ok: boolean }>('app.chrome', p),
  },

  /* 第 188 条：大事时间轴 */
  milestone: {
    list: () => rpc<{ id: string; date: string; title: string; note: string; kind: string }[]>('milestone.list'),
    save: (p: { id?: string; date: string; title: string; note?: string; kind?: string }) =>
      rpc<{ ok: boolean; id?: string; err?: string }>('milestone.save', p),
    delete: (id: string) => rpc<{ ok: boolean }>('milestone.delete', { id }),
  },

  /* #250：愿望单。金额一律传「分」，显示才换元 */
  wish: {
    list: () => rpc<Wish[]>('wish.list'),
    save: (p: {
      id?: string; title: string; priceCents: number; note?: string;
      url?: string; priority?: number; targetDate?: string;
    }) => rpc<{ ok: boolean; id?: string; err?: string }>('wish.save', p),
    done: (id: string, done: number) => rpc<{ ok: boolean }>('wish.done', { id, done }),
    remove: (id: string) => rpc<{ ok: boolean }>('wish.delete', { id }),
    stats: () => rpc<WishStats>('wish.stats'),
  },

  /* 第 117 条：跨模块搜索 */
  search: {
    all: (q: string, per = 6) => rpc<SearchHit[]>('search.all', { q, per }),
  },

  /* 第 140 条：打卡提醒。第 98 条补了提前量 / 间隔重复 / 提醒方式 */
  habitRemind: {
    preview: () => rpc<{
      count: number;
      names: string[];
      on: boolean;
      at: string;
      /** 提前多少分钟 */
      lead: number;
      /** 重复间隔分钟，0 = 一天只说一次 */
      every: number;
      how: 'sound' | 'badge' | 'silent' | string;
      /** 今天已经响过几次 */
      todayTimes: number;
      /** 今天最多响几次 */
      maxTimes: number;
      /** 今天会在哪几个时刻响，如 ['20:30','20:45'] */
      fireAt: string[];
    }>('habit.remindPreview'),
  },
};

/** 第 117 条：跨模块搜索的一条结果 */
export interface SearchHit {
  kind: 'entry' | 'note' | 'todo' | 'summary' | 'habit' | 'ledger' | 'alarm' | 'countdown';
  id: string;
  title: string;
  sub: string;
  snippet: string;
  date: string;
}

export type { Settings };
