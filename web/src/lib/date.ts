export const pad = (n: number) => String(n).padStart(2, '0');

/* ============================================================================
 * 语言：这里**故意不 import** lib/i18n
 * ----------------------------------------------------------------------------
 * 依赖链是 store.ts → lib/date.ts，而 lib/i18n.ts → store.ts。
 * 如果这里再 `import { tr } from './i18n'`，就形成
 *   i18n → store → date → i18n
 * 的循环。这类循环**编译期不报错**，只在运行时某个模块先被求值时变成
 * undefined —— 这个项目为此踩过坑（见开发文档里 ui.tsx / Lock 那次）。
 *
 * 所以改成显式注入：applyAppearance 读设置后调 setLang()，
 * date.ts 自己只维护**日期相关的几个词**（今天/昨天/前天）。
 * 只重复三个词，换掉一次运行时 undefined 的风险，这笔交易划算。
 * ========================================================================== */

let LANG = 'zh-Hans';

/** 由 applyAppearance 在每次设置变化时调用 */
export function setLang(v: string | null | undefined) {
  LANG = String(v || 'zh-Hans');
}
export function getLang() { return LANG; }

/** 日期用到的三个相对日词。key 与 lib/i18n.ts 的口径保持一致 */
const DAY_WORDS: Record<string, Record<string, string>> = {
  en: { 今天: 'Today', 昨天: 'Yesterday', 前天: 'Two days ago' },
  ja: { 今天: '今日', 昨天: '昨日', 前天: '一昨日' },
  de: { 今天: 'Heute', 昨天: 'Gestern', 前天: 'Vorgestern' },
};

const dayWord = (zh: string) => DAY_WORDS[LANG]?.[zh] ?? zh;

/* ============================================================================
 * 第 106 / 171 条：时区与时间格式
 * ----------------------------------------------------------------------------
 * 之前这两个设置项只在设置页写库，没有任何代码读它 —— 填了不起作用。
 * 现在改成：设置页写入 → applyAppearance 调 setTimezone() → 下面所有
 * 取「现在」的函数都走 nowShifted()，自动跟随。
 *
 * 时区用「偏移分钟数」表示，不引入 Intl.timeZone：本机是单机应用，
 * 用户要的就是「按 +08:00 显示」，偏移量已经够用，还省掉时区数据库。
 * ========================================================================== */

let TZ_OFFSET_MIN = 0;          // 0 = 跟随本机（不偏移）
let TZ_RAW = 'local';
let HOUR12 = false;             // 第 106 条：12 小时制
let DATE_FMT = 'ymd';           // 第 106 条：年月日 / 日月年 / 月日年

/** 接受 'local' / '' / '+08:00' / '-05:30' / '8'（小时数） */
export function setTimezone(v: string | number | null | undefined) {
  const s = String(v ?? '').trim();
  TZ_RAW = s || 'local';
  if (!s || s === 'local' || s.toLowerCase() === 'auto') {
    TZ_OFFSET_MIN = 0;
    return;
  }
  const m = s.match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) { TZ_OFFSET_MIN = 0; return; }
  const sign = m[1] === '-' ? -1 : 1;
  const h = Math.min(14, Math.abs(Number(m[2])));
  const mi = Number(m[3] || 0);
  TZ_OFFSET_MIN = sign * (h * 60 + Math.min(59, mi));
}

export function getTimezone() { return TZ_RAW; }
export function isTimezoneCustom() { return TZ_OFFSET_MIN !== 0; }

export function setHour12(v: boolean | string | number) {
  HOUR12 = v === true || v === '1' || v === 1 || v === 'true' || v === '12';
}
export function getHour12() { return HOUR12; }

/**
 * 第 106 条：年月日的先后顺序。
 * 用户原话要求「既包含了年月日的时间格式」也能改 —— 中文习惯是「2026年10月26日」，
 * 但英文习惯是「10/26/2026」，还有一些人就要「26/10/2026」。
 * 三个值：ymd（年月日）/ dmy（日月年）/ mdy（月日年）。
 */
export function setDateFormat(v: string | null | undefined) {
  const s = String(v ?? '').trim().toLowerCase();
  DATE_FMT = s === 'dmy' || s === 'mdy' ? s : 'ymd';
}
export function getDateFormat() { return DATE_FMT; }

/**
 * 「现在」按用户设的时区偏移过的时间。
 * 注意：这是在 Date 上做偏移，让 getHours() 之类返回目标时区的值。
 * 只用于**显示**和「今天是哪天」的判断，不要拿去做时间戳运算。
 */
export function nowShifted(): Date {
  const d = new Date();
  if (TZ_OFFSET_MIN === 0) return d;
  // 本机偏移（分钟，东八区是 -480），换成目标偏移
  const localMin = -d.getTimezoneOffset();
  const delta = TZ_OFFSET_MIN - localMin;
  return new Date(d.getTime() + delta * 60000);
}

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 「新的一天从几点开始」。
 * 设成 4 点，凌晨 2 点写的东西仍算前一天 —— 这是熬夜写日记的人最需要的。
 * 由 applyAppearance / init 写入，所有 todayKey() 调用自动跟随。
 */
