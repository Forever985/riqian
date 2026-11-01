import { create } from 'zustand';
import { api } from './api';
import type {
  DateKey, Entry, EntryListItem, Habit, HabitValue, JournalModule, MediaItem,
  ModuleValue, Overview, QuickMode, RecFilter, Settings, TabItem, TagCount, Todo, TodoList, TodoSortMode, VaultStatus, ViewKey,
} from './types';
import { imgUrl, setMediaIndex } from './lib/media';
import { applyAppearance } from './lib/theme';
import { setView } from './lib/diag';
import { inHMWindow, realTodayKey, setDayStart, shortDateLabel, todayKey } from './lib/date';

export interface Draft {
  /** 键是模块 id；Markdown / BBCode 的源码存在 `${id}:md`、`${id}:bb`，跟数据库里的存法一致 */
  values: Record<string, ModuleValue>;
  fav: number;
  bg: string;
  tags: string[];
  /** 标题（v9）。空串 = 这一天没起标题 */
  title: string;
  /** 背景调色（v10.1）：{t,fit,veil} 的 JSON，空串 = 没调过 */
  bgTone: string;
}

export interface PomoState {
  running: boolean;
  left: number;
  total: number;
  kind: 'focus' | 'break';
  preset: number;
  breakMin: number;
  task: string;
  /** 自定义预设（分钟），从设置里读 */
  presets: number[];
  breakPresets: number[];
  /** 第几颗番茄，用于决定长休息 */
  round: number;
  longBreakEvery: number;
  longBreak: number;
  autoNext: boolean;
}

/** 视图标题，选项卡与顶栏都用它 */
export const VIEW_TITLE: Record<string, string> = {
  today: '今天', flow: '流', habits: '打卡', pomodoro: '番茄钟', calendar: '日历',
  records: '记录', todos: '待办', countdown: '倒计时', stats: '统计', settings: '设置',
  notes: '笔记', profile: '我的', welcome: '欢迎', review: '总结',
  drafts: '草稿箱', changelog: '更新日志', manual: '使用说明书', contact: '联系我们',
  media: '多媒体库', music: '多媒体库',
  ledger: '记账本', alarms: '提醒', timeline: '时间轴',
  draw: '画板',
  // #241
  themeCenter: '主题中心', pluginCenter: '插件中心', workshop: '创意工坊',
};

const emptyFilter: RecFilter = { q: '', from: '', to: '', mood: '0', tag: '', fav: '0', hasImg: '0' };

/**
 * 第 163 条：待办列表用哪种排序。存 settings.todoSortMode。
 *
 * 必须放在 reloadTodos 外面读 settings —— 排序方式一变就要重新向后端取一次，
 * 前端只认服务端给的顺序（§2.6：能在 SQL 里算的不搬到前端）。
 * 老用户没有这个键，默认「手动」：他们之前拖出来的 sort 立刻生效，不会被换成别的口径。
 */
export function todoSortMode(s: Settings | undefined | null): TodoSortMode {
  const v = String(s?.todoSortMode || 'manual');
  return v === 'quad' || v === 'due' ? v : 'manual';
}

interface AppStore {
  ready: boolean;
  bootError: string | null;
  view: ViewKey;
  date: DateKey;
  ym: string;

  root: string;
  dbPath: string;
  mediaDir: string;
  exportDir: string;

  settings: Settings;
  modules: JournalModule[];
  tags: TagCount[];
  habits: Habit[];
  todos: Todo[];
  mediaList: MediaItem[];
  logs: Record<string, HabitValue>;
  habitNotes: Record<string, string>;
  todoLists: TodoList[];
  entry: Entry | null;
  draft: Draft;

  saveState: string;
  saveBad: boolean;
  /** 草稿是否有未落盘的改动。切日期 / 重新拉取之前靠它决定要不要先 flush */
  dirty: boolean;

  filter: RecFilter;
  recItems: EntryListItem[];
  overview: Overview | null;

  toastMsg: string;
  toastSeq: number;

  pomo: PomoState;
  pomoDone: number;

  /* ---- v7：选项卡 / 安全 / 笔记 ---- */
  tabs: TabItem[];
  activeTab: string;
  activeNoteId: string | null;
  vault: VaultStatus | null;
  /** 全软件锁：启动后未解锁时为 true */
  appLocked: boolean;
  dayStart: number;

