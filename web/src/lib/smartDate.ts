/**
 * 智能日期识别（参考滴答清单的规则表）。
 * 目标：输入「每年3月6日 妈妈生日」「每月1号交房租」「农历八月十五」「每2周复盘」
 * 都能拆成 标题 + 日期 + 时间 + 重复规则，不需要手点日历。
 */

export type Repeat =
  | '' | 'daily' | 'weekly' | 'weekday' | 'weekend'
  | 'monthly' | 'monthly-last' | 'monthly-weekday'
  | 'yearly' | 'lunar-yearly' | 'lunar-monthly';

export interface SmartDate {
  title: string;
  due: string | null;
  time: string;
  repeat: Repeat;
  interval?: number;
  lunarMonth?: number;
  lunarDay?: number;
  /**
   * 第 192 条：「每月最后一个周四」这类规则要记两件事——
   * 第几个（1–4，-1 表示最后一个）和星期几（0=周日）。
   * 光有 repeat='monthly-weekday' 算不出日子。
   */
  nth?: number;
  weekday?: number;
  /** 给界面的一句说明，例如「每年 3 月 6 日」 */
  hint?: string;
}

const D: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  十: 10, 廿: 20, 卅: 30,
};

/** 中文数字 → 阿拉伯数字，支持 十五 / 二十五 / 廿五 / 初八 / 三十 */
export function cnNum(s: string | undefined): number {
  if (s == null) return NaN;
  let t = String(s).trim().replace(/^初/, '');
  if (!t) return NaN;
  if (/^\d+$/.test(t)) return Number(t);
  if (t.length === 1) return D[t] ?? NaN;
  if (t[0] === '廿') return 20 + (D[t[1]] ?? 0);
  if (t[0] === '卅') return 30 + (D[t[1]] ?? 0);
  const i = t.indexOf('十');
  if (i >= 0) {
    const a = i === 0 ? 1 : (D[t.slice(0, i)] ?? NaN);
    const b = i === t.length - 1 ? 0 : (D[t.slice(i + 1)] ?? NaN);
    if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
    return a * 10 + b;
  }
  return NaN;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 本月（或下月）的第 n 天，保证不越界 */
function monthDay(base: Date, day: number, rollNext: boolean): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), Math.min(day, 28));
  // 先按 28 号建，再修正到实际天数，避免 2 月 30 号这类溢出
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  if (rollNext && d < base) d.setMonth(d.getMonth() + 1);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (d.getDate() > dim) d.setDate(dim);
  return d;
}

/** 数字 / 中文都可的「N」分组，用于正则 */
const N = '(\\d{1,2}|[一二两三四五六七八九十廿卅]{1,3})';

/** 星期几：一…六 / 日 / 天 */
const WD_CH = '(一|二|三|四|五|六|日|天)';
const WD_MAP: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const WD_NAME = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 第 192 条：算出「某月第 n 个周 w」是哪天，n = -1 表示最后一个。
 *
 * ⚠️ 不能写成「1 号往后找第一个周 w 再加 7×(n-1)」——那对「最后一个」会算到隔月去，
 * 「最后」必须从**月末**倒着找。
 * ⚠️ 第 5 个不一定存在（例如某月只有 4 个周四），越界就退到当月最后一个该周几。
 */
export function nthWeekdayOfMonth(y: number, m0: number, w: number, n: number): Date {
  const dim = new Date(y, m0 + 1, 0).getDate();
  const last = new Date(y, m0, dim);
  const back = (last.getDay() - w + 7) % 7;

  if (n === -1) return new Date(y, m0, dim - back);

  const first = new Date(y, m0, 1);
  const fwd = (w - first.getDay() + 7) % 7;
  const day = 1 + fwd + 7 * (Math.max(1, n) - 1);
  // 越界 = 这个月没有第 n 个该周几，退到最后一个
  return day > dim ? new Date(y, m0, dim - back) : new Date(y, m0, day);
}

/** 下一个「每月第 n 个周 w」，今天或之后；最多往后找 13 个月 */
function nextMonthlyWeekday(today: Date, w: number, n: number): Date {
  for (let i = 0; i <= 12; i++) {
    const base = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const cand = nthWeekdayOfMonth(base.getFullYear(), base.getMonth(), w, n);
    if (cand >= today) return cand;
  }
  return today;
}

