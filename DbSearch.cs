using System;
using System.Collections.Generic;
using System.Linq;

namespace Riqian
{
    public partial class Db
    {
        /* ================================================================== */
        /* 第 117 条：跨模块多元搜索                                          */
        /* ================================================================== */

        /// <summary>命中位置附近截一小段，作为搜索结果里的摘要</summary>
        private static string Snippet(string text, string q, int around = 55)
        {
            var s = (text ?? "").Replace("\r", " ").Replace("\n", " ").Replace("\t", " ").Trim();
            if (q.Length > 0)
            {
                // 压缩连续空格，正文里成片的空白在结果里没有意义
                while (s.Contains("  ")) s = s.Replace("  ", " ");
            }
            if (s.Length <= around * 2) return s;
            var i = s.IndexOf(q, StringComparison.OrdinalIgnoreCase);
            if (i < 0) return s.Substring(0, around * 2) + "…";
            var from = Math.Max(0, i - around);
            var len = Math.Min(s.Length - from, around * 2);
            return (from > 0 ? "…" : "") + s.Substring(from, len) + (from + len < s.Length ? "…" : "");
        }

        private string Meta(string k, string def = "") 
        {
            var r = Rows("SELECT v FROM meta WHERE k=$k", ("$k", k));
            return r.Count == 0 ? def : Str(r[0]["v"]);
        }

        private void MetaSet(string k, string v) =>
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES($k,$v)", ("$k", k), ("$v", v));

        /// <summary>
        /// 一次搜遍所有内容：日记、笔记、总结、待办、打卡、记账、提醒、倒数日。
        ///
        /// 每种来源各自 LIMIT，最后合并 —— 不能先合并再排，否则某一类内容多的时候
        /// 会把别的类型全挤掉，用户搜「跑步」只想找待办，结果满屏日记。
        /// </summary>
        public object SearchAll(string q, int per)
        {
            q = (q ?? "").Trim();
            if (q.Length == 0) return new List<object>();
            if (per <= 0 || per > 20) per = 6;

            var like = "%" + q + "%";
            var hits = new List<object>();

            void Add(string kind, string id, string title, string sub, string snippet, string date)
            {
                hits.Add(new { kind, id, title, sub, snippet, date });
            }

