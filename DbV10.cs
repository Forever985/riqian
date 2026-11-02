using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// v10：B1–B4 的共享底座。
    /// 只放"多个模块都要用"的东西：归档/回收、媒体分类与调色、记账、提醒、打气话、
    /// 排行榜、历史版本去重。具体页面各写各的，不塞进来。
    /// </summary>
    public partial class Db
    {
        public void EnsureV10()
        {
            // 背景调色：图还是那张图，参数跟着这一天走（第 78 条）
            EnsureColumn("entries", "bg_tone", "TEXT DEFAULT ''");

            // 记账：账户与周期账单（第 97 条）
            Exec(@"CREATE TABLE IF NOT EXISTS accounts(
                id TEXT PRIMARY KEY, name TEXT, kind TEXT DEFAULT 'cash',
                init REAL DEFAULT 0, sort INTEGER DEFAULT 0,
                created_at TEXT, deleted_at TEXT)");
            Exec(@"CREATE TABLE IF NOT EXISTS ledger_recur(
                id TEXT PRIMARY KEY, kind TEXT, amount REAL DEFAULT 0, cat TEXT DEFAULT '',
                note TEXT DEFAULT '', account_id TEXT DEFAULT '', day INTEGER DEFAULT 1,
                enabled INTEGER DEFAULT 1, last_month TEXT DEFAULT '', created_at TEXT)");

            // 打卡：删除 → 回收站 → 彻底删
            EnsureColumn("habits", "deleted_at", "TEXT DEFAULT NULL");
            EnsureColumn("habits", "deleted_from", "TEXT DEFAULT ''");

            // 笔记本可以分组（parent_id 指向另一个 notebook）
            EnsureColumn("notebooks", "parent_id", "TEXT DEFAULT ''");

            // 媒体：分类 + 调色参数（JSON：{b:亮度,c:对比度,s:饱和度,o:不透明度}）
            EnsureColumn("media", "kind", "TEXT DEFAULT ''");
            EnsureColumn("media", "tone", "TEXT DEFAULT ''");
            // 第 151 条：媒体库要能分类（文件夹）和起别名
            EnsureColumn("media", "folder", "TEXT DEFAULT ''");
            EnsureColumn("media", "alias", "TEXT DEFAULT ''");
            // 第 151 条：除了文件夹，还要能打标签（一个文件可以同时属于多个分类）。
            // 逗号分隔而不是单开一张关联表 —— 媒体库的标签只做筛选，不做统计，
            // 关联表会多出两张表和一套增删改，收益不抵复杂度。
            EnsureColumn("media", "tags", "TEXT DEFAULT ''");

            Exec(@"CREATE TABLE IF NOT EXISTS ledger(
                id TEXT PRIMARY KEY, date TEXT, kind TEXT, amount REAL DEFAULT 0,
                cat TEXT DEFAULT '', note TEXT DEFAULT '', account_id TEXT DEFAULT '',
                created_at TEXT, deleted_at TEXT)");
            Exec(@"CREATE TABLE IF NOT EXISTS alarms(
                id TEXT PRIMARY KEY, kind TEXT, title TEXT, at_time TEXT,
                repeat TEXT DEFAULT 'daily', enabled INTEGER DEFAULT 1,
                last_fire TEXT DEFAULT '', interval_min INTEGER DEFAULT 0,
                mode TEXT DEFAULT '', sound TEXT DEFAULT '', advance INTEGER DEFAULT 0,
                snooze_until TEXT DEFAULT '', created_at TEXT)");

            // 老库补列：必须放在建表之后 —— 首次运行时表还不存在，
            // ALTER 会静默失败（第 97 条就是这么漏掉 account_id 的，查了半天）
            EnsureColumn("ledger", "account_id", "TEXT DEFAULT ''");
            EnsureColumn("alarms", "interval_min", "INTEGER DEFAULT 0");
            // 第 143 条：方式（弹窗/响铃/都要/静默）、声音、提前量、贪睡
            EnsureColumn("alarms", "mode", "TEXT DEFAULT ''");
            EnsureColumn("alarms", "sound", "TEXT DEFAULT ''");
            EnsureColumn("alarms", "advance", "INTEGER DEFAULT 0");
            EnsureColumn("alarms", "snooze_until", "TEXT DEFAULT ''");
            Exec(@"CREATE TABLE IF NOT EXISTS encourage(
                id TEXT PRIMARY KEY, kind TEXT DEFAULT 'text', text TEXT DEFAULT '',
                media_id TEXT DEFAULT '', enabled INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at TEXT)");

            // 标签预设（第 116 条）：写日记时一键加，设置里可改
            SeedDefault("tagPresets", "工作,生活,灵感");
            SeedDefault("minimizeTip", "1");   // 收进托盘时是否弹"日签还在运行"（第 85 条）
            // 第 21 条：节日提醒。默认开 —— 这本来就是用户想要的「人文性」，
            // 提前 1 天说一声最自然（当天才说等于没做准备的时间）
            SeedDefault("festivalRemindOn", "1");
            SeedDefault("festivalRemindLead", "1");
            SeedDefault("festivalRemindAt", "08:00");
            SeedDefault("timeFormat", "24");        // 24 | 12
            SeedDefault("dateFormat", "");          // 第 106 条：空=跟语言 ymd|dmy|mdy
            SeedDefault("timezone", "local");       // local 或 +08:00 之类
            SeedDefault("fontFamily", "");          // 空 = 默认
            SeedDefault("experimental", "0");       // 实验性功能总开关
            SeedDefault("flowDir", "v");            // 流的方向：v 纵向 / h 横向
            SeedDefault("pageGap", "16");           // 页面卡片间距
            // 第 83 条：待办左栏宽度与「能不能拖」。用户要「自由设置 + 自由拖动 + 可关掉拖动」
            SeedDefault("todoRailW", "196");
            SeedDefault("todoRailDrag", "1");
            // 第 153 条：默认从 1080 改成 auto —— 1080 在 2560 宽的最大化窗口里
            // 两侧各留几百像素死白，用户原话「完全丧失了中间空白的功能」。
            // 注意这条只在**首次**写默认值，老库已经被写成数字的不会被改。
            SeedDefault("pageWidth", "full");       // full | auto(1600) | 具体像素
            SeedDefault("navHoverExpand", "1");     // 折叠时悬停自动展开
            // 第 122 条：Markdown / BBCode 双栏比例（百分比）。原来写死 1fr 1fr，
            // 在 1080 的内容区里每栏只剩 ~370px，用户说「只有窄窄一点」。
            SeedDefault("mdSplit", "50");
            SeedDefault("focusWrite", "0");         // 专注写作：收掉「今天」页右边边栏
            SeedDefault("ledgerCurrency", "¥");
            SeedDefault("bgGlobal", "");            // 全局背景（色值或媒体 id）
            SeedDefault("bgRotate", "0");           // 全局背景轮换秒数，0 = 不轮换
            SeedDefault("alarmSound", "1");

            // 老媒体的 kind 补一遍（图片/音频/视频）
            try
            {
                if (Scalar("SELECT v FROM meta WHERE k='v10MediaKind'") == null)
                {
                    foreach (var r in Rows("SELECT id,ext FROM media"))
                    {
                        var ext = Str(r["ext"]).ToLowerInvariant();
                        var kind = AudioExt(ext) ? "audio" : VideoExt(ext) ? "video" : "image";
                        Exec("UPDATE media SET kind=$k WHERE id=$i", ("$k", kind), ("$i", Str(r["id"])));
                    }
                    Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('v10MediaKind','1')");
                }
            }
            catch { }
        }

        private static bool AudioExt(string e) => e is "mp3" or "m4a" or "aac" or "wav" or "flac" or "ogg" or "opus";
        private static bool VideoExt(string e) => e is "mp4" or "webm" or "mov" or "mkv" or "avi" or "m4v";

        /* ================= 打卡：回收站 ================= */

        public object HabitSoftDelete(string id)
        {
            Exec("UPDATE habits SET deleted_at=$t WHERE id=$i", ("$t", Now), ("$i", id));
            Touch("habits", id, "del", 1);
            return new { ok = true };
        }

        public object HabitUndoDelete(string id)
        {
            Exec("UPDATE habits SET deleted_at=NULL WHERE id=$i", ("$i", id));
            Touch("habits", id, "upd", 1);
            return new { ok = true };
        }

        public object HabitHardPurge(string id)
        {
            Exec("DELETE FROM habits WHERE id=$i", ("$i", id));
            Exec("DELETE FROM habit_logs WHERE habit_id=$i", ("$i", id));
            Exec("DELETE FROM checks WHERE habit_id=$i", ("$i", id));
            return new { ok = true };
        }

        public object HabitTrash()
        {
            return Rows("SELECT * FROM habits WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
                .Select(r => new { id = Str(r["id"]), name = Str(r["name"]), color = Str(r["color"]), deletedAt = Str(r["deleted_at"]) })
                .ToList();
        }

        /// <summary>打卡统计：总量 / 完成率 / 每天完成数（近 N 天）</summary>
        public object HabitStats(int days)
        {
            if (days <= 0) days = 30;
            var to = Today;
            var from = DateTime.Now.AddDays(-(days - 1)).ToString("yyyy-MM-dd");
            var habits = Rows("SELECT id,name FROM habits WHERE deleted_at IS NULL").ToList();
            var perDay = new List<object>();
            for (var d = DateTime.ParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture);
                 d <= DateTime.ParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture); d = d.AddDays(1))
            {
                var k = d.ToString("yyyy-MM-dd");
                var n = Int(Scalar(@"SELECT COUNT(*) FROM habit_logs WHERE date=$d AND val NOT IN ('','null','false','0','[]')", ("$d", k)));
                perDay.Add(new { date = k, done = n });
            }
            var ranks = habits.Select(h =>
            {
                var id = Str(h["id"]);
                var done = Int(Scalar(@"SELECT COUNT(*) FROM habit_logs WHERE habit_id=$i AND date>=$f AND date<=$t
                                        AND val NOT IN ('','null','false','0','[]')", ("$i", id), ("$f", from), ("$t", to)));
                return new { id, name = Str(h["name"]), done };
            }).OrderByDescending(x => x.done).ToList();

            return new { from, to, days, total = habits.Count, perDay, ranks };
        }

        /* ================= 笔记：彻底删除 + 分组 ================= */

        public object NotePurge(string id)
        {
            Exec("DELETE FROM notes WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        public object NotePurgeAll()
        {
            var n = Int(Scalar("SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL"));
            Exec("DELETE FROM notes WHERE deleted_at IS NOT NULL");
            return new { ok = true, removed = n };
        }

        public object NotebookAdd2(string name, string color, string parentId)
        {
            var id = NewId();
            var sort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM notebooks")) + 10;
            Exec(@"INSERT INTO notebooks(id,name,color,sort,parent_id,created_at,updated_at)
                   VALUES($i,$n,$c,$s,$p,$t,$t)",
                ("$i", id), ("$n", name), ("$c", color), ("$s", sort), ("$p", parentId ?? ""), ("$t", Now));
            return new { ok = true, id };
        }

        /// <summary>
        /// 设置笔记本的上级。**转发到 NotebookSetParent2**，不要在这里另写一份。
        ///
        /// 这里原来是一句裸 UPDATE，没有任何防环 —— 把 A 挂到 B 下、再把 B 挂到 A 下，
        /// 就能造出互为父子的死循环，前端递归渲染会直接爆栈。
        /// 前端现在走的是 parent2，所以这版没人调用；但它在 RpcCatalog 里是有登记的，
        /// 将来任何新代码或插件调一下就能把库弄坏。留着两份实现迟早还会走岔，所以让它直接委托。
        /// </summary>
        public object NotebookSetParent(string id, string parentId) => NotebookSetParent2(id, parentId);

        /* ================= 媒体：分类 / 调色 ================= */

        /// <summary>
        /// 媒体列表（第 151 / 189 条）。
        ///
        /// sort + dir 两维：按时间 / 名称 / 大小，各自能升降。排序下推到 SQL，
        /// 前端只负责画。显示名优先用别名（alias），没有才回退到原始文件名。
        /// </summary>
        public object MediaList2(string kind, string q, string sort = "new", string dir = "desc", string folder = "", string tag = "")
        {
            var sb = new StringBuilder("SELECT * FROM media WHERE deleted_at IS NULL");
            var ps = new List<(string, object)>();
            if (!string.IsNullOrWhiteSpace(kind) && kind != "all") { sb.Append(" AND kind=$k"); ps.Add(("$k", kind)); }
            if (!string.IsNullOrWhiteSpace(q))
            {
                sb.Append(" AND (IFNULL(alias,'') LIKE $q OR orig_name LIKE $q OR id LIKE $q OR note LIKE $q OR IFNULL(tags,'') LIKE $q)");
                ps.Add(("$q", "%" + q.Trim() + "%"));
            }
            if (!string.IsNullOrWhiteSpace(folder))
            {
                if (folder == "__none__") sb.Append(" AND IFNULL(folder,'')=''");
                else
                {
                    /*
                     * 第 220 条：点父文件夹要能看到子层的文件（也就是「递归」）。
                     * 层级用 `/` 分隔，所以条件是「等于它」或者「以 它+斜杠 开头」。
                     *
                     * 注意这里必须精确匹配「它 + /」而不只是「以它开头」——
                     * 否则选中「旅行」会把「旅行照」也带进来（那个是另一层的平名字）。
                     */
                    sb.Append(" AND (IFNULL(folder,'')=$fd OR IFNULL(folder,'') LIKE $fdsub)");
                    ps.Add(("$fd", folder));
                    ps.Add(("$fdsub", folder + "/%"));
                }
            }
            // 第 151 条：按标签筛。标签是逗号串，两头补逗号再找，避免「风景」命中「风景照」
            if (!string.IsNullOrWhiteSpace(tag))
            {
                sb.Append(" AND (','||IFNULL(tags,'')||',') LIKE $tg");
                ps.Add(("$tg", "%," + tag.Trim() + ",%"));
            }

            var desc = !string.Equals(dir, "asc", StringComparison.OrdinalIgnoreCase);
            var byName = "IFNULL(NULLIF(alias,''), orig_name), id";
            sb.Append(sort switch
            {
                "size" => desc ? " ORDER BY bytes DESC, created_at DESC" : " ORDER BY bytes ASC, created_at DESC",
                "name" => desc ? $" ORDER BY {byName} DESC" : $" ORDER BY {byName} ASC",
                "old" => " ORDER BY created_at ASC, id",
                _ => desc ? " ORDER BY created_at DESC, id" : " ORDER BY created_at ASC, id",
            });
            return Rows(sb.ToString(), ps.ToArray()).Select(r => new
            {
                id = Str(r["id"]),
                file = LocalFileOf(Str(r["id"]), Str(r["ext"])),
                thumb = ThumbName(Str(r["id"])),
                name = Str(r["orig_name"]),
                alias = Str(r["alias"]),
                folder = Str(r["folder"]),
                tags = Str(r["tags"]),
                note = Str(r["note"]),
                kind = Str(r["kind"]) == "" ? "image" : Str(r["kind"]),
                ext = Str(r["ext"]),
                bytes = Int(r["bytes"]),
                width = Int(r["width"]),
                height = Int(r["height"]),
                tone = Str(r["tone"]),
                createdAt = Str(r["created_at"]),
            }).ToList();
        }

        /// <summary>改别名（第 151 条）：只影响显示和搜索，磁盘上的文件名不动</summary>
        public object MediaSetAlias(string id, string alias)
        {
            Exec("UPDATE media SET alias=$a, updated_at=$u WHERE id=$i",
                ("$a", (alias ?? "").Trim()), ("$u", Now), ("$i", id));
            return new { ok = true };
        }

        /// <summary>
        /// 改标签（第 151 条）：媒体库也要能打标签，一个文件可以属于多个分类。
        /// 存的是逗号分隔串，写入前统一去重、去空白、去重名。
        /// </summary>
        public object MediaSetTags(string id, string tags)
        {
            Exec("UPDATE media SET tags=$t, updated_at=$u WHERE id=$i",
                ("$t", NormalizeTags(tags)), ("$u", Now), ("$i", id));
            return new { ok = true, tags = NormalizeTags(tags) };
        }

        /// <summary>标签串规整：按逗号/顿号/空格切，去空去重，用半角逗号连回去</summary>
        private static string NormalizeTags(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            var parts = raw.Split(new[] { ',', '，', '、', ';', '；', ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim()).Where(x => x.Length > 0);
            // 保序去重：HashSet 会打乱顺序，用户刚排好的顺序不该被悄悄改掉
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var kept = new List<string>();
            foreach (var p in parts) if (seen.Add(p)) kept.Add(p);
            return string.Join(",", kept.Take(24));
        }

        /// <summary>
        /// 批量操作（第 154 条）：改文件夹 / 加标签 / 删标签 / 删除，一次调用处理一批。
        /// ids 用逗号分隔 —— 这里只要一串 id，不值得再走 JSON。
        /// 删除走软删（deleted_at），和媒体库原来的回收语义一致。
        /// </summary>
        public object MediaBulk(string ids, string action, string value)
        {
            var list = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
            if (list.Count == 0) return new { ok = true, n = 0 };

            var n = 0;
            foreach (var id in list)
            {
                if (action == "delete")
                {
                    Exec("UPDATE media SET deleted_at=$u, updated_at=$u, rev=rev+1 WHERE id=$i AND deleted_at IS NULL",
                        ("$u", Now), ("$i", id));
                }
                else if (action == "folder")
                {
                    Exec("UPDATE media SET folder=$f, updated_at=$u, rev=rev+1 WHERE id=$i",
                        ("$f", (value ?? "").Trim()), ("$u", Now), ("$i", id));
                }
                else if (action == "tag" || action == "untag")
                {
                    // 批量打标签要读-改-写：每个文件的现有标签都不一样，只能一个条个来
                    var one = Rows("SELECT IFNULL(tags,'') AS t FROM media WHERE id=$i", ("$i", id));
                    var cur = one.Count > 0 ? Str(one[0]["t"]) : "";
                    var mine = cur.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()).ToList();
                    var v = (value ?? "").Trim();
                    if (v.Length == 0) { n += 1; continue; }
                    if (action == "tag") { if (!mine.Contains(v)) mine.Add(v); }
                    else mine.RemoveAll(x => x == v);
                    Exec("UPDATE media SET tags=$t, updated_at=$u, rev=rev+1 WHERE id=$i",
                        ("$t", NormalizeTags(string.Join(",", mine))), ("$u", Now), ("$i", id));
                }
                else continue;
                n += 1;
            }
            return new { ok = true, n };
        }

        /// <summary>
        /// 文件夹清单（含「未分类」的计数），给筛选条用。
        ///
        /// 第 220 条：用户要「无限嵌套」。以前 folder 是一个平名字符串，
        /// 现在约定用 `/` 分隔层级（`旅行/2024/京都`），磁盘上的实际文件不动 ——
        /// 只是索引里多一段路径。这样不用改表结构，老数据（没有 `/`）自动就是第一层。
        ///
        /// 返回四项：
        ///   folder = 完整路径
        ///   name   = 最后一段（前端显示用）
        ///   own    = 只属于这一层的文件数（不含子层）
        ///   n      = 含所有子层的文件数（点进去实际会看到多少）
        ///   depth  = 层级深度，前端据此缩进
        /// </summary>
        public object MediaFolders()
        {
            var raw = Rows(@"SELECT IFNULL(folder,'') AS folder, COUNT(*) AS n
                         FROM media WHERE deleted_at IS NULL
                         GROUP BY 1 ORDER BY 1")
                .Select(r => new { folder = Str(r["folder"]), n = Int(r["n"]) })
                .Where(x => x.folder.Length > 0)
                .ToList();

            // 把沿途的中间层也补出来：有「旅行/2024/京都」就说明「旅行」「旅行/2024」也是文件夹，
            // 哪怕它们本身一个文件都没直接放。
            var all = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var x in raw)
            {
                var parts = x.folder.Split('/', StringSplitOptions.RemoveEmptyEntries);
                var acc = "";
                for (int i = 0; i < parts.Length; i++)
                {
                    acc = acc.Length == 0 ? parts[i] : acc + "/" + parts[i];
                    var isLeaf = i == parts.Length - 1;
                    all[acc] = (all.TryGetValue(acc, out var c) ? c : 0) + (isLeaf ? x.n : 0);
                }
            }

            var own = raw.ToDictionary(x => x.folder, x => x.n, StringComparer.Ordinal);
            return all.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv =>
                {
                    var parts = kv.Key.Split('/');
                    return new
                    {
                        folder = kv.Key,
                        name = parts[parts.Length - 1],
                        own = own.TryGetValue(kv.Key, out var o) ? o : 0,
                        n = kv.Value,
                        depth = parts.Length - 1,
                    };
                }).ToList();
        }

        /// <summary>
        /// 标签清单（第 151 条）：把逗号串拆开统计。
        /// 没有单独的标签表，所以在内存里聚合 —— 媒体库通常几千条，够用。
        /// </summary>
        public object MediaTags()
        {
            var rows = Rows("SELECT IFNULL(tags,'') AS t FROM media WHERE deleted_at IS NULL");
            var map = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var r in rows)
            {
                foreach (var t in Str(r["t"]).Split(',', StringSplitOptions.RemoveEmptyEntries))
                {
                    var k = t.Trim();
                    if (k.Length == 0) continue;
                    map[k] = (map.TryGetValue(k, out var c) ? c : 0) + 1;
                }
            }
            return map.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => new { tag = kv.Key, n = kv.Value }).ToList();
        }

        /// <summary>
        /// 重命名文件夹（第 151 条）：改名不该逼用户一个个挪文件。
        /// 第 220 条：有了层级之后，改名要连带整棵子树 —— 只改自己会把子文件夹变成孤儿。
        /// </summary>
        public object MediaRenameFolder(string from, string to)
        {
            var a = (from ?? "").Trim().Trim('/');
            var b = (to ?? "").Trim().Trim('/');
            if (a.Length == 0) return new { ok = false, n = 0 };

            var n = 0;
            // 先精确改自己
            Exec("UPDATE media SET folder=$b, updated_at=$u, rev=rev+1 WHERE IFNULL(folder,'')=$a",
                ("$b", b), ("$u", Now), ("$a", a));
            n += Int(Scalar("SELECT COUNT(*) FROM media WHERE IFNULL(folder,'')=$a AND deleted_at IS NULL", ("$a", b)));

            // 再把子层的路径前缀换掉：旅行/2024 → 出行/2024
            var kids = Rows("SELECT id, IFNULL(folder,'') AS f FROM media WHERE IFNULL(folder,'') LIKE $p AND deleted_at IS NULL",
                ("$p", a + "/%"));
            foreach (var k in kids)
            {
                var old = Str(k["f"]);
                var next = b + old.Substring(a.Length);
                Exec("UPDATE media SET folder=$b, updated_at=$u, rev=rev+1 WHERE id=$i",
                    ("$b", next), ("$u", Now), ("$i", Str(k["id"])));
                n++;
            }
            return new { ok = true, n };
        }

        public object MediaSetTone(string id, string tone)
        {
            Exec("UPDATE media SET tone=$t, updated_at=$u WHERE id=$i", ("$t", tone ?? ""), ("$u", Now), ("$i", id));
            return new { ok = true };
        }

        /* ================= 提醒 ================= */

        public object AlarmList()
        {
            return Rows("SELECT * FROM alarms ORDER BY at_time, created_at").Select(r => new
            {
                id = Str(r["id"]),
                kind = Str(r["kind"]),
                title = Str(r["title"]),
                atTime = Str(r["at_time"]),
                repeat = Str(r["repeat"]),
                enabled = Int(r["enabled"]),
                lastFire = Str(r["last_fire"]),
                intervalMin = Int(r["interval_min"]),
                // 第 143 条：方式 / 声音 / 提前量 / 贪睡
                mode = Str(r["mode"]),
                sound = Str(r["sound"]),
                advance = Int(r["advance"]),
                snoozeUntil = Str(r["snooze_until"]),
            }).ToList();
        }

        /// <summary>
        /// 存一条提醒。
        ///
        /// 第 143 条加的 mode / sound / advance 用「没传就保持原值」的语义：
        /// 老调用点（切换开关、仅一次的自动停用）只传原来那几个字段，
        /// 不能因为漏了新参数就把用户选好的方式和声音清掉。
        /// </summary>
        public object AlarmSave(string id, string kind, string title, string atTime, string repeat, int enabled, int intervalMin,
                                string mode = null, string sound = null, int advance = -1)
        {
            if (string.IsNullOrWhiteSpace(title)) title = "提醒";
            if (string.IsNullOrWhiteSpace(atTime)) atTime = "09:00";
            if (string.IsNullOrWhiteSpace(repeat)) repeat = "daily";
            if (intervalMin < 0) intervalMin = 0;
            if (string.IsNullOrEmpty(id))
            {
                id = NewId();

                /*
                 * 第 208 条的根因修复。
                 *
                 * 用户下午三点建了一个「每天 09:00」的提醒，30 秒后就响了。
                 * 原因是新建时 last_fire=''，而 AlarmsDue 的 daily 分支判的是
                 * `now >= dueAt && last_fire 不是今天` —— 15:00 >= 09:00 成立，当场响一次。
                 *
                 * 正确语义应该是：**新建的提醒从下一个时间点开始，不补响过去的那一次**。
                 * 所以这里在插入时就把 last_fire 填成「现在」，等于告诉轮询
                 * 「今天这一趟已经过去了」。
                 *
                 * 例外：如果时间点还没到（比如上午 8 点建 09:00 的），last_fire 留空，
                 * 到点正常响 —— 这是用户最想要的场景，不能被这次修复误伤。
                 */
                var stampNow = Now;
                var skippedToday = false;
                TimeSpan todParse;
                if (TimeSpan.TryParse(atTime, out todParse))
                {
                    var dueToday = DateTime.Today.Add(todParse).AddMinutes(-(advance < 0 ? 0 : advance));
                    if (enabled != 0 && DateTime.Now >= dueToday)
                    {
                        stampNow = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                        skippedToday = true;
                    }
                    else
                    {
                        stampNow = "";
                    }
                }

                Exec(@"INSERT INTO alarms(id,kind,title,at_time,repeat,enabled,last_fire,interval_min,mode,sound,advance,created_at)
                       VALUES($i,$k,$t,$a,$r,$e,$lf,$m,$md,$sd,$ad,$c)",
                    ("$i", id), ("$k", kind ?? "custom"), ("$t", title), ("$a", atTime),
                    ("$r", repeat), ("$e", enabled == 0 ? 0 : 1), ("$lf", stampNow), ("$m", intervalMin),
                    ("$md", mode ?? ""), ("$sd", sound ?? ""), ("$ad", advance < 0 ? 0 : advance), ("$c", Now));
                return new { ok = true, id, skippedToday };
            }
            else
            {
                var cur = Rows("SELECT * FROM alarms WHERE id=$i", ("$i", id)).FirstOrDefault();
                if (cur == null) return new { ok = false, id, err = "没有这条提醒" };
                if (mode == null) mode = Str(cur["mode"]);
                if (sound == null) sound = Str(cur["sound"]);
                if (advance < 0) advance = Int(cur["advance"]);

                Exec(@"UPDATE alarms SET kind=$k,title=$t,at_time=$a,repeat=$r,enabled=$e,interval_min=$m,
                       mode=$md,sound=$sd,advance=$ad WHERE id=$i",
                    ("$k", kind ?? "custom"), ("$t", title), ("$a", atTime),
                    ("$r", repeat), ("$e", enabled == 0 ? 0 : 1), ("$m", intervalMin),
                    ("$md", mode ?? ""), ("$sd", sound ?? ""), ("$ad", advance < 0 ? 0 : advance), ("$i", id));
            }
            return new { ok = true, id };
        }

        /// <summary>
        /// 稍后提醒：把 snooze_until 推到 now + minutes。
        ///
        /// 只动 snooze_until，不碰 last_fire —— 原提醒的下一次（明天 / 下一个工作日 /
        /// 下个间隔）照旧算，不会被贪睡打乱。AlarmsDue 里 snooze 到点会单独判一次。
        /// </summary>
        public object AlarmSnooze(string id, int minutes)
        {
            if (string.IsNullOrEmpty(id)) return new { ok = false, err = "缺少 id" };
            var m = minutes > 0 ? minutes : 5;
            if (m > 24 * 60) m = 24 * 60;
            var until = DateTime.Now.AddMinutes(m);
            var stamp = until.ToString("yyyy-MM-dd HH:mm:ss");
            Exec("UPDATE alarms SET snooze_until=$u WHERE id=$i", ("$u", stamp), ("$i", id));
            return new { ok = true, until = stamp, minutes = m };
        }

        public object AlarmDelete(string id)
        {
            Exec("DELETE FROM alarms WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        /// <summary>
        /// 现在该响的提醒。宿主每 30 秒问一次。
        ///
        /// 判定都基于「今天这个 at_time - advance」这个基准点（第 143 条：提前量）。
        /// 基准点由 SQLite 直接算出来（due_at），不在前端或 C# 里另算一遍：
        ///   due_at = datetime(今天 + at_time, '-advance minutes')
        ///
        /// 分支：
        /// - daily   今天到点、且今天还没响过
        /// - weekday 同上，但跳过周六日
        /// - once    没响过、且已到点（响完前端会把它停用）
        /// - every   从基准点起每 N 分钟一次，距上次响超过 N 分钟即认为到点
        /// - interval 每 N 天一次，按 last_fire 的日期算间隔
        /// - 贪睡     snooze_until 到点就直接响，不受上面任何分支限制
        ///
        /// 返回之前先写 last_fire，所以同一次不会被重复推两遍。
        /// </summary>
        public object AlarmsDue()
        {
            var now = DateTime.Now;
            var stamp = now.ToString("yyyy-MM-dd HH:mm:ss");
            var due = new List<object>();

            // due_at：把提前量交给 SQLite 算；snooze_due：贪睡是否到点
            foreach (var r in Rows(@"SELECT *,
                    datetime(date('now','localtime') || ' ' || IFNULL(NULLIF(at_time,''),'09:00'),
                             '-' || CAST(IFNULL(advance,0) AS TEXT) || ' minutes') AS due_at,
                    CASE WHEN IFNULL(snooze_until,'') <> ''
                              AND datetime(snooze_until) <= datetime('now','localtime')
                         THEN 1 ELSE 0 END AS snooze_due
                    FROM alarms WHERE enabled=1 ORDER BY at_time"))
            {
                var id = Str(r["id"]);
                var repeat = Str(r["repeat"]);
                if (string.IsNullOrEmpty(repeat)) repeat = "daily";
                var at = Str(r["at_time"]);
                TimeSpan tod;
                if (!TimeSpan.TryParse(at, out tod)) continue;
                var baseTime = DateTime.Today.Add(tod);

                DateTime last;
                var hasLast = DateTime.TryParse(Str(r["last_fire"]), out last);
                var fire = false;

                // 贪睡到点了：直接响一次，不动 last_fire —— 原提醒的每日/每 N 天节奏照旧
                if (Int(r["snooze_due"]) == 1)
                {
                    Exec("UPDATE alarms SET snooze_until='' WHERE id=$i", ("$i", id));
                    due.Add(new { id, kind = Str(r["kind"]), title = Str(r["title"]), mode = Str(r["mode"]), sound = Str(r["sound"]) });
                    continue;
                }

                // 提前量已在 SQL 里扣掉了，这里直接用 due_at 当基准点
                DateTime dueAt;
                if (!DateTime.TryParse(Str(r["due_at"]), out dueAt)) dueAt = baseTime;

                switch (repeat)
                {
                    case "once":
                        fire = !hasLast && now >= dueAt;
                        break;
                    case "weekday":
                        fire = now.DayOfWeek != DayOfWeek.Saturday && now.DayOfWeek != DayOfWeek.Sunday
                               && now >= dueAt && (!hasLast || last.Date < now.Date);
                        break;
                    case "interval":
                        {
                            if (now < dueAt) break;
                            var gap = Math.Max(1, Int(r["interval_min"]));
                            fire = !hasLast || (now.Date - last.Date).TotalDays >= gap;
                            break;
                        }
                    case "every":
                        {
                            if (now < dueAt) break;
                            var step = Math.Max(1, Int(r["interval_min"]));
                            // 给 30 秒轮询留一点余量，否则正好卡在边界上会漏一次
                            fire = !hasLast || (now - last).TotalMinutes >= step - 0.5;
                            break;
                        }
                    default:
                        fire = now >= dueAt && (!hasLast || last.Date < now.Date);
                        break;
                }

                if (!fire) continue;
                Exec("UPDATE alarms SET last_fire=$t WHERE id=$i", ("$t", stamp), ("$i", id));
                due.Add(new { id, kind = Str(r["kind"]), title = Str(r["title"]), mode = Str(r["mode"]), sound = Str(r["sound"]) });
            }

            return due;
        }

        /* ================= 首页打气话 ================= */

        public object EncourageList()
        {
            return Rows("SELECT * FROM encourage ORDER BY sort, created_at").Select(r => new
            {
                id = Str(r["id"]),
                kind = Str(r["kind"]),
                text = Str(r["text"]),
                mediaId = Str(r["media_id"]),
                enabled = Int(r["enabled"]),
                sort = Int(r["sort"]),
            }).ToList();
        }

        public object EncourageSave(string id, string kind, string text, string mediaId, int enabled)
        {
            if (string.IsNullOrEmpty(id))
            {
                id = NewId();
                // 步长和别处一致（0/10/20），以后要排序也不会插队
                var sort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM encourage")) + 10;
                Exec(@"INSERT INTO encourage(id,kind,text,media_id,enabled,sort,created_at)
                       VALUES($i,$k,$t,$m,$e,$s,$c)",
                    ("$i", id), ("$k", kind ?? "text"), ("$t", text ?? ""),
                    ("$m", mediaId ?? ""), ("$e", enabled == 0 ? 0 : 1), ("$s", sort), ("$c", Now));
            }
            else
            {
                Exec(@"UPDATE encourage SET kind=$k,text=$t,media_id=$m,enabled=$e WHERE id=$i",
                    ("$k", kind ?? "text"), ("$t", text ?? ""),
                    ("$m", mediaId ?? ""), ("$e", enabled == 0 ? 0 : 1), ("$i", id));
            }
            return new { ok = true, id };
        }

        public object EncourageDelete(string id)
        {
            Exec("DELETE FROM encourage WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        /* ================= 记账 ================= */

        public object LedgerAdd(string date, string kind, double amount, string cat, string note, string accountId = "")
        {
            var id = NewId();
            Exec(@"INSERT INTO ledger(id,date,kind,amount,cat,note,account_id,created_at) VALUES($i,$d,$k,$a,$c,$n,$ac,$t)",
                ("$i", id), ("$d", string.IsNullOrEmpty(date) ? Today : date), ("$k", kind),
                ("$a", amount), ("$c", cat ?? ""), ("$n", note ?? ""), ("$ac", accountId ?? ""), ("$t", Now));
            return new { ok = true, id };
        }

        public object LedgerDelete(string id)
        {
            Exec("DELETE FROM ledger WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        /// <summary>
        /// 改一笔账（第 159 条）。
        /// 只改传进来的字段：金额 <= 0 视为没传，其余用 null 表示没传。
        /// </summary>
        public object LedgerUpdate(string id, string date, string kind, double amount, string cat, string note, string accountId)
        {
            if (string.IsNullOrEmpty(id)) return new { ok = false, err = "no id" };
            if (!string.IsNullOrEmpty(date)) Exec("UPDATE ledger SET date=$v WHERE id=$i", ("$v", date), ("$i", id));
            if (!string.IsNullOrEmpty(kind)) Exec("UPDATE ledger SET kind=$v WHERE id=$i", ("$v", kind), ("$i", id));
            if (amount > 0) Exec("UPDATE ledger SET amount=$v WHERE id=$i", ("$v", amount), ("$i", id));
            if (cat != null) Exec("UPDATE ledger SET cat=$v WHERE id=$i", ("$v", cat), ("$i", id));
            if (note != null) Exec("UPDATE ledger SET note=$v WHERE id=$i", ("$v", note), ("$i", id));
            if (accountId != null) Exec("UPDATE ledger SET account_id=$v WHERE id=$i", ("$v", accountId), ("$i", id));
            return new { ok = true };
        }

        /// <summary>改分类名（第 159 条）：把用过这个分类的流水整体改名</summary>
        public object LedgerCatRename(string from, string to)
        {
            if (string.IsNullOrEmpty(from) || string.IsNullOrEmpty(to)) return new { ok = false };
            Exec("UPDATE ledger SET cat=$to WHERE cat=$from", ("$to", to), ("$from", from));
            return new { ok = true };
        }

        /// <summary>删掉一个分类（第 159 条）：流水不删，归到「其他」</summary>
        public object LedgerCatDrop(string cat, string to = "其他")
        {
            if (string.IsNullOrEmpty(cat)) return new { ok = false };
            Exec("UPDATE ledger SET cat=$to WHERE cat=$from", ("$to", string.IsNullOrEmpty(to) ? "其他" : to), ("$from", cat));
            return new { ok = true };
        }

        /// <summary>
        /// 一个月的账。
        ///
        /// 汇总（收入 / 支出 / 分类 / 按天小计）全部交给 SQLite 算，
        /// 前端只负责画 —— 见开发文档 §2.6、§7.7。
        /// 筛选条件也下推（kind / cat / kw），这样"筛完之后的合计"由数据库给，
        /// 前端不用再把几百行 reduce 一遍，也就不会出现"界面和合计对不上"。
        /// </summary>
        public object LedgerList(string from, string to, string kind = "", string cat = "", string kw = "")
        {
            if (string.IsNullOrEmpty(to)) to = Today;
            if (string.IsNullOrEmpty(from)) from = to.Substring(0, 8) + "01";

            var where = new System.Text.StringBuilder("date>=$f AND date<=$t AND deleted_at IS NULL");
            var args = new List<(string, object)> { ("$f", from), ("$t", to) };
            if (!string.IsNullOrEmpty(kind)) { where.Append(" AND kind=$k"); args.Add(("$k", kind)); }
            if (!string.IsNullOrEmpty(cat))
            {
                if (cat == "未分类") where.Append(" AND IFNULL(cat,'')=''");
                else { where.Append(" AND cat=$c"); args.Add(("$c", cat)); }
            }
            if (!string.IsNullOrEmpty(kw))
            {
                where.Append(" AND (cat LIKE $q OR note LIKE $q)");
                args.Add(("$q", "%" + kw + "%"));
            }
            var w = where.ToString();
            var a = args.ToArray();

            var items = Rows($@"SELECT * FROM ledger WHERE {w} ORDER BY date DESC, created_at DESC", a)
                .Select(r => new
                {
                    id = Str(r["id"]),
                    date = Str(r["date"]),
                    kind = Str(r["kind"]),
                    amount = Double(r["amount"]),      // 直接取数值，别再转字符串（T-19）
                    cat = Str(r["cat"]),
                    note = Str(r["note"]),
                    accountId = Str(r["account_id"]),
                    /* 罐子流水在账本里要显示，但它不是收支 ——
                       前端得知道这是转账，才能不把它算进"这天花了多少"，
                       并且给它一个不一样的标记（「存进罐子」而不是「支出」）。 */
                    jarId = Str(r["jar_id"]),
                }).ToList();

            /*
             * 第 97 条：储蓄罐的存入 / 取出也在 ledger 里，但它们**不是收支**。
             *
             * 用户把 2000 块放进储蓄罐，钱并没有花掉，只是从左口袋挪到右口袋。
             * 如果照 kind 记账本合计，这个月「支出」凭空多 2000，预算条立刻告急 —— 那是假的。
             * 所以所有合计（收入 / 支出 / 分类 / 按天）都排除 jar_id 非空的行，
             * 而明细列表仍然显示它们（用户在账本里应该看得见这笔钱去哪了）。
             */
            const string notJar = " AND IFNULL(jar_id,'')=''";

            // 收入 / 支出：一条 SQL
            var sums = Rows($@"SELECT
                    IFNULL(SUM(CASE WHEN kind='in'  THEN amount ELSE 0 END),0) AS income,
                    IFNULL(SUM(CASE WHEN kind='out' THEN amount ELSE 0 END),0) AS expense,
                    SUM(CASE WHEN kind='in'  THEN 1 ELSE 0 END) AS in_n,
                    SUM(CASE WHEN kind='out' THEN 1 ELSE 0 END) AS out_n
                FROM ledger WHERE {w}{notJar}", a).FirstOrDefault();
            var income = sums == null ? 0 : Double(sums["income"]);
            var expense = sums == null ? 0 : Double(sums["expense"]);
            var inN = sums == null ? 0 : Int(sums["in_n"]);
            var outN = sums == null ? 0 : Int(sums["out_n"]);

            // 分类汇总：一条 SQL
            var byCat = Rows($@"SELECT IFNULL(NULLIF(cat,''),'未分类') AS cat,
                    IFNULL(SUM(CASE WHEN kind='out' THEN amount ELSE 0 END),0) AS out_sum,
                    IFNULL(SUM(CASE WHEN kind='in'  THEN amount ELSE 0 END),0) AS in_sum
                FROM ledger WHERE {w}{notJar}
                GROUP BY 1 ORDER BY out_sum DESC", a)
                .Select(r => new
                {
                    cat = Str(r["cat"]),
                    outSum = Double(r["out_sum"]),
                    inSum = Double(r["in_sum"]),
                }).ToList();

            // 按天小计：一条 SQL，前端直接拿来当每天的抬头
            /* 注意 days 是**合计口径**：排掉了罐子流水。
               所以"那天只有存钱/取钱"的日子不会出现在这里 —— 这是对的（合计确实是 0），
               但前端不能拿它当渲染骨架，否则那些日子的明细永远显示不出来。
               骨架用下面那个 dayItems。 */
            var days = Rows($@"SELECT date,
                    IFNULL(SUM(CASE WHEN kind='in'  THEN amount ELSE 0 END),0) AS in_sum,
                    IFNULL(SUM(CASE WHEN kind='out' THEN amount ELSE 0 END),0) AS out_sum,
                    SUM(CASE WHEN kind='in'  THEN 1 ELSE 0 END) AS in_n,
                    SUM(CASE WHEN kind='out' THEN 1 ELSE 0 END) AS out_n,
                    COUNT(*) AS n
                FROM ledger WHERE {w}{notJar}
                GROUP BY date ORDER BY date DESC", a)
                .Select(r => new
                {
                    date = Str(r["date"]),
                    inSum = Double(r["in_sum"]),
                    outSum = Double(r["out_sum"]),
                    inN = Int(r["in_n"]),
                    outN = Int(r["out_n"]),
                    n = Int(r["n"]),
                }).ToList();

            /* 渲染骨架：**明细口径**，不排罐子。
               凡是 items 里出现过的日期都在这里，前端照这个分组就不会漏。
               罐子流水那天没有收支小计，所以 sum 全是 0 —— 前端显示时算 0 即可。 */
            var dayItems = Rows($@"SELECT date, COUNT(*) AS n
                FROM ledger WHERE {w}
                GROUP BY date ORDER BY date DESC", a)
                .Select(r => new { date = Str(r["date"]), n = Int(r["n"]) }).ToList();

            // 下拉要用的全部分类，不能受 cat 筛选影响，否则选了就只剩一个
            /* 但罐子流水的分类（「存钱」）要排掉 —— 那不是用户能选的花销分类，
               留着会在下拉里永久多出一项，选中后合计恒为 0，看着像坏了。 */
            var allCats = Rows(@"SELECT DISTINCT cat FROM ledger
                    WHERE date>=$f AND date<=$t AND deleted_at IS NULL
                      AND IFNULL(jar_id,'')='' AND IFNULL(cat,'')<>''
                    ORDER BY cat", ("$f", from), ("$t", to))
                .Select(r => Str(r["cat"])).ToList();

            return new { from, to, items, income, expense, balance = income - expense, inN, outN, byCat, days, dayItems, allCats };
        }

        /// <summary>
        /// 账户列表：余额、本月流入流出都由 SQL 算好（§2.6）。
        /// 前端只负责画条和数字，不再自己把流水撸一遍。
        /// </summary>
        public object LedgerAccounts()
        {
            var from = DateTime.Today.ToString("yyyy-MM-01");
            /*
             * 第 97 条：账户余额必须**包含**储蓄罐的存取。
             *
             * 钱从银行卡挪进储蓄罐，银行卡余额就是少了 —— 这是真的减少了，
             * 不是"账本口径"的问题。所以 delta 要算上罐子流水，
             * 但**符号要反过来**（见 Db.AccountDeltaSql 的注释：罐子流水的 kind 是罐子方向）。
             * 只有 monthIn / monthOut 这两列（账本上显示「本月流入/流出」）
             * 要排掉储蓄罐，否则用户会看到「本月支出 4000」但实际只花了 2000。
             */
            return Rows($@"SELECT a.*,
                    IFNULL((SELECT {AccountDeltaSql}
                            FROM ledger l WHERE l.account_id=a.id AND l.deleted_at IS NULL), 0) AS delta,
                    IFNULL((SELECT SUM(CASE WHEN l.kind='in' THEN l.amount ELSE 0 END)
                            FROM ledger l WHERE l.account_id=a.id AND l.deleted_at IS NULL AND l.date>=$f
                              AND IFNULL(l.jar_id,'')=''), 0) AS m_in,
                    IFNULL((SELECT SUM(CASE WHEN l.kind='out' THEN l.amount ELSE 0 END)
                            FROM ledger l WHERE l.account_id=a.id AND l.deleted_at IS NULL AND l.date>=$f
                              AND IFNULL(l.jar_id,'')=''), 0) AS m_out
                FROM accounts a WHERE a.deleted_at IS NULL ORDER BY a.sort, a.created_at",
                ("$f", from))
                .Select(r => new
                {
                    id = Str(r["id"]),
                    name = Str(r["name"]),
                    kind = Str(r["kind"]),
                    init = Double(r["init"]),
                    balance = Double(r["init"]) + Double(r["delta"]),
                    monthIn = Double(r["m_in"]),
                    monthOut = Double(r["m_out"]),
                    /* 第 221 条：账户可以自定义类型、单独设币种、停用而不删除 */
                    sort = Int(r["sort"]),
                    currency = Str(r["currency"]),
                    icon = Str(r["icon"]),
                    note = Str(r["note"]),
                    enabled = Int(r["enabled"]),
                }).ToList();
        }

        public object AccountSave(string id, string name, string kind, double init,
            string currency = null, string icon = null, string note = null)
        {
            if (string.IsNullOrWhiteSpace(name)) name = "现金";
            if (string.IsNullOrEmpty(id))
            {
                id = NewId();
                /* 第 221 条：新账户的 sort 接在最后一名的后面，不是永远 0 ——
                   否则每加一个都排在「第一个」的位置，拖着排完序再新增又会插到中间 */
                var nextSort = Int(Scalar("SELECT IFNULL(MAX(sort),0)+10 FROM accounts WHERE IFNULL(deleted_at,'')=''"));
                Exec(@"INSERT INTO accounts(id,name,kind,init,sort,created_at,currency,icon,note,enabled)
                       VALUES($i,$n,$k,$v,$s,$c,$cu,$ic,$no,1)",
                    ("$i", id), ("$n", name), ("$k", kind ?? "cash"), ("$v", init), ("$s", nextSort),
                    ("$c", Now), ("$cu", currency ?? ""), ("$ic", icon ?? ""), ("$no", note ?? ""));
            }
            else
            {
                /* 新字段传 null = 不改（老调用点只传前四个参数，不能把币种洗掉） */
                Exec("UPDATE accounts SET name=$n,kind=$k,init=$v WHERE id=$i",
                    ("$n", name), ("$k", kind ?? "cash"), ("$v", init), ("$i", id));
                if (currency != null)
                    Exec("UPDATE accounts SET currency=$cu WHERE id=$i", ("$cu", currency), ("$i", id));
                if (icon != null)
                    Exec("UPDATE accounts SET icon=$ic WHERE id=$i", ("$ic", icon), ("$i", id));
                if (note != null)
                    Exec("UPDATE accounts SET note=$no WHERE id=$i", ("$no", note), ("$i", id));
            }
            return new { ok = true, id };
        }

        public object AccountDelete(string id)
        {
            Exec("UPDATE accounts SET deleted_at=$t WHERE id=$i", ("$t", Now), ("$i", id));
            // 挂在它名下的流水不清空，只把归属置空，避免"删个账户把账也删了"
            Exec("UPDATE ledger SET account_id='' WHERE account_id=$i", ("$i", id));
            return new { ok = true };
        }

        public object LedgerRecurList()
        {
            return Rows("SELECT * FROM ledger_recur ORDER BY day, created_at").Select(r => new
            {
                id = Str(r["id"]),
                kind = Str(r["kind"]),
                amount = Str(r["amount"]),
                cat = Str(r["cat"]),
                note = Str(r["note"]),
                accountId = Str(r["account_id"]),
                day = Int(r["day"]),
                enabled = Int(r["enabled"]),
                lastMonth = Str(r["last_month"]),
            }).ToList();
        }

        public object LedgerRecurSave(string id, string kind, double amount, string cat, string note, string accountId, int day, int enabled)
        {
            if (day < 1) day = 1;
            if (day > 28) day = 28;   // 2 月只有 28 天：定在 28 号以内，避免"每月 31 号"漏月
            if (string.IsNullOrEmpty(id))
            {
                id = NewId();
                Exec(@"INSERT INTO ledger_recur(id,kind,amount,cat,note,account_id,day,enabled,created_at)
                       VALUES($i,$k,$a,$c,$n,$ac,$d,$e,$t)",
                    ("$i", id), ("$k", kind), ("$a", amount), ("$c", cat ?? ""), ("$n", note ?? ""),
                    ("$ac", accountId ?? ""), ("$d", day), ("$e", enabled), ("$t", Now));
            }
            else
            {
                Exec(@"UPDATE ledger_recur SET kind=$k,amount=$a,cat=$c,note=$n,account_id=$ac,day=$d,enabled=$e WHERE id=$i",
                    ("$k", kind), ("$a", amount), ("$c", cat ?? ""), ("$n", note ?? ""),
                    ("$ac", accountId ?? ""), ("$d", day), ("$e", enabled), ("$i", id));
            }
            return new { ok = true, id };
        }

        public object LedgerRecurDelete(string id)
        {
            Exec("DELETE FROM ledger_recur WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        /// <summary>
        /// 生成某个月的周期账单。幂等：每个规则用 last_month 记住"这个月已经生成过"，
        /// 反复打开记账页不会把同一笔房租记十遍。
        /// </summary>
        public object LedgerRecurRun(string month)
        {
            if (string.IsNullOrEmpty(month)) month = DateTime.Now.ToString("yyyy-MM");
            var made = 0;
            foreach (var r in Rows("SELECT * FROM ledger_recur WHERE enabled=1"))
            {
                if (Str(r["last_month"]) == month) continue;
                var day = Int(r["day"]);
                if (day < 1) day = 1;
                /*
                 * 第 160 条：以前只允许 1–28，等于把「每月 30 号交房租」这种最常见的需求挡在门外。
                 * 现在允许 1–31，超出当月天数就落到月末 —— 2 月写 31 号就是 2 月 28/29 号。
                 */
                var y = 1970; var m = 1;
                try { y = int.Parse(month.Substring(0, 4)); m = int.Parse(month.Substring(5, 2)); } catch { }
                var lastDay = DateTime.DaysInMonth(y, m);
                if (day > lastDay) day = lastDay;
                var date = month + "-" + day.ToString("00");
                Exec(@"INSERT INTO ledger(id,date,kind,amount,cat,note,account_id,created_at)
                       VALUES($i,$d,$k,$a,$c,$n,$ac,$t)",
                    ("$i", NewId()), ("$d", date), ("$k", Str(r["kind"])), ("$a", Double(r["amount"])),
                    ("$c", Str(r["cat"])), ("$n", Str(r["note"])), ("$ac", Str(r["account_id"])), ("$t", Now));
                Exec("UPDATE ledger_recur SET last_month=$m WHERE id=$i", ("$m", month), ("$i", Str(r["id"])));
                made++;
            }
            return new { ok = true, made, month };
        }

        /* ================= 多榜排行（第 126 条） ================= */

        /// <summary>把一串日期切成连续区间，按天数从大到小。打卡和日记共用这一套算法。</summary>
        private List<(string from, string to, int days)> RunsOf(List<string> dates)
        {
            var runs = new List<(string, string, int)>();
            if (dates.Count == 0) return runs;
            var start = dates[0];
            var prev = DateTime.ParseExact(start, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            var cur = start;
            foreach (var d in dates.Skip(1))
            {
                var dt = DateTime.ParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture);
                if ((dt - prev).TotalDays == 1) { prev = dt; cur = d; continue; }
                runs.Add((start, cur, (int)(prev - DateTime.ParseExact(start, "yyyy-MM-dd", CultureInfo.InvariantCulture)).TotalDays + 1));
                start = d; prev = dt; cur = d;
            }
            runs.Add((start, cur, (int)(prev - DateTime.ParseExact(start, "yyyy-MM-dd", CultureInfo.InvariantCulture)).TotalDays + 1));
            return runs;
        }

        /// <summary>第一榜：写作的连续区间 + 每天字数 Top（第 126 条）</summary>
        public object RankStreaks(int top)
        {
            if (top <= 0) top = 8;

            var dates = Rows("SELECT date FROM entries WHERE IFNULL(plain,'')<>'' ORDER BY date")
                .Select(r => Str(r["date"])).ToList();
            var runs = RunsOf(dates).OrderByDescending(r => r.days).Take(top)
                .Select(r => new { from = r.from, to = r.to, days = r.days }).ToList();
            var topDays = Rows(@"SELECT date, length(replace(IFNULL(plain,''),' ','')) AS chars
                                 FROM entries ORDER BY chars DESC LIMIT $l", ("$l", top))
                .Select(r => new { date = Str(r["date"]), chars = Int(r["chars"]) }).ToList();

            return new
            {
                runs,
                topDays,
                totalDays = dates.Count,
                best = runs.FirstOrDefault(),
            };
        }

        public object RankExtra(int top)
        {
            if (top <= 0) top = 5;

            var habitDates = Rows(@"SELECT DISTINCT date FROM habit_logs
                                    WHERE IFNULL(val,'')<>'' AND val<>'0' ORDER BY date")
                .Select(r => Str(r["date"])).ToList();
            var habitRuns = RunsOf(habitDates).OrderByDescending(r => r.days).Take(top)
                .Select(r => new { from = r.from, to = r.to, days = r.days }).ToList();
            var habitTop = Rows(@"SELECT h.name nm, COUNT(*) c FROM habit_logs l
                                  JOIN habits h ON h.id=l.habit_id
                                  WHERE IFNULL(l.val,'')<>'' AND l.val<>'0'
                                  GROUP BY l.habit_id ORDER BY c DESC LIMIT $l", ("$l", top))
                .Select(r => new { name = Str(r["nm"]), count = Int(r["c"]) }).ToList();

            var pomoTop = Rows(@"SELECT date, SUM(minutes) m, COUNT(*) c FROM pomodoro
                                 WHERE kind='focus' GROUP BY date ORDER BY m DESC LIMIT $l", ("$l", top))
                .Select(r => new { date = Str(r["date"]), minutes = Int(r["m"]), sessions = Int(r["c"]) }).ToList();
            var pomoDates = Rows("SELECT DISTINCT date FROM pomodoro WHERE kind='focus' ORDER BY date")
                .Select(r => Str(r["date"])).ToList();
            var pomoRuns = RunsOf(pomoDates).OrderByDescending(r => r.days).Take(top)
                .Select(r => new { from = r.from, to = r.to, days = r.days }).ToList();

            return new
            {
                habitTotal = habitDates.Count,
                habitRuns,
                habitTop,
                pomoTotal = pomoDates.Count,
                pomoRuns,
                pomoTop,
            };
        }

        /* ================= 历史版本去重 ================= */

        /// <summary>
        /// 版本列表按"内容指纹"去重：连续多次保存但正文没变时，只留最早的一条 + 最新的一条。
        /// 以前每 420ms 一存就一条，翻历史版本像在看同一段话的复读机。
        /// </summary>
        public object RevisionsDedup(string date)
        {
            var rows = Rows("SELECT * FROM revisions WHERE date=$d ORDER BY id", ("$d", date)).ToList();
            var outp = new List<object>();
            string lastKey = null;
            for (int i = 0; i < rows.Count; i++)
            {
                var r = rows[i];
                var snap = Str(r["snapshot"]);
                var key = snap.Length + ":" + snap.GetHashCode().ToString("X");
                var isLast = i == rows.Count - 1;
                if (key == lastKey && !isLast) continue;   // 和上一条内容一样，且不是最后一条 → 跳过
                // revisions 表只有 ts / snapshot 两列，没有 created_at / plain
                var snapText = Str(r["snapshot"]);
                outp.Add(new
                {
                    id = Int(r["id"]),
                    createdAt = Str(r["ts"]),
                    chars = snapText.Replace(" ", "").Length,
                    sameAsPrev = key == lastKey,
                });
                lastKey = key;
            }
            return outp;
        }
    }
}
