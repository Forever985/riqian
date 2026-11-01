/** 领域类型：与 Db.cs / MainForm.cs 的 RPC 返回结构一一对应 */

export type DateKey = string; // yyyy-MM-dd

export type ModuleType =
  | 'richtext' | 'mood' | 'weather' | 'tags' | 'habits' | 'todo'
  | 'sleep' | 'energy' | 'rating' | 'images' | 'quote' | 'heading' | 'divider';

export type EditorFormat = 'rich' | 'md' | 'bb';

export interface ModuleConfig {
  format?: EditorFormat;
  max?: number;
  [k: string]: unknown;
}

export interface JournalModule {
  id: string;
  type: ModuleType;
  title: string;
  enabled: number;       // 1 = 启用
  sort: number;
  config: ModuleConfig;
}

export type HabitType = 'bool' | 'time' | 'number' | 'duration' | 'choice' | 'note';
export type HabitValue = string | number | string[] | null;

export interface HabitDay {
  date: DateKey;
  v: HabitValue;
  note?: string;
}

export interface Habit {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: HabitType;
  unit: string;
  options: string[];
  goal: number;
  archived: number;
  total: number;
  streak: number;
  last14: HabitDay[];
}

export interface EntryLink {
  id: number;
  date: DateKey;
  kind: 'quote' | 'related' | string;
  quote?: string;
}

export interface QuoteRef {
  date: DateKey;
  text: string;
}

export type ModuleValue = string | number | string[] | QuoteRef[] | null;

export interface Entry {
  date: DateKey;
  /** 标题（v9 起）：空字符串表示这一天没起标题 */
  title?: string;
  /** draft | published —— 定稿后默认只读 */
  status?: string;
  publishedAt?: string;
  /** 这一天在库里到底有没有行（没有 = 还没写过） */
  exists?: boolean;
  /** 背景调色参数（第 78 条）：JSON {t,fit,veil}，空串 = 没调过 */
  bgTone?: string;
  values: Record<string, ModuleValue>;
  fav: number;
  bg: string;
  tags: string[];
  links: EntryLink[];
  backlinks: EntryLink[];
  plain: string;
  updatedAt: string;
  revisionCount: number;
  chars?: number;
}

export interface EntryListItem {
  date: DateKey;
  title?: string;
  status?: string;
  /** 背景调色（v10.1），流里那条背景带也用它 */
  bgTone?: string;
  chars: number;
  plain: string;
  fav: number;
  bg: string;
  values: Record<string, ModuleValue>;
  tags: string[];
}

export interface Todo {
  id: string;
  title: string;
  done: number;
  due: string;
  dueTime: string;
  priority: number;
  note: string;
  createdAt: string;
  doneAt: string;
  listId: string;
  /** 1 = 在「垃圾桶」里：不打算做了，但没删；不计入完成率 */
  trashed: number;
  /** 手动排序（第 84 条）：0/10/20… */
  sort?: number;
  /** 重复规则：'' | daily | weekly | monthly | yearly | weekday | lunar-yearly */
  repeat: string;
  /** 非空 = 在「回收站」里（真删除前的暂存） */
  deletedAt: string;
}

export interface TodoList {
  id: string;
  name: string;
  color: string;
  sort: number;
  open: number;
  done: number;
  trashed: number;
  /** 第 218 条：清单描述 */
  note?: string;
  /** 第 220 条：父清单，空 = 顶层 */
  parentId?: string;
}

/**
 * 第 163 条：待办的排序方式。
 * - manual：用户拖出来的顺序（sort 0/10/20…），只有这个模式能拖
 * - quad：四象限（重要 = 优先级高，紧急 = 到期早）
 * - due：按截止日期，没日期的垫底
 */
export type TodoSortMode = 'manual' | 'quad' | 'due';

export interface Countdown {
  id: string;
  title: string;
  date: DateKey;
  yearly: number;
  /** '' | yearly | monthly | lunar-yearly | lunar-monthly */
  repeat: string;
  lunar: boolean;
  color: string;
  note: string;
  days: number;
  nextDate: DateKey;
  /** 用户拖出来的顺序（0/10/20…）；全 0 表示没排过，按日期走 */
  sort: number;
}