  /* ---- v8：快速捕获 ---- */
  /** 非 null 时弹出快速捕获窗（托盘 / 全局热键触发） */
  quick: QuickMode | null;
  setQuick: (m: QuickMode | null) => void;
  /**
   * 带着条件打开「记录」：常用标签、统计里点某个方块都走这里。
   * 以前只 setView('records')，页面拿不到标签，用户点了等于跳个空页 —— 这是"假功能"。
   */
  recordsPreset: { tag?: string; q?: string; kind?: string } | null;
  openRecords: (p: { tag?: string; q?: string; kind?: string }) => void;
  takeRecordsPreset: () => { tag?: string; q?: string; kind?: string } | null;
  /** 设置深链：要打开哪一组 */
  settingsGroup: string | null;
  goSettings: (group: string) => void;
  takeSettingsGroup: () => string | null;
  /** 命令面板（Ctrl+K） */
  palette: boolean;
  setPalette: (v: boolean) => void;
  /** 快捷键一览（F1） */
  help: boolean;
  setHelp: (v: boolean) => void;
  /** 已经跨过日界线但界面还停在昨天 */
  dayStale: boolean;
  /** 这一轮"今天"的锚点（跨天判断基准） */
  dayAnchor: string;
  /** 开新的一页（会先落盘再切到 id 当天） */
  rollover: () => Promise<void>;
  /** 回到今天：点侧栏「今天」时用，反复点也管用 */
  goToday: () => Promise<void>;
  checkDay: () => void;
  setTitle: (t: string) => void;
  /** 设背景图 / 纯色 + 调色参数 */
  setBg: (bg: string, bgTone: string) => Promise<void>;
  publish: (on: boolean) => Promise<{ ok: boolean; status: string; publishedAt: string }>;
  /** 立即锁屏（托盘「立即锁定」） */
  lockApp: () => void;

  openTab: (view: ViewKey, opts?: { noteId?: string; title?: string; date?: string }) => Promise<void>;
  closeTab: (key: string) => void;
  closeOtherTabs: (key: string) => void;
  closeLeftTabs: (key: string) => void;
  closeRightTabs: (key: string) => void;
  closeAllTabs: () => void;
  /** 第 175 条：拖动排序，顺序跟着 tabs 走并落库 */
  moveTab: (from: number, to: number) => void;
  /** 点选项卡：切视图（日记页连日期一起切） */
  activateTab: (key: string) => Promise<void>;
  setActiveNote: (id: string | null) => void;
  reloadVault: () => Promise<void>;
  setAppLocked: (v: boolean) => void;

  init: () => Promise<void>;
  go: (v: ViewKey) => Promise<void>;
  /** 切视图后的数据加载（go 内部用，也可单独调） */
  afterNav: (v: ViewKey) => Promise<void>;
  setDate: (d: DateKey) => Promise<void>;

  setValue: (mid: string, val: ModuleValue) => void;
  setSource: (mid: string, kind: 'md' | 'bb', src: string, html: string) => void;
  patchDraft: (p: Partial<Draft>) => void;
  scheduleSave: () => void;
  flushSave: () => Promise<void>;
  reloadEntry: () => Promise<void>;

  reloadModules: () => Promise<void>;
  reloadHabits: () => Promise<void>;
  reloadTodos: () => Promise<void>;
  reloadMedia: () => Promise<void>;
  reloadTags: () => Promise<void>;
  setLog: (habitId: string, val: HabitValue) => Promise<void>;
  setHabitNote: (habitId: string, note: string) => Promise<void>;
  reloadTodoLists: () => Promise<void>;

  setSetting: (k: string, v: string, local?: boolean) => Promise<void>;
  setFilter: (p: Partial<RecFilter>) => void;
  setRecItems: (items: EntryListItem[]) => void;
  setYm: (ym: string) => void;
  setOverview: (o: Overview) => void;

  toast: (msg: string) => void;

