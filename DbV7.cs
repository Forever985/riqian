using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace Riqian
{
    /// <summary>
    /// v7 扩展：备忘录、用户中心、密码保护、缓存管理、设置导入导出、节日。
    /// 单独成文件，避免在 2000 行的 Db.cs 里穿插编辑。
    /// </summary>
    public partial class Db
    {
        /* ================= 建表与迁移 ================= */

        private void SeedDefault(string k, string v)
        {
            if (Scalar("SELECT v FROM meta WHERE k=$k", ("$k", k)) == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES($k,$v)", ("$k", k), ("$v", v));
        }

        public void EnsureV7()
        {
            Exec(@"
-- 备忘录：笔记本 + 笔记（笔记正文存 HTML，plain 用于搜索）
CREATE TABLE IF NOT EXISTS notebooks(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#b8623a',
  icon TEXT DEFAULT '',
  sort INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT DEFAULT NULL,
  rev INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notes(
  id TEXT PRIMARY KEY,
  notebook_id TEXT DEFAULT '',
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',
  plain TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT DEFAULT NULL,
  rev INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_note_nb ON notes(notebook_id, updated_at DESC);

-- 用户中心（单行）
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  nickname TEXT DEFAULT '',
  signature TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  birthday TEXT DEFAULT '',
  lunar_birthday TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT DEFAULT ''
);

-- 密码保护规则。hash/salt 为空表示「用主密码」
CREATE TABLE IF NOT EXISTS vault(
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  target TEXT DEFAULT '',
  label TEXT DEFAULT '',
  hash TEXT DEFAULT '',
  salt TEXT DEFAULT '',
  created_at TEXT,
  rev INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_vault ON vault(scope, target);

-- 用户自定义节日（生日、纪念日等）
CREATE TABLE IF NOT EXISTS festivals(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT DEFAULT '',
  lunar_month INTEGER DEFAULT 0,
  lunar_day INTEGER DEFAULT 0,
  yearly INTEGER DEFAULT 1,
  color TEXT DEFAULT '#b8623a',
  created_at TEXT,
  rev INTEGER DEFAULT 1
);
");
            // 新列（老库无损升级）
            EnsureColumn("todos", "repeat", "TEXT DEFAULT ''");
            EnsureColumn("countdowns", "repeat", "TEXT DEFAULT ''");
            EnsureColumn("media", "kind", "TEXT DEFAULT 'image'");     // image | audio | video | link
            EnsureColumn("media", "src_url", "TEXT DEFAULT ''");       // 网络链接（不缓存时直接用）
            EnsureColumn("media", "cached", "INTEGER DEFAULT 0");      // 网络链接是否已缓存到本地
            EnsureColumn("notes", "pinned", "INTEGER DEFAULT 0");

            // 默认设置
            SeedDefault("dayStart", "0");                 // 新的一天从几点开始（0-6）
            SeedDefault("moduleSortMode", "buttons");     // buttons | drag | both | off
            SeedDefault("habitSortMode", "drag");         // 同上；打卡排序独立于模块排序
            SeedDefault("todoView", "all");
            SeedDefault("tabMode", "0");                  // 选项卡模式
            SeedDefault("tabs", "[]");
            SeedDefault("welcomeOnStart", "1");           // 启动显示欢迎页

            // 提醒
            SeedDefault("notifyDesktop", "1");            // 自绘右下角弹窗
            SeedDefault("notifyTray", "0");               // 系统托盘气泡 / 通知中心
            SeedDefault("notifySound", "1");              // 提示音
            SeedDefault("notifySoundId", "");             // 音乐库里的音频 id，空 = 内置提示音
            SeedDefault("notifyVolume", "70");
            SeedDefault("dndEnabled", "0");               // 勿扰
            SeedDefault("dndFrom", "22:00");
            SeedDefault("dndTo", "07:00");
            SeedDefault("dndDuringPomo", "1");            // 专注进行中不打扰休息结束以外的提醒
            SeedDefault("minimizeToTray", "1");
            SeedDefault("notifyDuration", "8");           // 弹窗停留秒数

            // 番茄钟预设（JSON 数组，用户可改）
            SeedDefault("pomoPresets", "[15,25,35,45,60]");
            SeedDefault("pomoBreakPresets", "[3,5,10,15,30]");
            SeedDefault("pomoLongBreakEvery", "4");       // 每 4 颗长休息
            SeedDefault("pomoLongBreak", "20");
            SeedDefault("pomoAutoNext", "1");             // 自动进入下一段

            // 缓存
            SeedDefault("cacheDays", "30");
            SeedDefault("cacheMaxMB", "512");
            SeedDefault("cacheWarnMB", "400");
            SeedDefault("cacheAudio", "1");
            SeedDefault("cacheSuffix", "jpg,jpeg,png,webp,gif,mp3,m4a,wav,ogg,mp4");

            // 密码
            SeedDefault("vaultEnabled", "0");
            SeedDefault("vaultTimeout", "30");            // 解锁有效分钟数

            // 主题自定义（JSON：{ paper: {bg,panel,ink,accent,...} }）
            SeedDefault("themeCustom", "{}");

            // 单行用户
            if (Int(Scalar("SELECT COUNT(*) FROM users")) == 0)
                Exec("INSERT INTO users(id,nickname,signature,avatar,created_at) VALUES($i,'','','',$c)",
                    ("$i", NewId()), ("$c", Now));
            if (Int(Scalar("SELECT COUNT(*) FROM notebooks")) == 0)
            {
                foreach (var (n, c, s) in new (string, string, int)[] { ("随手记", "#4a7396", 0), ("工作", "#b8623a", 10), ("想法", "#5f8256", 20) })
                    Exec("INSERT INTO notebooks(id,name,color,sort,created_at,updated_at) VALUES($i,$n,$c,$s,$t,$t)",
                        ("$i", NewId()), ("$n", n), ("$c", c), ("$s", s), ("$t", Now));
            }
        }

        /* ================= 习惯排序 ================= */

        public object HabitReorder(string[] ids)
        {
            for (int i = 0; i < ids.Length; i++)
                Exec("UPDATE habits SET sort=$s, rev=rev+1, updated_at=$t WHERE id=$i",
                    ("$s", (i + 1) * 10), ("$t", Now), ("$i", ids[i]));
            Touch("habits", "order", "upd", 1, null);
            return new { ok = true };
        }

        /* ================= 备忘录 ================= */

        /// <summary>
        /// 笔记本列表。
        ///
        /// **parentId 必须返回。** 这里原来只给了 id / name / color / sort / count，
        /// 漏掉了 parent_id —— 而前端从第 220 条起就把「无限层级」整条链路
        /// 建在 b.parentId 上：左栏缩进、折叠箭头、跨层拖动、NotebookDialog 的
        /// 「换上级」下拉、MoveNoteDialog 的分组显示，全靠它判断父子。
        ///
        /// 后果不是「少显示一个字段」这么轻：parentId 恒为 undefined →
        /// 每个笔记本都被当成顶层 → 所有父子关系在界面上凭空消失，
        /// 但数据里 parent_id 是对的。用户看到的是「层级功能根本没用」，
        /// 而数据库里一切正常 —— 这种「数据对、显示错」最难查。
        ///
        /// 注意 RpcCatalog 里 notebooks.list 的说明写的就是「含 parentId」，
        /// 所以这是实现漏了，不是文档写错。
        /// </summary>
        public object Notebooks()
        {
            return Rows(@"
SELECT b.*, (SELECT COUNT(*) FROM notes n WHERE n.notebook_id=b.id AND n.deleted_at IS NULL) AS n
FROM notebooks b WHERE b.deleted_at IS NULL ORDER BY b.sort, b.rowid")
                .Select(r => new
                {
                    id = Str(r["id"]),
                    name = Str(r["name"]),
                    color = Str(r["color"]),
                    sort = Int(r["sort"]),
                    count = Int(r["n"]),
                    /* 空串 = 顶层。前端用 `!b.parentId` 判断，所以空串和 null 等价，统一给空串 */
                    parentId = r.ContainsKey("parent_id") ? Str(r["parent_id"]) : "",
                }).ToList();
        }

        public object NotebookAdd(string name, string color)
        {
            var id = NewId();
            var sort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM notebooks")) + 10;
            Exec("INSERT INTO notebooks(id,name,color,sort,created_at,updated_at) VALUES($i,$n,$c,$s,$t,$t)",
                ("$i", id), ("$n", name), ("$c", color ?? "#b8623a"), ("$s", sort), ("$t", Now));
            Touch("notebooks", id, "ins", 1, name);
            return new { ok = true, id };
        }

        public object NotebookUpdate(string id, string name, string color)
        {
            if (name != null) Exec("UPDATE notebooks SET name=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", name), ("$i", id), ("$t", Now));
            if (color != null) Exec("UPDATE notebooks SET color=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", color), ("$i", id), ("$t", Now));
            Touch("notebooks", id, "upd", 1, null);
            return new { ok = true };
        }

        public object NotebookDelete(string id)
        {
            Exec("UPDATE notebooks SET deleted_at=$t, updated_at=$t WHERE id=$i", ("$t", Now), ("$i", id));
            Exec("UPDATE notes SET deleted_at=$t WHERE notebook_id=$i AND deleted_at IS NULL", ("$t", Now), ("$i", id));
            Touch("notebooks", id, "del", 1, null);
            return new { ok = true };
        }

        public object Notes(string notebookId, string q, int limit)
        {
            if (limit <= 0) limit = 300;
            var sql = "SELECT id,notebook_id,title,plain,pinned,created_at,updated_at,rev,IFNULL(sort,0) AS sort,"
                + "IFNULL(color,'') AS color,IFNULL(icon,'') AS icon FROM notes WHERE deleted_at IS NULL";
            var ps = new List<(string, object)>();
            if (!string.IsNullOrEmpty(notebookId)) { sql += " AND notebook_id=$n"; ps.Add(("$n", notebookId)); }
            if (!string.IsNullOrEmpty(q)) { sql += " AND (title LIKE $q OR plain LIKE $q)"; ps.Add(("$q", "%" + q + "%")); }
            sql += " ORDER BY pinned DESC, updated_at DESC LIMIT " + limit;
            return Rows(sql, ps.ToArray()).Select(r => new
            {
                id = Str(r["id"]),
                notebookId = Str(r["notebook_id"]),
                title = Str(r["title"]),
                excerpt = Str(r["plain"]).Length > 90 ? Str(r["plain"]).Substring(0, 90) + "…" : Str(r["plain"]),
                pinned = Int(r["pinned"]),
                createdAt = Str(r["created_at"]),
                updatedAt = Str(r["updated_at"]),
                chars = Str(r["plain"]).Replace(" ", "").Length,
                /* 第 230 条：手动排序要用到 */
                sort = Int(r["sort"]),
                /* 第 128 条：单篇的颜色 / 图标，空串 = 跟随笔记本 */
                color = Str(r["color"]),
                icon = Str(r["icon"]),
            }).ToList();
        }

        public object NoteGet(string id)
        {
            var r = Rows("SELECT * FROM notes WHERE id=$i", ("$i", id)).FirstOrDefault();
            if (r == null) return new { ok = false, err = "笔记不存在" };
            return new
            {
                ok = true,
                id = Str(r["id"]),
                notebookId = Str(r["notebook_id"]),
                title = Str(r["title"]),
                body = Str(r["body"]),
                plain = Str(r["plain"]),
                pinned = Int(r["pinned"]),
                createdAt = Str(r["created_at"]),
                updatedAt = Str(r["updated_at"]),
                color = HasCol(r, "color") ? Str(r["color"]) : "",
                icon = HasCol(r, "icon") ? Str(r["icon"]) : "",
            };
        }

        /// <summary>老库在 ALTER 加列之前读出来没有这个键，直接取会抛 KeyNotFound</summary>
        private static bool HasCol(Dictionary<string, object> r, string name) => r != null && r.ContainsKey(name);

        public object NoteSave(string id, string notebookId, string title, string body, int pinned,
            string color = null, string icon = null)
        {
            var plain = StripHtml(body ?? "");
            if (string.IsNullOrEmpty(id))
            {
                id = NewId();
                Exec(@"INSERT INTO notes(id,notebook_id,title,body,plain,pinned,created_at,updated_at,rev,color,icon)
                       VALUES($i,$n,$t,$b,$p,$pin,$c,$c,1,$col,$ic)",
                    ("$i", id), ("$n", notebookId ?? ""), ("$t", title ?? ""), ("$b", body ?? ""),
                    ("$p", plain), ("$pin", pinned), ("$c", Now),
                    ("$col", color ?? ""), ("$ic", icon ?? ""));
                Touch("notes", id, "ins", 1, title);
            }
            else
            {
                /*
                 * 第 128 条：color / icon 传 null 表示「这次不动它」。
                 * 为什么要区分 null 和空串：自动保存每几秒就来一次，只带了正文，
                 * 如果 null 也当空串写进去，用户刚选的色点就被下一轮自动保存抹掉了。
                 */
                Exec(@"UPDATE notes SET notebook_id=$n,title=$t,body=$b,plain=$p,pinned=$pin,updated_at=$c,rev=rev+1 WHERE id=$i",
                    ("$n", notebookId ?? ""), ("$t", title ?? ""), ("$b", body ?? ""), ("$p", plain), ("$pin", pinned), ("$c", Now), ("$i", id));
                if (color != null) Exec("UPDATE notes SET color=$v WHERE id=$i", ("$v", color), ("$i", id));
                if (icon != null) Exec("UPDATE notes SET icon=$v WHERE id=$i", ("$v", icon), ("$i", id));
                Touch("notes", id, "upd", 1, title);
            }
            return new { ok = true, id, plain, chars = plain.Replace(" ", "").Length };
        }

        public object NoteDelete(string id)
        {
            Exec("UPDATE notes SET deleted_at=$t WHERE id=$i", ("$t", Now), ("$i", id));
            Touch("notes", id, "del", 1, null);
            return new { ok = true };
        }

        public object NoteRestore(string id)
        {
            Exec("UPDATE notes SET deleted_at=NULL WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        public object NotesTrash()
        {
            return Rows("SELECT id,title,notebook_id,updated_at FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100")
                .Select(r => new { id = Str(r["id"]), title = Str(r["title"]), at = Str(r["updated_at"]) }).ToList();
        }

        /* ================= 用户中心 ================= */

        public object UserGet()
        {
            var r = Rows("SELECT * FROM users LIMIT 1").FirstOrDefault();
            if (r == null) return new { ok = false };
            return new
            {
                ok = true,
                id = Str(r["id"]),
                nickname = Str(r["nickname"]),
                signature = Str(r["signature"]),
                avatar = Str(r["avatar"]),
                birthday = Str(r["birthday"]),
                lunarBirthday = Str(r["lunar_birthday"]),
                createdAt = Str(r["created_at"]),
            };
        }

        public object UserSave(string nickname, string signature, string avatar, string birthday, string lunarBirthday)
        {
            var r = Rows("SELECT id FROM users LIMIT 1").FirstOrDefault();
            var id = r == null ? NewId() : Str(r["id"]);
            if (r == null)
                Exec("INSERT INTO users(id,nickname,signature,avatar,birthday,lunar_birthday,created_at,updated_at) VALUES($i,$n,$s,$a,$b,$l,$t,$t)",
                    ("$i", id), ("$n", nickname ?? ""), ("$s", signature ?? ""), ("$a", avatar ?? ""), ("$b", birthday ?? ""), ("$l", lunarBirthday ?? ""), ("$t", Now));
            else
                Exec(@"UPDATE users SET nickname=$n,signature=$s,avatar=$a,birthday=$b,lunar_birthday=$l,updated_at=$t WHERE id=$i",
                    ("$n", nickname ?? ""), ("$s", signature ?? ""), ("$a", avatar ?? ""), ("$b", birthday ?? ""), ("$l", lunarBirthday ?? ""), ("$t", Now), ("$i", id));
            return new { ok = true };
        }

        /* ================= 密码保护 ================= */

        // 会话解锁：token → (过期时间, scope, target)
        private readonly Dictionary<string, (DateTime exp, string scope, string target)> _unlocked = new();

        private static (string hash, string salt) MakeHash(string pwd)
        {
            var salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
            var h = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pwd), Encoding.UTF8.GetBytes(salt),
                120000, HashAlgorithmName.SHA256, 32);
            return (Convert.ToBase64String(h), salt);
        }

        private static bool CheckHash(string pwd, string hash, string salt)
        {
            if (string.IsNullOrEmpty(hash)) return false;
            try
            {
                var h = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(pwd), Encoding.UTF8.GetBytes(salt),
                    120000, HashAlgorithmName.SHA256, 32);
                return CryptographicOperations.FixedTimeEquals(h, Convert.FromBase64String(hash));
            }
            catch { return false; }
        }

        private bool HasMain => Scalar("SELECT v FROM meta WHERE k='vaultMainHash'") != null;

        public object VaultStatus()
        {
            var rules = Rows("SELECT id,scope,target,label,hash FROM vault ORDER BY scope, label")
                .Select(r => new
                {
                    id = Str(r["id"]),
                    scope = Str(r["scope"]),
                    target = Str(r["target"]),
                    label = Str(r["label"]),
                    own = !string.IsNullOrEmpty(Str(r["hash"])),
                }).ToList();
            var nowT = DateTime.Now;
            var open = _unlocked.Where(kv => kv.Value.exp > nowT)
                .Select(kv => new { scope = kv.Value.scope, target = kv.Value.target }).ToList();
            return new
            {
                hasMain = HasMain,
                enabled = Int(Scalar("SELECT v FROM meta WHERE k='vaultEnabled'")) == 1,
                rules,
                unlocked = open,
                hint = Str(Scalar("SELECT v FROM meta WHERE k='vaultHint'")),
                qaCount = Int(Scalar("SELECT COUNT(*) FROM vault_qa")),
            };
        }

        public object VaultSetMain(string password)
        {
            var (h, s) = MakeHash(password ?? "");
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultMainHash',$h)", ("$h", h));
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultMainSalt',$s)", ("$s", s));
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultEnabled','1')");
            return new { ok = true };
        }

        public object VaultClearMain(string password)
        {
            if (HasMain && !CheckHash(password ?? "", Str(Scalar("SELECT v FROM meta WHERE k='vaultMainHash'")),
                Str(Scalar("SELECT v FROM meta WHERE k='vaultMainSalt'"))))
                return new { ok = false, err = "主密码不正确" };
            Exec("DELETE FROM meta WHERE k IN ('vaultMainHash','vaultMainSalt')");
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultEnabled','0')");
            Exec("DELETE FROM vault");
            _unlocked.Clear();
            return new { ok = true };
        }

        /// <summary>新增一条保护规则。password 为空表示「用主密码」。</summary>
        public object VaultAdd(string scope, string target, string label, string password)
        {
            if (string.IsNullOrEmpty(scope)) return new { ok = false, err = "缺少范围" };
            if (string.IsNullOrEmpty(password) && !HasMain) return new { ok = false, err = "请先设置主密码" };
            var exist = Scalar("SELECT id FROM vault WHERE scope=$s AND target=$t",
                ("$s", scope), ("$t", target ?? ""));
            var id = exist == null ? NewId() : Str(exist);
            string h = "", s2 = "";
            if (!string.IsNullOrEmpty(password)) (h, s2) = MakeHash(password);
            if (exist == null)
                Exec("INSERT INTO vault(id,scope,target,label,hash,salt,created_at) VALUES($i,$s,$t,$l,$h,$sa,$c)",
                    ("$i", id), ("$s", scope), ("$t", target ?? ""), ("$l", label ?? ""), ("$h", h), ("$sa", s2), ("$c", Now));
            else
                Exec("UPDATE vault SET label=$l,hash=$h,salt=$sa WHERE id=$i",
                    ("$l", label ?? ""), ("$h", h), ("$sa", s2), ("$i", id));
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('vaultEnabled','1')");
            return new { ok = true, id };
        }

        public object VaultRemove(string id)
        {
            Exec("DELETE FROM vault WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        /// <summary>某范围当前是否锁定。</summary>
        public object VaultCheck(string scope, string target)
        {
            var (locked, rule) = CheckLocked(scope, target);
            if (!locked) return new { locked = false };
            return new { locked = true, label = Str(rule["label"]), own = !string.IsNullOrEmpty(Str(rule["hash"])) };
        }

        /// <summary>
        /// 内部版：某范围当前是否锁定，附带命中的规则行。
        ///
        /// 抽出来是因为 **列表类接口也要用**（#244）。原来是每个页面各自包一层
        /// &lt;Guarded&gt;，只在「界面」上挡，数据早就从 entry.list 里发出去了 ——
        /// 给某一天的日记加了密码，切到「流」「记录」「全局搜索」照样读得到全文。
        /// 挡在界面上只是看不见，不是拿不到。
        ///
        /// 现在数据层自己判断：加锁的那一天，正文/标题/标签一律不往外给。
        /// </summary>
        internal (bool locked, Dictionary<string, object> rule) CheckLocked(string scope, string target)
        {
            var rule = Rows("SELECT * FROM vault WHERE scope=$s AND (target=$t OR target='') ORDER BY (target=$t) DESC LIMIT 1",
                ("$s", scope), ("$t", target ?? "")).FirstOrDefault();

            // 日记还额外受「一段日期」规则约束：target 形如 2026-01-01~2026-01-31
            if (rule == null && scope == "diary" && !string.IsNullOrEmpty(target))
            {
                foreach (var r in Rows("SELECT * FROM vault WHERE scope='diaryRange'"))
                {
                    var t = Str(r["target"]);
                    var parts = t.Split('~');
                    if (parts.Length != 2) continue;
                    if (string.CompareOrdinal(target, parts[0]) >= 0 && string.CompareOrdinal(target, parts[1]) <= 0)
                    {
                        rule = r;
                        break;
                    }
                }
            }

            // 没有规则 = 这个范围不锁。
            // 注意：设置主密码本身不等于「锁住整个软件」，那必须由一条显式的 app 规则来表态，
            // 否则用户只是给「待办」加了锁，却会在启动时被全屏挡住。
            if (rule == null) return (false, null);

            var nowT = DateTime.Now;
            var hit = _unlocked.Values.Any(v => v.exp > nowT &&
                (v.scope == scope || (scope == "diary" && v.scope == "diaryRange")) &&
                (v.target == (target ?? "") || string.IsNullOrEmpty(v.target)));
            return (!hit, rule);
        }

        /// <summary>
        /// 这一天的日记是不是锁着的（#244）。
        ///
        /// 列表/搜索类接口在往外吐正文之前必须问一句。已解锁的日期会返回 false ——
        /// 用户刚输过密码，不该立刻又看不见。
        /// </summary>
        internal bool IsDiaryLocked(string date)
        {
            if (string.IsNullOrEmpty(date)) return false;
            /*
             * 快速短路：一条日记规则都没有时，不要为列表里的每一行都查一次库。
             * 流页面一次加载 30 条、记录页 300 条，逐行查 vault 表是纯浪费。
             */
            if (Int(Scalar("SELECT COUNT(*) FROM vault WHERE scope IN ('diary','diaryRange')")) == 0) return false;
            return CheckLocked("diary", date).locked;
        }

        public object VaultUnlock(string scope, string target, string password, int minutes)
        {
            if (minutes <= 0) minutes = Int(Scalar("SELECT v FROM meta WHERE k='vaultTimeout'"));
            if (minutes <= 0) minutes = 30;

            var rule = Rows("SELECT * FROM vault WHERE scope=$s AND (target=$t OR target='') ORDER BY (target=$t) DESC LIMIT 1",
                ("$s", scope), ("$t", target ?? "")).FirstOrDefault();

            bool ok;
            if (rule != null && !string.IsNullOrEmpty(Str(rule["hash"])))
                ok = CheckHash(password ?? "", Str(rule["hash"]), Str(rule["salt"]));
            else
                ok = HasMain && CheckHash(password ?? "",
                    Str(Scalar("SELECT v FROM meta WHERE k='vaultMainHash'")),
                    Str(Scalar("SELECT v FROM meta WHERE k='vaultMainSalt'")));

            if (!ok) return new { ok = false, err = "密码不正确" };
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
            _unlocked[token] = (DateTime.Now.AddMinutes(minutes), scope, target ?? "");
            return new { ok = true, token, minutes };
        }

        public object VaultLock()
        {
            _unlocked.Clear();
            return new { ok = true };
        }

        /* ================= 缓存 ================= */

        private static long DirSize(string dir)
        {
            if (!Directory.Exists(dir)) return 0;
            try { return new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length); }
            catch { return 0; }
        }

        public object CacheStats()
        {
            var thumb = Path.Combine(MediaDir, ".thumb");
            var cacheDir = Path.Combine(Root, "缓存");
            long media = DirSize(MediaDir) - DirSize(thumb);
            long thumbs = DirSize(thumb);
            long backup = DirSize(BackupDir);
            long cache = DirSize(cacheDir);
            long db = File.Exists(DbPath) ? new FileInfo(DbPath).Length : 0;
            long wal = File.Exists(DbPath + "-wal") ? new FileInfo(DbPath + "-wal").Length : 0;
            return new
            {
                media, thumbs, backup, cache, db, wal,
                total = media + thumbs + backup + cache + db + wal,
                files = Directory.Exists(MediaDir) ? Directory.GetFiles(MediaDir).Length : 0,
                cacheFiles = Directory.Exists(cacheDir) ? Directory.GetFiles(cacheDir, "*", SearchOption.AllDirectories).Length : 0,
                cachedLinks = Int(Scalar("SELECT COUNT(*) FROM media WHERE cached=1")),
                maxMB = Int(Scalar("SELECT v FROM meta WHERE k='cacheMaxMB'")),
                warnMB = Int(Scalar("SELECT v FROM meta WHERE k='cacheWarnMB'")),
                days = Int(Scalar("SELECT v FROM meta WHERE k='cacheDays'")),
            };
        }

        /// <summary>按保留天数与大小时限清理：只清可重建的东西（缩略图、备份、网络缓存）。</summary>
        public object CachePrune(int days, int maxMB)
        {
            if (days <= 0) days = Int(Scalar("SELECT v FROM meta WHERE k='cacheDays'"));
            if (maxMB <= 0) maxMB = Int(Scalar("SELECT v FROM meta WHERE k='cacheMaxMB'"));
            var cut = DateTime.Now.AddDays(-Math.Max(1, days));
            int removed = 0; long freed = 0;

            void Sweep(string dir, string pattern = "*")
            {
                if (!Directory.Exists(dir)) return;
                foreach (var f in new DirectoryInfo(dir).EnumerateFiles(pattern, SearchOption.AllDirectories))
                {
                    try
                    {
                        if (f.LastWriteTime >= cut && f.LastAccessTime >= cut) continue;
                        var len = f.Length; f.Delete(); removed++; freed += len;
                    }
                    catch { }
                }
            }

            Sweep(BackupDir);                                    // 备份：过期即删（最近的留着）
            var backups = Directory.Exists(BackupDir)
                ? new DirectoryInfo(BackupDir).GetFiles().OrderByDescending(f => f.LastWriteTime).ToList()
                : new List<FileInfo>();
            foreach (var f in backups.Skip(14)) { try { var l = f.Length; f.Delete(); removed++; freed += l; } catch { } }

            // 缓存目录：网络链接的本地副本
            var cacheDir = Path.Combine(Root, "缓存");
            Sweep(cacheDir);
            // 缩略图：超过 60 天没访问的（重建代价低）
            Sweep(Path.Combine(MediaDir, ".thumb"));
            foreach (var f in (Directory.Exists(Path.Combine(MediaDir, ".thumb"))
                ? new DirectoryInfo(Path.Combine(MediaDir, ".thumb")).GetFiles().OrderByDescending(x => x.LastAccessTime).ToList()
                : new List<FileInfo>()).Skip(800))
            { try { var l = f.Length; f.Delete(); removed++; freed += l; } catch { } }

            // 仍超上限：从最老的备份与缓存继续删
            long limit = (long)Math.Max(64, maxMB) * 1024 * 1024;
            var total = CacheStats();
            long now = (long)total.GetType().GetProperty("total").GetValue(total);
            if (now > limit)
            {
                var pool = new List<FileInfo>();
                if (Directory.Exists(BackupDir)) pool.AddRange(new DirectoryInfo(BackupDir).GetFiles());
                if (Directory.Exists(cacheDir)) pool.AddRange(new DirectoryInfo(cacheDir).GetFiles());
                foreach (var f in pool.OrderBy(x => x.LastWriteTime))
                {
                    if (now <= limit) break;
                    try { var l = f.Length; f.Delete(); now -= l; removed++; freed += l; } catch { }
                }
            }
            return new { ok = true, removed, freedMB = Math.Round(freed / 1024.0 / 1024.0, 1) };
        }

        public object CacheClear(string what)
        {
            int n = 0; long freed = 0;
            void Wipe(string dir, bool self = false)
            {
                if (!Directory.Exists(dir)) return;
                foreach (var f in new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories))
                { try { var l = f.Length; f.Delete(); n++; freed += l; } catch { } }
                if (self) { try { Directory.Delete(dir, true); } catch { } }
            }
            if (what == "cache" || what == "all") Wipe(Path.Combine(Root, "缓存"), true);
            if (what == "thumbs" || what == "all") Wipe(Path.Combine(MediaDir, ".thumb"));
            if (what == "backup" || what == "all") Wipe(BackupDir);
            return new { ok = true, removed = n, freedMB = Math.Round(freed / 1024.0 / 1024.0, 1) };
        }

        /* ================= 设置导入导出 ================= */

        public object SettingsExport()
        {
            Directory.CreateDirectory(ExportDir);
            var d = new Dictionary<string, string>();
            foreach (var r in Rows("SELECT k,v FROM meta"))
            {
                var k = Str(r["k"]);
                if (k == "deviceId" || k.StartsWith("vaultMain")) continue;   // 设备标识与密码哈希不外带
                d[k] = Str(r["v"]);
            }
            var payload = new
            {
                _type = "riqian-settings",
                _version = 7,
                exportedAt = Now,
                settings = d,
                modules = Rows("SELECT type,title,enabled,sort,config FROM modules ORDER BY sort"),
                pomoPresets = Str(Scalar("SELECT v FROM meta WHERE k='pomoPresets'")),
            };
            var path = Path.Combine(ExportDir, "日签设置-" + Today + ".json");
            /* Encoding.UTF8 会写 BOM（EF BB BF），而 System.Text.Json 的 Parse
               不接受 BOM —— 于是导出的文件永远导不回来。用 new UTF8Encoding(false)
               明确写"不要 BOM"。这是导入功能彻底失效的根因，不只是"丢 modules"。 */
            File.WriteAllText(path, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
            return new { ok = true, path, count = d.Count };
        }

        public object SettingsImport(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new { ok = false, err = "内容为空" };
            try
            {
                /* 容忍 BOM：老版本导出的文件头上有 EF BB BF，
                   System.Text.Json 见到第一个字节是 0xEF 会直接报
                   "'0xEF' is an invalid start of a value"，用户手里已有的导出文件就全废了。
                   用 MainForm 里那个统一入口，别在这儿再写一遍 TrimStart ——
                   同一个坑踩两次，就是因为当初只在一处写、另一处漏了。 */
                json = TextUtil.StripJsonPreamble(json);
                if (json.Length == 0) return new { ok = false, err = "内容为空" };

                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("settings", out var st))
                    return new { ok = false, err = "不是「日签」的设置文件" };

                /* 能整块覆盖的字段：先备份，出任何岔子都能整体退回去。
                   导入是个"一步改一堆东西"的操作，中途炸掉会留下半新半旧的配置，
                   比彻底失败更难收拾。 */
                var backup = new Dictionary<string, string>();
                foreach (var r in Rows("SELECT k,v FROM meta")) backup[Str(r["k"])] = Str(r["v"]);

                int n = 0;
                int modN = 0;
                try
                {
                    foreach (var p in st.EnumerateObject())
                    {
                        var k = p.Name;
                        if (k == "deviceId" || k.StartsWith("vaultMain")) continue;
                        Exec("INSERT OR REPLACE INTO meta(k,v) VALUES($k,$v)", ("$k", k), ("$v", p.Value.GetString() ?? ""));
                        n++;
                    }

                    /* modules 这块以前被静默丢掉了：
                       SettingsExport 明明写进了文件，SettingsImport 却只读 settings 一项，
                       用户换机器导入设置，模块顺序和开关全没了，而且没有任何提示。
                       现在按 type 做 upsert —— 不按 id，因为 id 是本机生成的，
                       导进来的 id 换台机器就没意义，同 type 的模块也不该出现两份。 */
                    if (doc.RootElement.TryGetProperty("modules", out var mods)
                        && mods.ValueKind == JsonValueKind.Array)
                    {
                        int sortSeq = 0;
                        foreach (var m in mods.EnumerateArray())
                        {
                            sortSeq += 10;
                            var type = m.TryGetProperty("type", out var tx) ? (tx.GetString() ?? "") : "";
                            if (string.IsNullOrWhiteSpace(type)) continue;

                            var title = m.TryGetProperty("title", out var ti) ? (ti.GetString() ?? "") : "";
                            var enabled = 1;
                            if (m.TryGetProperty("enabled", out var en))
                            {
                                if (en.ValueKind == JsonValueKind.Number) enabled = en.TryGetInt32(out var ei) ? (ei != 0 ? 1 : 0) : 1;
                                else if (en.ValueKind == JsonValueKind.True) enabled = 1;
                                else if (en.ValueKind == JsonValueKind.False) enabled = 0;
                            }
                            var config = m.TryGetProperty("config", out var cf) && cf.ValueKind != JsonValueKind.Null
                                ? (cf.ValueKind == JsonValueKind.String ? (cf.GetString() ?? "{}") : cf.GetRawText())
                                : "{}";
                            var sort = m.TryGetProperty("sort", out var so) && so.TryGetInt32(out var si) ? si : sortSeq;

                            // 本机已经有同类型的模块 → 覆盖它的标题/开关/配置，不新增一条
                            var exist = Str(Scalar("SELECT id FROM modules WHERE type=$t LIMIT 1", ("$t", type)));
                            if (!string.IsNullOrEmpty(exist))
                            {
                                Exec("UPDATE modules SET title=$ti, enabled=$e, sort=$s, config=$c WHERE id=$i",
                                    ("$ti", title), ("$e", enabled), ("$s", sort), ("$c", config), ("$i", exist));
                            }
                            else
                            {
                                Exec("INSERT INTO modules(id,type,title,enabled,sort,config) VALUES($i,$t,$ti,$e,$s,$c)",
                                    ("$i", NewId()), ("$t", type), ("$ti", title),
                                    ("$e", enabled), ("$s", sort), ("$c", config));
                            }
                            modN++;
                        }
                    }

                    // pomoPresets 平时就在 meta 里，跟着 settings 一起进来了；
                    // 但老版本的导出把它单独放在顶层，所以这里兼容补一次
                    if (doc.RootElement.TryGetProperty("pomoPresets", out var pp)
                        && pp.ValueKind == JsonValueKind.String
                        && Scalar("SELECT v FROM meta WHERE k='pomoPresets'") == null)
                    {
                        Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('pomoPresets',$v)",
                            ("$v", pp.GetString() ?? ""));
                    }
                }
                catch
                {
                    // 半路失败 → 把 meta 整体还原，别留一半新一半旧
                    foreach (var kv in backup)
                        Exec("INSERT OR REPLACE INTO meta(k,v) VALUES($k,$v)", ("$k", kv.Key), ("$v", kv.Value));
                    throw;
                }

                return new { ok = true, count = n, modules = modN };
            }
            catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        /* ================= 节日 ================= */

        public object FestivalsUpcoming(int days)
        {
            if (days <= 0) days = 30;
            var u = UserGet();
            var lb = "";
            var uType = u.GetType();
            lb = (string)uType.GetProperty("lunarBirthday").GetValue(u) ?? "";
            int lm = 0, ld = 0;
            if (lb.Contains("-"))
            {
                var parts = lb.Split('-');
                int.TryParse(parts[0], out lm);
                int.TryParse(parts[1], out ld);
            }
            var list = Rows("SELECT * FROM festivals").Select(r => new
            {
                id = Str(r["id"]), name = Str(r["name"]), date = Str(r["date"]),
                lm = Int(r["lunar_month"]), ld = Int(r["lunar_day"]), yearly = Int(r["yearly"]), color = Str(r["color"]),
            }).ToList();

            var res = Festivals.Upcoming(DateTime.Today, days, lm, ld);
            foreach (var c in list)
            {
                var cType = c.GetType();
                var cm = (int)cType.GetProperty("lm").GetValue(c);
                var cd = (int)cType.GetProperty("ld").GetValue(c);
                if (cm > 0 && cd > 0)
                {
                    var d = Festivals.NextLunar(cm, cd, DateTime.Today);
                    if (d.HasValue && (d.Value.Date - DateTime.Today).TotalDays < days)
                        res.Add(new { date = d.Value.ToString("yyyy-MM-dd"), name = (string)cType.GetProperty("name").GetValue(c), days = (int)(d.Value.Date - DateTime.Today).TotalDays, lunar = true });
                }
            }
            return res.OrderBy(x => (int)x.GetType().GetProperty("days").GetValue(x)).ToList();
        }

        public object FestivalAdd(string name, string date, int lunarMonth, int lunarDay)
        {
            var id = NewId();
            Exec("INSERT INTO festivals(id,name,date,lunar_month,lunar_day,yearly,created_at) VALUES($i,$n,$d,$lm,$ld,1,$c)",
                ("$i", id), ("$n", name), ("$d", date ?? ""), ("$lm", lunarMonth), ("$ld", lunarDay), ("$c", Now));
            return new { ok = true, id };
        }

        public object FestivalDelete(string id)
        {
            Exec("DELETE FROM festivals WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        /// <summary>某天是否是节日（日历格子用）。</summary>
        public object DayFestival(string date)
        {
            if (!DateTime.TryParse(date, out var d)) return new List<string>();
            return Festivals.On(d);
        }

        /// <summary>整月的节日，日历一次取完，避免 31 次往返。</summary>
        public object FestivalMonth(string ym)
        {
            var res = new List<object>();
            if (!DateTime.TryParse((ym ?? "") + "-01", out var first)) return res;
            var days = DateTime.DaysInMonth(first.Year, first.Month);
            var custom = Rows("SELECT name,lunar_month,lunar_day,date FROM festivals").ToList();
            for (int i = 0; i < days; i++)
            {
                var d = first.AddDays(i);
                var key = d.ToString("yyyy-MM-dd");
                foreach (var n in Festivals.On(d))
                    res.Add(new { date = key, name = n, lunar = true });

                // 自定义节日：农历按当年换算，公历按日期匹配
                foreach (var c in custom)
                {
                    var lm = Int(c["lunar_month"]);
                    var ld = Int(c["lunar_day"]);
                    if (lm > 0 && ld > 0)
                    {
                        var s = Festivals.LunarToSolar(d.Year, lm, ld);
                        if (s.HasValue && s.Value.Date == d.Date)
                            res.Add(new { date = key, name = Str(c["name"]), lunar = true });
                    }
                    else if (Str(c["date"]) == key)
                        res.Add(new { date = key, name = Str(c["name"]), lunar = false });
                }
            }
            return res;
        }

        /* ================= 导出：单文件 HTML ================= */

        public object ExportHtml()
        {
            Directory.CreateDirectory(ExportDir);
            var sb = new StringBuilder();
            sb.Append("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>日签导出</title>");
            sb.Append("<style>body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.9 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#26221d;background:#faf7f0}");
            sb.Append("h1{font-size:22px;margin:44px 0 4px}h2{font-size:15px;color:#8a8072;font-weight:400;margin:0 0 18px}");
            sb.Append(".e{border-top:1px solid #e4ddce;padding-top:22px;margin-top:34px}.t{font-size:12px;color:#9c9386;letter-spacing:.1em}");
            sb.Append("blockquote{border-left:3px solid #d9b9a6;margin:10px 0;padding:2px 14px;color:#6d6459}");
            sb.Append("img{max-width:100%;border-radius:8px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}</style></head><body>");
            sb.Append("<h1>日签 · 全部日记</h1><h2>导出于 ").Append(Now).Append("</h2>");
            var rows = Rows("SELECT date,fav,bg FROM entries ORDER BY date DESC");
            foreach (var r in rows)
            {
                var date = Str(r["date"]);
                var vals = Rows("SELECT module_id,val FROM vals WHERE date=$d", ("$d", date));
                var main = vals.FirstOrDefault(v => Str(v["val"]).Contains("<p") || Str(v["val"]).Contains("<div"));
                sb.Append("<div class=\"e\"><h1>").Append(date).Append("</h1>");
                sb.Append("<div class=\"t\">").Append(Str(r["fav"]) == "1" ? "★ 收藏　" : "").Append(Festivals.LunarText(DateTime.Parse(date))).Append("</div>");
                if (main != null) sb.Append(Str(main["val"]));
                sb.Append("</div>");
            }
            sb.Append("</body></html>");
            var path = Path.Combine(ExportDir, "日签-全部日记-" + Today + ".html");
            File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
            return new { ok = true, path };
        }

        /* ================= 待办 / 倒计时的重复规则 ================= */

        public object TodoSetList(string id, string listId)
        {
            Exec("UPDATE todos SET list_id=$v, updated_at=$t, rev=rev+1 WHERE id=$i",
                ("$v", listId ?? ""), ("$i", id), ("$t", Now));
            return new { ok = true };
        }

        public object TodoSetRepeat(string id, string repeat)
        {
            Exec("UPDATE todos SET repeat=$v, updated_at=$t, rev=rev+1 WHERE id=$i",
                ("$v", repeat ?? ""), ("$i", id), ("$t", Now));
            return new { ok = true };
        }

        /* ---------------- 回收站（与「垃圾桶」不是一回事） ----------------
           垃圾桶：trashed=1，表示「不打算做了」，不删除、不计完成率，随时可恢复
           回收站：deleted_at 非空，表示「删掉了」，列表里看不到，可恢复或彻底清除
           ------------------------------------------------------------------ */

        public object TodosRecycle()
        {
            return Rows("SELECT * FROM todos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 300")
                .Select(r => new
                {
                    id = Str(r["id"]),
                    title = Str(r["title"]),
                    done = Int(r["done"]),
                    due = Str(r["due"]),
                    dueTime = Str(r["due_time"]),
                    priority = Int(r["priority"]),
                    note = Str(r["note"]),
                    createdAt = Str(r["created_at"]),
                    doneAt = Str(r["done_at"]),
                    listId = Str(r["list_id"]),
                    trashed = Int(r["trashed"]),
                    repeat = Str(r["repeat"]),
                    deletedAt = Str(r["deleted_at"]),
                }).ToList();
        }

        public object TodoRestore(string id)
        {
            Exec("UPDATE todos SET deleted_at=NULL, updated_at=$t, rev=rev+1 WHERE id=$i",
                ("$t", Now), ("$i", id));
            Touch("todos", id, "upd", 1, null);
            return new { ok = true };
        }

        public object TodoPurge(string id)
        {
            Exec("DELETE FROM todos WHERE id=$i", ("$i", id));
            Touch("todos", id, "del", 1, null);
            return new { ok = true };
        }

        public object TodoPurgeAll()
        {
            var n = Int(Scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NOT NULL"));
            Exec("DELETE FROM todos WHERE deleted_at IS NOT NULL");
            return new { ok = true, removed = n };
        }

        public object CdAdd2(string title, string date, string repeat, string color, string note)
        {
            var id = NewId();
            Exec("INSERT INTO countdowns(id,title,date,yearly,repeat,color,note) VALUES($i,$t,$d,$y,$r,$c,$n)",
                ("$i", id), ("$t", title), ("$d", date ?? ""),
                ("$y", string.IsNullOrEmpty(repeat) || repeat == "yearly" || repeat == "lunar-yearly" ? 1 : 0),
                ("$r", repeat ?? ""), ("$c", color ?? "#b8623a"), ("$n", note ?? ""));
            Touch("countdowns", id, "ins", 1, title);
            return new { ok = true, id };
        }

        public object CdSetRepeat(string id, string repeat)
        {
            Exec("UPDATE countdowns SET repeat=$r, yearly=$y WHERE id=$i",
                ("$r", repeat ?? ""),
                ("$y", repeat == "yearly" || repeat == "lunar-yearly" ? 1 : 0), ("$i", id));
            return new { ok = true };
        }

        /* ================= 音乐库（复用 media 表，用 kind 区分） ================= */

        private static string KindOf(string ext)
        {
            var e = (ext ?? "").TrimStart('.').ToLowerInvariant();
            if (new[] { "mp3", "m4a", "wav", "ogg", "flac", "aac", "opus" }.Contains(e)) return "audio";
            if (new[] { "mp4", "mkv", "webm", "mov", "avi" }.Contains(e)) return "video";
            if (new[] { "jpg", "jpeg", "png", "webp", "gif", "bmp" }.Contains(e)) return "image";
            return "file";
        }

        public object MediaImportPath(string path)
        {
            if (!File.Exists(path)) return new { ok = false, err = "文件不存在" };
            var orig = Path.GetFileName(path);
            var (id, sha, ext, dup) = StoreFile(path, out var abs);
            InsertMediaRow(id, sha, ext, orig, abs, dup);
            var kind = KindOf(ext);
            Exec("UPDATE media SET kind=$k WHERE id=$i", ("$k", kind), ("$i", id));
            return new { ok = true, id, name = orig, kind, dup };
        }

        /// <summary>网络音频链接：不下载，只登记；播放时由前端 &lt;audio&gt; 直接拉流。</summary>
        public object MediaAddUrl(string url, string name)
        {
            if (string.IsNullOrWhiteSpace(url)) return new { ok = false, err = "链接为空" };
            var id = NewId();
            var nm = string.IsNullOrWhiteSpace(name) ? url.Split('/').Last().Split('?')[0] : name;
            var ext = Path.GetExtension(nm).TrimStart('.').ToLowerInvariant();
            Exec(@"INSERT INTO media(id,sha,ext,bytes,width,height,orig_name,note,created_at,updated_at,rev,kind,src_url,cached)
                   VALUES($i,$i,$e,0,0,0,$n,'',$c,$c,1,$k,$u,0)",
                ("$i", id), ("$e", ext), ("$n", nm), ("$c", Now), ("$k", KindOf(ext) == "image" ? "audio" : KindOf(ext)), ("$u", url));
            return new { ok = true, id, name = nm };
        }

        /// <summary>
        /// 第 26 / 27 条：把网络链接真的下载到本地（缓存），之后离线也能放。
        ///
        /// 之前只有 `cached` 这个字段和 UI 上的开关，没有任何下载代码 —— 用户勾了
        /// 「缓存到本地」也不会真的存。这里补上真正的落盘。
        ///
        /// 两处开关都在这一步生效：
        ///   · cacheAudio=0  → 直接拒绝缓存（用户明确不要占空间）
        ///   · cacheSuffix   → 后缀不在白名单里也拒绝（避免下到奇怪的东西）
        /// </summary>
        public object MediaCacheUrl(string id)
        {
            var rows = Rows("SELECT id,src_url,orig_name,ext,cached FROM media WHERE id=$i AND deleted_at IS NULL",
                ("$i", id ?? ""));
            if (rows.Count == 0) return new { ok = false, err = "找不到这条媒体" };
            var r = rows[0];
            var url = Str(r["src_url"]);
            if (string.IsNullOrWhiteSpace(url)) return new { ok = false, err = "这不是网络链接" };
            if (Int(r["cached"]) == 1) return new { ok = true, already = true };

            // 开关一：用户关掉了「缓存网络音频」
            if (Str(Scalar("SELECT v FROM meta WHERE k='cacheAudio'")) == "0")
                return new { ok = false, err = "设置里关掉了「缓存网络音频」", off = true };

            // 开关二：后缀白名单
            var ext = Str(r["ext"]).ToLowerInvariant();
            var allow = Str(Scalar("SELECT v FROM meta WHERE k='cacheSuffix'"));
            if (!string.IsNullOrWhiteSpace(allow))
            {
                var set = allow.Split(',').Select(x => x.Trim().TrimStart('.').ToLowerInvariant())
                    .Where(x => x != "").ToHashSet();
                if (set.Count > 0 && !set.Contains(ext))
                    return new { ok = false, err = $"后缀 .{ext} 不在允许缓存的名单里", blocked = true };
            }

            try
            {
                var dir = Path.Combine(Root, "缓存");
                Directory.CreateDirectory(dir);
                var cut = Path.Combine(dir, id + (ext == "" ? "" : "." + ext));

                using var http = new System.Net.Http.HttpClient();
                http.Timeout = TimeSpan.FromSeconds(60);
                // 有些站会拦没有 UA 的请求
                http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Riqian/1.0");
                var bytes = http.GetByteArrayAsync(url).GetAwaiter().GetResult();
                File.WriteAllBytes(cut, bytes);

                Exec("UPDATE media SET cached=1, bytes=$b, updated_at=$c WHERE id=$i",
                    ("$b", (long)bytes.LongLength), ("$c", Now), ("$i", id));
                return new { ok = true, bytes = bytes.LongLength, path = cut };
            }
            catch (Exception e)
            {
                return new { ok = false, err = "下载失败：" + e.Message };
            }
        }

        /// <summary>第 27 条：批量缓存所有还没缓存的网络音频（设置页「立即缓存」用）</summary>
        public object MediaCacheAll()
        {
            var ids = Rows("SELECT id FROM media WHERE deleted_at IS NULL AND cached=0 AND src_url<>''")
                .Select(x => Str(x["id"])).ToList();
            int ok = 0, fail = 0; string lastErr = "";
            foreach (var id in ids)
            {
                var r = MediaCacheUrl(id);
                var pi = r.GetType().GetProperty("ok");
                var pel = r.GetType().GetProperty("err");
                if (pi != null && pi.GetValue(r) is bool b && b) ok++;
                else { fail++; if (pel != null) lastErr = Str(pel.GetValue(r)); }
            }
            return new { ok = true, total = ids.Count, done = ok, failed = fail, err = lastErr };
        }

        public object MediaByKind(string kinds)
        {
            var arr = (kinds ?? "").Split(',').Where(x => x != "").ToArray();
            if (arr.Length == 0) arr = new[] { "audio", "video" };
            var inSql = string.Join(",", arr.Select((_, i) => "$k" + i));
            var ps = arr.Select((k, i) => ("$k" + i, (object)k)).ToArray();
            return Rows($@"SELECT id,ext,bytes,orig_name,created_at,kind,src_url,cached FROM media
                           WHERE deleted_at IS NULL AND kind IN ({inSql}) ORDER BY created_at DESC", ps)
                .Select(r => new
                {
                    id = Str(r["id"]),
                    name = Str(r["orig_name"]),
                    ext = Str(r["ext"]),
                    bytes = Long(r["bytes"]),
                    kind = Str(r["kind"]),
                    url = Str(r["src_url"]),
                    cached = Int(r["cached"]),
                    createdAt = Str(r["created_at"]),
                }).ToList();
        }
    }
}