/** 回收站里的倒数日（第 145 条） */
export interface CountdownTrash {
  id: string;
  title: string;
  date: DateKey;
  color: string;
  note: string;
  repeat: string;
  deletedAt: string;
  days: number;
}

export interface TagCount { tag: string; n: number }

export interface Template {
  id: string;
  name: string;
  kind: 'day' | 'week' | 'month' | 'custom' | string;
  builtin: number;
  body: string;
}

export interface MediaItem {
  id: string;
  name: string;
  file: string;
  thumb: string;
  width: number;
  height: number;
  bytes: number;
  mtime: string;
  /** image | audio | video（v10 起后端会给） */
  kind?: string;
  ext?: string;
  /** 调色参数 JSON：{b,c,s,o} */
  tone?: string;
  note?: string;
  createdAt?: string;
  /** 第 151 条：显示用别名（不改磁盘文件名） */
  alias?: string;
  /** 第 151 条：所属文件夹，空串 = 未分类 */
  folder?: string;
  /** 第 151 条：逗号分隔的标签，一个文件可属多个分类 */
  tags?: string;
}

export interface RevisionRow {
  id: number;
  ts: string;
  chars: number;
  preview: string;
}

export interface RevisionDetail {
  id: number;
  ts: string;
  snapshot: { values?: Record<string, ModuleValue>; fav?: number; bg?: string };
}

export interface OnThisDay {
  date: DateKey;
  years: number;
  plain: string;
}

export interface HabitHistory {
  count: number;
  avgNumber?: number;
  avgTime?: string;
  list: HabitDay[];
}

export interface PomodoroPoint {
  date: DateKey;
  minutes: number;
  count: number;
}

export interface PomodoroBucket {
  minutes: number;
  count: number;
}

export interface PomodoroStats {
  days: number;
  todayCount: number;
  todayMinutes: number;
  todayList: { ts: string; task: string; minutes: number }[];
  week: PomodoroPoint[];
  series: PomodoroPoint[];
  byHour: (PomodoroBucket & { hour: number })[];
  byWeekday: (PomodoroBucket & { weekday: number })[];
  byTask: (PomodoroBucket & { task: string })[];
  totalCount: number;
  totalMinutes: number;
  rangeMinutes: number;
  rangeCount: number;
  avgMinutes: number;
  streak: number;
}

export interface DayStat {
  d: DateKey;
  chars: number;
  checks: number;
  mood: number;
  fav: number;
}

export interface Overview {
  streak: number;
  activeDays: number;
  totalChars: number;
  favorites: number;
  todos: { open: number; done: number; trashed: number; done7: number };
  links: number;
  perDay: DayStat[];
  moodDist: number[];
  monthWords: { m: string; n: number }[];
  longestStreak: number;
  avgChars: number;
  maxChars: number;
  maxCharsDate: string | null;
  byWeekday: number[];
  tagTop: { tag: string; n: number }[];
  firstDate: string;
  lastDate: string;
  mediaCount: number;
  habitLogs: number;
  habitNotes: number;
  pomodoroCount: number;
  pomodoroMinutes: number;
  countdowns: number;
  templates: number;
  entries: number;
}

export interface CalendarDay {
  date: DateKey;
  chars: number;
  checks: number;
  mood: number;
  fav: number;
}

export interface Diagnostics {
  device: string;
  entries: number;
  media: number;
  todos: number;
  habits: number;
  links: number;
  pomodoro: number;
  changes: number;
  lastSeq: number;
  idTypes: Record<string, string>;
}

/** 设置项都是字符串存的，这里给个便利的读写视图 */
export interface Settings {
  theme?: string;
  round?: string;
  density?: string;
  fontSize?: number;
  lineHeight?: number;
  navWidth?: number;
  navDock?: 'left' | 'right' | 'top' | 'bottom';
  navCollapsed?: string;
  features?: string;      // JSON 字符串
  pomoPreset?: number | string;
  /** 第 17 条：新的一天从几点开始（0-6），熬夜晚睡的人设成 4 点 */
  dayStart?: number | string;
  /** 第 171 条：时区偏移，'local' 或 '+08:00' 这类 */
  timezone?: string;
  /** 第 106 条：'24' 或 '12' */
  timeFormat?: string;
  /** 第 106 条：年月日顺序 'ymd' | 'dmy' | 'mdy'。空 = 跟语言习惯走 */
  dateFormat?: string;
  [k: string]: string | number | undefined;
}