  pomoTick: () => void;
  pomoStart: () => void;
  pomoPause: () => void;
  pomoReset: () => void;
  pomoSkip: () => Promise<void>;
  pomoSetPreset: (m: number) => Promise<void>;
  pomoSavePresets: (kind: 'focus' | 'break', list: number[]) => Promise<void>;
  pomoSetBreak: (m: number) => Promise<void>;
  pomoSetTask: (t: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dayTimer: ReturnType<typeof setInterval> | null = null;

/** 选项卡存盘：只留能重建界面的字段（date 一定要存，否则「10月1日」重开就成了今天） */
const persistTabs = (tabs: TabItem[]) =>
  api.settingSet('tabs', JSON.stringify(tabs.map((t) => ({
    key: t.key, view: t.view, title: t.title, noteId: t.noteId, date: t.date,
  })))).catch(() => null);

/** 某一天的日记标签（key 带日期，同一天只会有一个） */
const dayTab = (d: string): TabItem => ({ key: `today:${d}`, view: 'today', title: shortDateLabel(d), date: d });

/**
 * 第 175 条：标签最多留几个。
 * 以前两处各写各的（`>= 14` 和 `> 14`），看起来像 14 和 15 打架，
 * 实际都是留 14 个，但读代码的人得自己验算一遍。抽成常量，改一次就够。
 */
const MAX_TABS = 14;

export const useStore = create<AppStore>()((set, get) => ({
  ready: false,
  bootError: null,
  view: 'today',
  date: todayKey(),
  ym: todayKey().slice(0, 7),

  root: '',
  dbPath: '',
  mediaDir: '',
  exportDir: '',

  settings: {},
  modules: [],
  tags: [],
  habits: [],
  todos: [],
  mediaList: [],
  logs: {},
  habitNotes: {},
  todoLists: [],
  entry: null,
  draft: { values: {}, fav: 0, bg: '', tags: [], title: '', bgTone: '' },

  saveState: '',
  saveBad: false,
  dirty: false,

  filter: { ...emptyFilter },
  recItems: [],
  overview: null,

  toastMsg: '',
  toastSeq: 0,

  pomo: {
    running: false, left: 25 * 60, total: 25 * 60, kind: 'focus', preset: 25, breakMin: 5, task: '',
    presets: [15, 25, 35, 45, 60], breakPresets: [3, 5, 10, 15, 30],
    round: 0, longBreakEvery: 4, longBreak: 20, autoNext: true,
  },
  pomoDone: 0,

  tabs: [],
  activeTab: 'today',
  activeNoteId: null,
  vault: null,
  appLocked: false,
  dayStart: 0,

  /** 已经跨过日界线，但界面还停在昨天：提示用户开新的一页，不偷偷切 */
  dayStale: false,
  /** 这一轮"今天"的锚点：只有它变了才算跨天，翻旧日记不该弹提示 */
  dayAnchor: todayKey(),
  rollover: async () => {
    const st = get();
    if (st.dirty) await st.flushSave();
    const t = todayKey();
    await get().setDate(t);
    set({ dayStale: false, dayAnchor: t });
  },
  checkDay: () => {
    // 到了新的一天就把提示挂出来。只提示、不切页 —— 悄悄切日期正是「一口气冒出两篇日记」的来源。
    // 注意比的是 dayAnchor（这一轮的今天），不是 date：否则翻看旧日记也会弹「跨天了」。
    if (get().dayStale) return;
    if (todayKey() !== get().dayAnchor) set({ dayStale: true });
  },

  quick: null,
  setQuick: (m) => set({ quick: m }),
  recordsPreset: null,
  openRecords: (p) => { set({ recordsPreset: p }); void get().go('records'); },
  takeRecordsPreset: () => {
    const p = get().recordsPreset;
    if (p) set({ recordsPreset: null });
    return p;
  },

  /** 要跳到设置里的哪一组（'notify' / 'data' …），SettingsView 消费后清空 */
  settingsGroup: null,
  goSettings: (group) => { set({ settingsGroup: group, view: 'settings' }); void get().afterNav('settings'); },
  takeSettingsGroup: () => {
    const g = get().settingsGroup;
    if (g) set({ settingsGroup: null });
    return g;
  },

  palette: false,
  setPalette: (v) => set({ palette: v }),
  help: false,
  setHelp: (v) => set({ help: v }),
  lockApp: () => {
    const st = get();
    /*
     * 第 146 条：没设主密码就锁定 = 把自己反锁在门外。
     * 锁屏只会验证主密码，而主密码压根没设置过，输什么都是「密码不正确」——
     * 用户看到的就是「点了一下立即锁定，然后软件再也打不开了」。
     * 所以这里直接拒绝，并告诉他去哪儿设置。
     */
    if (!st.vault?.hasMain) {
      st.toast('还没设置主密码，应用锁用不了。先到「设置 → 安全与密码」设一个。');
      return;
    }
    // 锁之前先把没落盘的草稿写完，否则刚打的那段会跟着一起消失
    if (st.dirty) void st.flushSave();
    set({ quick: null, palette: false, appLocked: true });
  },

  /* ---------------- 启动 / 导航 ---------------- */

  init: async () => {
    try {
      const b = await api.bootstrap();
      // 日界线必须在算 todayKey 之前设置，否则凌晨打开会落到错误的一天
      setDayStart(b.settings.dayStart as string | number);
      const ds = Number(b.settings.dayStart) || 0;

      const parseNums = (raw: unknown, def: number[]) => {
        try {
          const a = JSON.parse(String(raw ?? ''));
          if (Array.isArray(a) && a.length) return a.map(Number).filter((n) => n > 0).sort((x, y) => x - y);
        } catch { /* 用默认 */ }
        return def;
      };
      /*
       * 第 226 条：默认时长现在有两处来源 ——
       * pomoFocus（设置里那个「默认专注时长」，第 226 条新加的）优先，
       * 回落到 pomoPreset（上一次点选的时长），再回落到 25。
       * 这样用户明确设了默认值就按默认值来，没设就沿用上次的选择。
       */
      const preset = Number(b.settings.pomoFocus) || Number(b.settings.pomoPreset) || 25;
      const breakMin = Number(b.settings.pomoBreak) || 5;

      let tabs: TabItem[] = [];
      try {
        const raw = JSON.parse(String(b.settings.tabs || '[]'));
        if (Array.isArray(raw)) {
          tabs = raw.filter((t) => t && t.view && VIEW_TITLE[t.view])
            .map((t) => ({
              key: String(t.key || t.view), view: t.view as ViewKey,
              title: String(t.title || VIEW_TITLE[t.view]),
              noteId: t.noteId,
              date: t.date ? String(t.date) : undefined,
            }));
        }
      } catch { tabs = []; }
      const today = todayKey();

      /*
       * 老数据的「今天」标签没有 date（以前 key 就是 'today'）。
       * 补上今天并换成带日期的 key，否则新逻辑里它会和「今天」撞成两个标签。
       */
      tabs = tabs.map((t) => (t.view === 'today' && !t.date ? dayTab(today) : t));
      tabs = tabs.filter((t, i) => tabs.findIndex((x) => x.key === t.key) === i);

      set({
        dayAnchor: today,
        root: b.root, dbPath: b.dbPath, mediaDir: b.mediaDir, exportDir: b.exportDir,
        settings: b.settings, modules: b.modules || [], tags: b.tags || [], habits: b.habits || [],
        date: today, ym: today.slice(0, 7), dayStart: ds,
        tabs,
        activeTab: tabs.length ? tabs[tabs.length - 1].key : 'today',
        pomo: {
          ...get().pomo, preset, total: preset * 60, left: preset * 60, breakMin,
          presets: parseNums(b.settings.pomoPresets, [15, 25, 35, 45, 60]),
          breakPresets: parseNums(b.settings.pomoBreakPresets, [3, 5, 10, 15, 30]),
          longBreakEvery: Number(b.settings.pomoLongBreakEvery) || 4,
          longBreak: Number(b.settings.pomoLongBreak) || 20,
          autoNext: String(b.settings.pomoAutoNext ?? '1') === '1',
        },
        ready: true,
      });
      applyAppearance(get().settings);

      // 全软件密码：有主密码且启用时先锁住
      try {
        const vs = await api.vault.status();
        set({ vault: vs });
        // 有没有 app 规则才是"要不要锁整个软件"的唯一依据。
        // 以前用 hasMain && enabled：只要把「启用」关掉就再也不锁，用户会以为锁坏了。
        if (vs.hasMain && (vs.rules || []).some((r) => r.scope === 'app')) {
          const c = await api.vault.check('app');
          set({ appLocked: c.locked });
        }
      } catch { /* 没有密码功能也不影响启动 */ }

      await get().reloadMedia();
      await get().reloadTodos();
      await get().reloadTodoLists();
      if (!get().tabs.length) {
        // 新库第一次开：一个「今天」就够了；key 也带日期，和其它日记标签同一套规则
        set({ tabs: [dayTab(today)], activeTab: `today:${today}` });
      }
      const startView: ViewKey = (get().appLocked || String(b.settings.welcomeOnStart ?? '1') === '1') ? 'welcome' : 'today';
      await get().go(startView);

      // 跨天检查：每分钟对一次时间。不用 setTimeout 到午夜 —— 合盖休眠醒来后那个定时器就废了
      if (!dayTimer) {
        dayTimer = window.setInterval(() => {
          try { useStore.getState().checkDay(); } catch { /* 无所谓 */ }
        }, 60_000);
      }
    } catch (e) {
      set({ bootError: (e as Error).message, ready: true });
    }
  },

  go: async (v) => {
    const st = get();
    // 记下当前页面：崩溃时日志里能看出「他当时在哪一页」
    setView(v);
    const tabMode = String(st.settings.tabMode ?? '0') === '1';
    /*
     * 选项卡模式下所有视图都进标签栏，欢迎页也一样 ——
     * 第 181 条「全部关闭回到欢迎页」本来就是靠一个欢迎标签兜住的。
     * 以前 welcome 走 else 分支，activeTab 会变成一个列表里不存在的 key，
     * 顶部一个高亮都没有，和状态对不上。
     */
    if (tabMode) await st.openTab(v, v === 'today' ? { date: st.date } : undefined);
    else set({ view: v, activeTab: v });
    await st.afterNav(v);
  },

  /** 点侧栏「今天」：如果正停在别的日期，先回到今天（多次点击也有效） */
  goToday: async () => {
    const t = todayKey();
    if (get().date !== t) await get().setDate(t);
    await get().go('today');
  },

  afterNav: async (v) => {
    if (v === 'today') {
      await get().reloadEntry();
    } else if (v === 'habits') {
      await get().reloadHabits();
      set({ logs: await api.habits.logs(get().date) });
    } else if (v === 'todos') {
      await get().reloadTodos();
      await get().reloadTodoLists();
    }
  },

  /* ---------------- 选项卡 ---------------- */

  /*
   * 第 172 / 173 条：加号以前只是再开一个「今天」，看着像没反应。
   * 现在日记页的 key 带上日期 —— 同一天只开一个，不同天各开一个，
   * 标题也换成「今天 / 昨天 / 10月1日」，一眼能分清在看哪天。
   */
  openTab: async (view, opts) => {
    const date = opts?.date;
    const dated = view === 'today' && !!date;
    const key = opts?.noteId ? `notes:${opts.noteId}` : dated ? `today:${date}` : view;
    const tabs = get().tabs.slice();
    const exist = tabs.find((t) => t.key === key);
    if (exist) {
      set({ view: exist.view, activeTab: key, activeNoteId: exist.noteId ?? null });
      if (exist.view === 'today' && exist.date && exist.date !== get().date) await get().setDate(exist.date);
      return;
    }
    const item: TabItem = {
      key, view,
      title: opts?.title || (dated ? shortDateLabel(String(date)) : VIEW_TITLE[view] || String(view)),
      noteId: opts?.noteId, date,
    };
    // 满了就挤掉最早那个；先 pop 后 push，保证总数恒为 MAX_TABS
    if (tabs.length >= MAX_TABS) tabs.shift();
    tabs.push(item);
    set({ tabs, view, activeTab: key, activeNoteId: opts?.noteId ?? null });
    void persistTabs(tabs);
    // 日期已经一样了就别再绕回去：setDate 内部也会改标签，会打转
    if (dated && String(date) !== get().date) await get().setDate(String(date));
  },

  /** 点某个选项卡：切过去（日记页还要把日期一起切过去） */
  activateTab: async (key) => {
    const tab = get().tabs.find((t) => t.key === key);
    if (!tab) return;
    set({ view: tab.view, activeTab: key, activeNoteId: tab.noteId ?? null });
    if (tab.view === 'today' && tab.date && tab.date !== get().date) await get().setDate(tab.date);
  },

  closeTab: (key) => {
    const all = get().tabs;
    const i = all.findIndex((t) => t.key === key);
    const tabs = all.filter((t) => t.key !== key);
    // 关掉当前页时落到它左边那个（浏览器的习惯），没有就取右边的；
    // 一个都不剩了也不能空着 —— 补一个「当前这天」，否则界面会白屏
    const next = tabs.length
      ? tabs[Math.min(Math.max(i, 0), tabs.length - 1)]
      : dayTab(get().date);
    const list = tabs.length ? tabs : [next];
    const active = get().activeTab === key ? next.key : get().activeTab;
    const cur = list.find((t) => t.key === active) || next;
    set({ tabs: list, activeTab: cur.key, view: cur.view, activeNoteId: cur.noteId ?? null });
    void persistTabs(list);
    // setDate 自己会 reloadEntry，别为了同一份数据拉两遍
    if (cur.view === 'today' && cur.date && cur.date !== get().date) void get().setDate(cur.date);
    else void get().afterNav(cur.view);
  },

  closeOtherTabs: (key) => {
    const keep = get().tabs.filter((t) => t.key === key);
    const list = keep.length ? keep : [dayTab(get().date)];
    set({ tabs: list, activeTab: list[0].key, view: list[0].view, activeNoteId: list[0].noteId ?? null });
    void persistTabs(list);
  },

  closeLeftTabs: (key) => {
    const all = get().tabs;
    const i = all.findIndex((t) => t.key === key);
    if (i <= 0) return;
    const list = all.slice(i);
    set({ tabs: list, activeTab: key });
    void persistTabs(list);
  },

  closeRightTabs: (key) => {
    const all = get().tabs;
    const i = all.findIndex((t) => t.key === key);
    if (i < 0 || i >= all.length - 1) return;
    const list = all.slice(0, i + 1);
    set({ tabs: list, activeTab: key });
    void persistTabs(list);
  },

  /*
   * 第 181 条：全部关闭之后停在「今天」很奇怪 —— 用户是把页面都关掉了，
   * 该回到首页。首页那个欢迎视图本来就是"打开软件第一眼看到的东西"。
   */
  closeAllTabs: () => {
    const list: TabItem[] = [{ key: 'welcome', view: 'welcome', title: '欢迎' }];
    set({ tabs: list, activeTab: 'welcome', view: 'welcome' });
    void persistTabs(list);
    void get().afterNav('welcome');
  },

  /* 第 175 条：拖完顺序直接写回 tabs 并落库，重开软件还是这个顺序 */
  moveTab: (from, to) => {
    const tabs = get().tabs.slice();
    if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    set({ tabs });
    void persistTabs(tabs);
  },

  setActiveNote: (id) => set({ activeNoteId: id }),

  reloadVault: async () => set({ vault: await api.vault.status() }),
  setAppLocked: (v) => set({ appLocked: v }),

  setDate: async (d) => {
    // 关键：换日期前先把当前没落盘的草稿写完，否则 420ms 的防抖会把「上一天的内容」写进新的一天
    if (get().dirty) await get().flushSave();
    const st = get();
    const tabMode = String(st.settings.tabMode ?? '0') === '1';
    set({ date: d, view: 'today' });

    /*
     * 第 173 条：选项卡模式下换日期要跟着标签走。
     * - 当前就在某天的日记里点「前一天 / 后一天」：把这个标签改名成新日期，
     *   否则顶栏已经写着 10月1日，标签还挂着「今天」，用户会以为切错了页面；
     * - 从记录 / 日历这种页面点某天：直接开（或切到）那一天的标签，
     *   不然 view 已经是 today、activeTab 却还停在上一个页面。
     */
    if (tabMode) {
      const active = st.tabs.find((t) => t.key === st.activeTab);
      const target = `today:${d}`;
      if (active && active.view === 'today' && active.key === target) {
        // 已经是这一天的标签了，什么都不用动
      } else if (active && active.view === 'today') {
        if (st.tabs.some((t) => t.key === target)) {
          set({ activeTab: target });
        } else {
          const tabs = st.tabs.map((t) => (t.key === active.key
            ? { ...t, key: target, date: d, title: shortDateLabel(d) }
            : t));
          set({ tabs, activeTab: target });
          void persistTabs(tabs);
        }
      } else if (st.tabs.some((t) => t.key === target)) {
        set({ activeTab: target });
      } else {
        const tabs = [...st.tabs, dayTab(d)];
        if (tabs.length > MAX_TABS) tabs.shift();
        set({ tabs, activeTab: target });
        void persistTabs(tabs);
      }
    }
    await get().reloadEntry();
  },

  reloadEntry: async () => {
    // 同理：任何重新拉取（收藏 / 背景 / 关联 / 引用 / 切回今天）之前先落盘，
    // 否则拉回来的旧值会覆盖草稿，紧接着的防抖又把旧值写回库 —— 刚打的字就没了
    if (get().dirty) await get().flushSave();
    const date = get().date;
    const e = await api.entry.get(date);
    const [logs, notes] = await Promise.all([api.habits.logs(date), api.habits.notes(date)]);
    set({
      entry: e,
      logs,
      habitNotes: notes,
      draft: {
        values: { ...(e.values || {}) },
        fav: e.fav || 0,
        bg: e.bg || '',
        tags: e.tags || [],
        title: e.title || '',
        bgTone: e.bgTone || '',
      },
    });
  },

  /* ---------------- 草稿与保存 ---------------- */

  setValue: (mid, val) => {
    const draft = get().draft;
    set({ draft: { ...draft, values: { ...draft.values, [mid]: val } } });
  },

  setSource: (mid, kind, src, html) => {
    const draft = get().draft;
    set({
      draft: {
        ...draft,
        values: { ...draft.values, [`${mid}:${kind}`]: src, [mid]: html },
      },
    });
  },

  patchDraft: (p) => set({ draft: { ...get().draft, ...p } }),

  /** 设背景（含调色）。立刻落库：这是"选一下就完事"的动作，走防抖反而容易丢 */
  setBg: async (bg: string, bgTone: string) => {
    const st = get();
    set({ draft: { ...st.draft, bg, bgTone } });
    await api.entry.bg(st.date, bg, bgTone);
    await get().reloadEntry();
  },

  setTitle: (title) => {
    set({ draft: { ...get().draft, title } });
    get().scheduleSave();
  },

  /** 定稿 / 改回草稿。定稿前先把当前内容写掉，否则"定稿"会把最后一段漏掉 */
  publish: async (on) => {
    const st = get();
    if (st.dirty) await st.flushSave();
    const r = await api.entry.publish(st.date, on);
    const entry = st.entry ? { ...st.entry, status: r.status, publishedAt: r.publishedAt } : st.entry;
    set({ entry });
    return r;
  },

  scheduleSave: () => {
    set({ saveState: '输入中…', saveBad: false, dirty: true });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void get().flushSave(); }, 420);
  },

  flushSave: async () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const { date, draft } = get();
    set({ saveState: '保存中…' });
    try {
      await api.entry.save({
        date, values: draft.values, fav: draft.fav, bg: draft.bg,
        title: draft.title || '', bgTone: draft.bgTone || '',
      });
      await api.tags.set(date, draft.tags);
      set({ saveState: '已保存', saveBad: false, dirty: false });
      // 回填元信息（字数、版本数、关联）但不覆盖正在编辑的草稿
      const fresh = await api.entry.get(date);
      if (get().date === date) set({ entry: fresh });
    } catch (e) {
      set({ saveState: '保存失败：' + (e as Error).message, saveBad: true });
    }
  },

  /* ---------------- 各类数据 ---------------- */

  reloadModules: async () => set({ modules: await api.modules.list() }),
  reloadHabits: async () => set({ habits: await api.habits.list() }),
  reloadTodos: async () => set({ todos: await api.todos.list(todoSortMode(get().settings)) }),
  reloadTodoLists: async () => set({ todoLists: await api.todos.lists() }),
  reloadTags: async () => set({ tags: await api.tags.list() }),

  reloadMedia: async () => {
    const list = await api.media.list('', 2000);
    setMediaIndex(list);
    set({ mediaList: list });
  },

  setLog: async (habitId, val) => {
    const date = get().date;
    await api.habits.log(date, habitId, val);
    const [logs, habits, notes] = await Promise.all([
      api.habits.logs(date), api.habits.list(), api.habits.notes(date),
    ]);
    set({ logs, habits, habitNotes: notes });
  },

  setHabitNote: async (habitId, note) => {
    const date = get().date;
    await api.habits.log(date, habitId, null, note);
    const [logs, notes] = await Promise.all([api.habits.logs(date), api.habits.notes(date)]);
    set({ logs, habitNotes: notes });
  },

  setSetting: async (k, v, local = true) => {
    if (local) set({ settings: { ...get().settings, [k]: v } });
    await api.settingSet(k, v);
    if (local) applyAppearance(get().settings);
  },

  setFilter: (p) => set({ filter: { ...get().filter, ...p } }),
  setRecItems: (items) => set({ recItems: items }),
  setYm: (ym) => set({ ym }),
  setOverview: (o) => set({ overview: o }),

  toast: (msg) => set({ toastMsg: msg, toastSeq: get().toastSeq + 1 }),

  /* ---------------- 番茄钟 ---------------- */

  pomoTick: () => {
    const p = get().pomo;
    if (!p.running) return;
    const left = p.left - 1;
    if (left <= 0) {
      set({ pomo: { ...p, left: 0, running: false } });
      void completePomo(get);
      return;
    }
    set({ pomo: { ...p, left } });
  },

  pomoStart: () => {
    const p = get().pomo;
    if (p.running) return;
    set({ pomo: { ...p, running: true, left: p.left || p.total } });
  },

  pomoPause: () => set({ pomo: { ...get().pomo, running: false } }),

  pomoReset: () => {
    const p = get().pomo;
    const total = p.preset * 60;
    set({ pomo: { ...p, running: false, kind: 'focus', total, left: total } });
  },

  pomoSkip: async () => {
    const p = get().pomo;
    const kind: 'focus' | 'break' = p.kind === 'focus' ? 'break' : 'focus';
    const total = (kind === 'focus' ? p.preset : p.breakMin) * 60;
    set({ pomo: { ...p, running: false, kind, total, left: total } });
  },

  pomoSetPreset: async (m) => {
    const p = get().pomo;
    const total = m * 60;
    set({ pomo: { ...p, preset: m, total: p.running ? p.total : total, left: p.running ? p.left : total } });
    await api.settingSet('pomoPreset', String(m));
  },

  pomoSavePresets: async (kind, list) => {
    const clean = [...new Set(list.map(Number).filter((n) => n > 0 && n <= 240))].sort((a, b) => a - b);
    const p = get().pomo;
    if (kind === 'focus') set({ pomo: { ...p, presets: clean } });
    else set({ pomo: { ...p, breakPresets: clean } });
    await api.settingSet(kind === 'focus' ? 'pomoPresets' : 'pomoBreakPresets', JSON.stringify(clean));
  },

  pomoSetTask: (t) => set({ pomo: { ...get().pomo, task: t } }),

  pomoSetBreak: async (m) => {
    set({ pomo: { ...get().pomo, breakMin: m } });
    await api.settingSet('pomoBreak', String(m));
  },
}));

