using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// v9 扩展：日记标题 / 定稿与草稿箱、待办「放弃」与「回收站」分开、
    /// 番茄钟洞察统计、反馈落盘。
    /// </summary>
    public partial class Db
    {
        /* ================= 建表 ================= */

        public void EnsureV9()
        {
            EnsureColumn("entries", "title", "TEXT DEFAULT ''");
            EnsureColumn("entries", "status", "TEXT DEFAULT 'draft'");   // draft | published
            EnsureColumn("entries", "published_at", "TEXT DEFAULT ''");

            // 老数据迁移：已经有正文的日子算「定稿」，不然历史日记会一股脑进草稿箱
            try
            {
                if (Scalar("SELECT v FROM meta WHERE k='v9EntryStatus'") == null)
                {
                    Exec("UPDATE entries SET status='published', published_at=IFNULL(NULLIF(updated_at,''), created_at) WHERE IFNULL(plain,'')<>'' AND (status IS NULL OR status='')");
                    Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('v9EntryStatus','1')");
                }
            }
            catch { /* 迁移失败不影响使用，下次启动再试 */ }

            // 设置默认值
            SeedDefault("toastMs", "2600");            // 0 = 不自动消失
            SeedDefault("closeAction", "tray");        // tray | quit
            SeedDefault("minTray", "0");               // 最小化时是否收进托盘（不占任务栏）
            SeedDefault("language", "zh-Hans");        // 语言
            SeedDefault("region", "CN");               // 地区
            SeedDefault("regionCity", "");             // 城市（自由填）
            SeedDefault("profileOrder", "");           // 个人中心模块顺序
            SeedDefault("settingsOrder", "");          // 设置分组顺序
            SeedDefault("profileFields", "");          // 额外资料（JSON）
            SeedDefault("pomoStatsDays", "30");        // 番茄钟统计默认跨度
            SeedDefault("entryTitleOn", "1");          // 日记显示标题栏
            SeedDefault("autoRollover", "1");          // 跨天时提示是否开新的一页

            // 老设置 minimizeToTray 原本表示「点 X 收进托盘」，语义对新结构来说是 closeAction。
            // 迁移一次，别让老用户升级后发现关不掉 / 退不出。
            if (Scalar("SELECT v FROM meta WHERE k='v9CloseAction'") == null)
            {
                var old = Str(Scalar("SELECT v FROM meta WHERE k='minimizeToTray'"));
                if (old != "")
                    Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('closeAction',$v)", ("$v", old == "1" ? "tray" : "quit"));
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('v9CloseAction','1')");
            }
        }

        /* ================= 定稿 / 草稿箱 ================= */

        public object EntryPublish(string date, int published)
        {
            var now = Now;
            if (published == 1)
                Exec("UPDATE entries SET status='published',published_at=$p,rev=rev+1,updated_at=$u WHERE date=$d",
                    ("$p", now), ("$u", now), ("$d", date));
            else
                Exec("UPDATE entries SET status='draft',published_at='',rev=rev+1,updated_at=$u WHERE date=$d",
                    ("$u", now), ("$d", date));
            Touch("entries", date, "upd", 1);
            var st = Str(Scalar("SELECT status FROM entries WHERE date=$d", ("$d", date)));
            return new { ok = true, status = st, publishedAt = Str(Scalar("SELECT published_at FROM entries WHERE date=$d", ("$d", date))) };
        }

        /// <summary>草稿箱：有内容但还没定稿的日子，最近的在前。</summary>
        public object EntryDrafts()
        {
            return Rows(@"SELECT date,title,plain,updated_at,fav FROM entries
                          WHERE deleted_at IS NULL AND IFNULL(status,'draft')='draft'
                            AND (IFNULL(plain,'')<>'' OR IFNULL(title,'')<>'')
                          ORDER BY date DESC LIMIT 300")
                .Select(r => new
                {
                    date = Str(r["date"]),
                    title = Str(r["title"]),
                    excerpt = Trim1(Str(r["plain"]), 60),
                    chars = Str(r["plain"]).Replace(" ", "").Length,
                    fav = Int(r["fav"]),
                    updatedAt = Str(r["updated_at"]),
                }).ToList();
        }

        public object EntryStatus(string date)
        {
            var r = Rows("SELECT status,published_at,title FROM entries WHERE date=$d", ("$d", date)).FirstOrDefault();
            return new
            {
                date,
                status = r == null ? "draft" : (Str(r["status"]) == "" ? "draft" : Str(r["status"])),
                publishedAt = r == null ? "" : Str(r["published_at"]),
                title = r == null ? "" : Str(r["title"]),
            };
        }

        /* ================= 待办 =================
           放弃与回收站其实早已是两个字段：trashed=放弃（不打算做了），deleted_at=回收站（删了但留底）。
           这一轮只改文案与入口，不新增字段 —— 再加一个 dropped 只会让两套语义并存。
           见前端 Todos.tsx。 */

        /* ================= 番茄钟洞察 ================= */

        /// <summary>
        /// 参考「番茄 todo」的统计口径：总量、连续天数、时段分布、任务排行、逐日热力。
        /// 只做能算准的，不编「效率评分」这种没有依据的东西。
        ///
        /// 第 131 条：统计页要把这块嵌进去复用。但统计页的区间是
        /// 「近 7 天 / 近 30 天 / 今年 / 去年 / 自定义」这一套，
        /// 光有 days 表达不了「去年」和「自定义」—— 传 days 只能算"从今天往前推"。
        /// 所以加一对可选的起止日期：给了就按它，没给就还是按 days 从今天往前推，
        /// 番茄钟页那边的老调用一行都不用改。
        /// </summary>
        public object PomoInsight(int days, string fromIn = null, string toIn = null)
        {
            if (days <= 0) days = 30;
            if (days > 365) days = 365;

            string to, from;
            if (!string.IsNullOrWhiteSpace(fromIn) && fromIn.Length >= 10)
            {
                /* 自定义区间。两个方向都要夹住，否则「去年」查出来 spans 三年，
                   热力图的列数会爆炸（它是按天铺格子的）。 */
                from = fromIn.Substring(0, 10);
                to = !string.IsNullOrWhiteSpace(toIn) && toIn.Length >= 10 ? toIn.Substring(0, 10) : Today;
                if (string.CompareOrdinal(to, from) < 0) { var t0 = to; to = from; from = t0; }
                if ((DateTime.Parse(to) - DateTime.Parse(from)).TotalDays > 366)
                    from = DateTime.Parse(to).AddDays(-366).ToString("yyyy-MM-dd");
            }
            else
            {
                to = Today;
                from = DateTime.Now.AddDays(-(days - 1)).ToString("yyyy-MM-dd");
            }

            var rows = Rows(@"SELECT date,ts,minutes,kind,task FROM pomodoro
                              WHERE date>=$f AND date<=$t ORDER BY date, ts", ("$f", from), ("$t", to))
                .Where(r => Str(r["kind"]) != "break").ToList();

            var byDay = new Dictionary<string, int>();
            var byHour = new int[24];
            var tasks = new Dictionary<string, int>();
            var countByDay = new Dictionary<string, int>();

            foreach (var r in rows)
            {
                var d = Str(r["date"]);
                var m = Int(r["minutes"]);
                if (m <= 0) m = 25;
                byDay[d] = byDay.TryGetValue(d, out var cur) ? cur + m : m;
                countByDay[d] = countByDay.TryGetValue(d, out var c2) ? c2 + 1 : 1;

                var ts = Str(r["ts"]);
                if (ts.Length >= 13 && int.TryParse(ts.Substring(11, 2), out var hh) && hh >= 0 && hh < 24) byHour[hh] += m;

                var task = (Str(r["task"]) ?? "").Trim();
                if (task.Length > 0) tasks[task] = tasks.TryGetValue(task, out var t2) ? t2 + m : m;
            }

            // 逐日数组（含空白日），给前端画柱状图 / 热力图
            var series = new List<(string date, int minutes, int count)>();
            var d0 = DateTime.ParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            var d1 = DateTime.ParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            for (var d = d0; d <= d1; d = d.AddDays(1))
            {
                var k = d.ToString("yyyy-MM-dd");
                byDay.TryGetValue(k, out var mins);
                countByDay.TryGetValue(k, out var cnt);
                series.Add((k, mins, cnt));
            }

            // 连续天数：从今天往回数，哪天为 0 就停
            int streak = 0;
            for (var d = d1; d >= d0; d = d.AddDays(-1))
            {
                byDay.TryGetValue(d.ToString("yyyy-MM-dd"), out var mins);
                if (mins > 0) streak++; else break;
            }

            // 区间内最长连续
            int longest = 0, run = 0;
            foreach (var x in series)
            {
                run = x.minutes > 0 ? run + 1 : 0;
                if (run > longest) longest = run;
            }

            var total = byDay.Values.Sum();
            var activeDays = byDay.Count;
            var today = Today;
            byDay.TryGetValue(today, out var todayMin);
            countByDay.TryGetValue(today, out var todayCnt);

            var weekStart = DateTime.Now.AddDays(-(((int)DateTime.Now.DayOfWeek + 6) % 7)).ToString("yyyy-MM-dd");
            var weekMin = byDay.Where(kv => string.CompareOrdinal(kv.Key, weekStart) >= 0).Sum(kv => kv.Value);
            var monthMin = byDay.Where(kv => kv.Key.StartsWith(DateTime.Now.ToString("yyyy-MM")))
                                .Sum(kv => kv.Value);

            var bestDate = byDay.OrderByDescending(kv => kv.Value).Select(kv => kv.Key).FirstOrDefault() ?? "";

            return new
            {
                from, to,
                days,
                totalMinutes = total,
                sessions = rows.Count,
                activeDays,
                avgMinutes = activeDays == 0 ? 0 : total / activeDays,
                todayMinutes = todayMin,
                todaySessions = todayCnt,
                weekMinutes = weekMin,
                monthMinutes = monthMin,
                streak,
                longest,
                bestDate,
                bestMinutes = byDay.TryGetValue(bestDate, out var bm) ? bm : 0,
                byHour,
                series = series.Select(x => new { date = x.date, minutes = x.minutes, count = x.count }).ToList(),
                topTasks = tasks.OrderByDescending(kv => kv.Value).Take(8)
                                 .Select(kv => new { name = kv.Key, minutes = kv.Value }).ToList(),
            };
        }

        /// <summary>
        /// 第 182 条：年月快跳面板用的按月汇总。
        /// 用户原话「要能够让我在日历中快速翻越到几个月前几年前的日历，而不是让我一个个手点」——
        /// 所以先把「哪几个月有东西」一次算出来交给前端，点哪个月就直接跳，
        /// 而不是靠前端反复请求 12 个月或者干脆不分。
        ///
        /// 一条 SQL 出全部：日记按月分组 + 打卡按月分组 + 番茄按月分组，用 date 前缀对齐。
        /// 三年也就 36 行，没必要分页。
        /// </summary>
        public object CalendarMonths()
        {
            var map = new Dictionary<string, (int days, int chars, int checks, int pomo)>();

            void Bump(string ym, int days, int chars, int checks, int pomo)
            {
                map.TryGetValue(ym, out var cur);
                map[ym] = (cur.days + days, cur.chars + chars, cur.checks + checks, cur.pomo + pomo);
            }

            foreach (var r in Rows(@"SELECT SUBSTR(date,1,7) ym, COUNT(*) c, IFNULL(SUM(LENGTH(plain)),0) ch
                                     FROM entries GROUP BY ym"))
                Bump(Str(r["ym"]), Int(r["c"]), Int(r["ch"]), 0, 0);

            foreach (var r in Rows(@"SELECT SUBSTR(date,1,7) ym, COUNT(*) c FROM habit_logs
                                     WHERE val NOT IN ('','0','[]','null') GROUP BY ym"))
                Bump(Str(r["ym"]), 0, 0, Int(r["c"]), 0);

            foreach (var r in Rows(@"SELECT SUBSTR(date,1,7) ym, IFNULL(SUM(minutes),0) m FROM pomodoro
                                     WHERE IFNULL(kind,'focus')<>'break' GROUP BY ym"))
                Bump(Str(r["ym"]), 0, 0, 0, Int(r["m"]));

            return map.OrderBy(kv => kv.Key).Select(kv => new
            {
                ym = kv.Key,
                days = kv.Value.days,
                chars = kv.Value.chars,
                checks = kv.Value.checks,
                pomoMinutes = kv.Value.pomo,
            }).ToList();
        }

        /// <summary>
        /// 第 186 条：某一天的番茄明细。
        /// 用户原话「我可以知道我哪一天专注了哪些」——所以这里按天给到「几点到几点、做了多久、做了什么事」，
        /// 而不只是一个总数。总数在他处已经有了，重复算没有意义。
        /// 休息段（kind=break）不收：那不是专注，混进来会让"这天到底专注了多久"失真。
        /// </summary>
        public object PomoDay(string date)
        {
            if (string.IsNullOrWhiteSpace(date)) date = Today;

            var rows = Rows(@"SELECT id, ts, minutes, kind, task FROM pomodoro
                              WHERE date=$d AND IFNULL(kind,'focus')<>'break' ORDER BY ts, id",
                ("$d", date));

            var items = new List<object>();
            var byTask = new Dictionary<string, int>();
            var total = 0;

            foreach (var r in rows)
            {
                var m = Int(r["minutes"]);
                if (m <= 0) m = 25;
                total += m;
                var task = (Str(r["task"]) ?? "").Trim();
                var key = task.Length == 0 ? "（没写任务）" : task;
                byTask[key] = byTask.TryGetValue(key, out var cur) ? cur + m : m;

                var ts = Str(r["ts"]);
                items.Add(new
                {
                    ts,
                    // 只给「时:分」，前端不需要自己切字符串（以前切错过一次）
                    hm = ts.Length >= 16 ? ts.Substring(11, 5) : "",
                    minutes = m,
                    task = key,
                    // 给明细页的删除按钮用：删单颗必须能精确指到这一条
                    id = Str(r["id"]),
                });
            }

            return new
            {
                date,
                totalMinutes = total,
                count = items.Count,
                items,
                byTask = byTask.OrderByDescending(kv => kv.Value)
                               .Select(kv => new { name = kv.Key, minutes = kv.Value }).ToList(),
            };
        }

        /// <summary>
        /// 哪几个月有番茄记录 —— 日历的年月快跳面板拿它给有数据的月份打点。
        /// 不传范围就是全部历史：一年 12 条、十年也才 120 条，没必要分页。
        /// </summary>
        public object PomoMonths()
        {
            var rows = Rows(@"SELECT SUBSTR(date,1,7) ym, COUNT(*) c, IFNULL(SUM(minutes),0) m
                              FROM pomodoro WHERE IFNULL(kind,'focus')<>'break'
                              GROUP BY ym ORDER BY ym");
            return rows.Select(r => new
            {
                ym = Str(r["ym"]),
                count = Int(r["c"]),
                minutes = Int(r["m"]),
            }).ToList();
        }

        /* ================= 反馈 ================= */

        public string FeedbackDir
        {
            get
            {
                var d = Path.Combine(ExportDir, "反馈");
                Directory.CreateDirectory(d);
                return d;
            }
        }

        public object FeedbackSave(string text, string contact)
        {
            if (string.IsNullOrWhiteSpace(text)) return new { ok = false, err = "内容还是空的" };
            var name = "反馈-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".txt";
            var path = Path.Combine(FeedbackDir, name);
            var sb = new StringBuilder();
            sb.AppendLine("日签 · 反馈");
            sb.AppendLine("时间：" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            sb.AppendLine("系统：" + Environment.OSVersion.VersionString);
            sb.AppendLine("联系方式：" + (string.IsNullOrWhiteSpace(contact) ? "（未填）" : contact.Trim()));
            sb.AppendLine("数据目录：" + Root);
            sb.AppendLine(new string('-', 40));
            sb.AppendLine(text.Trim());
            File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
            return new { ok = true, path };
        }

        /// <summary>给「联系我们」页拼一段可复制的说明，不联网也能用。</summary>
        public object AppFacts()
        {
            int entries = 0, words = 0, days = 0;
            try
            {
                entries = Int(Scalar("SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL AND IFNULL(plain,'')<>''"));
                words = Int(Scalar("SELECT IFNULL(SUM(LENGTH(REPLACE(plain,' ',''))),0) FROM entries WHERE deleted_at IS NULL"));
                days = Int(Scalar("SELECT COUNT(DISTINCT date) FROM pomodoro WHERE kind<>'break'"));
            }
            catch { }
            return new
            {
                root = Root,
                dbPath = DbPath,
                entries,
                words,
                pomoDays = days,
                os = Environment.OSVersion.VersionString,
                clr = Environment.Version.ToString(),
                today = Today,
            };
        }
    }
}