            try
            {
                foreach (var r in Rows(
                    @"SELECT date, IFNULL(title,'') AS title, IFNULL(plain,'') AS plain
                      FROM entries
                      WHERE IFNULL(deleted_at,0)=0
                        AND (IFNULL(plain,'') LIKE $q OR IFNULL(title,'') LIKE $q)
                      ORDER BY date DESC LIMIT $n", ("$q", like), ("$n", per)))
                {
                    var d = Str(r["date"]);
                    var t = Str(r["title"]);
                    Add("entry", d, t.Length > 0 ? t : d, d, Snippet(Str(r["plain"]), q), d);
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            try
            {
                foreach (var r in Rows(
                    @"SELECT n.id AS id, IFNULL(n.title,'') AS title, IFNULL(n.plain,'') AS plain,
                             IFNULL(n.updated_at,'') AS updated_at, IFNULL(nb.name,'') AS book
                      FROM notes n LEFT JOIN notebooks nb ON nb.id = n.notebook_id
                      WHERE IFNULL(n.deleted_at,0)=0
                        AND (IFNULL(n.plain,'') LIKE $q OR IFNULL(n.title,'') LIKE $q)
                      ORDER BY n.updated_at DESC LIMIT $n", ("$q", like), ("$n", per)))
                {
                    var book = Str(r["book"]);
                    Add("note", Str(r["id"]), Str(r["title"]).Length > 0 ? Str(r["title"]) : "（无标题笔记）",
                        book.Length > 0 ? book : "笔记", Snippet(Str(r["plain"]), q), Str(r["updated_at"]));
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            try
            {
                foreach (var r in Rows(
                    @"SELECT id, title, IFNULL(note,'') AS note, done, IFNULL(due,'') AS due
                      FROM todos
                      WHERE IFNULL(deleted_at,0)=0 AND IFNULL(trashed,0)=0
                        AND (IFNULL(title,'') LIKE $q OR IFNULL(note,'') LIKE $q)
                      ORDER BY done ASC, IFNULL(due,'9999-99-99') ASC LIMIT $n", ("$q", like), ("$n", per)))
                {
                    var due = Str(r["due"]);
                    var done = Int(r["done"]) == 1;
                    Add("todo", Str(r["id"]), Str(r["title"]),
                        done ? "已完成" : (due.Length > 0 ? "待办 · " + due : "待办"),
                        Snippet(Str(r["note"]), q), due);
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            try
            {
                foreach (var r in Rows(
                    @"SELECT id, IFNULL(title,'') AS title, IFNULL(plain,'') AS plain,
                             IFNULL(from_date,'') AS from_date, IFNULL(to_date,'') AS to_date
                      FROM summaries
                      WHERE IFNULL(deleted_at,0)=0
                        AND (IFNULL(plain,'') LIKE $q OR IFNULL(title,'') LIKE $q)
                      ORDER BY created_at DESC LIMIT $n", ("$q", like), ("$n", per)))
                {
                    var f = Str(r["from_date"]); var t2 = Str(r["to_date"]);
                    Add("summary", Str(r["id"]), Str(r["title"]).Length > 0 ? Str(r["title"]) : "总结",
                        f.Length > 0 ? f + " → " + t2 : "总结", Snippet(Str(r["plain"]), q), f);
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            try
            {
                foreach (var r in Rows(
                    @"SELECT id, name FROM habits
                      WHERE archived=0 AND IFNULL(deleted_at,0)=0 AND name LIKE $q
                      ORDER BY sort LIMIT $n", ("$q", like), ("$n", per)))
                {
                    Add("habit", Str(r["id"]), Str(r["name"]), "打卡习惯", "", "");
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            try
            {
                foreach (var r in Rows(
                    @"SELECT id, date, kind, amount, IFNULL(cat,'') AS cat, IFNULL(note,'') AS note
                      FROM ledger
                      WHERE IFNULL(deleted_at,0)=0
                        AND (IFNULL(note,'') LIKE $q OR IFNULL(cat,'') LIKE $q)
                      ORDER BY date DESC LIMIT $n", ("$q", like), ("$n", per)))
                {
                    var kind = Str(r["kind"]) == "in" ? "收入" : "支出";
                    var cat = Str(r["cat"]);
                    Add("ledger", Str(r["id"]), Str(r["note"]).Length > 0 ? Str(r["note"]) : (cat.Length > 0 ? cat : kind),
                        kind + " · " + Str(r["date"]) + (cat.Length > 0 ? " · " + cat : ""),
                        Str(r["amount"]), Str(r["date"]));
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            try
            {
                foreach (var r in Rows(
                    @"SELECT id, IFNULL(title,'') AS title, IFNULL(at_time,'') AS at_time, IFNULL(repeat,'') AS rep
                      FROM alarms WHERE IFNULL(title,'') LIKE $q ORDER BY at_time LIMIT $n",
                    ("$q", like), ("$n", per)))
                {
                    Add("alarm", Str(r["id"]), Str(r["title"]), "提醒 · " + Str(r["at_time"]), Str(r["rep"]), "");
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            try
            {
                foreach (var r in Rows(
                    @"SELECT id, IFNULL(title,'') AS title, IFNULL(date,'') AS date, IFNULL(note,'') AS note
                      FROM countdowns
                      WHERE IFNULL(deleted_at,0)=0 AND (IFNULL(title,'') LIKE $q OR IFNULL(note,'') LIKE $q)
                      ORDER BY date LIMIT $n", ("$q", like), ("$n", per)))
                {
                    Add("countdown", Str(r["id"]), Str(r["title"]), "倒数日 · " + Str(r["date"]), Snippet(Str(r["note"]), q), Str(r["date"]));
                }
            }
            catch (Exception e) { Diag.Error("search", "搜索模块执行失败", e); }

            return hits;
        }

        /* ================================================================== */
        /* 第 140 条：打卡提醒                                                 */
        /* ================================================================== */

        /// <summary>今天还没打卡的习惯（按排序，最多返回 5 个名字）</summary>
        public List<string> HabitsPendingToday()
        {
            var today = Today;
            return Rows(
                @"SELECT h.id, h.name FROM habits h
                  WHERE h.archived=0 AND IFNULL(h.deleted_at,0)=0
                    AND h.id NOT IN (
                        SELECT habit_id FROM habit_logs
                        WHERE date=$d AND val NOT IN ('','0','[]','null')
                        UNION
                        SELECT habit_id FROM checks WHERE date=$d)
                  ORDER BY h.sort", ("$d", today))
                .Select(r => Str(r["name"]))
                .Where(n => n.Length > 0)
                .ToList();
        }

        /// <summary>
        /// 第 21 条：节日提醒。
        ///
        /// 用户原话是「提供节假日提醒功能」。原来只有日历和欢迎页**展示**节日，
        /// 不会主动说一声 —— 节日当天打开软件才知道，这就不算「提醒」了。
        ///
        /// 和打卡提醒同一套机制（宿主 30 秒轮询），但多两件事：
        /// · 可设「提前几天」提醒（明天中秋，今天先说一声）
        /// · 当天和提前各只提醒一次（用 `festivalRemindLast` 记 `日期|节日名` 摘要）
        /// </summary>
        public object FestivalRemindTick()
        {
            if (Meta("festivalRemindOn", "1") != "1") return null;

            var lead = Int(Meta("festivalRemindLead", "1"));
            if (lead < 0) lead = 0;
            if (lead > 30) lead = 30;

            var at = Meta("festivalRemindAt", "08:00");
            if (at.Length < 4) at = "08:00";
            var now = DateTime.Now;
            if (string.CompareOrdinal(now.ToString("HH:mm"), at) < 0) return null;

            var today = Today;
            // 今天提醒过就收手，不然每 30 秒弹一次
            if (Meta("festivalRemindLast", "") == today) return null;

            // 只看「今天」和「未来 lead 天」，不能把整年的节日都搬出来
            var horizon = now.Date.AddDays(lead + 1);
            var hits = new List<(string name, int days)>();

            try
            {
                var res = FestivalsUpcoming(lead + 1);
                foreach (var it in (IEnumerable<object>)res)
                {
                    var t = it.GetType();
                    var nm = t.GetProperty("name")?.GetValue(it) as string ?? "";
                    var ds = t.GetProperty("days")?.GetValue(it);
                    var n = ds == null ? -1 : Convert.ToInt32(ds);
                    if (n < 0 || n > lead) continue;
                    if (!string.IsNullOrWhiteSpace(nm)) hits.Add((nm, n));
                }
            }
            catch (Exception ex) { Diag.Error("festival.remind", "算节日出错", ex); return null; }

            MetaSet("festivalRemindLast", today);
            if (hits.Count == 0) return null;

            // 按「还差几天」排，今天的在前
            hits.Sort((a, b) => a.days.CompareTo(b.days));
            return new
            {
                count = hits.Count,
                names = hits.Take(3).Select(h => h.name).ToList(),
                days = hits.Take(3).Select(h => h.days).ToList(),
                // 今天的节日单独给一份，前端好写「今天中秋」而不是「中秋还有 0 天」
                todayNames = hits.Where(h => h.days == 0).Select(h => h.name).ToList(),
            };
        }

        /// <summary>第 21 条：设置页预览「现在提醒会长什么样」，不看时间也不记账</summary>
        public object FestivalRemindPreview()
        {
            var lead = Int(Meta("festivalRemindLead", "1"));
            if (lead < 0) lead = 0;
            if (lead > 30) lead = 30;
            var hits = new List<(string name, int days)>();
            try
            {
                foreach (var it in (IEnumerable<object>)FestivalsUpcoming(lead + 1))
                {
                    var t = it.GetType();
                    var nm = t.GetProperty("name")?.GetValue(it) as string ?? "";
                    var ds = t.GetProperty("days")?.GetValue(it);
                    var n = ds == null ? -1 : Convert.ToInt32(ds);
                    if (n >= 0 && n <= lead && !string.IsNullOrWhiteSpace(nm)) hits.Add((nm, n));
                }
            }
            catch (Exception ex) { Diag.Error("festival.preview", "算节日出错", ex); }
            hits.Sort((a, b) => a.days.CompareTo(b.days));
            return new
            {
                on = Meta("festivalRemindOn", "1") == "1",
                lead,
                at = Meta("festivalRemindAt", "08:00"),
                count = hits.Count,
                names = hits.Take(5).Select(h => h.name).ToList(),
                days = hits.Take(5).Select(h => h.days).ToList(),
            };
        }

        /// <summary>
        /// 宿主定时器每 30 秒问一次：现在该不该提醒打卡。
        ///
        /// 第 98 条补了三件事，原来只有「到点说一次就走」：
        ///
        /// 1. **提前量**（habitRemindLead）。到点才说已经太晚了 ——
        ///    21:00 才提醒，人可能已经在床上，打卡也无从下手。
        ///    提前 30 分钟说，还有时间补。
        /// 2. **间隔重复**（habitRemindEvery）。催一次不理是常态。
        ///    但也不能没完没了 —— 上限 5 次，之后放弃，
        ///    不然一晚上响十几次会让人干脆关掉这个功能。
        /// 3. **提醒方式**（habitRemindHow）。声音 / 静音 / 只标红角标。
        ///    深夜开声音会吵到人，这个选择必须交给用户。
        ///
        /// 不发提醒的四种情况：
        ///   ① 没开启，或还没到「设定时间 − 提前量」
        ///   ② 今天的习惯已经全打完了 —— 已完成的人不需要被催
        ///   ③ 本轮已经催满次数（新一轮从每天 0 点重新计）
        ///   ④ 距上次提醒还没到间隔
        /// </summary>
        public object HabitRemindTick()
        {
            var d = HabitRemindDue();
            if (d == null) return null;

            /* 只有真要发的时候才记账。原先是"到点就记账"，看似省事，
               但配合间隔重复会变成：第一次响完就写死，后面几次全被拦掉。
               记账必须发生在"确实要响"这一刻。 */
            MetaSet("habitRemindLast", d.today);
            MetaSet("habitRemindAt2", d.now.ToString("s"));
            MetaSet("habitRemindN", d.nth.ToString());

            return new
            {
                count = d.names.Count,
                names = d.names.Take(3).ToList(),
                /* 第几次（从 1 起）。前端拿它决定语气：
                   第一次好好说，第二次开始加一句"还没打"，越往后越直接。 */
                nth = d.nth,
                max = d.max,
                /* 提醒方式由宿主决定要不要出声 —— 但实际发声在前端（playChime），
                   所以要把设置带过去，而不是这边偷偷静音。 */
                how = d.how,
            };
        }

        /// <summary>
        /// 「此刻该不该提醒」的完整判断。抽出来是因为预览也要用它 ——
        /// 预览如果自己另写一套判断，两边迟早不一致，
        /// 用户点「看看现在什么情况」得到的答案就不可信了。
        ///
        /// 不发提醒的四种情况：
        ///   ① 没开启，或还没到「设定时间 − 提前量」
        ///   ② 今天的习惯已经全打完了 —— 已完成的人不需要被催
        ///   ③ 本轮已经催满次数（新一轮从每天 0 点重新计）
        ///   ④ 距上次提醒还没到间隔
        /// </summary>
        private HabitRemindDecision HabitRemindDue()
        {
            if (Meta("habitRemindOn", "0") != "1") return null;

            var at = Meta("habitRemindAt", "21:00");
            if (at.Length < 4) at = "21:00";
            var now = DateTime.Now;

            /* 提前量：把「21:00 提醒」理解成「21:00 之前要有时间打完」，
               所以实际发声时刻是 21:00 − lead。 */
            var lead = Int(Meta("habitRemindLead", "0"));
            if (lead < 0) lead = 0;
            if (lead > 240) lead = 240;      // 提前四小时以上就没意义了，那是另一个功能

            DateTime dueAt;
            if (!DateTime.TryParse(now.ToString("yyyy-MM-dd") + " " + at, out dueAt))
                dueAt = now.Date.AddHours(21);
            dueAt = dueAt.AddMinutes(-lead);
            if (now < dueAt) return null;

            var today = Today;

            /* 全打完了就早退，并且**不要**记次数 ——
               否则用户补完卡之后次数还留着，明天一开软件就接着催。 */
            var pending = HabitsPendingToday();
            if (pending.Count == 0) return null;

            /*
             * 间隔重复。用三个 meta 记：
             *   habitRemindLast  上次真正发声的日期
             *   habitRemindAt2   上次真正发声的时刻（算间隔用）
             *   habitRemindN     今天已经说了几次
             *
             * 名字带 2 是因为 habitRemindAt 已经被"设定时间"占用了 ——
             * 沿用旧 key 会让老用户的设置被悄悄改写，只能在旁边加一个。
             */
            var lastDay = Meta("habitRemindLast", "");
            var lastTs = Meta("habitRemindAt2", "");
            var times = lastDay == today ? Int(Meta("habitRemindN", "0")) : 0;

            var every = Int(Meta("habitRemindEvery", "0"));
            if (every < 0) every = 0;
            if (every > 240) every = 240;

            // every = 0 表示「一天只提醒一次」，保持第 140 条原来的行为
            var maxTimes = every > 0 ? 5 : 1;
            if (times >= maxTimes) return null;

            if (times > 0 && every > 0 && lastTs.Length >= 16)
            {
                DateTime prev;
                if (DateTime.TryParse(lastTs, out prev) && (now - prev).TotalMinutes < every) return null;
            }

            return new HabitRemindDecision
            {
                names = pending,
                nth = times + 1,
                max = maxTimes,
                how = Meta("habitRemindHow", "sound"),
                today = today,
                now = now,
            };
        }

        /** 判断结果。用一个小类而不是匿名元组：字段有六个，元组读起来全是 Item1 */
        private sealed class HabitRemindDecision
        {
            public List<string> names;
            public int nth;
            public int max;
            public string how;
            public string today;
            public DateTime now;
        }

        /// <summary>
        /// 此刻该不该提醒 —— 只读版本，给自测和「现在什么情况」用。
        /// 和定时器走同一个判断函数，但**不记账**，所以连着调一百次也不会把额度耗掉。
        /// </summary>
        public object HabitRemindCheck()
        {
            var d = HabitRemindDue();
            if (d == null) return new { fire = false, count = 0, nth = 0, max = 0, how = "", names = new List<string>() };
            return new
            {
                fire = true,
                count = d.names.Count,
                nth = d.nth,
                max = d.max,
                how = d.how,
                names = d.names.Take(3).ToList(),
            };
        }

        /// <summary>测试 / 预览用：立刻算一次「现在提醒会长什么样」，不看时间也不记账</summary>
        public object HabitRemindPreview()
        {
            var pending = HabitsPendingToday();
            var at = Meta("habitRemindAt", "21:00");
            var lead = Int(Meta("habitRemindLead", "0"));
            var every = Int(Meta("habitRemindEvery", "0"));

            /* 把「实际什么时候会响」直接算出来给用户看。
               光给三个输入框，用户得自己在脑子里做 21:00 − 30 分钟这种减法，
               还得再想「间隔 15 分钟会响几次」—— 这不该让他算。 */
            DateTime dueAt;
            if (!DateTime.TryParse(DateTime.Today.ToString("yyyy-MM-dd") + " " + at, out dueAt))
                dueAt = DateTime.Today.AddHours(21);
            dueAt = dueAt.AddMinutes(-lead);

            var maxTimes = every > 0 ? 5 : 1;
            var fireAt = new List<string>();
            for (var i = 0; i < maxTimes; i++)
                fireAt.Add(dueAt.AddMinutes((long)every * i).ToString("HH:mm"));

            /* 此刻会不会响 —— 用的是和后台定时器**同一个**判断函数，
               不是另写一套。这样用户点「看看现在什么情况」看到的答案才可信。 */
            var due = HabitRemindDue();

            var firedToday = Meta("habitRemindLast", "") == Today ? Int(Meta("habitRemindN", "0")) : 0;

            /* 不响的原因要说清楚。「不会响」这三个字对用户毫无帮助 ——
               他需要知道是没开、打完了、还没到点，还是次数用完了。 */
            string why = "";
            if (due == null)
            {
                if (Meta("habitRemindOn", "0") != "1") why = "提醒没开启";
                else if (pending.Count == 0) why = "今天的卡都打完了，不用提醒";
                else if (DateTime.Now < dueAt) why = $"还没到点，{dueAt:HH:mm} 才会响";
                else if (firedToday >= maxTimes) why = $"今天已经提醒 {maxTimes} 次了，不再打扰";
                else why = $"距上次提醒还不到 {every} 分钟";
            }

            return new
            {
                count = pending.Count,
                names = pending.Take(5).ToList(),
                on = Meta("habitRemindOn", "0") == "1",
                at,
                lead,
                every,
                how = Meta("habitRemindHow", "sound"),
                /** 今天已经响过几次 */
                todayTimes = firedToday,
                maxTimes,
                fireAt,
                /** 现在这一刻会不会响，以及为什么不会 */
                nowWillFire = due != null,
                why,
            };
        }
    }
}