/** 一颗番茄结束：记一笔、提醒、按设置进入下一段 */
async function completePomo(get: () => AppStore) {
  const p = get().pomo;
  const wasFocus = p.kind === 'focus';
  useStore.setState({ pomoDone: get().pomoDone + 1 });

  const s = get().settings;
  const dndOn = String(s.dndEnabled ?? '0') === '1';
  const inDnd = dndOn && inHMWindow(String(s.dndFrom || '22:00'), String(s.dndTo || '07:00'));
  // 专注进行中不打扰：这里判断的是「刚开始专注」，不弹窗；休息开始时照常提醒
  const quiet = inDnd;

  if (wasFocus) {
    await api.pomodoro.add(Math.round(p.total / 60), 'focus', p.task).catch(() => null);
    const round = p.round + 1;
    const isLong = p.longBreakEvery > 0 && round % p.longBreakEvery === 0;
    const breakTotal = (isLong ? p.longBreak : p.breakMin) * 60;
    useStore.setState({
      pomo: { ...get().pomo, kind: 'break', total: breakTotal, left: breakTotal, round, running: !!p.autoNext },
    });
    get().toast(isLong ? `完成第 ${round} 颗，进入长休息 ${Math.round(breakTotal / 60)} 分钟` : `完成一颗番茄 🍅 休息 ${p.breakMin} 分钟`);
    if (!quiet) {
      void api.notify.push({
        title: isLong ? '长休息时间' : '番茄完成 🍅',
        body: isLong ? `已连续专注 ${round} 颗，去活动一下 ${Math.round(breakTotal / 60)} 分钟`
                     : `已经专注 ${Math.round(p.total / 60)} 分钟，休息 ${p.breakMin} 分钟`,
        kind: 'break',
      }).catch(() => null);
      playChime(1);
    }
  } else {
    const total = p.preset * 60;
    useStore.setState({ pomo: { ...get().pomo, kind: 'focus', total, left: total, running: !!p.autoNext } });
    get().toast('休息结束，继续加油');
    if (!quiet) {
      void api.notify.push({
        title: '休息结束',
        body: `可以开始第 ${p.round + 1} 颗番茄了`,
        kind: 'focus',
      }).catch(() => null);
      playChime(2);
    }
  }
}

