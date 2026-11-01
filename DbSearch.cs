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
        /// 三个不发的情况：
        /// 1. 没开启，或者还没到设定时间
        /// 2. 今天已经提醒过了（`habitRemindLast` 记的是日期，不是时间戳）
        /// 3. 今天的习惯已经全打完了 —— 已完成的人不需要被催
        /// </summary>
        public object HabitRemindTick()
        {
            if (Meta("habitRemindOn", "0") != "1") return null;

            var at = Meta("habitRemindAt", "21:00");
            if (at.Length < 4) at = "21:00";
            var now = DateTime.Now;
            var hm = now.ToString("HH:mm");
            if (string.CompareOrdinal(hm, at) < 0) return null;

            var today = Today;
            if (Meta("habitRemindLast", "") == today) return null;

            var pending = HabitsPendingToday();
            // 全打完了也记一笔，免得之后每 30 秒空跑一次
            MetaSet("habitRemindLast", today);
            if (pending.Count == 0) return null;

            return new { count = pending.Count, names = pending.Take(3).ToList() };
        }

        /// <summary>测试 / 预览用：立刻算一次「现在提醒会长什么样」，不看时间也不记账</summary>
        public object HabitRemindPreview()
        {
            var pending = HabitsPendingToday();
            return new
            {
                count = pending.Count,
                names = pending.Take(5).ToList(),
                on = Meta("habitRemindOn", "0") == "1",
                at = Meta("habitRemindAt", "21:00"),
            };
        }
    }
}
