export const pad = (n: number) => String(n).padStart(2, '0');

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

export function cnDateLabel(date: string, today: string): string {
  if (date === today) return '今天';
  const x = parseKey(date);
  // 第 229 条：这里原来写死「M月D日」。这是**不带年**的短标签，
  // 所以不能直接借 fmtDate（那会补出年份撑爆一行），只把顺序拆出来。
  if (DATE_FMT === 'dmy') return `${x.getDate()}/${x.getMonth() + 1}`;
  if (DATE_FMT === 'mdy') return `${x.getMonth() + 1}/${x.getDate()}`;
  return `${x.getMonth() + 1}月${x.getDate()}日`;
}

/**
 * 选项卡标题用的短日期：今天 / 昨天 / 前天 / M月D日（跨年补年份）。
 * 第 173 条：同一天只开一个 tab，标题必须让人一眼看出是哪天。
 */
export function shortDateLabel(date: string, today = todayKey()): string {
  if (date === today) return '今天';
  if (date === shiftDay(today, -1)) return '昨天';
  if (date === shiftDay(today, -2)) return '前天';
  const d = parseKey(date);
  const t = parseKey(today);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === t.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** 现在几点（HH:mm），番茄钟/勿扰判断用。12 小时制时返回 H:mm AM/PM */
export function nowHM(): string {
  const d = nowShifted();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 第 106 条：按用户设置格式化时刻。
 * 24 小时制 → 21:05；12 小时制 → 下午 9:05（中文习惯不用 AM/PM 缩写）。
 */
export function fmtHM(hhmm: string): string {
  if (!HOUR12) return hhmm;
  const [h0, m] = hhmm.split(':');
  const h = Number(h0);
  if (!Number.isFinite(h)) return hhmm;
  const ap = h < 12 ? '上午' : '下午';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ap} ${h12}:${m}`;
}

/**
 * 第 229 条：日期显示顺序跟随语言习惯。
 * 第 106 条：用户还可以在设置里手动选顺序（选了就以用户为准）。
 *
 * 优先级：用户手选（DATE_FMT 不是 ymd 时） > 语言默认。
 * 语言默认：zh 用「2026年10月26日」，en 用「10/26/2026」。
 *
 * lang 传空 → 直接按用户设置来，不看语言（老调用点都是这么用的）。
 */
export function fmtDate(d: Date | string, lang?: string): string {
  const x = typeof d === 'string' ? parseKey(d) : d;
  const y = x.getFullYear();
  const m = x.getMonth() + 1;
  const day = x.getDate();

  const userPicked = DATE_FMT !== 'ymd';
  const isEn = !!lang && lang.startsWith('en');
  const order = userPicked ? DATE_FMT : (isEn ? 'mdy' : 'ymd');
  const sep = order === 'ymd' ? (isEn ? '/' : '') : '/';

  if (order === 'dmy') return `${pad(day)}${sep}${pad(m)}${sep}${y}`;
  if (order === 'mdy') return `${pad(m)}${sep}${pad(day)}${sep}${y}`;
  return `${y}年${m}月${day}日`;
}

/** 短日期（不带年）：中文 10月26日 / 英文 10/26 */
export function fmtMonthDay(d: Date | string, lang = 'zh'): string {
  const x = typeof d === 'string' ? parseKey(d) : d;
  const m = x.getMonth() + 1;
  const day = x.getDate();
  return lang.startsWith('en') ? `${pad(m)}/${pad(day)}` : `${m}月${day}日`;
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
  if (lang.startsWith('en')) return `${pad(m)}/${y}`;
  return `${y}年${m}月`;
}

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