/* ---------------- 提示音 ---------------- */

let chimeCtx: AudioContext | null = null;

/**
 * 内置提示音用 WebAudio 合成，不依赖任何音频文件。
 * 用户也可以在设置里指定音乐库里的音频，那种情况由 notifySoundId 走 <audio>。
 */
export function playChime(kind: 1 | 2 = 1, force = false) {
  try {
    const st = useStore.getState();
    // force：设置页的「试听」必须真的响，否则用户关了「播放提示音」就会以为坏了
    if (!force && String(st.settings.notifySound ?? '1') !== '1') return;
    const vol = Math.max(0, Math.min(100, Number(st.settings.notifyVolume ?? 70))) / 100;

    // 设置里选了音乐库的音频就用它，否则用内置合成音
    const sid = String(st.settings.notifySoundId || '');
    if (sid) {
      const a = new Audio(imgUrl(sid));
      a.volume = vol;
      void a.play().catch(() => playSynth(vol, kind));
      return;
    }
    playSynth(vol, kind);
  } catch { /* 没有音频设备就静默 */ }
}

/**
 * 第 143 条：按「单条提醒自己选的声音」响一次。
 *
 * sound 的取值和设置页的「提示音来源」保持一套语义：
 *   ''  = 跟随设置（走 playChime，含用户选过的音乐库音频）
 *   '1' / '2' = 内置风铃 A / B
 *   其它 = 音乐库里的媒体 id，用 <audio> 播
 *
 * force 默认 true：提醒到点本来就该响，不该被「播放提示音」这个全局开关吃掉，
 * 否则用户给某条提醒单独选了声音却听不见，会以为是坏了。
 */
