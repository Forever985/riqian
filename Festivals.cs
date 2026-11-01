using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Riqian
{
    /// <summary>
    /// 节日与农历工具。
    /// 农历转换直接用 .NET 内置的 ChineseLunisolarCalendar（支持 1901-2100），
    /// 不自己维护 200 多项的 lunarInfo 表 —— 那种表错一项就差一天，且极难发现。
    /// </summary>
    public static class Festivals
    {
        private static readonly ChineseLunisolarCalendar Lunar = new ChineseLunisolarCalendar();

        /* ---------------- 农历基础 ---------------- */

        /// <summary>农历 → 公历。闰月用 isLeap 指定；该年没有这个闰月时自动退回普通月。</summary>
        public static DateTime? LunarToSolar(int lunarYear, int lunarMonth, int lunarDay, bool isLeap = false)
        {
            try
            {
                if (lunarYear < 1901 || lunarYear > 2100) return null;
                if (lunarMonth < 1 || lunarMonth > 12 || lunarDay < 1 || lunarDay > 30) return null;

                int leap = Lunar.GetLeapMonth(lunarYear);          // 0 = 无闰月；否则为「闰几月」的序号（含前置偏移）
                int month = lunarMonth;
                if (leap > 0)
                {
                    // GetLeapMonth 返回的是带偏移的序号：闰 4 月会返回 5
                    if (isLeap) month = leap;                       // 闰月本身
                    else if (lunarMonth >= leap) month = lunarMonth + 1;
                }
                return Lunar.ToDateTime(lunarYear, month, lunarDay, 0, 0, 0, 0);
            }
            catch { return null; }
        }

        /// <summary>公历 → 农历，返回 (年, 月, 日, 是否闰月)。</summary>
        public static (int year, int month, int day, bool leap)? SolarToLunar(DateTime d)
        {
            try
            {
                int y = Lunar.GetYear(d), m = Lunar.GetMonth(d), dd = Lunar.GetDayOfMonth(d);
                int leap = Lunar.GetLeapMonth(y);
                bool isLeap = leap > 0 && m == leap;
                int realMonth = (leap > 0 && m >= leap) ? m - 1 : m;
                return (y, realMonth, dd, isLeap);
            }
            catch { return null; }
        }

        /// <summary>今年（或指定年）农历某月某日对应的公历日期；已过则取明年。</summary>
        public static DateTime? NextLunar(int month, int day, DateTime from, bool isLeap = false)
        {
            for (int i = 0; i < 3; i++)
            {
                var d = LunarToSolar(from.Year + i, month, day, isLeap);
                if (d.HasValue && d.Value.Date >= from.Date) return d;
            }
            return null;
        }

        public static string LunarText(DateTime d)
        {
            var l = SolarToLunar(d);
            if (l == null) return "";
            return $"农历{l.Value.month}月{l.Value.day}日";
        }

        /* ---------------- 节日 ---------------- */

        // 公历固定节日：(月, 日, 名称)
        private static readonly (int m, int d, string name)[] SolarFixed =
        {
            (1, 1, "元旦"), (2, 14, "情人节"), (3, 8, "妇女节"), (3, 12, "植树节"),
            (4, 1, "愚人节"), (5, 1, "劳动节"), (5, 4, "青年节"), (5, 12, "护士节"),
            (6, 1, "儿童节"), (7, 1, "建党节"), (8, 1, "建军节"), (9, 10, "教师节"),
            (10, 1, "国庆节"), (12, 24, "平安夜"), (12, 25, "圣诞节"), (12, 31, "跨年夜"),
        };

        // 农历节日：(月, 日, 名称)
        private static readonly (int m, int d, string name)[] LunarFixed =
        {
            (1, 1, "春节"), (1, 15, "元宵节"), (2, 2, "龙抬头"), (5, 5, "端午节"),
            (7, 7, "七夕"), (7, 15, "中元节"), (8, 15, "中秋节"), (9, 9, "重阳节"),
            (12, 8, "腊八节"), (12, 23, "小年"),
        };

        /// <summary>某天命中的节日名（可能多个）。除夕单独按「腊月最后一天」判断。</summary>
        public static List<string> On(DateTime d)
        {
            var list = new List<string>();
            foreach (var f in SolarFixed)
                if (d.Month == f.m && d.Day == f.d) list.Add(f.name);

            var l = SolarToLunar(d);
            if (l != null)
            {
                foreach (var f in LunarFixed)
                    if (l.Value.month == f.m && l.Value.day == f.d && !l.Value.leap) list.Add(f.name);

                // 除夕 = 腊月最后一天（可能是二十九，也可能是三十）
                if (l.Value.month == 12 && !l.Value.leap)
                {
                    var next = d.AddDays(1);
                    var nl = SolarToLunar(next);
                    if (nl != null && nl.Value.month == 1 && nl.Value.day == 1) list.Add("除夕");
                }
            }
            return list;
        }

        /// <summary>接下来 N 天内的节日（含今天），用于欢迎页与倒计时提示。</summary>
        public static List<object> Upcoming(DateTime from, int days = 30, int lunarBirthdayMonth = 0, int lunarBirthdayDay = 0)
        {
            var res = new List<object>();
            for (int i = 0; i < days; i++)
            {
                var d = from.Date.AddDays(i);
                foreach (var name in On(d))
                    res.Add(new { date = d.ToString("yyyy-MM-dd"), name, days = i, lunar = LunarFixed.Any(f => f.name == name) });
            }
            if (lunarBirthdayMonth > 0 && lunarBirthdayDay > 0)
            {
                var b = NextLunar(lunarBirthdayMonth, lunarBirthdayDay, from);
                if (b.HasValue && (b.Value.Date - from.Date).TotalDays < days)
                    res.Add(new { date = b.Value.ToString("yyyy-MM-dd"), name = "农历生日", days = (int)(b.Value.Date - from.Date).TotalDays, lunar = true });
            }
            return res.OrderBy(x => (int)x.GetType().GetProperty("days").GetValue(x)).ToList();
        }

        /// <summary>是否周末（用于日历着色）。</summary>
        public static bool IsWeekend(DateTime d) => d.DayOfWeek == DayOfWeek.Saturday || d.DayOfWeek == DayOfWeek.Sunday;
    }
}