export function parseSmartDate(text: string): SmartDate {
  const raw = text || '';
  let due: string | null = null;
  let time = '';
  let period = '';
  let repeat: Repeat = '';
  let interval: number | undefined;
  let lunarMonth: number | undefined;
  let lunarDay: number | undefined;
  /* 第 192 条：每月第 N 个周几 */
  let nthWeek: number | undefined;
  let weekday: number | undefined;
  let hint = '';
  let rest = ` ${raw} `;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eat = (m: string) => { rest = rest.replace(m, ' '); };

  /* ---------- ⓪ 农历（优先级最高，否则「八月十五」会被当成公历） ---------- */
  const lunar = rest.match(new RegExp(`(农历|阴历)\\s*${N}?\\s*月\\s*${N}\\s*[日号]?`));
  if (lunar) {
    lunarMonth = cnNum(lunar[2]);
    lunarDay = cnNum(lunar[3]);
    if (Number.isNaN(lunarMonth) || lunarMonth < 1 || lunarMonth > 12) lunarMonth = undefined;
    if (Number.isNaN(lunarDay) || lunarDay < 1 || lunarDay > 30) lunarDay = undefined;
    repeat = 'lunar-yearly';
    hint = lunarMonth && lunarDay ? `农历${lunarMonth}月${lunarDay}日 · 每年` : '农历每年';
    eat(lunar[0]);
  }
  const lunarMonthly = !repeat && rest.match(/(农历|阴历)\s*每\s*月\s*([一二三四五六七八九十廿卅\d]{1,3})\s*[日号]?/);
  if (lunarMonthly) {
    lunarDay = cnNum(lunarMonthly[2]);
    repeat = 'lunar-monthly';
    hint = `农历每月${lunarDay}日`;
    eat(lunarMonthly[0]);
  }

  /* ---------- ① 重复规则（先吃掉，剩下的日期才不会被误判） ---------- */
  if (!repeat) {
    // 每天 / 每日
    const mDaily = rest.match(/(每\s*天|每\s*日|每天|每日)/);
    // 每 N 天 / 每隔 N 天
    const mEveryN = rest.match(new RegExp(`每\\s*(?:隔)?\\s*${N}\\s*天`));
    // 每 N 周
    const mEveryW = rest.match(new RegExp(`每\\s*(?:隔)?\\s*${N}\\s*(?:周|个?星期)`));
    // 每个工作日
    const mWork = rest.match(/(每\s*个?工作日|工作日每天)/);
    // 每周末
    const mWeekend = rest.match(/(每\s*周末|每个周末)/);
    // 每周一
    const mWeek = rest.match(new RegExp(`每\\s*(?:周|个?星期|礼拜)${N}`));
    // 每月第N天 / 每月N号 / 每月最后一天
    const mMonthLast = rest.match(/(每月|每个月)\s*最后\s*(一天|1天|[日号])/);
    /*
     * 第 192 条：「每月最后一个周四」「每月第二个周二」「每个月最后 1 个星期五」。
     * 必须排在 mMonth **前面**——mMonth 的 `每月 + N` 会把「最后一个周四」里的
     * 数字当日子吃掉，结果变成「每月 1 日」。
     *
     * 这个正则被改了三轮才对，记下坑在哪（都是「个/一」这两个字被别的分组抢走）：
     *   1. 前缀写 `每个?月`，`每个月` 会整段被吃进前缀 → 改 `每\s*个?\s*月`。
     *   2. 「最后 1 个星期五」的 最后 与 个 之间夹着个 1 → 「最后」后允许可选数字。
     *   3. 关键的一个：`月` 后面的 `个?` 会把「最后**一个**周四」的那个「个」先吃掉，
     *      接着 `一?` 再吃掉「一」，轮到要匹配「周」时已经没有字了 → 失败。
     *      解法是让「个」「一」各自可重复（`[个一]*`），谁先吃掉都无所谓。
     *      「每月第二个周二」「每月第一个周一」能过、「每月最后一个周四」不能过，
     *      就是这个区别 —— 只测前两个会漏掉这个 bug。
     */
    const mMonthWD = rest.match(
      new RegExp(
        `每\\s*个?\\s*月\\s*第?\\s*(?:(最后|末)(?:\\s*\\d\\s*)?|${N})[个一\\s]*(?:周|星期|礼拜)\\s*${WD_CH}`,
      ),
    );
    const mMonth = rest.match(new RegExp(`(每月|每个月|每个?月)\\s*(?:第)?\\s*${N}\\s*[日号天]?`));
    // 每年M月D日 / 每个M月
    const mYear = rest.match(new RegExp(`(每年|每个)\\s*${N}\\s*月\\s*${N}?\\s*[日号]?`));
    const mYearMonthOnly = rest.match(new RegExp(`(每年|每个)\\s*${N}\\s*月`));

    if (mEveryN) {
      const n = cnNum(mEveryN[1]);
      repeat = 'daily';
      interval = Number.isNaN(n) ? 1 : Math.max(1, n);
      hint = `每 ${interval} 天`;
      eat(mEveryN[0]);
      due = ymd(today);
    } else if (mEveryW) {
      const n = cnNum(mEveryW[1]);
      repeat = 'weekly';
      interval = Number.isNaN(n) ? 1 : Math.max(1, n);
      hint = `每 ${interval} 周`;
      eat(mEveryW[0]);
      due = ymd(today);
    } else if (mWork) {
      repeat = 'weekday';
      hint = '每个工作日';
      eat(mWork[0]);
      const d = new Date(today);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      due = ymd(d);
    } else if (mWeekend) {
      repeat = 'weekend';
      hint = '每周末';
      eat(mWeekend[0]);
      const d = new Date(today);
      while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
      due = ymd(d);
    } else if (mMonthLast) {
      repeat = 'monthly-last';
      hint = '每月最后一天';
      eat(mMonthLast[0]);
      const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      due = ymd(d);
    } else if (mMonthWD) {
      /*
       * 第 192 条。分组：1=最后|末（没有就是 undefined）2=N 3=周几
       * 「最后/末」记成 nth=-1，其余走 cnNum。
       */
      const isLast = !!mMonthWD[1];
      const nthRaw = mMonthWD[2];
      const w = WD_MAP[mMonthWD[3]];
      const nth = isLast ? -1 : cnNum(nthRaw);
      if (w != null && !Number.isNaN(nth) && (nth === -1 || (nth >= 1 && nth <= 5))) {
        repeat = 'monthly-weekday';
        nthWeek = nth;
        weekday = w;
        const d = nextMonthlyWeekday(today, w, nth);
        due = ymd(d);
        hint = nth === -1
          ? `每月最后一个周${WD_NAME[w]}`
          : `每月第 ${nth} 个周${WD_NAME[w]}`;
        eat(mMonthWD[0]);
      }
    } else if (mYear && cnNum(mYear[2]) >= 1) {
      const mm = cnNum(mYear[2]);
      const dd = mYear[3] ? cnNum(mYear[3]) : 1;
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        repeat = 'yearly';
        const d = new Date(today.getFullYear(), mm - 1, Math.min(dd, 28));
        d.setDate(Math.min(dd, new Date(d.getFullYear(), mm, 0).getDate()));
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        due = ymd(d);
        hint = `每年 ${mm} 月 ${dd} 日`;
        eat(mYear[0]);
      }
    } else if (mYearMonthOnly && cnNum(mYearMonthOnly[2]) >= 1) {
      const mm = cnNum(mYearMonthOnly[2]);
      repeat = 'yearly';
      const d = new Date(today.getFullYear(), mm - 1, 1);
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      due = ymd(d);
      hint = `每年 ${mm} 月 1 日`;
      eat(mYearMonthOnly[0]);
    } else if (mMonth) {
      const dd = cnNum(mMonth[2]);
      if (dd >= 1 && dd <= 31) {
        repeat = 'monthly';
        const d = monthDay(today, dd, true);
        due = ymd(d);
        hint = `每月 ${dd} 日`;
        eat(mMonth[0]);
      }
    } else if (mWeek) {
      const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
      const w = map[String(cnNum(mWeek[1]))] ?? map[mWeek[1]];
      if (w != null) {
        repeat = 'weekly';
        const cur = today.getDay();
        let diff = (w - cur + 7) % 7;
        if (diff === 0) diff = 7;
        const d = new Date(today);
        d.setDate(d.getDate() + diff);
        due = ymd(d);
        hint = `每周${['日', '一', '二', '三', '四', '五', '六'][w]}`;
        eat(mWeek[0]);
      }
    } else if (mDaily) {
      repeat = 'daily';
      due = ymd(today);
      hint = '每天';
      eat(mDaily[0]);
    }
  }

  /* ---------- ② 相对日（明天 / 后天 / N天后 / 明晚） ---------- */
  if (!due) {
    const rel: [string, number, string][] = [
      ['大后天', 3, ''], ['后天', 2, ''], ['明天', 1, ''], ['明日', 1, ''],
      ['明晚', 1, '晚上'], ['明早', 1, '早上'],
      ['今晚', 0, '晚上'], ['今夜', 0, '晚上'], ['今早', 0, '早上'],
      ['今天', 0, ''], ['今日', 0, ''],
    ];
    for (const [w, n, p] of rel) {
      if (rest.includes(w)) {
        const d = new Date(today);
        d.setDate(d.getDate() + n);
        due = ymd(d);
        if (p) period = p;
        eat(w);
        break;
      }
    }
  }
  if (!due) {
    const m = rest.match(new RegExp(`${N}\\s*天\\s*[后之以]`));
    if (m) { const d = new Date(today); d.setDate(d.getDate() + (cnNum(m[1]) || 0)); due = ymd(d); eat(m[0]); }
  }
  if (!due) {
    const m = rest.match(new RegExp(`${N}\\s*(?:周|个?星期)\\s*[后之以]`));
    if (m) { const d = new Date(today); d.setDate(d.getDate() + (cnNum(m[1]) || 0) * 7); due = ymd(d); eat(m[0]); }
  }
  if (!due) {
    const m = rest.match(new RegExp(`${N}\\s*个?\\s*月\\s*[后之以]`));
    if (m) { const d = new Date(today); d.setMonth(d.getMonth() + (cnNum(m[1]) || 0)); due = ymd(d); eat(m[0]); }
  }

  /* ---------- ③ 周几 ---------- */
  if (!due) {
    const m = rest.match(/(下周|下个?星期|本周|这周|周|星期|礼拜)([一二三四五六日天])/);
    if (m) {
      const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
      const target = map[m[2]];
      const cur = today.getDay();
      let diff = (target - cur + 7) % 7;
      if (m[1].startsWith('下')) diff += 7;
      if (diff === 0 && !m[1].startsWith('下')) diff = 7;
      const d = new Date(today);
      d.setDate(d.getDate() + diff);
      due = ymd(d);
      eat(m[0]);
    }
  }

  /* ---------- ④ 具体公历日期 ---------- */
  if (!due) {
    // 带年份：2027年10月1日 / 2027-10-01
    let my = rest.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (my) {
      const y = Number(my[1]); const mm = Number(my[2]); const dd = Number(my[3]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const d = new Date(y, mm - 1, 1);
        d.setDate(Math.min(dd, new Date(y, mm, 0).getDate()));
        due = ymd(d);
        eat(my[0]);
      }
    }
    if (!due) {
      my = rest.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?![\d:：])/);
      if (my) {
        const d = new Date(Number(my[1]), Number(my[2]) - 1, Number(my[3]));
        if (!Number.isNaN(d.getTime())) { due = ymd(d); eat(my[0]); }
      }
    }
  }
  if (!due) {
    let m = rest.match(new RegExp(`${N}\\s*月\\s*${N}\\s*[日号]?`));
    if (m) {
      const mm = cnNum(m[1]); const dd = cnNum(m[2]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const d = new Date(today.getFullYear(), mm - 1, 1);
        d.setDate(Math.min(dd, new Date(d.getFullYear(), mm, 0).getDate()));
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        due = ymd(d);
        eat(m[0]);
      }
    } else {
      m = rest.match(/(\d{1,2})[-/](\d{1,2})(?![\d:：])/);
      if (m) {
        const d = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]));
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        due = ymd(d);
        eat(m[0]);
      }
    }
  }

  /* ---------- ⑤ 时段 ---------- */
  const per = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)/.exec(rest);
  if (per && !period) period = per[1];

  /* ---------- ⑥ 时间点（支持中文数字：三点、十点半、晚上八点） ---------- */
  const fixHour = (h: number) => {
    let hh = h;
    if (/下午|傍晚|晚上|夜里/.test(period) && hh < 12) hh += 12;
    if (period === '中午' && hh < 12) hh += 12;
    if (period === '凌晨' && hh === 12) hh = 0;
    return Math.min(23, hh);
  };

  let m2 = rest.match(/(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[:：]\s*(\d{2})/);
  if (m2) {
    const h = fixHour(cnNum(m2[1]) || 0);
    time = `${pad(h)}:${pad(Math.min(59, Number(m2[2]) || 0))}`;
    eat(m2[0]);
  } else {
    m2 = rest.match(/(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[点時时]\s*(半|[一二三四五六七八九十\d]{1,3}\s*分)?/);
    if (m2) {
      const h = fixHour(cnNum(m2[1]) || 0);
      let mi = 0;
      if (m2[2] === '半') mi = 30;
      else if (m2[2]) mi = cnNum(m2[2].replace(/[分\s]/g, '')) || 0;
      time = `${pad(h)}:${pad(Math.min(59, mi))}`;
      eat(m2[0]);
    }
  }
  if (per) eat(per[0]);

  const title = rest.replace(/\s{2,}/g, ' ').replace(/^[\s,，、。:：]+|[\s,，、。:：]+$/g, '').trim();
  return {
    title: title || raw.trim(),
    due,
    time,
    repeat,
    interval,
    lunarMonth,
    lunarDay,
    nth: nthWeek,
    weekday,
    hint: hint || undefined,
  };
}

/**
 * 第 192 条：把 SmartDate 的重复规则编码成入库字符串。
 *
 * `monthly-weekday` 光有类型算不出日子，必须带上「第几个」和「周几」，
 * 所以编码成 `monthly-weekday:<nth>:<weekday>`（nth = -1 表示最后一个）。
 * 其余规则原样返回，老数据不受影响。
 *
 * 后端 Db.cs 的 Countdowns() 里按同样的格式解析——两边必须同步改。
 */
export function repeatCode(p: Pick<SmartDate, 'repeat' | 'nth' | 'weekday'>): string {
  if (p.repeat === 'monthly-weekday') {
    const nth = p.nth ?? -1;
    const w = p.weekday ?? 0;
    return `monthly-weekday:${nth}:${w}`;
  }
  return p.repeat || '';
}

/** `monthly-weekday:1:4` → 人能读的「每月第 1 个周四」 */
export function repeatCodeLabel(code: string): string {
  const m = /^monthly-weekday:(-?\d+):(\d)$/.exec(code || '');
  if (!m) return '';
  const nth = Number(m[1]);
  const w = Number(m[2]);
  return nth === -1 ? `每月最后一个周${WD_NAME[w]}` : `每月第 ${nth} 个周${WD_NAME[w]}`;
}

/** 重复规则的中文说明，列表里显示 */
export function repeatLabel(r: string, interval?: number): string {
  // 第 192 条：带参数的编码先拆，否则会落到 default 显示成空
  if (r && r.startsWith('monthly-weekday:')) return repeatCodeLabel(r);
  switch (r) {
    case 'daily': return interval && interval > 1 ? `每 ${interval} 天` : '每天';
    case 'weekly': return interval && interval > 1 ? `每 ${interval} 周` : '每周';
    case 'weekday': return '每个工作日';
    case 'weekend': return '每周末';
    case 'monthly': return '每月';
    case 'monthly-last': return '每月最后一天';
    case 'monthly-weekday': return '每月第 N 个周几';
    case 'yearly': return '每年';
    case 'lunar-yearly': return '每年（农历）';
    case 'lunar-monthly': return '每月（农历）';
    default: return '';
  }
}