let DAY_START = 0;
export function setDayStart(hour: number | string) {
  const n = Number(hour);
  DAY_START = Number.isFinite(n) ? Math.max(0, Math.min(6, Math.round(n))) : 0;
}
export function getDayStart() {
  return DAY_START;
}

/** 按日界线算出的「今天」 */
export function todayKey(): string {
  const now = nowShifted();
  if (DAY_START > 0 && now.getHours() < DAY_START) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return ymd(d);
  }
  return ymd(now);
}

/** 真实自然日（不受日界线影响），用于「此刻」类判断 */
export const realTodayKey = () => ymd(nowShifted());

/** 距离下一次日界线还有多久（毫秒），用于跨天时刷新界面 */
export function msToNextDay(): number {
  const now = nowShifted();
  const next = new Date(now);
  next.setHours(DAY_START, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function parseKey(k: string): Date {
  const a = k.split('-').map(Number);
  return new Date(a[0], a[1] - 1, a[2]);
}

export function shiftDay(k: string, n: number): string {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000);
}

export const WD = ['日', '一', '二', '三', '四', '五', '六'];

export function weekOfMonth(d: Date): number {
  const first = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - first.getTime()) / 86400000 + first.getDay() + 1) / 7);
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * 日历格子里那种短标签。今天专门显示成「今天」。
 *
 * 加日德后要跟着语言走：
 *   zh 今天 / 10月26日     ja 今日 / 10月26日
 *   en Today / 10/26       de Heute / 26.10.
 * 只翻「今天」这个词、不翻日期格式，会变成「Today / 10月26日」这种半截混搭。
 */
export function cnDateLabel(date: string, today: string): string {
  if (date === today) return dayWord('今天');
  const x = parseKey(date);
  const lang = LANG;
  if (lang.startsWith('de')) {
    if (DATE_FMT === 'mdy') return `${pad(x.getMonth() + 1)}.${pad(x.getDate())}.`;
    return `${pad(x.getDate())}.${pad(x.getMonth() + 1)}.`;
  }
  if (lang.startsWith('en') || DATE_FMT === 'mdy') {
    return DATE_FMT === 'dmy'
      ? `${pad(x.getDate())}/${pad(x.getMonth() + 1)}`
      : `${pad(x.getMonth() + 1)}/${pad(x.getDate())}`;
  }
  if (DATE_FMT === 'dmy') return `${x.getDate()}/${x.getMonth() + 1}`;
  return `${x.getMonth() + 1}月${x.getDate()}日`;
}

/**
 * 选项卡标题用的短日期：今天 / 昨天 / 前天 / M月D日（跨年补年份）。
 * 第 173 条：同一天只开一个 tab，标题必须让人一眼看出是哪天。
 *
 * 三种语言都要有「昨天 / 前天」这两个词，否则日语界面下 tab 标题
 * 会突然蹦出中文「昨天」。
 */
export function shortDateLabel(date: string, today = todayKey()): string {
  if (date === today) return dayWord('今天');
  if (date === shiftDay(today, -1)) return dayWord('昨天');
  if (date === shiftDay(today, -2)) return dayWord('前天');
  const d = parseKey(date);
  const t = parseKey(today);
  const sameYear = d.getFullYear() === t.getFullYear();
  if (!sameYear) return fmtDate(d);
  return fmtMonthDay(d, LANG);
}