export interface Bootstrap {
  root: string;
  dbPath: string;
  mediaDir: string;
  exportDir: string;
  settings: Settings;
  modules: JournalModule[];
  tags: TagCount[];
  habits: Habit[];
  today: DateKey;
}

export interface RecFilter {
  q: string;
  from: string;
  to: string;
  mood: string;
  tag: string;
  fav: string;
  hasImg: string;
}

export type ViewKey =
  | 'today' | 'flow' | 'habits' | 'pomodoro' | 'calendar'
  | 'records' | 'todos' | 'countdown' | 'stats' | 'settings'
  | 'notes' | 'profile' | 'welcome' | 'review'
  | 'changelog' | 'manual' | 'contact' | 'media' | 'music' | 'drafts'
  | 'ledger' | 'alarms' | 'timeline' | 'draw'
  | 'themeCenter' | 'pluginCenter' | 'workshop';

/** 草稿箱里的一条 */
export interface DraftItem {
  date: string;
  title: string;
  excerpt: string;
  chars: number;
  fav: number;
  updatedAt: string;
}

/** 番茄钟洞察（参考「番茄 todo」的口径，只算能算准的） */
export interface PomoInsight {
  from: string;
  to: string;
  days: number;
  totalMinutes: number;
  sessions: number;
  activeDays: number;
  avgMinutes: number;
  todayMinutes: number;
  todaySessions: number;
  weekMinutes: number;
  monthMinutes: number;
  streak: number;
  longest: number;
  bestDate: string;
  bestMinutes: number;
  byHour: number[];
  series: { date: string; minutes: number; count: number }[];
  topTasks: { name: string; minutes: number }[];
}

/** 第 186 条：某一天的番茄明细（休息段不收） */
export interface PomoDay {
  date: string;
  totalMinutes: number;
  count: number;
  items: { ts: string; hm: string; minutes: number; task: string; id?: string }[];
  byTask: { name: string; minutes: number }[];
}

/** 哪几个月有番茄（日历的年月快跳据此打点） */
export interface PomoMonth {
  ym: string;
  count: number;
  minutes: number;
}

/** 第 182 条：日历年月快跳用的按月汇总 */
export interface CalendarMonth {
  ym: string;
  days: number;
  chars: number;
  checks: number;
  pomoMinutes: number;
}

export interface AppFacts {
  root: string;
  dbPath: string;
  entries: number;
  words: number;
  pomoDays: number;
  os: string;
  clr: string;
  today: string;
}

/* ================= v8：总结 / 回顾 ================= */

export interface SummaryRow {
  id: string;
  kind: 'day' | 'range' | string;
  fromDate: string;
  toDate: string;
  title: string;
  plain: string;
  pinned: number;
  createdAt: string;
  updatedAt: string;
  body?: string;
}

export interface ReviewDay {
  date: string;
  chars: number;
  plain: string;
  oneLine: string;
  fav: number;
  mood: number;
  weather: string;
  tags: string[];
  images: number;
  habitDone: number;
  habitTotal: number;
  pomoMinutes: number;
  pomoCount: number;
  todoDone: number;
  todoOpen: number;
  hasEntry: boolean;
  updatedAt: string;
}

export interface ReviewDayPoint {
  date: string;
  chars: number;
  oneLine: string;
  fav: number;
}

export interface ReviewRange {
  from: string;
  to: string;
  days: number;
  entries: number;
  activeDays: number;
  totalChars: number;
  avgChars: number;
  maxChars: number;
  maxCharsDate: string;
  longest: number;
  tail: number;
  moodDist: number[];
  byDay: ReviewDayPoint[];
  tagsTop: { tag: string; n: number }[];
  habitsTop: { name: string; n: number }[];
  pomoMinutes: number;
  pomoCount: number;
  todoDone: number;
  images: number;
}

/** 快速捕获窗支持的模式 */
export type QuickMode = 'diary' | 'note' | 'todo' | 'cd' | 'pomo';

/* ================= v7 ================= */