export function playAlarmSound(sound: string, force = true) {
  try {
    const st = useStore.getState();
    // force=false（方式=跟随设置）时要尊重「播放提示音」开关，否则用户关了还响
    if (!force && String(st.settings.notifySound ?? '1') !== '1') return;
    const vol = Math.max(0, Math.min(100, Number(st.settings.notifyVolume ?? 70))) / 100;
    const s = String(sound || '');
    if (!s) { playChime(1, force); return; }
    if (s === '1' || s === '2') { playSynth(vol, s === '1' ? 1 : 2); return; }
    const a = new Audio(imgUrl(s));
    a.volume = vol;
    void a.play().catch(() => playSynth(vol, 1));
  } catch { /* 没有音频设备就静默 */ }
}

/** 内置提示音：正弦波 + 包络，像风铃而不是系统蜂鸣 */
function playSynth(vol: number, kind: 1 | 2) {
  try {

    const ctx = chimeCtx || (chimeCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());
    // WebView 里首次创建时常是 suspended，不 resume 就是"点了没声音"
    if (ctx.state !== 'running') void ctx.resume();

    // 三音上行（休息） / 两音（继续），用正弦波加包络，听起来像风铃而不是系统蜂鸣
    const notes = kind === 1 ? [880, 1108.7, 1318.5] : [1318.5, 880];
    notes.forEach((f, i) => {
      const t0 = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.22 * vol, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.85);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.9);
    });
  } catch { /* 没有音频设备就静默 */ }
}