/** 现在几点（HH:mm），番茄钟/勿扰判断用。12 小时制时返回 H:mm AM/PM */
export function nowHM(): string {
  const d = nowShifted();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 第 106 条：按用户设置格式化时刻。
 *
 * 24 小时制几乎所有语言都一样（21:05）。12 小时制的「上午/下午」标法
 * 各语言不同，硬用中文会变成「PM 9:05」这种半截：
 *   zh 下午 9:05     ja 午後9:05（日语不空格）
 *   en 9:05 PM（英文把标记放后面）    de 21:05 不出 12 小时制（德语日常不用 AM/PM）
 *
 * 德语特例：德语日常口语就是 24 小时制，即使界面开了「12 小时制」
 * 也不该把 21:05 写成「9:05 nachm.」—— 那不是德语的说法。直接返回 24 小时制。
 */
export function fmtHM(hhmm: string): string {
  if (!HOUR12) return hhmm;
  if (LANG.startsWith('de')) return hhmm;
  const [h0, m] = hhmm.split(':');
  const h = Number(h0);
  if (!Number.isFinite(h)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (LANG.startsWith('en')) return `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  if (LANG.startsWith('ja')) return `${h < 12 ? '午前' : '午後'}${h12}:${m}`;
  return `${h < 12 ? '上午' : '下午'} ${h12}:${m}`;
}

/**
 * 第 229 条：日期显示顺序跟随语言习惯。
 * 第 106 条：用户还可以在设置里手动选顺序（选了就以用户为准）。
 *
 * 优先级：用户手选（DATE_FMT 不是 ymd 时） > 语言默认。
 *
 * 语言默认（加日德时逐条查过习惯写法，不是简单套用英文）：
 *   zh-Hans 2026年10月26日
 *   ja      2026年10月26日   ← 和中文同形。日语也用「年月日」，别改成斜杠
 *   en      10/26/2026       ← 月日年
 *   de      26.10.2026       ← **日月年 + 点号**。德语不用斜杠，写成 26/10/2026
 *                              虽然看得懂，但明显不像德国人写的日期
 *
 * lang 传空 → 直接按用户设置来，不看语言（老调用点都是这么用的）。
 */
export function fmtDate(d: Date | string, lang?: string): string {
  const x = typeof d === 'string' ? parseKey(d) : d;
  const y = x.getFullYear();
  const m = x.getMonth() + 1;
  const day = x.getDate();

  /* 德语固定「日月年 + 点号」，且**不受 ymd 默认值影响** ——
     德语里不存在「年月日」这种顺序，硬套 ymd 会输出 26. Okt 之外的怪东西 */
  const isDe = !!lang && lang.startsWith('de');
  if (isDe && DATE_FMT === 'ymd') return `${pad(day)}.${pad(m)}.${y}`;

  const userPicked = DATE_FMT !== 'ymd';
  const isEn = !!lang && lang.startsWith('en');
  const order = userPicked ? DATE_FMT : (isEn ? 'mdy' : 'ymd');
  /* 德语在用户手选时也用点号，其它语言用斜杠 */
  const sep = isDe ? '.' : (order === 'ymd' ? (isEn ? '/' : '') : '/');

  if (order === 'dmy') return `${pad(day)}${sep}${pad(m)}${sep}${y}`;
  if (order === 'mdy') return `${pad(m)}${sep}${pad(day)}${sep}${y}`;
  return `${y}年${m}月${day}日`;
}

/**
 * 短日期（不带年）。
 *
 * 四种语言写法各不相同，不能只有「中文 / 英文」两分支：
 *   zh  10月26日    ja  10月26日（同形）
 *   en  10/26       de  26.10.
 *
 * 德语末尾那个点是德语日期的固定写法（26.10. = 26. Oktober），
 * 少了它就不像德语。
 */
export function fmtMonthDay(d: Date | string, lang = 'zh'): string {
  const x = typeof d === 'string' ? parseKey(d) : d;
  const m = x.getMonth() + 1;
  const day = x.getDate();
  if (lang.startsWith('de')) return `${pad(day)}.${pad(m)}.`;
  if (lang.startsWith('en')) return `${pad(m)}/${pad(day)}`;
  return `${m}月${day}日`;
}

/**
 * 年月（不带日）。第 229 条顺带修的一个真 bug：
 * 统计页「按月的字数」原来拿 `2026-10-01` 去走 fmtMonthDay，渲染成「10月1日」，
 * 而注释承诺的是「2026年10月」。月份序列根本不该有「日」。
 *
 * 接受 `2026-10` / `2026-10-01` 两种写法，只取年月。
 */
export function fmtYearMonth(ym: string | Date, lang = 'zh'): string {
  let y: number, m: number;
  if (ym instanceof Date) {
    y = ym.getFullYear(); m = ym.getMonth() + 1;
  } else {
    const a = String(ym).split('-').map(Number);
    if (!a[0] || !a[1]) return String(ym);
    y = a[0]; m = a[1];
  }
  /* 德语：Oktober 2026 —— 用月份名，不用数字。德语里「10/2026」读起来像分数 */
  if (lang.startsWith('de')) return `${DE_MONTHS[m - 1] || m} ${y}`;
  if (lang.startsWith('en')) return `${pad(m)}/${y}`;
  return `${y}年${m}月`;
}

/**
 * 德语月份名。
 *
 * 德语日期和英文不同，月份习惯**写全名**而不是数字 ——
 * 「26. Oktober 2026」是标准写法，「26.10.2026」只在表格里用。
 * 年份刻度这种需要短的地方用数字月份，其它地方用这个名字。
 */
const DE_MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/**
 * 「距离下次轮换还有多久」这类相对时长，以及设置页里那句「当前时区」的说明。
 * 第 171 条：时区预设列表放这里，设置页直接渲染，避免两边各写一份对不上。
 */
export const TZ_PRESETS: [string, string][] = [
  ['local', '跟随本机'],
  ['+08:00', '中国标准时间 UTC+8'],
  ['+09:00', '日本 / 韩国 UTC+9'],
  ['+07:00', '曼谷 / 雅加达 UTC+7'],
  ['+05:30', '印度 UTC+5:30'],
  ['+04:00', '迪拜 UTC+4'],
  ['+01:00', '中欧 UTC+1'],
  ['+00:00', '格林尼治 UTC+0'],
  ['-05:00', '美东 UTC-5'],
  ['-08:00', '美西 UTC-8'],
  ['-10:00', '夏威夷 UTC-10'],
];

/** "22:00" 与 "07:00" 之间的区间判断，支持跨零点 */
export function inHMWindow(from: string, to: string, cur = nowHM()): boolean {
  if (!from || !to) return false;
  if (from <= to) return cur >= from && cur < to;
  return cur >= from || cur < to;   // 22:00 - 07:00 跨天
}