export interface Notebook {
  id: string;
  name: string;
  color: string;
  sort: number;
  count: number;
  parentId?: string;
}

/** v10：记账一笔 */
export interface LedgerItem {
  id: string;
  date: string;
  kind: 'in' | 'out' | string;
  /** 后端直接给数值（REAL），不要再当字符串解析 */
  amount: number;
  cat: string;
  note: string;
  accountId?: string;
}

export interface LedgerData {
  from: string;
  to: string;
  items: LedgerItem[];
  income: number;
  expense: number;
  balance: number;
  byCat: { cat: string; outSum: number; inSum: number }[];
  /** 按天小计，SQL 里 GROUP BY 出来的，前端直接当抬头用（§2.6） */
  days: { date: string; inSum: number; outSum: number; inN: number; outN: number; n: number }[];
  /** 收入 / 支出笔数，同样由 SQL 数 */
  inN: number;
  outN: number;
  /** 下拉用的全部分类（不受当前筛选影响） */
  allCats: string[];
}

/** v10.1：账户 */
export interface AccountItem {
  id: string;
  name: string;
  kind: string;
  init: number;
  balance: number;
  /** 本月流入 / 流出（SQL 汇总） */
  monthIn?: number;
  monthOut?: number;
  /** 第 221 条：自定义币种 / 图标 / 备注 / 启停 / 排序 */
  currency?: string;
  icon?: string;
  note?: string;
  enabled?: number;
  sort?: number;
}

/**
 * 记账本图表数据（第 205 条）。
 * 一条 RPC 把九组数一次给全 —— 画九张图发九次请求太吵，
 * 而且这些数全都是同一个月份口径，分开取容易不一致。
 */
export interface LedgerInsight {
  ym: string;
  from: string;
  to: string;
  totalOut: number;
  totalIn: number;
  byCat: { cat: string; sum: number; n: number }[];
  byDay: { date: string; day: number; outSum: number; inSum: number; n: number }[];
  byWeek: { week: number; from: string; to: string; outSum: number; inSum: number; n: number }[];
  months: { ym: string; label: string; outSum: number; inSum: number; balance: number }[];
  accounts: { id: string; name: string; balance: number }[];
  top: { id: string; date: string; amount: number; cat: string; note: string }[];
  weekday: { dow: number; sum: number }[];
  heat: { date: string; w: number; d: number; sum: number }[];
  heatFrom: string;
  heatTo: string;
  /* ---- 第 239 条新增六组 ---- */
  /** 按笔数排的分类（找"高频小额"） */
  catByCount: { cat: string; n: number; sum: number; avg: number }[];
  /** 近 12 个月 × 分类的堆叠矩阵 */
  catMonth: { ym: string; label: string; total: number; parts: { cat: string; sum: number }[] }[];
  /** 支出分档（小钱/中钱/大钱/巨款，按当月的分位数切） */
  quart: { name: string; sum: number; n: number; upTo: number }[];
  /** 星期几的场均（不是合计，避免被某个大额日带偏） */
  weekdayAvg: { dow: number; avg: number; n: number }[];
  /** 按小时分布；空数组表示这张账本没有时间戳，别画 */
  hourly: { hour: number; sum: number }[];
  /** 分类环比 */
  catTrend: { cat: string; now: number; prev: number; delta: number; pct: number | null; isNew: boolean }[];
  /** 有没有带时间的账（>0 才画 hourly） */
  hasTime: number;
}

/** v10.1：周期账单 */
export interface RecurItem {
  id: string;
  kind: string;
  amount: string;
  cat: string;
  note: string;
  accountId: string;
  day: number;
  enabled: number;
  lastMonth: string;
}

/** v10.1：打卡 / 番茄排行 */
export interface RankExtraData {
  habitTotal: number;
  habitRuns: { from: string; to: string; days: number }[];
  habitTop: { name: string; count: number }[];
  pomoTotal: number;
  pomoRuns: { from: string; to: string; days: number }[];
  pomoTop: { date: string; minutes: number; sessions: number }[];
}