/** 关闭窗口前把没落盘的草稿写掉；托盘菜单也通过这两个钩子操作 */
export function installFlushHook() {
  window.__FLUSH__ = () => {
    if (useStore.getState().dirty) void useStore.getState().flushSave();
  };
  // 托盘「专注 25 分钟」→ 设置时长并立刻开始
  (window as unknown as { __POMO_START__?: (m: number) => void }).__POMO_START__ = (m: number) => {
    const st = useStore.getState();
    const total = Math.max(1, Math.round(m)) * 60;
    useStore.setState({
      view: 'pomodoro',
      pomo: { ...st.pomo, kind: 'focus', preset: Math.round(m), total, left: total, running: true },
    });
    void st.afterNav('pomodoro');
  };

  /**
   * 宿主 → 界面 的唯一命令入口。
   * 托盘、全局热键、右下角悬浮球都走这里，前端只需要在一处扩展动作，
   * 不用每加一个入口就在 C# 里写一段 ExecuteScript。
   */
  window.__HOST_CMD__ = (cmd: string) => {
    const st = useStore.getState();
    switch (cmd) {
      case 'quick:diary': st.setQuick('diary'); break;
      case 'quick:note': st.setQuick('note'); break;
      case 'quick:todo': st.setQuick('todo'); break;
      case 'quick:cd': st.setQuick('cd'); break;
      case 'quick:pomo': {
        const total = (Number(st.pomo.preset) || 25) * 60;
        useStore.setState({
          view: 'pomodoro',
          pomo: { ...st.pomo, kind: 'focus', total, left: total, running: true },
        });
        void st.afterNav('pomodoro');
        st.toast('番茄钟已开始');
        break;
      }
      case 'nav:review': void st.go('review'); break;
      case 'nav:settings': void st.go('settings'); break;
      case 'nav:home': void st.go('welcome'); break;
      case 'lock': st.lockApp(); break;
      default: break;
    }
  };
}
