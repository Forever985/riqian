using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// v8 扩展：总结留存、密码提示与密保、回顾数据聚合。
    /// 继续沿用「一个版本一个 partial 文件」的结构，避免在两千行的 Db.cs 里穿插改。
    /// </summary>
    public partial class Db
    {
        /* ================= 建表 ================= */

        public void EnsureV8()
        {
            Exec(@"
-- 总结留存：一日总结 / 近几日总结，存渲染后的 HTML，可直接分享或自我留存
CREATE TABLE IF NOT EXISTS summaries(
  id TEXT PRIMARY KEY,
  kind TEXT DEFAULT 'day',          -- day | range
  from_date TEXT DEFAULT '',
  to_date TEXT DEFAULT '',
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',
  plain TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT DEFAULT NULL,
  rev INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_summary_time ON summaries(created_at DESC);

-- 密保问题：答案同样 PBKDF2 存储，绝不明文
CREATE TABLE IF NOT EXISTS vault_qa(
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  answer_salt TEXT NOT NULL,
  sort INTEGER DEFAULT 0,
  created_at TEXT
);
");
            EnsureColumn("vault", "hint", "TEXT DEFAULT ''");

            /* ---- 设置默认值 ---- */

            // 快捷键（空字符串 = 不注册）
            SeedDefault("hotkeyEnable", "1");
            SeedDefault("hotkeyToggle", "Ctrl+Alt+J");   // 唤出 / 收起
            SeedDefault("hotkeyBoss", "Ctrl+Alt+H");     // 老板键：隐藏 / 伪装
            SeedDefault("hotkeyDiary", "Ctrl+Alt+Shift+D");
            SeedDefault("hotkeyNote", "Ctrl+Alt+Shift+N");
            SeedDefault("hotkeyTodo", "Ctrl+Alt+Shift+T");
            SeedDefault("hotkeyCd", "Ctrl+Alt+Shift+C");
            SeedDefault("hotkeyPomo", "Ctrl+Alt+Shift+P");

            // 托盘与窗口
            SeedDefault("trayMenu", "open,today,diary,note,todo,pomo,sep,hide,boss,sep,quit");
            SeedDefault("trayDoubleClick", "open");      // open | diary | note | boss
            SeedDefault("trayIconMode", "full");         // full | mini | off
            SeedDefault("orbEnabled", "0");              // 右下角悬浮小 logo
            SeedDefault("orbSize", "56");
            SeedDefault("taskbarShow", "1");             // 是否占任务栏
            SeedDefault("disguiseStyle", "note");        // note | blank | sheet
            SeedDefault("trayLockIcon", "1");            // 第 75 条：锁定后托盘图标叠小锁角标

            // 总结与分享
            SeedDefault("reviewDays", "7");
            SeedDefault("reviewAutoSave", "0");
            SeedDefault("shareStyle", "paper");          // paper | ink | night | plain
            SeedDefault("shareSize", "story");           // story(3:4) | square | wide(16:9)
            SeedDefault("shareWatermark", "1");
            SeedDefault("shareBrand", "日签 · 打卡日记本");
            SeedDefault("shareFooter", "把每一天过成值得回看的样子");
            SeedDefault("shareShowStats", "1");

            // v8.1：实测 Ctrl+Alt+C / Ctrl+Alt+P 在很多机器上已被其它软件占用，
            // 快速记录统一加一个 Shift。只改「还是旧默认值」的那几项，用户自己设过的不动。
            if (Scalar("SELECT v FROM meta WHERE k='v8HotkeyShift'") == null)
            {
                var mig = new (string k, string from, string to)[]
                {
                    ("hotkeyDiary", "Ctrl+Alt+D", "Ctrl+Alt+Shift+D"),
                    ("hotkeyNote",  "Ctrl+Alt+N", "Ctrl+Alt+Shift+N"),
                    ("hotkeyTodo",  "Ctrl+Alt+T", "Ctrl+Alt+Shift+T"),
                    ("hotkeyCd",    "Ctrl+Alt+C", "Ctrl+Alt+Shift+C"),
                    ("hotkeyPomo",  "Ctrl+Alt+P", "Ctrl+Alt+Shift+P"),
                };
                foreach (var (k, from, to) in mig)
                    Exec("UPDATE meta SET v=$t WHERE k=$k AND v=$f", ("$k", k), ("$f", from), ("$t", to));
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('v8HotkeyShift','1')");
            }
        }

        /* ================= 总结留存 ================= */

        private static object SummaryRow(Dictionary<string, object> r, bool withBody)
        {
            if (withBody)
                return new
                {
                    id = Str(r["id"]),
                    kind = Str(r["kind"]),
                    fromDate = Str(r["from_date"]),
                    toDate = Str(r["to_date"]),
                    title = Str(r["title"]),
                    body = Str(r["body"]),
                    plain = Str(r["plain"]),
                    pinned = Int(r["pinned"]),
                    createdAt = Str(r["created_at"]),
                    updatedAt = Str(r["updated_at"]),
                };
            return new
            {
                id = Str(r["id"]),
                kind = Str(r["kind"]),
                fromDate = Str(r["from_date"]),
                toDate = Str(r["to_date"]),
                title = Str(r["title"]),
                plain = Str(r["plain"]),
                pinned = Int(r["pinned"]),
                createdAt = Str(r["created_at"]),
                updatedAt = Str(r["updated_at"]),
            };
        }

        public object Summaries()
        {
            return Rows(@"SELECT * FROM summaries WHERE deleted_at IS NULL
                          ORDER BY pinned DESC, created_at DESC LIMIT 200")
                .Select(r => SummaryRow(r, false)).ToList();
        }

        public object SummaryGet(string id)
        {
            var r = Rows("SELECT * FROM summaries WHERE id=$i", ("$i", id)).FirstOrDefault();
            if (r == null) return new { ok = false, err = "找不到这份总结" };
            return SummaryRow(r, true);
        }

        public object SummarySave(string id, string kind, string from, string to,
                                  string title, string body, string plain)
        {
            var now = Now;
            if (string.IsNullOrEmpty(id))
            {
                id = NewId();
                Exec(@"INSERT INTO summaries(id,kind,from_date,to_date,title,body,plain,created_at,updated_at)
                       VALUES($i,$k,$f,$t,$ti,$b,$p,$c,$u)",
                    ("$i", id), ("$k", kind ?? "day"), ("$f", from ?? ""), ("$t", to ?? ""),
                    ("$ti", title ?? ""), ("$b", body ?? ""), ("$p", plain ?? ""), ("$c", now), ("$u", now));
            }
            else
            {
                Exec(@"UPDATE summaries SET kind=$k,from_date=$f,to_date=$t,title=$ti,body=$b,plain=$p,
                       updated_at=$u,rev=rev+1 WHERE id=$i",
                    ("$i", id), ("$k", kind ?? "day"), ("$f", from ?? ""), ("$t", to ?? ""),
                    ("$ti", title ?? ""), ("$b", body ?? ""), ("$p", plain ?? ""), ("$u", now));
            }
            Touch("summaries", id, string.IsNullOrEmpty(id) ? "ins" : "upd", 1, null);
            return new { ok = true, id };
        }

        public object SummaryDelete(string id)
        {
            Exec("UPDATE summaries SET deleted_at=$t,rev=rev+1 WHERE id=$i", ("$t", Now), ("$i", id));
            return new { ok = true };
        }

        public object SummaryPin(string id, int pinned)
        {
            Exec("UPDATE summaries SET pinned=$p,rev=rev+1,updated_at=$t WHERE id=$i",
                ("$p", pinned), ("$t", Now), ("$i", id));
            return new { ok = true };
        }

        /* ================= 回顾数据聚合 ================= */
        /*
         * 明确不做「AI 摘要」：没有模型、不联网，硬编几个模板句只会产出看起来像总结的废话。
         * 这里只做可验证的统计 + 原文摘句，用户看到的每个数字都能在别处对上。
         */

        private static string Trim1(string s, int max)
        {
            s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            while (s.Contains("  ")) s = s.Replace("  ", " ");
            return s.Length <= max ? s : s.Substring(0, max) + "…";
        }

        /// <summary>从一天的正文里挑一句最像「值得记住」的：优先问号/感叹号/较长的句子。</summary>
        private static string PickLine(string plain)
        {
            if (string.IsNullOrWhiteSpace(plain)) return "";
            var parts = plain.Replace("\r", "\n")
                .Split(new[] { '\n', '。', '！', '？', '；', '…' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(p => p.Trim())
                .Where(p => p.Length >= 6)
                .ToList();
            if (parts.Count == 0) return Trim1(plain, 60);
            var scored = parts
                .Select(p => new { p, s = p.Length + (plain.Contains(p + "！") ? 6 : 0) + (plain.Contains(p + "？") ? 4 : 0) })
                .OrderByDescending(x => x.s)
                .First();
            return Trim1(scored.p, 70);
        }

        private static int ValIsOn(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return 0;
            var s = raw.Trim();
            if (s == "null" || s == "false" || s == "\"\"" || s == "[]" || s == "0" || s == "0.0") return 0;
            return 1;
        }

        public object ReviewDay(string date)
        {
            if (string.IsNullOrEmpty(date)) date = Today;
            var e = Rows("SELECT * FROM entries WHERE date=$d", ("$d", date)).FirstOrDefault();
            var plain = e == null ? "" : Str(e["plain"]);
            var fav = e == null ? 0 : Int(e["fav"]);

            // 心情 / 天气 / 图片数都藏在 vals 里，靠模块类型认出来
            int mood = 0, images = 0;
            string weather = "";
            foreach (var v in Rows(@"SELECT m.type, v.val FROM vals v JOIN modules m ON m.id=v.module_id
                                     WHERE v.date=$d", ("$d", date)))
            {
                var t = Str(v["type"]);
                var raw = Str(v["val"]);
                if (t == "mood") int.TryParse(raw.Trim('"'), out mood);
                else if (t == "weather") weather = raw.Trim('"');
                else if (t == "images")
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(raw);
                        if (doc.RootElement.ValueKind == JsonValueKind.Array) images += doc.RootElement.GetArrayLength();
                    }
                    catch { }
                }
            }

            var tags = Rows("SELECT tag FROM entry_tags WHERE date=$d ORDER BY tag", ("$d", date))
                .Select(r => Str(r["tag"])).ToList();

            var habitTotal = Int(Scalar("SELECT COUNT(*) FROM habits WHERE archived=0 AND deleted_at IS NULL"));
            var habitDone = 0;
            foreach (var h in Rows("SELECT val FROM habit_logs WHERE date=$d", ("$d", date)))
                habitDone += ValIsOn(Str(h["val"]));

            var pomo = Rows("SELECT minutes,kind FROM pomodoro WHERE date=$d", ("$d", date));
            var pomoMinutes = pomo.Where(x => Str(x["kind"]) != "break").Sum(x => Int(x["minutes"]));
            var pomoCount = pomo.Count(x => Str(x["kind"]) != "break");

            var todoDone = Int(Scalar("SELECT COUNT(*) FROM todos WHERE done=1 AND substr(done_at,1,10)=$d", ("$d", date)));
            var todoOpen = Int(Scalar("SELECT COUNT(*) FROM todos WHERE done=0 AND trashed=0 AND deleted_at IS NULL AND due<=$d", ("$d", date)));

            /*
             * #244 衍生：这一天加了密码，就不许从这里把正文摘出去。
             *
             * 「总结」页是 <Guarded scope="diary"> 包的，但那个 Guarded 只有在
             * 存在「整段日记」规则（scope=diary 且 target 为空）时才会挡；
             * 用户给**某一天**单独加锁（target=2026-11-03）时它根本拦不住。
             * 实测：加锁的那天 review.day 直接返回了全文和标签。
             *
             * 这里把日期相关的内容全部抹掉，只留「这天有内容但被锁着」这个事实 ——
             * 连 chars 都要清，因为字数和标签也是信息（「原来那天写了两个字」）。
             * 心情/天气同理：它们属于日记内容的一部分。
             */
            var locked = IsDiaryLocked(date);
            if (locked)
            {
                return new
                {
                    date,
                    chars = 0,
                    plain = "",
                    oneLine = "",
                    fav,
                    mood = 0,
                    weather = "",
                    tags = new List<string>(),
                    images = 0,
                    habitDone,
                    habitTotal,
                    pomoMinutes,
                    pomoCount,
                    todoDone,
                    todoOpen,
                    hasEntry = e != null,
                    locked = true,
                    updatedAt = e == null ? "" : Str(e["updated_at"]),
                };
            }

            return new
            {
                date,
                chars = plain.Replace(" ", "").Length,
                plain,
                oneLine = PickLine(plain),
                fav,
                mood,
                weather,
                tags,
                images,
                habitDone,
                habitTotal,
                pomoMinutes,
                pomoCount,
                todoDone,
                todoOpen,
                hasEntry = e != null,
                locked = false,
                updatedAt = e == null ? "" : Str(e["updated_at"]),
            };
        }

        /// <summary>逐日一行。用命名类而不是匿名类型 —— 后面要算连续天数，dynamic 访问匿名类型很容易踩坑。</summary>
        private sealed class DayPoint
        {
            public string date;
            public int chars;
            public string oneLine;
            public int fav;
            public bool has;
        }

        public object ReviewRange(string from, string to)
        {
            if (string.IsNullOrEmpty(to)) to = Today;
            if (string.IsNullOrEmpty(from)) from = to;

            var d0 = DateTime.ParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            var d1 = DateTime.ParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (d1 < d0) { var tmp = d0; d0 = d1; d1 = tmp; from = d0.ToString("yyyy-MM-dd"); to = d1.ToString("yyyy-MM-dd"); }

            var entries = Rows(@"SELECT date,plain,fav FROM entries
                                 WHERE date>=$f AND date<=$t ORDER BY date", ("$f", from), ("$t", to));

            /*
             * #244 衍生：区间总结里也要把加锁的日子剔干净。
             *
             * 这里不只是「正文」——`byDay.oneLine` 是每日摘要、`totalChars` 是字数、
             * `activeDays` 是「写过几天」、`moodDist` / `tagsTop` 是心情与标签分布。
             * 少了任何一项，「那几天写过东西」这件事就会从统计数字里漏出来：
             * 比如区间里明明 4 个活跃日，用户只看见 3 天的内容，多出来那天是谁一目了然。
             *
             * 所以锁住的日期整体不参与统计 —— 宁可让数字变小，也不让它的存在被推出来。
             */
            var lockedDates = new HashSet<string>(StringComparer.Ordinal);
            foreach (var r in entries)
            {
                var dd = Str(r["date"]);
                if (IsDiaryLocked(dd)) lockedDates.Add(dd);
            }
            if (lockedDates.Count > 0)
                entries = entries.Where(r => !lockedDates.Contains(Str(r["date"]))).ToList();

            var byDayRaw = new Dictionary<string, Dictionary<string, object>>();
            foreach (var r in entries) byDayRaw[Str(r["date"])] = r;

            var days = (d1 - d0).Days + 1;
            var totalChars = entries.Sum(x => Str(x["plain"]).Replace(" ", "").Length);
            var activeDays = entries.Count(x => Str(x["plain"]).Trim().Length > 0);

            // 逐日（含空白日），前端画柱状图 / 列表都要连续日期
            var byDay = new List<DayPoint>();
            var best = (date: "", chars: 0);
            for (var d = d0; d <= d1; d = d.AddDays(1))
            {
                var k = d.ToString("yyyy-MM-dd");
                byDayRaw.TryGetValue(k, out var row);
                var p = row == null ? "" : Str(row["plain"]);
                var c = p.Replace(" ", "").Length;
                if (c > best.chars) best = (k, c);
                byDay.Add(new DayPoint
                {
                    date = k,
                    chars = c,
                    oneLine = PickLine(p),
                    fav = row == null ? 0 : Int(row["fav"]),
                    has = c > 0,
                });
            }

            // 心情分布（排除加锁日，否则能反推出那天有心情记录）
            var moodDist = new int[6];
            foreach (var v in Rows(@"SELECT v.val, v.date FROM vals v JOIN modules m ON m.id=v.module_id
                                     WHERE m.type='mood' AND v.date>=$f AND v.date<=$t", ("$f", from), ("$t", to)))
            {
                if (lockedDates.Contains(Str(v["date"]))) continue;
                if (int.TryParse(Str(v["val"]).Trim('"'), out var mv) && mv >= 1 && mv <= 5) moodDist[mv]++;
            }

            /*
             * 注意：这里改了写法（先取原始行、在内存里按日期剔除锁定的那些、
             * 再分组计数），**必须把 $f / $t 两个参数传进去** ——
             * SQL 里写着 date>=$f AND date<=$t，漏了参数 SqliteCommand 会直接抛
             * 「Must add values for the following parameters」，
             * 整块区间总结就打不开了。这是回归时实测抓到的。
             */
            var tagsTop = Rows(@"SELECT tag, date FROM entry_tags WHERE date>=$f AND date<=$t",
                    ("$f", from), ("$t", to))
                .Where(r => !lockedDates.Contains(Str(r["date"])))
                .GroupBy(r => Str(r["tag"]))
                .Select(g => new { tag = g.Key, n = g.Count() })
                .OrderByDescending(x => x.n).ThenBy(x => x.tag)
                .Take(12).ToList();

            var habitsTop = Rows(@"SELECT h.name nm, COUNT(*) n FROM habit_logs l
                                   JOIN habits h ON h.id=l.habit_id
                                   WHERE l.date>=$f AND l.date<=$t AND l.val NOT IN ('','null','false','0','[]')
                                   GROUP BY h.id ORDER BY n DESC, nm LIMIT 8", ("$f", from), ("$t", to))
                .Select(r => new { name = Str(r["nm"]), n = Int(r["n"]) }).ToList();

            var pomoMinutes = Int(Scalar(@"SELECT IFNULL(SUM(minutes),0) FROM pomodoro
                                           WHERE date>=$f AND date<=$t AND kind<>'break'", ("$f", from), ("$t", to)));
            var pomoCount = Int(Scalar(@"SELECT COUNT(*) FROM pomodoro
                                         WHERE date>=$f AND date<=$t AND kind<>'break'", ("$f", from), ("$t", to)));
            var todoDone = Int(Scalar(@"SELECT COUNT(*) FROM todos WHERE done=1
                                        AND substr(done_at,1,10)>=$f AND substr(done_at,1,10)<=$t",
                                        ("$f", from), ("$t", to)));
            var images = 0;
            foreach (var v in Rows(@"SELECT v.val, v.date FROM vals v JOIN modules m ON m.id=v.module_id
                                     WHERE m.type='images' AND v.date>=$f AND v.date<=$t", ("$f", from), ("$t", to)))
            {
                // #244 衍生：锁定日的图片也不该算进区间统计
                if (lockedDates.Contains(Str(v["date"]))) continue;
                try
                {
                    using var doc = JsonDocument.Parse(Str(v["val"]));
                    if (doc.RootElement.ValueKind == JsonValueKind.Array) images += doc.RootElement.GetArrayLength();
                }
                catch { }
            }

            // 连续记录：区间内最长的连续有字天数，以及到今天为止仍在延续的天数
            int longest = 0, run = 0, tail = 0;
            foreach (var row in byDay)
            {
                run = row.has ? run + 1 : 0;
                if (run > longest) longest = run;
            }
            for (var i = byDay.Count - 1; i >= 0; i--)
            {
                if (byDay[i].has) tail++;
                else break;
            }

            return new
            {
                from,
                to,
                days,
                entries = entries.Count,
                activeDays,
                totalChars,
                avgChars = activeDays == 0 ? 0 : totalChars / activeDays,
                maxChars = best.chars,
                maxCharsDate = best.date,
                longest,
                tail,
                moodDist = moodDist.Skip(1).ToArray(),
                byDay,
                tagsTop,
                habitsTop,
                pomoMinutes,
                pomoCount,
                todoDone,
                images,
            };
        }

        /* ================= 密码提示与密保 ================= */

        public object VaultSetHint(string hint)
        {
            // 提示只针对「主密码」。用独立密码的规则不显示它，免得把两把钥匙的线索混在一起。
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultHint',$h)", ("$h", hint ?? ""));
            return new { ok = true };
        }

        public object VaultQaList()
        {
            return Rows("SELECT id,question,sort FROM vault_qa ORDER BY sort, rowid")
                .Select(r => new { id = Str(r["id"]), question = Str(r["question"]) }).ToList();
        }

        /// <summary>
        /// 整体覆盖保存密保问题。
        /// 早先的实现用 INSERT OR REPLACE 但每次生成新 id，等于「又插一条」，
        /// 结果问题一份变两份（验收时就是这么发现的）。现在统一：先全删，再按顺序插。
        /// </summary>
        public object VaultQaSave(JsonElement list)
        {
            if (list.ValueKind != JsonValueKind.Array) return new { ok = false, err = "格式不对" };
            var old = Rows("SELECT * FROM vault_qa ORDER BY sort, rowid");
            var items = list.EnumerateArray().ToList();
            if (items.Count > 5) return new { ok = false, err = "最多 5 个密保问题" };

            var rows = new List<(string q, string h, string salt)>();
            for (int i = 0; i < items.Count; i++)
            {
                var q = items[i].TryGetProperty("question", out var qe) ? (qe.GetString() ?? "").Trim() : "";
                var ans = items[i].TryGetProperty("answer", out var ae) ? (ae.GetString() ?? "").Trim() : "";
                if (string.IsNullOrEmpty(q)) continue;

                if (!string.IsNullOrEmpty(ans))
                {
                    var (h, salt) = MakeHash(ans);
                    rows.Add((q, h, salt));
                }
                else if (i < old.Count)
                {
                    // 答案留空 = 沿用同序号那条的答案（前端目前要求重填，这里留个兜底）
                    rows.Add((q, Str(old[i]["answer_hash"]), Str(old[i]["answer_salt"])));
                }
            }

            Exec("DELETE FROM vault_qa");
            int n = 0;
            foreach (var r in rows)
            {
                n++;
                Exec(@"INSERT INTO vault_qa(id,question,answer_hash,answer_salt,sort,created_at)
                       VALUES($i,$q,$h,$s,$o,$c)",
                    ("$i", NewId()), ("$q", r.q), ("$h", r.h), ("$s", r.salt), ("$o", n), ("$c", Now));
            }
            return new { ok = true, count = n };
        }

        private int VerifyQa(JsonElement answers)
        {
            var qa = Rows("SELECT * FROM vault_qa ORDER BY sort, rowid");
            if (qa.Count == 0) return -1;                       // 没设密保
            if (answers.ValueKind != JsonValueKind.Array) return 0;
            var list = answers.EnumerateArray().Select(x => x.GetString() ?? "").ToList();
            int ok = 0;
            for (int i = 0; i < qa.Count; i++)
            {
                var a = i < list.Count ? list[i].Trim() : "";
                if (a.Length == 0) continue;
                if (CheckHash(a, Str(qa[i]["answer_hash"]), Str(qa[i]["answer_salt"]))) ok++;
            }
            return ok;
        }

        public object VaultQaVerify(JsonElement answers)
        {
            var qa = Rows("SELECT * FROM vault_qa");
            var ok = VerifyQa(answers);
            if (ok < 0) return new { ok = false, err = "还没有设置密保问题", total = 0, matched = 0 };
            return new { ok = ok == qa.Count && qa.Count > 0, matched = ok, total = qa.Count };
        }

        /// <summary>
        /// 答对密保后重设主密码；newPassword 为空 = 清掉全部密码保护（数据保留）。
        /// 独立密码（有自己 hash 的规则）不动 —— 那是另一把钥匙，不能靠密保绕过。
        /// </summary>
        public object VaultResetByQa(JsonElement answers, string newPassword)
        {
            var qa = Rows("SELECT * FROM vault_qa");
            if (qa.Count == 0) return new { ok = false, err = "还没有设置密保问题" };
            var ok = VerifyQa(answers);
            if (ok != qa.Count) return new { ok = false, err = "密保答案不正确", matched = ok, total = qa.Count };

            if (string.IsNullOrEmpty(newPassword))
            {
                // 彻底清掉保护：主密码、所有规则、密保一起删。数据本身一条不动。
                Exec("DELETE FROM meta WHERE k IN ('vaultMainHash','vaultMainSalt','vaultHint')");
                Exec("DELETE FROM vault");
                Exec("DELETE FROM vault_qa");
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultEnabled','0')");
                _unlocked.Clear();
                return new { ok = true, cleared = true };
            }

            if (newPassword.Length < 4) return new { ok = false, err = "新密码至少 4 位" };
            var (h, s) = MakeHash(newPassword);
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultMainHash',$h)", ("$h", h));
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultMainSalt',$s)", ("$s", s));
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultEnabled','1')");
            _unlocked.Clear();
            return new { ok = true, cleared = false };
        }

        /* ================= 分享落盘 ================= */

        private string ShareDir
        {
            get
            {
                var d = Path.Combine(ExportDir, "分享");
                Directory.CreateDirectory(d);
                return d;
            }
        }

        public object ShareSaveImage(string dataUrl, string name)
        {
            if (string.IsNullOrEmpty(dataUrl)) return new { ok = false, err = "没有图片数据" };
            var i = dataUrl.IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
            if (i < 0) return new { ok = false, err = "不是 base64 图片" };
            var b64 = dataUrl.Substring(i + 7);
            var bytes = Convert.FromBase64String(b64);

            var safe = string.Join("_", (string.IsNullOrWhiteSpace(name) ? "日签分享" : name).Split(Path.GetInvalidFileNameChars()));
            var path = Path.Combine(ShareDir, safe + ".png");
            File.WriteAllBytes(path, bytes);
            return new { ok = true, path, kb = bytes.Length / 1024 };
        }

        public object ShareCopyImage(string dataUrl)
        {
            var i = (dataUrl ?? "").IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
            if (i < 0) return new { ok = false, err = "没有图片数据" };
            // 剪贴板是 Windows 专有的，走 Platform 那一层，别在数据层直接引用 WinForms
            return Platform.CopyImage(dataUrl);
        }

        public object ShareCopyText(string text)
        {
            return Platform.CopyText(text);
        }

        /// <summary>分享页：一个可以发给别人、双击就能看的静态 HTML。</summary>
        public object ShareSaveHtml(string html, string name)
        {
            var safe = string.Join("_", (string.IsNullOrWhiteSpace(name) ? "日签分享" : name).Split(Path.GetInvalidFileNameChars()));
            var path = Path.Combine(ShareDir, safe + ".html");
            File.WriteAllText(path, html ?? "", Encoding.UTF8);
            return new { ok = true, path };
        }
    }
}