/** v10：提醒 */
export interface AlarmItem {
  id: string;
  kind: string;
  title: string;
  atTime: string;
  repeat: string;
  enabled: number;
  lastFire: string;
  /** every / interval 时用：每隔多少分钟 / 隔多少天 */
  intervalMin?: number;
  /** 第 143 条：方式 '' 跟随设置 | popup 只弹窗 | sound 只响铃 | both 弹窗+响铃 | silent 静默 */
  mode?: string;
  /** 第 143 条：'' 跟随设置 | '1' 内置风铃 A | '2' 内置风铃 B | 媒体 id */
  sound?: string;
  /** 第 143 条：提前多少分钟提醒（0 / 5 / 15 / 30 / 60） */
  advance?: number;
  /** 第 143 条：贪睡到什么时候（yyyy-MM-dd HH:mm:ss），空 = 没在贪睡 */
  snoozeUntil?: string;
}

/** 诊断日志统计（diag.stats / diag.logs 的返回） */
export interface DiagStats {
  dir: string;
  file: string;
  minLevel: string;
  keepDays: number;
  total: number;
  trace: number;
  info: number;
  warn: number;
  error: number;
  fatal: number;
  writeFailures: number;
  queued: number;
  files: { name: string; bytes: number; mtime: string }[];
}

/** v10：首页打气话 */
export interface EncourageItem {
  id: string;
  kind: 'text' | 'image' | 'audio' | string;
  text: string;
  mediaId: string;
  enabled: number;
  sort: number;
}

/** v10：连续写作排行 */
export interface RankData {
  runs: { from: string; to: string; days: number }[];
  topDays: { date: string; chars: number }[];
  totalDays: number;
  best?: { from: string; to: string; days: number } | null;
}

/** v10：打卡统计 */
export interface HabitStatData {
  from: string;
  to: string;
  days: number;
  total: number;
  perDay: { date: string; done: number }[];
  ranks: { id: string; name: string; done: number }[];
}

export interface NoteRow {
  id: string;
  notebookId: string;
  title: string;
  excerpt: string;
  pinned: number;
  createdAt: string;
  updatedAt: string;
  chars: number;
  /** 第 230 条：手动顺序。只有「手动」排序模式看它 */
  sort?: number;
}

/** 第 178 条：画板列表里的元数据（不带笔画） */
export interface DrawingMeta {
  id: string;
  title: string;
  w: number;
  h: number;
  /** 缩略图的媒体 id，空 = 还没生成 */
  thumb: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 打开一块画板时读到的完整数据 */
export interface DrawingFull extends DrawingMeta {
  ok: boolean;
  /** 笔画 JSON：Stroke[] 序列化后的字符串 */
  strokes: string;
  err?: string;
}

export interface NoteDetail {
  ok: boolean;
  id: string;
  notebookId: string;
  title: string;
  body: string;
  plain: string;
  pinned: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  ok: boolean;
  id: string;
  nickname: string;
  signature: string;
  avatar: string;
  birthday: string;
  lunarBirthday: string;
  createdAt: string;
}

export type VaultScope =
  | 'app' | 'todos' | 'countdown' | 'diary' | 'diaryRange' | 'notebook' | 'note';

export interface VaultRule {
  id: string;
  scope: VaultScope | string;
  target: string;
  label: string;
  own: boolean;      // true = 这条用独立密码
}

export interface VaultStatus {
  hasMain: boolean;
  enabled: boolean;
  rules: VaultRule[];
  unlocked: { scope: string; target: string }[];
  /** 主密码提示（明文，用户自己填的） */
  hint?: string;
  /** 已设置的密保问题数量 */
  qaCount?: number;
}

export interface VaultQa {
  id: string;
  question: string;
}

export interface CacheStats {
  media: number; thumbs: number; backup: number; cache: number; db: number; wal: number;
  total: number; files: number; cacheFiles: number; cachedLinks: number;
  maxMB: number; warnMB: number; days: number;
}

export interface MusicItem {
  id: string;
  name: string;
  ext: string;
  bytes: number;
  kind: 'audio' | 'video' | string;
  url: string;
  cached: number;
  createdAt: string;
}

export interface FestivalItem {
  date: string;
  name: string;
  days: number;
  lunar: boolean;
}

/** 选项卡模式下打开的一个页面 */
export interface TabItem {
  key: string;       // 唯一键：view + 可选参数
  view: ViewKey;
  title: string;
  date?: string;
  noteId?: string;
}
