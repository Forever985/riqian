using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Riqian
{
    /// <summary>
    /// 全部数据落在 SQLite 单文件里。模块、日记、版本、标签、待办、倒计时、习惯、关联都在一张库中。
    /// </summary>
    public partial class Db : IDisposable
    {
        public string Root { get; private set; }
        public string DbPath { get; private set; }
        public string MediaDir { get; private set; }
        public string BackupDir { get; private set; }
        public string ExportDir { get; private set; }

        private SqliteConnection conn;
        private string backedUpDay = "";

        /* ==================================================================
         * 账户余额的口径 —— 只在这里定义一次，别处一律引用。
         *
         * 为什么必须集中：ledger 里 kind 这个字段对**两类流水**含义是相反的。
         *
         *   · 普通流水（jar_id 为空）：kind='in' 表示钱进入账户 → 余额 +
         *   · 罐子流水（jar_id 非空）：kind='in' 表示钱进入**罐子** → 账户余额 −
         *
         * 储蓄罐存取时，钱确实离开了账户，但方向跟 kind 刚好相反。
         * 之前 LedgerAccounts 和 LedgerInsight 各写了一份 SUM(CASE WHEN kind='in' ...)，
         * 两处都漏掉了这个反转，结果存 100 块进罐子，账户余额反而 +100，
         * 「账户 + 罐子」的总资产凭空多出一倍。
         *
         * 现在把它抽成一个常量，两边都拼这同一段 —— 以后改口径只改一处，
         * 不会再出现"这页对了那页还错"的情况。
         * ================================================================== */
        internal const string AccountDeltaSql =
            @"SUM(CASE
                  WHEN IFNULL(jar_id,'')<>'' THEN (CASE WHEN kind='in' THEN -amount ELSE amount END)
                  ELSE (CASE WHEN kind='in' THEN amount ELSE -amount END)
              END)";

        /// <summary>罐子余额：kind 在罐子语境里本来就是对的（in 存进来 +，out 取出去 −）。</summary>
        internal const string JarBalanceSql = "SUM(CASE WHEN kind='in' THEN amount ELSE -amount END)";

        public static string Today => DateTime.Now.ToString("yyyy-MM-dd");
        private static string Now => DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");

        public Db(string root)
        {
            Root = root;
            DbPath = Path.Combine(root, "riqian.db");
            MediaDir = Path.Combine(root, "图片库");
            BackupDir = Path.Combine(root, "自动备份");
            ExportDir = Path.Combine(root, "导出");
            Open();
        }

        private void Open()
        {
            foreach (var d in new[] { Root, MediaDir, BackupDir, ExportDir })
                Directory.CreateDirectory(d);

            /* Pooling=False 是必须的，不是为了性能取舍。
             *
             * Microsoft.Data.Sqlite 默认开连接池，`Close()` / `Dispose()` 只是把
             * 物理连接**归还池子**，文件句柄还留在进程里。于是：
             *   · 自检跑完删不掉临时目录（riqian.db 一直被占着，-shm 也留着）
             *   · DailyBackup 里 `conn.Close()` → File.Copy → `conn.Open()` 那个
             *     "先关掉再拷"的假设根本不成立 —— 拷贝时文件其实还开着
             *
             * 全局只有一处主连接（MainForm 一个 Db，SelfCheck 一个 Db，不同时存在），
             * 池化本来就是白拿的收益：省不下一次真的 open，却让"关掉"变成谎话。
             * 关掉它，`Dispose()` 才是真的闭嘴。 */
            /*
             * 打开数据库要允许重试 —— 因为「打不开」有两类，长得一样但性质完全不同：
             *
             *   ① 真坏了：权限没有、磁盘满、文件被改坏 —— 重试多少次都一样
             *   ② 瞬时故障：磁盘刚唤醒还没就绪、杀毒软件正在扫这个文件、
             *      上一份进程刚退出句柄还没回收
             *
             * 2026-11-11 撞的是第 ②类：启动后干等 40 秒，然后报
             * `SQLite Error 8: attempt to write a readonly database`（在 Db.Seed 里）。
             * 等这台机器缓过来再启动，同一个库一秒钟就开好了 —— 说明库本身没毛病。
             *
             * 所以这里重试 3 次、间隔递增（0.3s / 0.8s）。真正的第 ①类最多多花 1.1 秒，
             * 但第 ②类能救回来。**不重试的话，用户看到的是"打不开"，重开一次又好了**，
             * 那种问题最难被当成 bug 报上来。
             */
            Exception lastError = null;
            for (var attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    conn = new SqliteConnection("Data Source=" + DbPath + ";Pooling=False");
                    conn.Open();
                    Exec("PRAGMA journal_mode=WAL;");
                    Exec("PRAGMA synchronous=NORMAL;");
                    Schema();
                    EnsureMilestones();   // 第 188 条：大事时间轴
                    Seed();
                    DailyBackup();
                    if (attempt > 1) Diag.Info("db.open", $"第 {attempt} 次尝试成功，库已打开");
                    return;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    /* 半开的连接必须收掉，否则重试时旧句柄还占着文件，越试越坏 */
                    try { conn?.Dispose(); } catch { }
                    conn = null;

                    if (attempt < 3)
                    {
                        Diag.Warn("db.open", $"打开数据库失败（第 {attempt}/3 次），稍后重试：" + ex.Message);
                        System.Threading.Thread.Sleep(attempt == 1 ? 300 : 800);
                    }
                }
            }

            Diag.Error("db.open", $"连续 3 次打不开数据库：{DbPath}", lastError);
            throw lastError;
        }

        /// <summary>
        /// 释放数据库连接。
        ///
        /// 这是 2026-11-02 做 `--selfcheck` 时补的，起因很具体：
        /// 自检跑完要删掉临时库目录，结果 `Directory.Delete` 一直失败 ——
        /// 因为 `Db` 从来没有关闭连接的地方，WAL 的 `-shm` / `-wal` 两个文件
        /// 被 SqliteConnection 一直占着。**这不是自检的问题，是 Db 的问题**：
        /// 一个持有连接的对象没有释放入口，谁用它谁就只能泄漏。
        ///
        /// 主程序里看不出后果 —— 进程退出时 OS 会回收，但那次 WAL 没做 checkpoint。
        /// 单进程长跑的场景下也确实不需要手动关。但只要有第二个使用者
        /// （自检、将来的备份工具、测试），就必须有这个方法。
        ///
        /// ⚠️ 关之前先做 checkpoint：WAL 模式下不 checkpoint 直接关，
        /// 数据还在 -wal 里没并回主库，删目录/拷文件都会丢最后一次写入。
        ///
        /// ⚠️ 光调 Close/Dispose 是不够的 —— 连接池会接住物理连接，文件句柄不还。
        /// 所以构造连接时写了 `Pooling=False`（见 Open()）。两处必须配套：
        /// 只关池化不写 Dispose 浪费，只写 Dispose 不关池化是假关闭。
        /// </summary>
        public void Dispose()
        {
            if (conn == null) return;
            try
            {
                // TRUNCATE 而不是 PASSIVE：把 WAL 并回主库并把 -wal 截成 0 字节，
                // 这样关掉之后目录里只剩一个 .db，可以直接删或直接拷。
                Exec("PRAGMA wal_checkpoint(TRUNCATE);");
            }
            catch { /* checkpoint 失败不该盖住后面的关闭 */ }

            try { conn.Close(); } catch { }
            try { conn.Dispose(); } catch { }
            conn = null;
        }

        /* ---------------- 底层 ---------------- */

        private void Exec(string sql, params (string k, object v)[] ps)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var p in ps) cmd.Parameters.AddWithValue(p.k, p.v ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }

        private object Scalar(string sql, params (string k, object v)[] ps)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var p in ps) cmd.Parameters.AddWithValue(p.k, p.v ?? DBNull.Value);
            var r = cmd.ExecuteScalar();
            return r == DBNull.Value ? null : r;
        }

        /// <summary>
        /// media 表里这条 id 在不在（不看软删）。
        /// 「文件还在、行没了」是彻底删除的正常结果，再导入时必须能重建行，
        /// 否则这张图就永久消失了。
        /// </summary>
        private bool RowExists(string id) =>
            Int(Scalar("SELECT COUNT(*) FROM media WHERE id=$i", ("$i", id))) > 0;

        private List<Dictionary<string, object>> Rows(string sql, params (string k, object v)[] ps)
        {
            var list = new List<Dictionary<string, object>>();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var p in ps) cmd.Parameters.AddWithValue(p.k, p.v ?? DBNull.Value);
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var row = new Dictionary<string, object>();
                for (int i = 0; i < r.FieldCount; i++)
                    row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
                list.Add(row);
            }
            return list;
        }

        private static string Str(object o) => o == null ? "" : Convert.ToString(o);
        private static int Int(object o) => o == null ? 0 : Convert.ToInt32(o);
        private static long Long(object o) => o == null ? 0 : Convert.ToInt64(o);
        /// <summary>SQLite 的 REAL 也可能是字符串（历史数据），统一按不变文化转，别让小数点变成千分位</summary>
        private static double Double(object o)
        {
            if (o == null) return 0;
            var t = Convert.ToString(o, CultureInfo.InvariantCulture) ?? "";
            return double.TryParse(t, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : 0;
        }

        /* ---------------- 表结构 ---------------- */

        private void Schema()
        {
            Exec(@"
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);

CREATE TABLE IF NOT EXISTS modules(
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT,
  enabled INTEGER DEFAULT 1,
  sort INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS entries(
  date TEXT PRIMARY KEY,
  fav INTEGER DEFAULT 0,
  bg TEXT DEFAULT '',
  plain TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS vals(
  date TEXT NOT NULL,
  module_id TEXT NOT NULL,
  val TEXT,
  PRIMARY KEY(date, module_id)
);

CREATE TABLE IF NOT EXISTS revisions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  ts TEXT,
  snapshot TEXT
);
CREATE INDEX IF NOT EXISTS ix_rev ON revisions(date, id DESC);

CREATE TABLE IF NOT EXISTS entry_tags(
  date TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY(date, tag)
);
CREATE INDEX IF NOT EXISTS ix_tag ON entry_tags(tag);

CREATE TABLE IF NOT EXISTS links(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  kind TEXT DEFAULT 'related',
  quote TEXT DEFAULT '',
  ts TEXT
);
CREATE INDEX IF NOT EXISTS ix_link_to ON links(to_date);

CREATE TABLE IF NOT EXISTS todos(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  due TEXT DEFAULT '',
  priority INTEGER DEFAULT 1,
  note TEXT DEFAULT '',
  created_at TEXT,
  done_at TEXT,
  sort INTEGER DEFAULT 0,
  list_id TEXT DEFAULT '',
  trashed INTEGER DEFAULT 0
);

-- 清单（像滴答清单那样把待办分组）
CREATE TABLE IF NOT EXISTS todo_lists(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#b8623a',
  sort INTEGER DEFAULT 0,
  created_at TEXT,
  rev INTEGER DEFAULT 1,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS countdowns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  yearly INTEGER DEFAULT 0,
  color TEXT DEFAULT '#b8623a',
  note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS habits(
  id TEXT PRIMARY KEY,
  name TEXT,
  color TEXT,
  archived INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checks(
  date TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  PRIMARY KEY(date, habit_id)
);

CREATE TABLE IF NOT EXISTS habit_logs(
  date TEXT NOT NULL,
  habit_id TEXT NOT NULL,
  val TEXT DEFAULT '',
  note TEXT DEFAULT '',
  PRIMARY KEY(date, habit_id)
);
CREATE INDEX IF NOT EXISTS ix_hlog ON habit_logs(habit_id, date);

CREATE TABLE IF NOT EXISTS pomodoro(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  ts TEXT,
  minutes INTEGER DEFAULT 25,
  kind TEXT DEFAULT 'focus',
  task TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_pomo ON pomodoro(date);

CREATE TABLE IF NOT EXISTS templates(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'day',
  body TEXT DEFAULT '[]',
  builtin INTEGER DEFAULT 0
);

-- 图片库：内容哈希做身份，文件名只当显示名
CREATE TABLE IF NOT EXISTS media(
  id TEXT PRIMARY KEY,          -- sha256 前 16 位 hex，全局唯一且稳定
  sha TEXT NOT NULL,            -- 完整 sha256，校验/去重用
  ext TEXT DEFAULT '',          -- 小写扩展名，不含点
  bytes INTEGER DEFAULT 0,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  orig_name TEXT DEFAULT '',    -- 导入时的原始文件名，仅显示与搜索
  note TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT,
  rev INTEGER DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_media_sha ON media(sha);
CREATE INDEX IF NOT EXISTS ix_media_name ON media(orig_name);

-- 变更日志：为未来多端同步准备的单调整表
CREATE TABLE IF NOT EXISTS changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  op TEXT NOT NULL,             -- ins | upd | del
  rev INTEGER DEFAULT 1,
  ts TEXT,
  device TEXT DEFAULT '',
  payload TEXT
);
CREATE INDEX IF NOT EXISTS ix_changes_seq ON changes(seq);
");

            // 老库升级：缺列就补，不破坏已有数据
            // 第 145 条：倒计时支持手动排序（拖一下就换位置）
            EnsureColumn("countdowns", "sort", "INTEGER DEFAULT 0");
            EnsureColumn("habits", "type", "TEXT DEFAULT 'bool'");
            EnsureColumn("habits", "unit", "TEXT DEFAULT ''");
            EnsureColumn("habits", "options", "TEXT DEFAULT '[]'");
            EnsureColumn("habits", "goal", "REAL DEFAULT 0");
            EnsureColumn("habits", "icon", "TEXT DEFAULT ''");
            EnsureColumn("todos", "due_time", "TEXT DEFAULT ''");
            EnsureColumn("todos", "list_id", "TEXT DEFAULT ''");
            EnsureColumn("todos", "trashed", "INTEGER DEFAULT 0");
            // 第 163 条：待办手动排序。老库可能没有 sort（建表语句里早就有，但迁移过的库另说）
            EnsureColumn("todos", "sort", "INTEGER DEFAULT 0");
            EnsureColumn("habit_logs", "note", "TEXT DEFAULT ''");

            // 同步前置：每张业务表都要能回答"这行变了没有、什么时候删的"
            foreach (var t in new[] { "entries", "todos", "countdowns", "habits", "modules", "templates", "media", "links", "pomodoro", "habit_logs" })
            {
                EnsureColumn(t, "rev", "INTEGER DEFAULT 1");
                EnsureColumn(t, "updated_at", "TEXT DEFAULT ''");
                EnsureColumn(t, "deleted_at", "TEXT DEFAULT NULL");
            }

            MigrateIdsToText();

            // ⚠️ 主键迁移会整表重建，重建时用的是写死的列清单，
            // 所以这里必须再补一次列，否则刚加的 list_id / trashed 会被迁移吃掉。
            EnsureColumn("todos", "list_id", "TEXT DEFAULT ''");
            EnsureColumn("todos", "trashed", "INTEGER DEFAULT 0");
            EnsureColumn("todos", "sort", "INTEGER DEFAULT 0");
            EnsureColumn("habit_logs", "note", "TEXT DEFAULT ''");
            /*
             * countdowns.sort 是同一个坑，而且已经真的踩了：
             *
             * 第 306 行在主键迁移**之前**补 sort，而迁移用的列清单里没有 sort
             * （见 MigrateIdsToText 的 targets）—— 于是补完立刻被整表重建吃掉。
             * 全新装机的用户一打开倒计时就 `no such column: sort`，
             * 因为 Countdowns() 的 ORDER BY 里带着它。
             *
             * 老库看不见：它们早就迁成 TEXT 主键了，MigrateIdsToText 直接 continue，
             * 重建根本不发生，第 306 行补的列得以存活。
             * 这个 bug 只在「新装 / 删档重来 / 换机器」时现形 —— 和 v13 罐子那次一模一样。
             *
             * 两处都改了：重建清单补上列 + 这里再兜一次底。
             * 兜底这行才是真正护航新老两条路径的那一道，别删。
             */
            EnsureColumn("countdowns", "sort", "INTEGER DEFAULT 0");
            // v7：备忘录 / 用户 / 密码 / 缓存 / 节日。同样放在主键迁移之后
            EnsureV7();
            // v8：总结留存 / 密码提示与密保 / 回顾聚合。顺序同样必须在主键迁移之后
            EnsureV8();
            // v9：日记标题 / 定稿与草稿箱 / 待办放弃 / 番茄洞察
            EnsureV9();
            // v10：打卡回收站 / 笔记分组 / 媒体分类与调色 / 记账 / 提醒 / 打气话
            EnsureV10();
            // v11：排序轮子 / 无限层级目录 / 学习模块 / 媒体批量导入（第 196-235 条）
            EnsureV11();
            /*
             * v13：储蓄罐（jars 表 + ledger.jar_id / jar_base 两列）。
             *
             * 这一行以前是漏的 —— EnsureV13 只在 JarList / JarSave 这类罐子接口里
             * 懒调用。后果不是「罐子功能用不了」这么轻：
             *   ledger.accounts、ledger.insight、以及所有带 `IFNULL(jar_id,'')=''`
             *   的统计查询都会直接抛 `no such column: jar_id`，
             *   全新装机的用户一进记账本就是一整页报错、图表全空。
             *
             * 老库之所以看不出问题，是因为升级时手动跑过 EnsureV13，
             * 或者建库时代码里恰好走到过罐子接口 —— 这个 bug 被「历史」掩盖了。
             * 只要有人删档重开或者换台机器，立刻现形。所以必须放在这里。
             */
            EnsureV13();
            /*
             * #250：愿望单。
             *
             * 必须挂在这条链上，不能只靠 WishList 里的懒调用 ——
             * 这个坑本项目已经踩过两次（jars / countdowns.sort）：
             * 某个接口懒建表，结果别的查询先跑到，全新装机直接
             * `no such table`，而老库因为早就建过了完全看不出来。
             */
            EnsureWishes();

            foreach (var t in new[] { "todos", "countdowns", "pomodoro" })
            {
                EnsureColumn(t, "rev", "INTEGER DEFAULT 1");
                EnsureColumn(t, "updated_at", "TEXT DEFAULT ''");
                EnsureColumn(t, "deleted_at", "TEXT DEFAULT NULL");
            }
        }

        /// <summary>
        /// 把自增整数主键换成 UUID。多端同步时两个设备各自 +1 必然撞车，
        /// 所以 id 必须是全局唯一的字符串。老数据按行生成新 id 后搬过去。
        /// </summary>
        private void MigrateIdsToText()
        {
            var targets = new (string table, string cols, string srcCols)[]
            {
                ("todos",
                 "id TEXT PRIMARY KEY,title TEXT,done INTEGER DEFAULT 0,due TEXT DEFAULT '',due_time TEXT DEFAULT '',priority INTEGER DEFAULT 1,note TEXT DEFAULT '',created_at TEXT,done_at TEXT,sort INTEGER DEFAULT 0,list_id TEXT DEFAULT '',trashed INTEGER DEFAULT 0,rev INTEGER DEFAULT 1,updated_at TEXT DEFAULT '',deleted_at TEXT DEFAULT NULL",
                 "lower(hex(randomblob(8))),title,done,due,due_time,priority,note,created_at,done_at,sort,'',0,1,IFNULL(created_at,''),NULL"),
                ("countdowns",
                 "id TEXT PRIMARY KEY,title TEXT,date TEXT,yearly INTEGER DEFAULT 0,color TEXT DEFAULT '#b8623a',note TEXT DEFAULT '',rev INTEGER DEFAULT 1,updated_at TEXT DEFAULT '',deleted_at TEXT DEFAULT NULL,sort INTEGER DEFAULT 0",
                 "lower(hex(randomblob(8))),title,date,yearly,color,note,1,'',NULL,0"),
                ("pomodoro",
                 "id TEXT PRIMARY KEY,date TEXT NOT NULL,ts TEXT,minutes INTEGER DEFAULT 25,kind TEXT DEFAULT 'focus',task TEXT DEFAULT '',rev INTEGER DEFAULT 1,updated_at TEXT DEFAULT '',deleted_at TEXT DEFAULT NULL",
                 "lower(hex(randomblob(8))),date,ts,minutes,kind,task,1,IFNULL(ts,''),NULL")
            };

            foreach (var t in targets)
            {
                try
                {
                    var info = Rows("PRAGMA table_info(" + t.table + ")");
                    var idCol = info.FirstOrDefault(r => Str(r["name"]) == "id");
                    if (idCol == null) continue;
                    if (Str(idCol["type"]).IndexOf("TEXT", StringComparison.OrdinalIgnoreCase) >= 0) continue;

                    Exec("BEGIN;");
                    Exec("CREATE TABLE " + t.table + "__new(" + t.cols + ");");
                    Exec("INSERT INTO " + t.table + "__new SELECT " + t.srcCols + " FROM " + t.table + ";");
                    Exec("DROP TABLE " + t.table + ";");
                    Exec("ALTER TABLE " + t.table + "__new RENAME TO " + t.table + ";");
                    Exec("COMMIT;");
                    Diag.Info("db.migrate", "已把 " + t.table + ".id 迁移为 TEXT");
                }
                catch (Exception ex)
                {
                    try { Exec("ROLLBACK;"); } catch { }
                    Diag.Error("db.migrate", "迁移 " + t.table + " 失败", ex);
                }
            }
        }

        private void EnsureColumn(string table, string col, string def)
        {
            try
            {
                var cols = Rows("PRAGMA table_info(" + table + ")").Select(r => Str(r["name"])).ToList();
                if (!cols.Contains(col)) Exec("ALTER TABLE " + table + " ADD COLUMN " + col + " " + def + ";");
            }
            catch (Exception ex) { Diag.Warn("db.schema", "EnsureColumn " + table + "." + col + " 失败（该列可能不存在，后续读取要兜底）", ex); }
        }

        private void Seed()
        {
            if (Int(Scalar("SELECT COUNT(*) FROM modules")) == 0)
            {
                var defs = new (string type, string title, int on, int sort)[]
                {
                    ("richtext","正文",1,10),
                    ("mood","心情",1,20),
                    ("weather","天气",1,30),
                    ("tags","标签",1,40),
                    ("habits","打卡",1,50),
                    ("todo","今日待办",1,60),
                    ("sleep","睡眠",0,70),
                    ("energy","精力",0,80),
                    ("rating","评分",0,90),
                    ("images","图片",0,100),
                    ("quote","引用",0,110),
                    ("heading","小标题",0,120),
                    ("divider","分割线",0,130),
                };
                foreach (var d in defs)
                    Exec("INSERT INTO modules(id,type,title,enabled,sort,config) VALUES($i,$t,$ti,$e,$s,'{}')",
                        ("$i", NewId()), ("$t", d.type), ("$ti", d.title), ("$e", d.on), ("$s", d.sort));
            }

            if (Int(Scalar("SELECT COUNT(*) FROM habits")) == 0)
            {
                // 默认给几个不同类型，让用户一眼看到「打卡也能记数据」
                var hs = new (string n, string c, string t, string u, string o, int g, string ic)[]
                {
                    ("早起", "#b8623a", "time", "", "[]", 0, "⏰"),
                    ("运动", "#5f8256", "duration", "分钟", "[\"跑步\",\"力量\",\"游泳\",\"球类\",\"散步\"]", 30, "🏃"),
                    ("阅读", "#4a7396", "number", "页", "[]", 20, "📖"),
                    ("喝够水", "#4f8a86", "bool", "", "[]", 8, "💧")
                };
                for (int i = 0; i < hs.Length; i++)
                    Exec("INSERT INTO habits(id,name,color,archived,sort,type,unit,options,goal,icon) VALUES($i,$n,$c,0,$s,$t,$u,$o,$g,$ic)",
                        ("$i", NewId()), ("$n", hs[i].n), ("$c", hs[i].c), ("$s", i),
                        ("$t", hs[i].t), ("$u", hs[i].u), ("$o", hs[i].o), ("$g", hs[i].g), ("$ic", hs[i].ic));
            }

            if (Int(Scalar("SELECT COUNT(*) FROM templates")) == 0) SeedTemplates();

            if (Scalar("SELECT v FROM meta WHERE k='navDock'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('navDock','left')");
            if (Scalar("SELECT v FROM meta WHERE k='navWidth'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('navWidth','218')");
            if (Scalar("SELECT v FROM meta WHERE k='density'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('density','normal')");
            if (Scalar("SELECT v FROM meta WHERE k='features'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('features','{}')");

            if (Scalar("SELECT v FROM meta WHERE k='theme'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('theme','paper')");
            else
                // 老版本存的是 light / dark，主题改名后要迁移，否则取不到任何 CSS 变量
                Exec("UPDATE meta SET v='paper' WHERE k='theme' AND v IN ('light','')");
            Exec("UPDATE meta SET v='ink' WHERE k='theme' AND v='dark'");
            if (Scalar("SELECT v FROM meta WHERE k='fontSize'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('fontSize','16')");
            if (Scalar("SELECT v FROM meta WHERE k='lineHeight'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('lineHeight','1.85')");
            if (Scalar("SELECT v FROM meta WHERE k='typewriter'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('typewriter','0')");
            if (Scalar("SELECT v FROM meta WHERE k='focus'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('focus','0')");
            if (Scalar("SELECT v FROM meta WHERE k='createdAt'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('createdAt',$d)", ("$d", Today));

            // 设备标识：将来多端同步时用来区分"这条改动来自哪台机器"
            if (Scalar("SELECT v FROM meta WHERE k='deviceId'") == null)
                Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('deviceId',$d)", ("$d", NewId()));
        }

        private void DailyBackup()
        {
            try
            {
                if (backedUpDay == Today) return;
                backedUpDay = Today;
                var dst = Path.Combine(BackupDir, "riqian-" + Today + ".db");
                if (File.Exists(dst) || !File.Exists(DbPath)) return;
                // WAL 模式下必须先 checkpoint，否则最新的写入还在 -wal 文件里，拷出来的库是旧的
                try { Exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { }

                /* ⚠️ 下面这一对 Close/Open 只有在 `Pooling=False` 时才有意义（见 Open()）。
                   池化开着的话 Close 只是把物理连接还进池子，文件句柄没还，
                   File.Copy 拷的是一个"还开着写"的库 —— 历史遗留的
                   自动备份/riqian-2026-10-31.db-shm 就是那时候留下的。 */
                conn.Close();
                File.Copy(DbPath, dst, true);
                conn.Open();
            }
            catch { try { if (conn.State != System.Data.ConnectionState.Open) conn.Open(); } catch { } }
        }

        private static string NewId() => Guid.NewGuid().ToString("N").Substring(0, 10);

        /* ---------------- JSON 小工具 ---------------- */

        private static readonly Regex TagRe = new Regex("<[^>]+>", RegexOptions.Compiled);
        private static readonly Regex SpaceRe = new Regex("[ \\t\\r\\n]+", RegexOptions.Compiled);

        public static string StripHtml(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            s = Regex.Replace(s, "<br\\s*/?>", "\n", RegexOptions.IgnoreCase);
            s = Regex.Replace(s, "</(p|div|li|h[1-6])>", "\n", RegexOptions.IgnoreCase);
            s = TagRe.Replace(s, "");
            s = s.Replace("&nbsp;", " ").Replace("&amp;", "&").Replace("&lt;", "<").Replace("&gt;", ">").Replace("&quot;", "\"");
            return SpaceRe.Replace(s, " ").Trim();
        }

        private static string JsonText(JsonNode n)
        {
            if (n == null) return "null";
            return n.ToJsonString();
        }

        private static object Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try { using var d = JsonDocument.Parse(json); return d.RootElement.Clone(); }
            catch { return null; }
        }

        private string BuildPlain(Dictionary<string, string> vals)
        {
            var types = ModulesRaw().ToDictionary(m => m["id"], m => m["type"]);
            var sb = new StringBuilder();
            foreach (var kv in vals)
            {
                if (!types.TryGetValue(kv.Key, out var t) || kv.Value == null) continue;
                var node = JsonNode.Parse(kv.Value);
                switch (t)
                {
                    case "richtext":
                    case "heading":
                        sb.Append(StripHtml(node?.GetValue<string>() ?? "")).Append('\n');
                        break;
                    case "tags":
                        if (node is JsonArray ta) foreach (var x in ta) sb.Append(x).Append(' ');
                        sb.Append('\n');
                        break;
                    case "quote":
                        if (node is JsonArray qa)
                            foreach (var x in qa)
                                sb.Append(x?["text"]?.ToString() ?? "").Append('\n');
                        break;
                    case "mood":
                        // 心情只用于筛选，不写进正文（否则搜索结果里会混进「不错」这类词）
                        break;
                }
            }
            return sb.ToString().Trim();
        }

        /* ---------------- 设置 ---------------- */

        public object SettingsAll()
        {
            var d = new Dictionary<string, string>();
            foreach (var r in Rows("SELECT k,v FROM meta")) d[Str(r["k"])] = Str(r["v"]);
            return d;
        }

        public object SettingSet(string k, string v)
        {
            Exec("INSERT OR REPLACE INTO meta(k,v) VALUES($k,$v)", ("$k", k), ("$v", v));
            return new { ok = true };
        }

        /// <summary>
        /// 读一条设置。以前只有 SettingSet 没有对应的读方法，宿主想知道某个开关是开的还是关的，
        /// 只能把 SettingsAll() 整个拉一遍再翻字典 —— 启动路径上干这事太浪费
        /// （bootstrap 返回体里几百条设置，就为了看一个 debugApi）。
        /// </summary>
        public string GetSetting(string k, string def = "")
        {
            var o = Scalar("SELECT v FROM meta WHERE k=$k", ("$k", k));
            return o == null || o == DBNull.Value ? def : Convert.ToString(o);
        }

        /* ---------------- 模块 ---------------- */

        private List<Dictionary<string, object>> ModulesRaw() =>
            Rows("SELECT id,type,title,enabled,sort,config FROM modules ORDER BY sort, rowid");

        public object Modules()
        {
            return ModulesRaw().Select(r => new
            {
                id = Str(r["id"]),
                type = Str(r["type"]),
                title = Str(r["title"]),
                enabled = Int(r["enabled"]),
                sort = Int(r["sort"]),
                config = Parse(Str(r["config"])) ?? new { }
            }).ToList();
        }

        public object ModuleAdd(string type, string title)
        {
            var id = NewId();
            var maxSort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM modules")) + 10;
            Exec("INSERT INTO modules(id,type,title,enabled,sort,config) VALUES($i,$t,$ti,1,$s,'{}')",
                ("$i", id), ("$t", type), ("$ti", title), ("$s", maxSort));
            Touch("modules", id, "ins", 1, title);
            return new { ok = true, id };
        }

        public object ModuleUpdate(string id, string title, int enabled, string config)
        {
            if (title != null) Exec("UPDATE modules SET title=$t WHERE id=$i", ("$t", title), ("$i", id));
            if (enabled >= 0) Exec("UPDATE modules SET enabled=$e WHERE id=$i", ("$e", enabled), ("$i", id));
            if (config != null) Exec("UPDATE modules SET config=$c WHERE id=$i", ("$c", config), ("$i", id));
            Touch("modules", id, "upd", 1, null);
            return new { ok = true };
        }

        public object ModuleDelete(string id)
        {
            Exec("DELETE FROM modules WHERE id=$i", ("$i", id));
            Exec("DELETE FROM vals WHERE module_id=$i", ("$i", id));
            PurgeModuleHidden(id);       // 第 237 条：顺手清掉它在各日期上的临时隐藏记录
            Touch("modules", id, "del", 1, null);
            return new { ok = true };
        }

        public object ModuleReorder(string[] ids)
        {
            for (int i = 0; i < ids.Length; i++)
            {
                Exec("UPDATE modules SET sort=$s WHERE id=$i", ("$s", (i + 1) * 10), ("$i", ids[i]));
                Touch("modules", ids[i], "upd", 1, null);
            }
            return new { ok = true };
        }

        /* ---------------- 第 237 条：某一天临时关闭的模块 ----------------
         *
         * 问题原话：「在该页面中关闭，不应该影响未来或者从前的每一天。
         * 如果想要影响未来的每一天，应该去设置里『日记与模块』里保证长期生效，
         * 不然只是在『今天』里点的话只对今天临时生效（注意，这里的今天不是指时间上的今天，
         * 而是指日记上的今天，不能说一过 24 点啪突然就变回去了）」。
         *
         * 所以「今天页里点 ✕」= 只在**那一篇日记**里不显示，写进这张表，
         * 键是 (date, module_id)，跟 modules.enabled 完全分开。
         * 一过 24 点绝对不会"啪"地变回去 —— 因为那条记录是跟着日期走的，
         * 你回去翻 11 月 1 号，它就还是当时那个样子。
         *
         * 反过来，设置里关掉的模块是 modules.enabled=0，那是全局的，
         * 所有日期一起消失 —— 这正是用户说的「保证长期生效」。
         * 两条路径语义不同，不能互写。
         */

        private void EnsureModuleHiddenTable()
        {
            Exec(@"CREATE TABLE IF NOT EXISTS module_hidden(
  date TEXT NOT NULL,
  module_id TEXT NOT NULL,
  PRIMARY KEY(date, module_id))");
        }

        /// <summary>某一天被临时隐藏的模块 id 列表</summary>
        public List<string> ModuleHiddenOn(string date)
        {
            try
            {
                EnsureModuleHiddenTable();
                return Rows("SELECT module_id FROM module_hidden WHERE date=$d", ("$d", date))
                    .Select(r => Str(r["module_id"])).ToList();
            }
            catch (Exception ex)
            {
                Diag.Warn("db.module", "读临时隐藏模块失败 date=" + date, ex);
                return new List<string>();
            }
        }

        /// <summary>在「某一天」里隐藏 / 恢复一个模块</summary>
        public object ModuleHideOn(string date, string moduleId, int hidden)
        {
            if (string.IsNullOrEmpty(date) || string.IsNullOrEmpty(moduleId))
                return new { ok = false, err = "缺 date 或 id" };
            try
            {
                EnsureModuleHiddenTable();
                if (hidden == 1)
                    Exec("INSERT OR REPLACE INTO module_hidden(date,module_id) VALUES($d,$m)",
                        ("$d", date), ("$m", moduleId));
                else
                    Exec("DELETE FROM module_hidden WHERE date=$d AND module_id=$m",
                        ("$d", date), ("$m", moduleId));

                Touch("module_hidden", date + ":" + moduleId, hidden == 1 ? "ins" : "del", 1, null);
                Diag.Info("db.module", (hidden == 1 ? "临时隐藏" : "临时恢复") + " 模块=" + moduleId + " 日期=" + date);
                return new { ok = true };
            }
            catch (Exception ex)
            {
                Diag.Error("db.module", "临时隐藏模块失败 date=" + date + " id=" + moduleId, ex);
                return new { ok = false, err = ex.Message };
            }
        }

        /// <summary>
        /// 根治性清理：模块被**彻底删除**时，把它在所有日期上的临时隐藏记录一起清掉。
        /// 不清的话，这些孤儿记录会一直躺在表里，虽然不影响显示（模块本身都没了），
        /// 但属于垃圾数据，而且哪天 id 被复用就会冒出诡异现象。
        /// </summary>
        private void PurgeModuleHidden(string moduleId)
        {
            try
            {
                EnsureModuleHiddenTable();
                Exec("DELETE FROM module_hidden WHERE module_id=$m", ("$m", moduleId));
                // module_shown 可能是懒建表的，这里先确保它存在再删，否则第一次删会抛异常
                EnsureModuleShownTable();
                Exec("DELETE FROM module_shown WHERE module_id=$m", ("$m", moduleId));
            }
            catch { /* 清理失败不影响主流程 */ }
        }

        /* ---------------- 第 237 条后半：某一天临时**多显示**的模块 ----------------
         *
         * 和 module_hidden 正好相反：
         *   module_hidden = 全局开着，但这一篇不要
         *   module_shown  = 全局关着，但这一篇想要
         *
         * 为什么要这张表：用户原话是「在『今天』里也应该可以简单临时添加模块」。
         * 第一版我直接调 modules.add，那是**全局永久新增** —— 等于在设置里加了个模块，
         * 所有日子都会出现，和「临时」完全不是一回事。这里补上真正按日期生效的版本。
         *
         * 严格说它不会「新建」一个模块（那必然要改 modules 表、影响全局），
         * 而是把**已经存在但被全局关掉**的模块在这一天重新亮出来。
         * 若确实要一个全新的模块，那条路仍在设置页，且会明确告知是长期生效的。
         */

        private void EnsureModuleShownTable()
        {
            Exec(@"CREATE TABLE IF NOT EXISTS module_shown(
  date TEXT NOT NULL,
  module_id TEXT NOT NULL,
  PRIMARY KEY(date, module_id))");
        }

        /// <summary>某一天被临时多显示的模块 id 列表</summary>
        public List<string> ModuleShownOn(string date)
        {
            try
            {
                EnsureModuleShownTable();
                return Rows("SELECT module_id FROM module_shown WHERE date=$d", ("$d", date))
                    .Select(r => Str(r["module_id"])).ToList();
            }
            catch (Exception ex)
            {
                Diag.Warn("db.module", "读临时显示模块失败 date=" + date, ex);
                return new List<string>();
            }
        }

        /// <summary>在某一天里临时显示 / 取消显示一个模块</summary>
        public object ModuleShowOn(string date, string moduleId, int shown)
        {
            if (string.IsNullOrEmpty(date) || string.IsNullOrEmpty(moduleId))
                return new { ok = false, err = "缺 date 或 id" };
            try
            {
                EnsureModuleShownTable();
                if (shown == 1)
                    Exec("INSERT OR REPLACE INTO module_shown(date,module_id) VALUES($d,$m)",
                        ("$d", date), ("$m", moduleId));
                else
                    Exec("DELETE FROM module_shown WHERE date=$d AND module_id=$m",
                        ("$d", date), ("$m", moduleId));
                Diag.Info("db.module", (shown == 1 ? "临时显示" : "取消临时显示") + " 模块=" + moduleId + " 日期=" + date);
                return new { ok = true };
            }
            catch (Exception ex)
            {
                Diag.Error("db.module", "临时显示模块失败 date=" + date + " id=" + moduleId, ex);
                return new { ok = false, err = ex.Message };
            }
        }

        /* ---------------- 日记 ---------------- */

        public object EntryGet(string date)
        {
            var row = Rows("SELECT * FROM entries WHERE date=$d", ("$d", date)).FirstOrDefault();

            /*
             * #244 衍生（最后一处，也是最要紧的一处）：
             * 这一天加了密码，就不许从这个接口把正文交出去。
             *
             * 之前只有 entry.list / search.all 做了判断，entry.get 没做。
             * 而 entry.get 恰好是**唯一能拿到全部模块值 + 正文 + 标签**的接口，
             * 也就是「真正的完整内容」。只在列表上做过滤、把内容源留着，
             * 锁就只是界面上的装饰 —— 任何人走一次接口就全拿到了。
             *
             * 解锁后 IsDiaryLocked 返回 false，这里自然放行，不会把人锁死。
             * 返回结构保持完全一致（空值 + locked 标记），前端不用改判断逻辑。
             */
            var locked = IsDiaryLocked(date);
            if (locked)
            {
                return new
                {
                    date,
                    exists = row != null,
                    locked = true,
                    title = "",
                    status = "draft",
                    publishedAt = "",
                    fav = row == null ? 0 : Int(row["fav"]),
                    bg = "",
                    bgTone = "",
                    plain = "",
                    createdAt = null as string,
                    updatedAt = null as string,
                    values = new Dictionary<string, object>(),
                    tags = new List<string>(),
                    links = new List<object>(),
                    backlinks = new List<object>(),
                    revisionCount = 0,
                };
            }

            var vals = new Dictionary<string, object>();
            foreach (var v in Rows("SELECT module_id,val FROM vals WHERE date=$d", ("$d", date)))
                vals[Str(v["module_id"])] = Parse(Str(v["val"]));

            var tags = Rows("SELECT tag FROM entry_tags WHERE date=$d", ("$d", date)).Select(r => Str(r["tag"])).ToList();
            var links = Rows("SELECT id,to_date,kind,quote FROM links WHERE from_date=$d", ("$d", date))
                .Select(r => new { id = Int(r["id"]), date = Str(r["to_date"]), kind = Str(r["kind"]), quote = Str(r["quote"]) }).ToList();

            return new
            {
                date,
                exists = row != null,
                /*
                 * 显式给 false，不是省掉。
                 *
                 * 锁定分支返回 locked=true，这一支如果直接不写这个字段，
                 * 前端拿到的是 undefined —— 和 `false` 在 JS 里不等价：
                 * `x.locked === false` 会是 false，`!x.locked` 又是 true，
                 * 两种写法给出相反结论。字段要么一直有，要么一直没有。
                 */
                locked = false,
                title = row == null ? "" : Str(row["title"]),
                status = row == null || Str(row["status"]) == "" ? "draft" : Str(row["status"]),
                publishedAt = row == null ? "" : Str(row["published_at"]),
                fav = row == null ? 0 : Int(row["fav"]),
                bg = row == null ? "" : Str(row["bg"]),
                bgTone = row == null ? "" : Str(row["bg_tone"]),
                plain = row == null ? "" : Str(row["plain"]),
                createdAt = row == null ? null : Str(row["created_at"]),
                updatedAt = row == null ? null : Str(row["updated_at"]),
                values = vals,
                tags,
                links,
                backlinks = Backlinks(date),
                revisionCount = Int(Scalar("SELECT COUNT(*) FROM revisions WHERE date=$d", ("$d", date)))
            };
        }

        /// <summary>
        /// 保存一天的内容。
        /// v9 起多两件事：
        /// 1) title 可空 —— 空表示"不改标题"，不是"清空标题"；
        /// 2) **什么都没写就不建行**。以前跨天时一次空转保存会凭空插一条空日记，
        ///    用户看到的就是"一口气冒出两篇日记"（第 60 条的根因）。
        /// </summary>
        public object EntrySave(string date, JsonElement values, int fav, string bg, string title = null, string bgTone = null)
        {
            var now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            var dict = new Dictionary<string, string>();
            if (values.ValueKind == JsonValueKind.Object)
                foreach (var p in values.EnumerateObject())
                    dict[p.Name] = p.Value.GetRawText();

            var exists = Int(Scalar("SELECT COUNT(*) FROM entries WHERE date=$d", ("$d", date))) > 0;
            var plain = BuildPlain(dict);
            var newTitle = title == null ? null : (title ?? "").Trim();

            bool anyVal = dict.Any(kv => !IsBlankJson(kv.Value));
            bool blank = !anyVal
                         && plain.Trim().Length == 0
                         && string.IsNullOrEmpty((newTitle ?? "").Trim())
                         && fav == 0
                         && string.IsNullOrEmpty(bg);

            if (!exists && blank)
                return new { ok = true, skipped = true, updatedAt = "", plain = "", chars = 0, exists = false };

            if (!exists)
                Exec("INSERT INTO entries(date,fav,bg,bg_tone,plain,title,created_at,updated_at,status) VALUES($d,$f,$b,$bt,$p,$ti,$c,$u,'draft')",
                    ("$d", date), ("$f", fav), ("$b", bg ?? ""), ("$bt", bgTone ?? ""), ("$p", plain), ("$ti", newTitle ?? ""), ("$c", now), ("$u", now));
            else if (newTitle != null)
                Exec("UPDATE entries SET fav=$f,bg=$b,plain=$p,title=$ti,updated_at=$u WHERE date=$d",
                    ("$f", fav), ("$b", bg ?? ""), ("$p", plain), ("$ti", newTitle), ("$u", now), ("$d", date));
            else
                Exec("UPDATE entries SET fav=$f,bg=$b,plain=$p,updated_at=$u WHERE date=$d",
                    ("$f", fav), ("$b", bg ?? ""), ("$p", plain), ("$u", now), ("$d", date));

            // 背景调色单独一条：传 null 表示"这次不改"，传空串表示"恢复原样"
            if (bgTone != null)
                Exec("UPDATE entries SET bg_tone=$t WHERE date=$d", ("$t", bgTone), ("$d", date));

            Exec("DELETE FROM vals WHERE date=$d", ("$d", date));
            foreach (var kv in dict)
                Exec("INSERT INTO vals(date,module_id,val) VALUES($d,$m,$v)", ("$d", date), ("$m", kv.Key), ("$v", kv.Value));

            SaveRevision(date, dict, fav, bg);

            Exec("UPDATE entries SET rev=rev+1, updated_at=$u WHERE date=$d", ("$u", now), ("$d", date));
            Touch("entries", date, exists ? "upd" : "ins", Int(Scalar("SELECT rev FROM entries WHERE date=$d", ("$d", date))));

            return new { ok = true, updatedAt = now, plain, chars = plain.Replace(" ", "").Length, exists = true };
        }

        /// <summary>判断一个模块值是不是"空的"（空字符串 / null / 空数组 / 空对象 / 0）。</summary>
        private static bool IsBlankJson(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return true;
            var t = raw.Trim();
            return t == "" || t == "\"\"" || t == "null" || t == "[]" || t == "{}" || t == "0" || t == "0.0" || t == "false";
        }

        private void SaveRevision(string date, Dictionary<string, string> vals, int fav, string bg)
        {
            var snap = JsonSerializer.Serialize(new { values = vals, fav, bg });
            var last = Rows("SELECT id,ts,snapshot FROM revisions WHERE date=$d ORDER BY id DESC LIMIT 1", ("$d", date)).FirstOrDefault();
            if (last != null && Str(last["snapshot"]) == snap) return;

            var canMerge = last != null &&
                DateTime.TryParse(Str(last["ts"]), out var lt) &&
                (DateTime.Now - lt).TotalSeconds < 120;

            if (canMerge)
                Exec("UPDATE revisions SET ts=$t,snapshot=$s WHERE id=$i",
                    ("$t", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")), ("$s", snap), ("$i", Int(last["id"])));
            else
                Exec("INSERT INTO revisions(date,ts,snapshot) VALUES($d,$t,$s)",
                    ("$d", date), ("$t", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")), ("$s", snap));

            Exec(@"DELETE FROM revisions WHERE date=$d AND id NOT IN
                   (SELECT id FROM revisions WHERE date=$d ORDER BY id DESC LIMIT 300)", ("$d", date));
        }

        public object Revisions(string date)
        {
            return Rows("SELECT id,ts,snapshot FROM revisions WHERE date=$d ORDER BY id DESC", ("$d", date))
                .Select(r =>
                {
                    var snap = Str(r["snapshot"]);
                    var chars = StripHtml(snap).Length;
                    string preview = "";
                    try
                    {
                        var doc = JsonNode.Parse(snap);
                        foreach (var kv in doc["values"].AsObject())
                            if (kv.Value != null && kv.Value.GetValueKind() == JsonValueKind.String)
                            {
                                var t = StripHtml(kv.Value.GetValue<string>());
                                if (t.Length > preview.Length) preview = t;
                            }
                    }
                    catch { }
                    return new
                    {
                        id = Int(r["id"]),
                        ts = Str(r["ts"]),
                        chars,
                        preview = preview.Length > 80 ? preview.Substring(0, 80) : preview
                    };
                }).ToList();
        }

        public object RevisionGet(int id)
        {
            var r = Rows("SELECT id,ts,snapshot FROM revisions WHERE id=$i", ("$i", id)).FirstOrDefault();
            if (r == null) return new { ok = false };
            return new { ok = true, id, ts = Str(r["ts"]), snapshot = Parse(Str(r["snapshot"])) };
        }

        public object RevisionRestore(int id)
        {
            var r = Rows("SELECT date,snapshot FROM revisions WHERE id=$i", ("$i", id)).FirstOrDefault();
            if (r == null) return new { ok = false };
            var date = Str(r["date"]);
            var doc = JsonNode.Parse(Str(r["snapshot"]));
            var vals = new Dictionary<string, string>();
            if (doc["values"] is JsonObject vo)
                foreach (var kv in vo) vals[kv.Key] = kv.Value?.ToJsonString() ?? "null";
            var fav = doc["fav"]?.GetValue<int>() ?? 0;
            var bg = doc["bg"]?.GetValue<string>() ?? "";

            EntrySave(date, JsonSerializer.SerializeToElement(
                vals.ToDictionary(k => k.Key, k => Parse(k.Value))), fav, bg);
            return new { ok = true, date };
        }

        public object EntryList(string q, string from, string to, int mood, string tag, int fav, int hasImg, int limit, int offset)
        {
            var sb = new StringBuilder("SELECT * FROM entries WHERE 1=1");
            var ps = new List<(string, object)>();
            if (!string.IsNullOrWhiteSpace(q))
            {
                // 标题也参与搜索（v9）：不然写了标题反而搜不到
                sb.Append(" AND (plain LIKE $q OR IFNULL(title,'') LIKE $q OR date LIKE $q2)");
                ps.Add(("$q", "%" + q + "%")); ps.Add(("$q2", "%" + q + "%"));
            }
            if (!string.IsNullOrEmpty(from)) { sb.Append(" AND date>=$f"); ps.Add(("$f", from)); }
            if (!string.IsNullOrEmpty(to)) { sb.Append(" AND date<=$t"); ps.Add(("$t", to)); }
            if (fav == 1) sb.Append(" AND fav=1");
            if (!string.IsNullOrEmpty(tag)) { sb.Append(" AND date IN (SELECT date FROM entry_tags WHERE tag=$tg)"); ps.Add(("$tg", tag)); }
            if (hasImg == 1) sb.Append(" AND date IN (SELECT date FROM vals WHERE val LIKE '%\"%' AND module_id IN (SELECT id FROM modules WHERE type='images'))");
            if (mood > 0) sb.Append(" AND date IN (SELECT date FROM vals WHERE module_id IN (SELECT id FROM modules WHERE type='mood') AND val=$mo)");
            if (mood > 0) ps.Add(("$mo", mood.ToString()));
            sb.Append(" ORDER BY date DESC LIMIT $l OFFSET $o");
            ps.Add(("$l", limit <= 0 ? 200 : limit)); ps.Add(("$o", offset));

            var rows = Rows(sb.ToString(), ps.ToArray());
            return rows.Select(r =>
            {
                var d = Str(r["date"]);
                /*
                 * #244：加了密码的那一天，正文不能从这里出去。
                 *
                 * 「今天」页有 <Guarded> 挡着，但列表接口不认那把锁 ——
                 * 用户给 10-31 加了密码，切到「流」照样看到全文，
                 * 「记录」页、全局搜索也一样。挡在界面上只是看不见，不是拿不到。
                 *
                 * 这里直接把内容抹掉、只留一个 locked 标记，前端据此显示占位。
                 * 不给内容，前端就算被改坏也泄露不出去。
                 */
                var locked = IsDiaryLocked(d);
                var vals = new Dictionary<string, object>();
                if (!locked)
                {
                    foreach (var v in Rows("SELECT module_id,val FROM vals WHERE date=$d", ("$d", d)))
                        vals[Str(v["module_id"])] = Parse(Str(v["val"]));
                }
                return new
                {
                    date = d,
                    locked,
                    title = locked ? "" : Str(r["title"]),
                    status = Str(r["status"]) == "" ? "draft" : Str(r["status"]),
                    fav = Int(r["fav"]),
                    bg = Str(r["bg"]),
                    bgTone = Str(r["bg_tone"]),
                    plain = locked ? "" : Str(r["plain"]),
                    chars = locked ? 0 : Str(r["plain"]).Replace(" ", "").Length,
                    updatedAt = Str(r["updated_at"]),
                    values = vals,
                    tags = locked
                        ? new List<string>()
                        : Rows("SELECT tag FROM entry_tags WHERE date=$d", ("$d", d)).Select(x => Str(x["tag"])).ToList()
                };
            }).ToList();
        }

        public object EntryFav(string date, int fav)
        {
            Exec("INSERT OR IGNORE INTO entries(date,fav,bg,plain,created_at,updated_at) VALUES($d,0,'','',$t,$t)",
                ("$d", date), ("$t", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")));
            Exec("UPDATE entries SET fav=$f WHERE date=$d", ("$f", fav), ("$d", date));
            return new { ok = true };
        }

        /// <summary>
        /// 只改背景（不动正文）。v10 起多带一个调色 JSON：
        /// 背景图要单独调亮度/对比度/色温这些，参数跟着这一天走，而不是改库里那张图本身。
        /// </summary>
        public object EntryBg(string date, string bg, string tone = null)
        {
            var now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            Exec("INSERT OR IGNORE INTO entries(date,fav,bg,plain,created_at,updated_at) VALUES($d,0,'','',$t,$t)",
                ("$d", date), ("$t", now));
            if (tone == null)
                Exec("UPDATE entries SET bg=$b WHERE date=$d", ("$b", bg ?? ""), ("$d", date));
            else
                Exec("UPDATE entries SET bg=$b, bg_tone=$t WHERE date=$d",
                    ("$b", bg ?? ""), ("$t", tone), ("$d", date));
            return new { ok = true };
        }

        public object EntryDelete(string date)
        {
            Exec("DELETE FROM entries WHERE date=$d", ("$d", date));
            Exec("DELETE FROM vals WHERE date=$d", ("$d", date));
            Exec("DELETE FROM revisions WHERE date=$d", ("$d", date));
            Exec("DELETE FROM entry_tags WHERE date=$d", ("$d", date));
            Exec("DELETE FROM links WHERE from_date=$d OR to_date=$d", ("$d", date));
            Touch("entries", date, "del", 1, null);
            return new { ok = true };
        }

        /* ---------------- 标签 ---------------- */

        public object Tags()
        {
            return Rows(@"SELECT tag, COUNT(*) AS n FROM entry_tags GROUP BY tag ORDER BY n DESC, tag")
                .Select(r => new { tag = Str(r["tag"]), n = Int(r["n"]) }).ToList();
        }

        public object TagSet(string date, string[] tags)
        {
            if (string.IsNullOrWhiteSpace(date)) return new { ok = false, err = "没指定哪一天" };

            /* 必须先洗一遍再动手：原来是"先删光、再一条条插"，
               万一半路抛异常（非法字符、约束冲突、磁盘满），
               用户原有的标签已经没了，新的只进去一半 —— 净损失。
               现在整段包在事务里，要么全换掉，要么原样不动。 */
            var clean = (tags ?? Array.Empty<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Where(x => x.Length > 0 && x.Length <= 40)
                .Distinct()
                .ToArray();

            try
            {
                Exec("BEGIN;");
                Exec("DELETE FROM entry_tags WHERE date=$d", ("$d", date));
                foreach (var t in clean)
                    Exec("INSERT OR IGNORE INTO entry_tags(date,tag) VALUES($d,$t)", ("$d", date), ("$t", t));
                Exec("COMMIT;");
                return new { ok = true, count = clean.Length };
            }
            catch (Exception ex)
            {
                try { Exec("ROLLBACK;"); } catch { }
                return new { ok = false, err = ex.Message };
            }
        }

        /* ---------------- 关联 / 引用 ---------------- */

        public object Backlinks(string date)
        {
            // 反向链接全部来自 links 表：界面里插入引用/关联时都会同步写一条，
            // 比在 HTML 里做字符串匹配更可靠。
            return Rows("SELECT id,from_date,kind,quote FROM links WHERE to_date=$d ORDER BY from_date DESC", ("$d", date))
                .Select(r => new { id = Int(r["id"]), date = Str(r["from_date"]), kind = Str(r["kind"]), quote = Str(r["quote"]) })
                .ToList();
        }

        public object LinkAdd(string from, string to, string kind, string quote)
        {
            if (from == to) return new { ok = false, err = "不能和自己关联" };
            var n = Int(Scalar("SELECT COUNT(*) FROM links WHERE from_date=$f AND to_date=$t", ("$f", from), ("$t", to)));
            if (n == 0)
                Exec("INSERT INTO links(from_date,to_date,kind,quote,ts) VALUES($f,$t,$k,$q,$ts)",
                    ("$f", from), ("$t", to), ("$k", kind ?? "related"), ("$q", quote ?? ""),
                    ("$ts", DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")));
            return new { ok = true };
        }

        public object LinkDelete(int id)
        {
            Exec("DELETE FROM links WHERE id=$i", ("$i", id));
            return new { ok = true };
        }

        /* ---------------- 待办 ---------------- */

        /// <summary>
        /// 待办列表。
        /// 第 163 条：排序方式下推给 SQL —— 前端拿到的就是最终顺序，
        /// 不再「先取全量、再在 JS 里 sort」（§2.6）。三种口径：
        ///   manual   用户拖出来的顺序（sort 0/10/20…，新建项追加在末尾）
        ///   quad     四象限：先看重要（优先级高），再看紧急（到期早 / 空日期排最后）
        ///   due      纯按截止日期，没日期的垫底
        /// </summary>
        public object Todos(string mode = null)
        {
            var m = (mode ?? "").Trim().ToLowerInvariant();
            string order;
            switch (m)
            {
                case "quad":
                case "priority":
                    // 空日期不能算「最早」，否则没排期的事会挤到最前面
                    order = "trashed, done, priority DESC, CASE WHEN IFNULL(due,'')='' THEN 1 ELSE 0 END, due, sort, id";
                    break;
                case "due":
                    order = "trashed, done, CASE WHEN IFNULL(due,'')='' THEN 1 ELSE 0 END, due, sort, id";
                    break;
                default:
                    /*
                     * 手动：sort 为主。加 created_at 是给老数据兜底 ——
                     * 这个功能之前 sort 从没随用户拖动写过，老库整表 sort=0，
                     * 只按 sort 排会退化成随机 id 序（看起来就是"顺序坏了"）。
                     * 拖过一次之后 sort 全是唯一的，created_at 不再起作用。
                     */
                    order = "trashed, done, sort, created_at, id";
                    break;
            }
            return Rows("SELECT * FROM todos WHERE deleted_at IS NULL ORDER BY " + order).Select(r => new
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
                // 手动顺序（第 84 条）：前端要能读到，否则「拖完再刷新」看不出到底存没存住
                sort = Int(r["sort"]),
                repeat = Str(r["repeat"]),
                deletedAt = Str(r["deleted_at"])
            }).ToList();
        }

        /* ---------------- 清单 ---------------- */

        public object TodoLists()
        {
            return Rows("SELECT * FROM todo_lists WHERE deleted_at IS NULL ORDER BY sort, rowid").Select(r =>
            {
                var id = Str(r["id"]);
                return new
                {
                    id,
                    name = Str(r["name"]),
                    color = Str(r["color"]),
                    sort = Int(r["sort"]),
                    // 第 218 / 220 条：描述 + 上级清单，前端靠这两个字段画层级树
                    note = Str(r["note"]),
                    parentId = Str(r["parent_id"]),
                    open = Int(Scalar("SELECT COUNT(*) FROM todos WHERE list_id=$l AND done=0 AND trashed=0 AND deleted_at IS NULL", ("$l", id))),
                    done = Int(Scalar("SELECT COUNT(*) FROM todos WHERE list_id=$l AND done=1 AND trashed=0 AND deleted_at IS NULL", ("$l", id))),
                    trashed = Int(Scalar("SELECT COUNT(*) FROM todos WHERE list_id=$l AND trashed=1 AND deleted_at IS NULL", ("$l", id)))
                };
            }).ToList();
        }

        public object TodoListAdd(string name, string color)
        {
            if (string.IsNullOrWhiteSpace(name)) return new { ok = false, err = "名称不能空" };
            var id = NewId();
            // 和拖动排序的归一化步长（0/10/20）保持一致，否则新项会插到已有项中间
            var sort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM todo_lists")) + 10;
            Exec(@"INSERT INTO todo_lists(id,name,color,sort,created_at,rev,updated_at)
                   VALUES($i,$n,$c,$s,$t,1,$t)",
                ("$i", id), ("$n", name.Trim()), ("$c", color ?? "#b8623a"), ("$s", sort), ("$t", Now));
            Touch("todo_lists", id, "ins", 1, name);
            return new { ok = true, id };
        }

        public object TodoListUpdate(string id, string name, string color, int sort)
        {
            if (string.IsNullOrEmpty(id)) return new { ok = false, err = "缺少 id" };
            if (!string.IsNullOrEmpty(name))
                Exec("UPDATE todo_lists SET name=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", name.Trim()), ("$i", id), ("$t", Now));
            if (!string.IsNullOrEmpty(color))
                Exec("UPDATE todo_lists SET color=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", color), ("$i", id), ("$t", Now));
            if (sort >= 0)
                Exec("UPDATE todo_lists SET sort=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", sort), ("$i", id), ("$t", Now));
            Touch("todo_lists", id, "upd", 1, null);
            return new { ok = true };
        }

        /// <summary>删清单：里面的待办不删，退回「收集箱」（list_id 置空）</summary>
        public object TodoListDelete(string id)
        {
            if (string.IsNullOrEmpty(id)) return new { ok = false };
            Exec("UPDATE todos SET list_id='', updated_at=$t, rev=rev+1 WHERE list_id=$i", ("$i", id), ("$t", Now));
            Exec("UPDATE todo_lists SET deleted_at=$t, updated_at=$t, rev=rev+1 WHERE id=$i", ("$i", id), ("$t", Now));
            Touch("todo_lists", id, "del", 1, null);
            return new { ok = true };
        }

        public object TodoAdd(string title, string due, int priority, string note)
        {
            return TodoAdd2(title, due, "", priority, note, null);
        }

        public object TodoAdd2(string title, string due, string dueTime, int priority, string note, string listId)
        {
            var id = NewId();
            // 步长必须和拖动归一化（0/10/20）一致，否则新建项会插到排序中间
            var maxSort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM todos")) + 10;
            Exec(@"INSERT INTO todos(id,title,done,due,due_time,priority,note,created_at,sort,list_id,trashed,rev,updated_at)
                   VALUES($i,$t,0,$d,$dt,$p,$n,$c,$s,$l,0,1,$c)",
                ("$i", id), ("$t", title), ("$d", due ?? ""), ("$dt", dueTime ?? ""), ("$p", priority), ("$n", note ?? ""),
                ("$c", Now), ("$s", maxSort), ("$l", listId ?? ""));
            Touch("todos", id, "ins", 1, title);
            return new { ok = true, id };
        }

        public object TodoUpdate(int id, string title, int done, string due, int priority, string note)
        {
            return TodoUpdate2(id == 0 ? "" : id.ToString(), title, done, due, null, priority, note, null, -1);
        }

        public object TodoUpdate2(string id, string title, int done, string due, string dueTime,
                                  int priority, string note, string listId, int trashed, int sort = -1)
        {
            if (string.IsNullOrEmpty(id)) return new { ok = false, err = "缺少 id" };
            if (title != null) Exec("UPDATE todos SET title=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", title), ("$i", id), ("$t", Now));
            if (due != null) Exec("UPDATE todos SET due=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", due), ("$i", id), ("$t", Now));
            if (dueTime != null) Exec("UPDATE todos SET due_time=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", dueTime), ("$i", id), ("$t", Now));
            if (priority >= 0) Exec("UPDATE todos SET priority=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", priority), ("$i", id), ("$t", Now));
            if (note != null) Exec("UPDATE todos SET note=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", note), ("$i", id), ("$t", Now));
            if (listId != null) Exec("UPDATE todos SET list_id=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", listId), ("$i", id), ("$t", Now));
            if (trashed == 0 || trashed == 1)
                Exec("UPDATE todos SET trashed=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", trashed), ("$i", id), ("$t", Now));
            // 任务自己的排序（第 84 条）：以前只有清单能排，任务只能按创建/到期，用户没法按自己的心思摆
            if (sort >= 0)
                Exec("UPDATE todos SET sort=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", sort), ("$i", id), ("$t", Now));
            if (done >= 0)
                Exec("UPDATE todos SET done=$d, done_at=$a, updated_at=$t, rev=rev+1 WHERE id=$i",
                    ("$d", done), ("$a", done == 1 ? Now : ""), ("$i", id), ("$t", Now));
            Touch("todos", id, "upd", 1, null);
            return new { ok = true };
        }

        /// <summary>垃圾桶：过时但没做完的，挪进去后不计入完成率，也不碍眼</summary>
        public object TodoTrash(string id, int trashed)
        {
            return TodoUpdate2(id, null, -1, null, null, -1, null, null, trashed == 1 ? 1 : 0);
        }

        public object TodoDelete(string id)
        {
            Exec("UPDATE todos SET deleted_at=$t, updated_at=$t, rev=rev+1 WHERE id=$i", ("$t", Now), ("$i", id));
            Touch("todos", id, "del", 1, null);
            return new { ok = true };
        }

        public object TodoClearDone()
        {
            foreach (var r in Rows("SELECT id FROM todos WHERE done=1 AND deleted_at IS NULL"))
            {
                var id = Str(r["id"]);
                Exec("UPDATE todos SET deleted_at=$t, updated_at=$t, rev=rev+1 WHERE id=$i", ("$t", Now), ("$i", id));
                Touch("todos", id, "del", 1, null);
            }
            return new { ok = true };
        }

        /// <summary>
        /// 待办手动排序的步长。全项目统一 10（0/10/20…）：清单、倒计时、习惯都用这个，
        /// 以前混用 +1 / +10 导致新建项插到已有项中间，「顺序看着对、过一会儿就乱」（第 163 条）。
        /// </summary>
        public const int TodoSortStep = 10;

        /// <summary>
        /// 批量重排待办（第 163 条）。一次拖动只发一条 SQL：
        /// UPDATE ... SET sort = CASE id WHEN … THEN … END。
        /// 逐条 UPDATE 会写 N 次磁盘、N 条 changes 日志，拖 50 项能卡半秒。
        /// 不在 ids 里的行（已放弃 / 回收站 / 其他视图）ELSE sort 原样保留，不会被搅乱。
        /// </summary>
        public object TodoReorder(string[] ids)
        {
            if (ids == null || ids.Length == 0) return new { ok = true, n = 0 };
            var ps = new List<(string k, object v)>();
            var sb = new StringBuilder("UPDATE todos SET sort=CASE id");
            for (var i = 0; i < ids.Length; i++)
            {
                sb.Append(" WHEN $k").Append(i).Append(" THEN ").Append(i * TodoSortStep);
                ps.Add(("$k" + i, ids[i]));
            }
            sb.Append(" ELSE sort END, updated_at=$t, rev=rev+1 WHERE id IN (");
            for (var i = 0; i < ids.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append("$k").Append(i);
            }
            sb.Append(")");
            ps.Add(("$t", Now));
            Exec(sb.ToString(), ps.ToArray());
            Touch("todos", "order", "upd", 1, null);
            return new { ok = true, n = ids.Length };
        }

        /* ---------------- 倒计时 ---------------- */

        /// <summary>
        /// 算出「某月第 nth 个星期 wd」是哪天（nth = -1 表示最后一个）。
        /// 第 192 条用。与前端 smartDate.ts 的 nthWeekdayOfMonth 必须保持一致——
        /// 两边算出来不一样的话，界面显示的日子和后端推进的日子会对不上。
        /// </summary>
        private static DateTime NthWeekdayOfMonth(int year, int month, int wd, int nth)
        {
            var dim = DateTime.DaysInMonth(year, month);
            var last = new DateTime(year, month, dim);
            // DayOfWeek: 0=周日…6=周六，与前端 getDay() 一致
            var back = ((int)last.DayOfWeek - wd + 7) % 7;
            if (nth == -1) return new DateTime(year, month, dim - back);

            var first = new DateTime(year, month, 1);
            var fwd = (wd - (int)first.DayOfWeek + 7) % 7;
            var day = 1 + fwd + 7 * (Math.Max(1, nth) - 1);
            // 第 5 个不一定存在，越界退到当月最后一个该周几
            return day > dim ? new DateTime(year, month, dim - back) : new DateTime(year, month, day);
        }

        public object Countdowns()
        {
            var today = DateTime.Today;
            /*
             * 排序优先用 sort（用户拖出来的顺序），没排过的（sort = 0）按日期靠前站。
             * 这样老数据不用迁移也自然按日期排，一旦拖动过一次就全按 sort 走。
             */
            return Rows("SELECT * FROM countdowns WHERE deleted_at IS NULL ORDER BY sort, date").Select(r =>
            {
                var ds = Str(r["date"]);
                var yearly = Int(r["yearly"]);
                var repeat = Str(r["repeat"]);
                if (string.IsNullOrEmpty(repeat)) repeat = yearly == 1 ? "yearly" : "";
                DateTime target;
                if (!DateTime.TryParse(ds, out target)) target = today;

                if (repeat == "yearly")
                {
                    target = new DateTime(today.Year, target.Month, Math.Min(target.Day, DateTime.DaysInMonth(today.Year, target.Month)));
                    if (target.Date < today) target = target.AddYears(1);
                }
                else if (repeat == "monthly")
                {
                    var day = Math.Min(target.Day, DateTime.DaysInMonth(today.Year, today.Month));
                    target = new DateTime(today.Year, today.Month, day);
                    if (target.Date < today) target = target.AddMonths(1);
                }
                else if (repeat == "monthly-last")
                {
                    target = new DateTime(today.Year, today.Month, DateTime.DaysInMonth(today.Year, today.Month));
                    if (target.Date < today) target = new DateTime(today.Year, today.Month, 1).AddMonths(1).AddDays(-1);
                }
                else if (repeat.StartsWith("monthly-weekday:"))
                {
                    /*
                     * 第 192 条：「每月最后一个周四」。
                     * repeat 存成 `monthly-weekday:<nth>:<weekday>`，nth = -1 表示最后一个。
                     *
                     * 为什么把参数塞进 repeat 字符串而不是加两列：countdowns 表已经被
                     * 好几轮迁移改过，为一个低频规则再加列要连带改 4 个地方（建表、迁移、
                     * insert、update）。塞进字符串只需在这里和前端各解析一次，
                     * 老数据（不带冒号）自然走不到这个分支，零迁移风险。
                     */
                    var parts = repeat.Split(':');
                    int nth, wd;
                    if (parts.Length == 3 && int.TryParse(parts[1], out nth) && int.TryParse(parts[2], out wd))
                    {
                        target = NthWeekdayOfMonth(today.Year, today.Month, wd, nth);
                        if (target.Date < today)
                        {
                            var nx = new DateTime(today.Year, today.Month, 1).AddMonths(1);
                            target = NthWeekdayOfMonth(nx.Year, nx.Month, wd, nth);
                        }
                    }
                }
                else if (repeat == "lunar-yearly")
                {
                    var n = Festivals.NextLunar(target.Month, target.Day, today);
                    if (n.HasValue) target = n.Value;
                }
                else if (repeat == "lunar-monthly")
                {
                    var cur = Festivals.SolarToLunar(today);
                    if (cur != null)
                    {
                        var cand = Festivals.LunarToSolar(cur.Value.year, cur.Value.month, Math.Min(target.Day, 30));
                        if (cand.HasValue && cand.Value.Date < today)
                        {
                            var m = cur.Value.month + 1;
                            var y = cur.Value.year;
                            if (m > 12) { m = 1; y++; }
                            cand = Festivals.LunarToSolar(y, m, Math.Min(target.Day, 30));
                        }
                        if (cand.HasValue) target = cand.Value;
                    }
                }

                return new
                {
                    id = Str(r["id"]),
                    title = Str(r["title"]),
                    date = ds,
                    yearly,
                    repeat,
                    lunar = repeat.StartsWith("lunar"),
                    color = Str(r["color"]),
                    note = Str(r["note"]),
                    days = (int)(target.Date - today).TotalDays,
                    nextDate = target.ToString("yyyy-MM-dd"),
                    sort = Int(r["sort"]),
                    /* 第 101 条：重要 = 星标。老库没这列时当 0，不显示星也不进「重要」两格 */
                    star = r.ContainsKey("star") ? Int(r["star"]) : 0
                };
            }).ToList();
        }

        public object CdAdd(string title, string date, int yearly, string color, string note)
        {
            var id = NewId();
            // 步长和拖动归一化（0/10/20…）保持一致，否则新项会插到已有项中间
            var sort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM countdowns")) + 10;
            Exec(@"INSERT INTO countdowns(id,title,date,yearly,color,note,sort,rev,updated_at)
                   VALUES($i,$t,$d,$y,$c,$n,$s,1,$u)",
                ("$i", id), ("$t", title), ("$d", date), ("$y", yearly), ("$c", color ?? "#b8623a"), ("$n", note ?? ""), ("$s", sort), ("$u", Now));
            Touch("countdowns", id, "ins", 1, title);
            return new { ok = true, id };
        }

        public object CdUpdate(string id, string title, string date, int yearly, string color, string note, int sort = -1, string repeat = null, int star = -1)
        {
            if (string.IsNullOrEmpty(id)) return new { ok = false };
            // 第 145 条：拖动排序和「改重复方式」也要能走同一个入口
            if (sort >= 0) Exec("UPDATE countdowns SET sort=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", sort), ("$i", id), ("$t", Now));
            if (repeat != null) Exec("UPDATE countdowns SET repeat=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", repeat), ("$i", id), ("$t", Now));
            /* 第 101 条：星标 -1 = 这次不动它（和其它字段的 null 约定一致） */
            if (star >= 0) Exec("UPDATE countdowns SET star=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", star), ("$i", id), ("$t", Now));
            if (title != null) Exec("UPDATE countdowns SET title=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", title), ("$i", id), ("$t", Now));
            if (date != null) Exec("UPDATE countdowns SET date=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", date), ("$i", id), ("$t", Now));
            if (yearly >= 0) Exec("UPDATE countdowns SET yearly=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", yearly), ("$i", id), ("$t", Now));
            if (color != null) Exec("UPDATE countdowns SET color=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", color), ("$i", id), ("$t", Now));
            if (note != null) Exec("UPDATE countdowns SET note=$v, updated_at=$t, rev=rev+1 WHERE id=$i", ("$v", note), ("$i", id), ("$t", Now));
            Touch("countdowns", id, "upd", 1, null);
            return new { ok = true };
        }

        public object CdDelete(string id)
        {
            Exec("UPDATE countdowns SET deleted_at=$t, updated_at=$t, rev=rev+1 WHERE id=$i", ("$t", Now), ("$i", id));
            Touch("countdowns", id, "del", 1, null);
            return new { ok = true };
        }

        /// <summary>回收站：删掉的倒数日还能捡回来（第 145 条）</summary>
        public object CdTrash()
        {
            var today = DateTime.Today;
            return Rows("SELECT * FROM countdowns WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").Select(r =>
            {
                DateTime target;
                if (!DateTime.TryParse(Str(r["date"]), out target)) target = today;
                return new
                {
                    id = Str(r["id"]),
                    title = Str(r["title"]),
                    date = Str(r["date"]),
                    color = Str(r["color"]),
                    note = Str(r["note"]),
                    repeat = Str(r["repeat"]),
                    deletedAt = Str(r["deleted_at"]),
                    days = (int)(target.Date - today).TotalDays,
                };
            }).ToList();
        }

        public object CdRestore(string id)
        {
            Exec("UPDATE countdowns SET deleted_at=NULL, updated_at=$t, rev=rev+1 WHERE id=$i", ("$t", Now), ("$i", id));
            Touch("countdowns", id, "upd", 1, null);
            return new { ok = true };
        }

        public object CdPurge(string id)
        {
            Exec("DELETE FROM countdowns WHERE id=$i AND deleted_at IS NOT NULL", ("$i", id));
            Touch("countdowns", id, "del", 1, null);
            return new { ok = true };
        }

        /* ---------------- 习惯（支持多种数据类型） ---------------- */

        /// <summary>某天某习惯是否算「有记录」。数值型看是否大于 0。</summary>
        private bool Logged(string date, string habitId)
        {
            var row = Rows("SELECT val FROM habit_logs WHERE date=$d AND habit_id=$h", ("$d", date), ("$h", habitId)).FirstOrDefault();
            if (row != null) return IsTruthy(Str(row["val"]));
            // 兼容老版本 checks 表
            return Int(Scalar("SELECT COUNT(*) FROM checks WHERE date=$d AND habit_id=$h", ("$d", date), ("$h", habitId))) > 0;
        }

        private static bool IsTruthy(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return false;
            json = json.Trim();
            if (json == "0" || json == "false" || json == "null" || json == "\"\"" || json == "[]" || json == "{}") return false;
            return true;
        }

        public object Habits()
        {
            return Rows("SELECT * FROM habits WHERE deleted_at IS NULL ORDER BY archived, sort, rowid").Select(r =>
            {
                var id = Str(r["id"]);
                var type = Str(r["type"]);
                if (string.IsNullOrEmpty(type)) type = "bool";

                var total = Int(Scalar("SELECT COUNT(*) FROM habit_logs WHERE habit_id=$i", ("$i", id)));
                var streak = 0;
                var d = DateTime.Today;
                if (!Logged(d.ToString("yyyy-MM-dd"), id)) d = d.AddDays(-1);
                while (Logged(d.ToString("yyyy-MM-dd"), id)) { streak++; d = d.AddDays(-1); }

                var last14 = new List<object>();
                for (int k = 13; k >= 0; k--)
                {
                    var dd = DateTime.Today.AddDays(-k).ToString("yyyy-MM-dd");
                    var vv = Rows("SELECT val FROM habit_logs WHERE habit_id=$i AND date=$d", ("$i", id), ("$d", dd)).FirstOrDefault();
                    last14.Add(new { date = dd, v = vv == null ? null : Parse(Str(vv["val"])) });
                }

                var todayRow = Rows("SELECT val FROM habit_logs WHERE habit_id=$i AND date=$d", ("$i", id), ("$d", Today)).FirstOrDefault();

                return new
                {
                    id,
                    name = Str(r["name"]),
                    color = Str(r["color"]),
                    archived = Int(r["archived"]),
                    type,
                    unit = Str(r["unit"]),
                    options = Parse(Str(r["options"])) ?? new string[0],
                    goal = (double)(r["goal"] == null ? 0 : Convert.ToDouble(r["goal"])),
                    icon = Str(r["icon"]),
                    total,
                    streak,
                    last14,
                    today = todayRow == null ? null : Parse(Str(todayRow["val"]))
                };
            }).ToList();
        }

        public object HabitAdd(string name, string color, string type, string unit, string options, double goal, string icon)
        {
            var id = NewId();
            var sort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM habits")) + 10;
            Exec(@"INSERT INTO habits(id,name,color,archived,sort,type,unit,options,goal,icon,rev,updated_at)
                   VALUES($i,$n,$c,0,$s,$t,$u,$o,$g,$ic,1,$now)",
                ("$i", id), ("$n", name), ("$c", color ?? "#b8623a"), ("$s", sort),
                ("$t", type ?? "bool"), ("$u", unit ?? ""), ("$o", options ?? "[]"),
                ("$g", goal), ("$ic", icon ?? ""), ("$now", Now));
            Touch("habits", id, "ins", 1, name);
            return new { ok = true, id };
        }

        public object HabitUpdate(string id, string name, string color, int archived,
                                  string type, string unit, string options, double goal, string icon)
        {
            if (name != null) Exec("UPDATE habits SET name=$v WHERE id=$i", ("$v", name), ("$i", id));
            if (color != null) Exec("UPDATE habits SET color=$v WHERE id=$i", ("$v", color), ("$i", id));
            if (archived >= 0) Exec("UPDATE habits SET archived=$v WHERE id=$i", ("$v", archived), ("$i", id));
            if (type != null) Exec("UPDATE habits SET type=$v WHERE id=$i", ("$v", type), ("$i", id));
            if (unit != null) Exec("UPDATE habits SET unit=$v WHERE id=$i", ("$v", unit), ("$i", id));
            if (options != null) Exec("UPDATE habits SET options=$v WHERE id=$i", ("$v", options), ("$i", id));
            if (goal >= 0) Exec("UPDATE habits SET goal=$v WHERE id=$i", ("$v", goal), ("$i", id));
            if (icon != null) Exec("UPDATE habits SET icon=$v WHERE id=$i", ("$v", icon), ("$i", id));
            Exec("UPDATE habits SET rev=rev+1, updated_at=$t WHERE id=$i", ("$t", Now), ("$i", id));
            Touch("habits", id, "upd", 1, null);
            return new { ok = true };
        }

        public object HabitDelete(string id)
        {
            // 软删除：日志留着，历史趋势还能看
            Exec("UPDATE habits SET deleted_at=$t, updated_at=$t, rev=rev+1 WHERE id=$i", ("$t", Now), ("$i", id));
            Touch("habits", id, "del", 1, null);
            return new { ok = true };
        }

        /// <summary>
        /// 写入某天的打卡值 / 备注。
        /// val 传 null 表示「打卡值不动」，传 "" 表示清除打卡；
        /// note 传 null 表示「备注不动」，传 "" 表示清空备注。
        /// 只写备注、不打卡时 val 保持为空字符串，这行仍保留（否则备注会跟着消失）。
        /// </summary>
        public object HabitLog(string date, string habitId, string val, string note = null)
        {
            var has = Int(Scalar("SELECT COUNT(*) FROM habit_logs WHERE date=$d AND habit_id=$h",
                ("$d", date), ("$h", habitId))) > 0;
            var curVal = has ? Str(Scalar("SELECT val FROM habit_logs WHERE date=$d AND habit_id=$h",
                ("$d", date), ("$h", habitId))) : "";
            var curNote = has ? Str(Scalar("SELECT note FROM habit_logs WHERE date=$d AND habit_id=$h",
                ("$d", date), ("$h", habitId))) : "";

            var t = val == null ? curVal : val.Trim();
            var finalNote = note == null ? curNote : note.Trim();

            if (!IsTruthy(t) && string.IsNullOrEmpty(finalNote))
                Exec("DELETE FROM habit_logs WHERE date=$d AND habit_id=$h", ("$d", date), ("$h", habitId));
            else
                Exec("INSERT OR REPLACE INTO habit_logs(date,habit_id,val,note) VALUES($d,$h,$v,$n)",
                    ("$d", date), ("$h", habitId), ("$v", t), ("$n", finalNote ?? ""));

            // 老表同步一份，防止混用（布尔型）
            Exec("DELETE FROM checks WHERE date=$d AND habit_id=$h", ("$d", date), ("$h", habitId));
            if (IsTruthy(t)) Exec("INSERT OR REPLACE INTO checks(date,habit_id) VALUES($d,$h)", ("$d", date), ("$h", habitId));
            Touch("habit_logs", date + "|" + habitId, IsTruthy(t) ? "upd" : "del", 1, t);
            return new { ok = true };
        }

        public object HabitLogsFor(string date)
        {
            var map = new Dictionary<string, object>();
            foreach (var r in Rows("SELECT habit_id,val FROM habit_logs WHERE date=$d", ("$d", date)))
                map[Str(r["habit_id"])] = Parse(Str(r["val"]));
            return map;
        }

        /// <summary>当天每个习惯的备注（只有写了备注的才返回，省得前端遍历）</summary>
        public object HabitNotesFor(string date)
        {
            var map = new Dictionary<string, object>();
            foreach (var r in Rows(@"SELECT habit_id,note FROM habit_logs
                                     WHERE date=$d AND IFNULL(note,'')<>''", ("$d", date)))
                map[Str(r["habit_id"])] = Str(r["note"]);
            return map;
        }

        /// <summary>单个习惯的历史（用于趋势图和平均起床时间等）。</summary>
        public object HabitHistory(string habitId, int days)
        {
            if (days <= 0) days = 30;
            var from = DateTime.Today.AddDays(-days + 1).ToString("yyyy-MM-dd");
            var rows = Rows("SELECT date,val,note FROM habit_logs WHERE habit_id=$h AND date>=$f ORDER BY date",
                ("$h", habitId), ("$f", from)).ToList();
            var list = rows.Select(r => new
            {
                date = Str(r["date"]),
                v = Parse(Str(r["val"])),
                note = Str(r["note"])
            }).ToList();

            double numSum = 0; int numN = 0; double timeSum = 0; int timeN = 0;
            foreach (var r in rows)
            {
                var raw = Str(r["val"]).Trim();
                if (double.TryParse(raw, out var dv)) { numSum += dv; numN++; }
                if (raw.StartsWith("\"") && TimeSpan.TryParse(raw.Trim('"'), out var tv))
                { timeSum += tv.TotalMinutes; timeN++; }
            }

            return new
            {
                list,
                count = list.Count,
                avgNumber = numN > 0 ? Math.Round(numSum / numN, 1) : 0,
                avgTime = timeN > 0 ? TimeSpan.FromMinutes(timeSum / timeN).ToString(@"hh\:mm") : null
            };
        }

        // 兼容 v2 前端的布尔切换
        public object CheckToggle(string date, string habitId)
        {
            var on = Logged(date, habitId);
            return HabitLog(date, habitId, on ? "" : "1");
        }

        public object ChecksFor(string date)
        {
            var ids = Rows("SELECT habit_id FROM habit_logs WHERE date=$d AND val NOT IN ('','0','[]','null')", ("$d", date))
                        .Select(r => Str(r["habit_id"])).ToList();
            ids.AddRange(Rows("SELECT habit_id FROM checks WHERE date=$d", ("$d", date)).Select(r => Str(r["habit_id"])));
            return ids.Distinct().ToList();
        }

        /* ---------------- 番茄钟 ---------------- */

        public object PomodoroAdd(int minutes, string kind, string task)
        {
            var id = NewId();
            Exec(@"INSERT INTO pomodoro(id,date,ts,minutes,kind,task,rev,updated_at)
                   VALUES($i,$d,$t,$m,$k,$s,1,$t)",
                ("$i", id), ("$d", Today), ("$t", Now), ("$m", minutes), ("$k", kind ?? "focus"), ("$s", task ?? ""));
            Touch("pomodoro", id, "ins", 1, null);
            return new { ok = true, id };
        }

        /*
         * 第 186 条配套：番茄以前只能加不能删。
         * 这不只是「测试数据堆在库里清不掉」的问题 —— 用户自己记错了一颗也没法撤。
         * 只按 id 删单条，不做批量清空，避免手滑把一整天的记录带走。
         */
        public object PomodoroDelete(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, n = 0 };
            /* Exec 是 void，删没删到得自己先问一句 */
            var exists = Int(Scalar("SELECT COUNT(*) FROM pomodoro WHERE id=$i", ("$i", id))) > 0;
            if (!exists) return new { ok = false, n = 0 };
            Exec("DELETE FROM pomodoro WHERE id=$i", ("$i", id));
            Touch("pomodoro", id, "del", 1, null);
            return new { ok = true, n = 1 };
        }

        /// <summary>
        /// 番茄统计。
        /// 第 8 / 130 条：原来只能 7/30/90 三档，用户要「区间自定义」。
        /// 加 from/to（yyyy-MM-dd）：给了就按日期区间算，没给就退回按 days 往回推。
        /// 旧调用（只传 days）行为完全不变，老前端不用改。
        /// </summary>
        public object PomodoroStats(int days = 7, string fromIn = "", string toIn = "")
        {
            if (days <= 0) days = 7;
            if (days > 365) days = 365;

            string from, to;
            bool custom = false;
            var toD = DateTime.Today;
            var fromD = DateTime.Today.AddDays(-days + 1);

            if (!string.IsNullOrWhiteSpace(fromIn) && !string.IsNullOrWhiteSpace(toIn)
                && DateTime.TryParse(fromIn, out var pf) && DateTime.TryParse(toIn, out var pt))
            {
                fromD = pf.Date; toD = pt.Date;
                if (fromD > toD) { var tmp = fromD; fromD = toD; toD = tmp; }   // 用户把两头填反了也认
                custom = true;
            }

            from = fromD.ToString("yyyy-MM-dd");
            to = toD.ToString("yyyy-MM-dd");
            // 区间跨度最多一年，别让用户填个 1930 年把库拖死
            var span = (int)Math.Min(366, (toD - fromD).TotalDays + 1);
            if (!custom) days = span;

            var todayRows = Rows("SELECT * FROM pomodoro WHERE date=$d AND kind='focus' ORDER BY id DESC", ("$d", Today));

            // 近 7 天（老前端字段，保留）
            var week = new List<object>();
            for (int i = 6; i >= 0; i--)
            {
                var d = DateTime.Today.AddDays(-i).ToString("yyyy-MM-dd");
                week.Add(new
                {
                    date = d,
                    minutes = Int(Scalar("SELECT IFNULL(SUM(minutes),0) FROM pomodoro WHERE date=$d AND kind='focus'", ("$d", d))),
                    count = Int(Scalar("SELECT COUNT(*) FROM pomodoro WHERE date=$d AND kind='focus'", ("$d", d)))
                });
            }

            // 所选区间逐日序列（折线图 / 柱状图用）
            var perDayRaw = Rows(@"SELECT date, IFNULL(SUM(minutes),0) AS m, COUNT(*) AS c
                                   FROM pomodoro WHERE kind='focus' AND date>=$f AND date<=$t GROUP BY date",
                ("$f", from), ("$t", to)).ToList();
            var map = new Dictionary<string, (int m, int c)>();
            foreach (var r in perDayRaw) map[Str(r["date"])] = (Int(r["m"]), Int(r["c"]));
            var series = new List<object>();
            var rangeMinutes = 0; var rangeCount = 0;
            // 第 8 / 130 条：从 from 正着走到 to（自定义区间可能不是「到今天为止」，
            // 原来写死 AddDays(-i) 是倒着推的，一旦指定过去某段就全空）
            for (var cur = fromD; cur <= toD; cur = cur.AddDays(1))
            {
                var d = cur.ToString("yyyy-MM-dd");
                var v = map.TryGetValue(d, out var t) ? t : (m: 0, c: 0);
                rangeMinutes += v.m; rangeCount += v.c;
                series.Add(new { date = d, minutes = v.m, count = v.c });
            }

            // 按小时（饼图：一天里什么时候最容易专注）
            var byHour = Enumerable.Range(0, 24).Select(h => new { hour = h, minutes = 0, count = 0 }).ToList();
            foreach (var r in Rows(@"SELECT substr(ts,12,2) AS h, IFNULL(SUM(minutes),0) AS m, COUNT(*) AS c
                                     FROM pomodoro WHERE kind='focus' AND date>=$f AND date<=$t AND LENGTH(ts)>=13
                                     GROUP BY h", ("$f", from), ("$t", to)))
            {
                if (!int.TryParse(Str(r["h"]), out var h) || h < 0 || h > 23) continue;
                byHour[h] = new { hour = h, minutes = Int(r["m"]), count = Int(r["c"]) };
            }

            // 按星期
            var wk = new int[7]; var wkc = new int[7];
            foreach (var r in Rows(@"SELECT date, IFNULL(SUM(minutes),0) AS m, COUNT(*) AS c
                                     FROM pomodoro WHERE kind='focus' AND date>=$f AND date<=$t GROUP BY date", ("$f", from), ("$t", to)))
            {
                if (!DateTime.TryParse(Str(r["date"]), out var dt)) continue;
                wk[(int)dt.DayOfWeek] += Int(r["m"]);
                wkc[(int)dt.DayOfWeek] += Int(r["c"]);
            }
            var byWeekday = Enumerable.Range(0, 7).Select(i => new { weekday = i, minutes = wk[i], count = wkc[i] }).ToList();

            // 按任务（饼图：时间花在什么事上）
            var byTask = Rows(@"SELECT task, IFNULL(SUM(minutes),0) AS m, COUNT(*) AS c
                                FROM pomodoro WHERE kind='focus' AND date>=$f AND date<=$t AND IFNULL(task,'')<>''
                                GROUP BY task ORDER BY m DESC LIMIT 8", ("$f", from), ("$t", to))
                .Select(r => new { task = Str(r["task"]), minutes = Int(r["m"]), count = Int(r["c"]) }).ToList();

            var totalCount = Int(Scalar("SELECT COUNT(*) FROM pomodoro WHERE kind='focus'"));
            var totalMinutes = Int(Scalar("SELECT IFNULL(SUM(minutes),0) FROM pomodoro WHERE kind='focus'"));

            // 连续有番茄的天数
            int streak = 0;
            var day = DateTime.Today;
            bool HasPomo(DateTime x) => Int(Scalar("SELECT COUNT(*) FROM pomodoro WHERE date=$d AND kind='focus'",
                ("$d", x.ToString("yyyy-MM-dd")))) > 0;
            if (!HasPomo(day)) day = day.AddDays(-1);
            while (HasPomo(day)) { streak++; day = day.AddDays(-1); }

            return new
            {
                days,
                todayCount = todayRows.Count,
                todayMinutes = todayRows.Sum(r => Int(r["minutes"])),
                todayList = todayRows.Select(r => new { minutes = Int(r["minutes"]), ts = Str(r["ts"]), task = Str(r["task"]) }).ToList(),
                week,
                series,
                byHour,
                byWeekday,
                byTask,
                totalCount,
                totalMinutes,
                rangeMinutes,
                rangeCount,
                avgMinutes = rangeCount > 0 ? Math.Round((double)rangeMinutes / rangeCount, 1) : 0,
                streak
            };
        }

        /* ---------------- 模板 ---------------- */

        private void SeedTemplates()
        {
            var t = new (string id, string name, string kind, string body)[]
            {
                ("tpl_daily", "日报（飞书风）", "day", "[{\"type\":\"richtext\",\"title\":\"今天做了什么\",\"html\":\"<h3>今日完成</h3><p>· </p><h3>进行中</h3><p>· </p><h3>明天计划</h3><p>· </p><h3>风险 / 需要协助</h3><p>· </p>\"}]"),
                ("tpl_weekly", "周报", "week", "[{\"type\":\"richtext\",\"title\":\"周报\",\"html\":\"<h3>本周概览</h3><p>· </p><h3>关键进展</h3><p>· </p><h3>问题与反思</h3><p>· </p><h3>下周三件事</h3><p>1. <br>2. <br>3. </p>\"}]"),
                ("tpl_monthly", "月报", "month", "[{\"type\":\"richtext\",\"title\":\"月报\",\"html\":\"<h3>本月关键词</h3><p>· </p><h3>主要成果</h3><p>· </p><h3>没做成的</h3><p>· </p><h3>下月目标</h3><p>· </p>\"}]"),
                ("tpl_review", "每日复盘 KPT", "day", "[{\"type\":\"richtext\",\"title\":\"复盘\",\"html\":\"<h3>Keep · 值得保持</h3><p>· </p><h3>Problem · 遇到的问题</h3><p>· </p><h3>Try · 下次试试</h3><p>· </p>\"}]"),
                ("tpl_grateful", "感恩三件事", "day", "[{\"type\":\"richtext\",\"title\":\"感恩\",\"html\":\"<p>1. 今天让我觉得温暖的一件事是 </p><p>2. 我要感谢的人是 </p><p>3. 一件小小的好事： </p>\"}]"),
                ("tpl_reading", "读书笔记", "day", "[{\"type\":\"richtext\",\"title\":\"读书笔记\",\"html\":\"<p><strong>书名：</strong></p><p><strong>读到：</strong></p><h3>摘录</h3><p>· </p><h3>想法</h3><p>· </p>\"}]")
            };
            foreach (var x in t)
                Exec("INSERT OR IGNORE INTO templates(id,name,kind,body,builtin) VALUES($i,$n,$k,$b,1)",
                    ("$i", x.id), ("$n", x.name), ("$k", x.kind), ("$b", x.body));
        }

        public object Templates()
        {
            return Rows("SELECT * FROM templates ORDER BY builtin DESC, name").Select(r => new
            {
                id = Str(r["id"]),
                name = Str(r["name"]),
                kind = Str(r["kind"]),
                builtin = Int(r["builtin"]),
                body = Parse(Str(r["body"]))
            }).ToList();
        }

        public object TemplateSave(string name, string body)
        {
            var id = NewId();
            Exec("INSERT INTO templates(id,name,kind,body,builtin) VALUES($i,$n,'custom',$b,0)",
                ("$i", id), ("$n", name), ("$b", body));
            Touch("templates", id, "ins", 1, name);
            return new { ok = true, id };
        }

        public object TemplateDelete(string id)
        {
            Exec("DELETE FROM templates WHERE id=$i AND builtin=0", ("$i", id));
            Touch("templates", id, "del", 1, null);
            return new { ok = true };
        }

        /// <summary>把模板套到某一天：缺什么模块就补一个，然后把内容填进去。</summary>
        public object ApplyTemplate(string date, string templateId)
        {
            var row = Rows("SELECT body FROM templates WHERE id=$i", ("$i", templateId)).FirstOrDefault();
            if (row == null) return new { ok = false, err = "模板不存在" };

            var blocks = JsonNode.Parse(Str(row["body"])) as JsonArray;
            if (blocks == null) return new { ok = false, err = "模板内容损坏" };

            var values = new Dictionary<string, string>();
            foreach (var v in Rows("SELECT module_id,val FROM vals WHERE date=$d", ("$d", date)))
                values[Str(v["module_id"])] = Str(v["val"]);

            int added = 0;
            foreach (var b in blocks)
            {
                var type = b?["type"]?.ToString() ?? "richtext";
                var title = b?["title"]?.ToString() ?? "";
                var html = b?["html"]?.ToString() ?? "";

                var mod = Rows("SELECT id,config FROM modules WHERE type=$t ORDER BY sort LIMIT 1", ("$t", type)).FirstOrDefault();
                string mid;
                if (mod == null)
                {
                    mid = NewId();
                    var sort = Int(Scalar("SELECT IFNULL(MAX(sort),0) FROM modules")) + 10;
                    Exec("INSERT INTO modules(id,type,title,enabled,sort,config) VALUES($i,$t,$ti,1,$s,'{}')",
                        ("$i", mid), ("$t", type), ("$ti", title), ("$s", sort));
                    added++;
                }
                else mid = Str(mod["id"]);

                // 模板写的是 HTML；如果这个模块正处在 Markdown / BBCode 输入模式，
                // 页面会显示源码而不是内容，所以切回富文本可见
                if (type == "richtext" || type == "heading")
                {
                    var cfg = Str(mod == null ? "" : mod["config"]);
                    if (cfg.Contains("\"format\""))
                        Exec("UPDATE modules SET config='{}' WHERE id=$i", ("$i", mid));
                }

                if (!string.IsNullOrEmpty(html)) values[mid] = JsonSerializer.Serialize(html);
            }

            var plain = BuildPlain(values);
            var now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            var exists = Int(Scalar("SELECT COUNT(*) FROM entries WHERE date=$d", ("$d", date))) > 0;
            if (!exists)
                Exec("INSERT INTO entries(date,fav,bg,plain,created_at,updated_at) VALUES($d,0,'',$p,$c,$u)",
                    ("$d", date), ("$p", plain), ("$c", now), ("$u", now));
            else
                Exec("UPDATE entries SET plain=$p,updated_at=$u WHERE date=$d", ("$p", plain), ("$u", now), ("$d", date));

            foreach (var kv in values)
                Exec("INSERT OR REPLACE INTO vals(date,module_id,val) VALUES($d,$m,$v)",
                    ("$d", date), ("$m", kv.Key), ("$v", kv.Value));

            return new { ok = true, addedModules = added };
        }

        /* ---------------- 数据体检 ---------------- */

        public object Diagnostics()
        {
            return new
            {
                device = Str(Scalar("SELECT v FROM meta WHERE k='deviceId'")),
                schema = Int(Scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")),
                entries = Int(Scalar("SELECT COUNT(*) FROM entries")),
                media = Int(Scalar("SELECT COUNT(*) FROM media WHERE deleted_at IS NULL")),
                mediaDeleted = Int(Scalar("SELECT COUNT(*) FROM media WHERE deleted_at IS NOT NULL")),
                todos = Int(Scalar("SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL")),
                habits = Int(Scalar("SELECT COUNT(*) FROM habits WHERE deleted_at IS NULL")),
                links = Int(Scalar("SELECT COUNT(*) FROM links")),
                pomodoro = Int(Scalar("SELECT COUNT(*) FROM pomodoro")),
                changes = Int(Scalar("SELECT COUNT(*) FROM changes")),
                lastSeq = Int(Scalar("SELECT IFNULL(MAX(seq),0) FROM changes")),
                dbBytes = File.Exists(DbPath) ? new FileInfo(DbPath).Length : 0,
                // 所有主键是否都已是字符串（同步的前提）
                idTypes = new
                {
                    todos = IdType("todos"),
                    countdowns = IdType("countdowns"),
                    pomodoro = IdType("pomodoro")
                }
            };
        }

        private string IdType(string table)
        {
            try
            {
                var col = Rows("PRAGMA table_info(" + table + ")").FirstOrDefault(r => Str(r["name"]) == "id");
                return col == null ? "missing" : Str(col["type"]);
            }
            catch { return "error"; }
        }

        /* ---------------- 图片库：内容哈希做身份 ---------------- */

        public string ThumbDir => Path.Combine(MediaDir, ".thumb");
        public string ImportDir => Path.Combine(MediaDir, "_导入");

        private static readonly Regex HashName = new Regex(@"^[0-9a-f]{16}\.[a-z0-9]+$", RegexOptions.Compiled);

        /// <summary>
        /// 缩略图文件名；没生成成功就返回空。
        /// 为什么不直接给 id.jpg：GDI+ 读不了 webp / 部分 gif，MakeThumb 会静默失败，
        /// 前端再去请求一个不存在的文件就是一条 404（控制台报错、图裂）。
        /// 空字符串让前端直接用原图 —— Chromium 能显示，GDI+ 不能，这就是差别。
        /// </summary>
        private string ThumbName(string id)
        {
            try { return File.Exists(Path.Combine(ThumbDir, id + ".jpg")) ? id + ".jpg" : ""; }
            catch { return ""; }
        }

        /// <summary>本地文件存在才返回文件名，否则空串（纯链接类记录没有本地文件）。</summary>
        private string LocalFileOf(string id, string ext)
        {
            if (string.IsNullOrEmpty(ext)) return "";
            var name = id + "." + ext;
            try { return File.Exists(Path.Combine(MediaDir, name)) ? name : ""; }
            catch { return ""; }
        }

        private void Touch(string tbl, string pk, string op, int rev, string payload = null)
        {
            try
            {
                var dev = Str(Scalar("SELECT v FROM meta WHERE k='deviceId'"));
                Exec(@"INSERT INTO changes(tbl,pk,op,rev,ts,device,payload)
                       VALUES($t,$p,$o,$r,$s,$d,$pl)",
                    ("$t", tbl), ("$p", pk), ("$o", op), ("$r", rev), ("$s", Now), ("$d", dev), ("$pl", payload));
            }
            catch (Exception ex) { Diag.Warn("db.touch", "Touch 失败（同步记录没写进去，多端同步会漏）", ex); }
        }

        public object MediaList(string q, int limit)
        {
            var sb = new StringBuilder("SELECT * FROM media WHERE deleted_at IS NULL");
            var ps = new List<(string, object)>();
            if (!string.IsNullOrWhiteSpace(q))
            {
                sb.Append(" AND (orig_name LIKE $q OR id LIKE $q OR note LIKE $q)");
                ps.Add(("$q", "%" + q.Trim() + "%"));
            }
            sb.Append(" ORDER BY created_at DESC, id LIMIT $l");
            ps.Add(("$l", limit <= 0 ? 500 : limit));

            return Rows(sb.ToString(), ps.ToArray()).Select(r => new
            {
                id = Str(r["id"]),
                // 文件真的在才给文件名：网络链接类记录（只存了 src_url）没有本地文件，
                // 前端拿到 <id>.mp3 去请求就是一条 404
                file = LocalFileOf(Str(r["id"]), Str(r["ext"])),
                thumb = ThumbName(Str(r["id"])),
                name = Str(r["orig_name"]),
                note = Str(r["note"]),
                bytes = Int(r["bytes"]),
                width = Int(r["width"]),
                height = Int(r["height"]),
                createdAt = Str(r["created_at"])
            }).ToList();
        }

        /// <summary>把引用（id 或旧版文件名）解析成可渲染的信息。</summary>
        public object MediaResolve(string[] refs)
        {
            var map = new Dictionary<string, object>();
            foreach (var raw in refs.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct())
            {
                var r = Rows("SELECT id,ext,orig_name,width,height FROM media WHERE id=$i AND deleted_at IS NULL", ("$i", raw)).FirstOrDefault();
                if (r == null)
                    r = Rows(@"SELECT id,ext,orig_name,width,height FROM media
                               WHERE orig_name=$n AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1", ("$n", raw)).FirstOrDefault();
                if (r == null) { map[raw] = null; continue; }
                map[raw] = new
                {
                    id = Str(r["id"]),
                    file = LocalFileOf(Str(r["id"]), Str(r["ext"])),
                    thumb = ThumbName(Str(r["id"])),
                    name = Str(r["orig_name"]),
                    width = Int(r["width"]),
                    height = Int(r["height"])
                };
            }
            return map;
        }

        /// <summary>
        /// 把一个文件放进图片库。同名不覆盖、同内容去重、并发安全。
        /// 返回 (id, sha, ext, 是否已存在)。
        /// </summary>
        private (string id, string sha, string ext, bool dup) StoreFile(string src, out string absTarget)
        {
            Directory.CreateDirectory(MediaDir);
            var ext = Path.GetExtension(src).TrimStart('.').ToLowerInvariant();
            if (ext == "jpeg") ext = "jpg";
            if (ext == "") ext = "bin";

            // 先落在临时文件上算哈希，避免读到正在被写入的半个文件
            var tmp = Path.Combine(MediaDir, ".tmp-" + Guid.NewGuid().ToString("N") + "." + ext);
            File.Copy(src, tmp, true);

            string sha;
            using (var fs = File.OpenRead(tmp))
                sha = Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();

            var id = sha.Substring(0, 16);
            var target = Path.Combine(MediaDir, id + "." + ext);
            absTarget = target;

            if (File.Exists(target))
            {
                try { File.Delete(tmp); } catch { }
                return (id, sha, ext, true);          // 内容一样，直接复用，不产生第二份
            }
            try
            {
                File.Move(tmp, target);               // 原子落地
            }
            catch (IOException)
            {
                // 并发下另一个线程先落地了：丢弃临时文件，算已存在
                if (File.Exists(target)) { try { File.Delete(tmp); } catch { } return (id, sha, ext, true); }
                throw;
            }
            return (id, sha, ext, false);
        }

        /// <summary>
        /// 生成缩略图。**这里只算路径，真正的像素处理走 Platform.ThumbMaker**。
        ///
        /// 原因见 Platform.cs 顶部：GDI+ 在安卓上会抛 PlatformNotSupportedException，
        /// 而 .NET 7 起 System.Drawing.EnableUnixSupport 那个逃生开关已被删除。
        /// 把判据收在一处，Windows 走 Platform.Windows.cs，安卓走平台自己的实现。
        /// </summary>
        private void MakeThumb(string absPath, string id)
        {
            try
            {
                Directory.CreateDirectory(ThumbDir);
                var outp = Path.Combine(ThumbDir, id + ".jpg");
                if (File.Exists(outp)) return;
                Platform.MakeThumb(absPath, outp);
            }
            catch (Exception ex) { Diag.Warn("media.thumb", "缩略图生成失败 id=" + id, ex); }
        }

        private void InsertMediaRow(string id, string sha, string ext, string origName, string absPath, bool dup)
        {
            var size = 0L; int w = 0, h = 0;
            try { size = new FileInfo(absPath).Length; } catch { }
            try { (w, h) = Platform.ImageSize(absPath); } catch { }

            if (!dup && !RowExists(id))
                Exec(@"INSERT OR REPLACE INTO media(id,sha,ext,bytes,width,height,orig_name,note,created_at,updated_at,rev)
                       VALUES($i,$s,$e,$b,$w,$h,$n,'',$c,$c,1)",
                    ("$i", id), ("$s", sha), ("$e", ext), ("$b", size), ("$w", w), ("$h", h),
                    ("$n", origName ?? ""), ("$c", Now));
            else
                /*
                 * 记录已存在（内容重复，或记录被彻底删过而磁盘文件还在）。
                 * 两个坑都在这里，都是"导进去了但界面上没有"：
                 *   1. 用户删掉一张图后又把同一个文件导进来 —— 哈希一样、文件也还在，
                 *      记录却是软删状态。不清 deleted_at 就永远不显示，而投递区那边
                 *      "库里已有同名记录"成立，源文件被删掉，等于凭空吞掉一张图。
                 *   2. 彻底删除只会删行、文件留着（见 MediaPurge/MediaDelete），
                 *      再导入时 dup=true 走 UPDATE，行不存在 → 影响 0 行 → 记录再也回不来。
                 *      UPDATE 之后补一次 INSERT 兜底。
                 */
                Exec(@"UPDATE media SET orig_name=CASE WHEN orig_name='' THEN $n ELSE orig_name END,
                       bytes=$b, width=$w, height=$h, deleted_at=NULL, updated_at=$c, rev=rev+1 WHERE id=$i",
                    ("$n", origName ?? ""), ("$b", size), ("$w", w), ("$h", h), ("$c", Now), ("$i", id));

            if (!RowExists(id))
                Exec(@"INSERT OR IGNORE INTO media(id,sha,ext,bytes,width,height,orig_name,note,created_at,updated_at,rev)
                       VALUES($i,$s,$e,$b,$w,$h,$n,'',$c,$c,1)",
                    ("$i", id), ("$s", sha), ("$e", ext), ("$b", size), ("$w", w), ("$h", h),
                    ("$n", origName ?? ""), ("$c", Now));

            MakeThumb(absPath, id);
            Touch("media", id, dup ? "upd" : "ins", 1, null);
        }

        public object MediaImportFiles(string[] files)
        {
            var added = new List<object>();
            foreach (var f in files)
            {
                try
                {
                    if (!File.Exists(f)) continue;
                    var orig = Path.GetFileName(f);
                    var (id, sha, ext, dup) = StoreFile(f, out var abs);
                    InsertMediaRow(id, sha, ext, orig, abs, dup);
                    added.Add(new { ok = true, id, name = orig, dup });
                }
                catch (Exception ex)
                {
                    added.Add(new { ok = false, name = Path.GetFileName(f), err = ex.Message });
                }
            }
            return new { ok = true, items = added };
        }

        /// <summary>
        /// 从内存字节入库。拖拽文件 / 粘贴剪贴板图片时前端拿不到磁盘路径，走这条。
        /// 落盘仍复用 StoreFile：临时文件 → 算哈希 → 原子改名，同内容自动去重。
        /// </summary>
        public object MediaSaveBase64(string name, string b64)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(b64)) return new { ok = false, err = "没有内容" };
                var comma = b64.IndexOf(',');
                var raw = comma >= 0 ? b64.Substring(comma + 1) : b64;
                var bytes = Convert.FromBase64String(raw);
                if (bytes.Length == 0) return new { ok = false, err = "空文件" };
                if (bytes.Length > 40 * 1024 * 1024) return new { ok = false, err = "文件超过 40MB" };

                var orig = string.IsNullOrWhiteSpace(name) ? "paste.png" : Path.GetFileName(name);
                Directory.CreateDirectory(MediaDir);
                var tmpDir = Path.Combine(MediaDir, "_tmp");
                Directory.CreateDirectory(tmpDir);
                var ext = Path.GetExtension(orig);
                if (string.IsNullOrEmpty(ext)) ext = ".png";
                var tmp = Path.Combine(tmpDir, Guid.NewGuid().ToString("N") + ext);
                File.WriteAllBytes(tmp, bytes);
                try
                {
                    var (id, sha, ext2, dup) = StoreFile(tmp, out var abs);
                    InsertMediaRow(id, sha, ext2, orig, abs, dup);
                    return new { ok = true, id, name = orig, dup };
                }
                finally { try { File.Delete(tmp); } catch { } }
            }
            catch (Exception ex) { return new { ok = false, err = ex.Message }; }
        }

        /// <summary>扫描「_导入」目录：丢文件进去点一下就能进库。</summary>
        public object MediaScan()
        {
            Directory.CreateDirectory(ImportDir);
            var files = Directory.GetFiles(ImportDir)
                .Where(f => !Path.GetFileName(f).StartsWith("."))
                .ToArray();
            if (files.Length == 0) return new { ok = true, count = 0, items = new object[0] };

            var res = MediaImportFiles(files);
            // 导入成功才从投递区移走（导入是复制，成功即源文件可删）
            var items = res.GetType().GetProperty("items").GetValue(res) as List<object>;
            foreach (var f in files)
            {
                try
                {
                    var name = Path.GetFileName(f);
                    if (items == null) continue;
                    // 简单起见：只要库里存在同名记录就删源文件
                    if (Int(Scalar("SELECT COUNT(*) FROM media WHERE orig_name=$n AND deleted_at IS NULL", ("$n", name))) > 0)
                        File.Delete(f);
                }
                catch (Exception ex) { Diag.Warn("media.inbox", "清理投递区失败", ex); }
            }
            return new { ok = true, count = files.Length, items = items };
        }

        public object MediaRename(string id, string name)
        {
            Exec("UPDATE media SET orig_name=$n, updated_at=$t, rev=rev+1 WHERE id=$i",
                ("$n", name ?? ""), ("$t", Now), ("$i", id));
            Touch("media", id, "upd", 1, null);
            return new { ok = true };
        }

        public object MediaDelete(string id, int hard)
        {
            Exec("UPDATE media SET deleted_at=$t, updated_at=$t, rev=rev+1 WHERE id=$i",
                ("$t", Now), ("$i", id));
            if (hard == 1)
            {
                var r = Rows("SELECT ext FROM media WHERE id=$i", ("$i", id)).FirstOrDefault();
                if (r != null)
                {
                    try { File.Delete(Path.Combine(MediaDir, id + "." + Str(r["ext"]))); } catch { }
                    try { File.Delete(Path.Combine(ThumbDir, id + ".jpg")); } catch { }
                }
            }
            Touch("media", id, "del", 1, null);
            return new { ok = true };
        }

        public object MediaRebuildThumbs()
        {
            int n = 0;
            foreach (var r in Rows("SELECT id,ext FROM media WHERE deleted_at IS NULL"))
            {
                var abs = Path.Combine(MediaDir, Str(r["id"]) + "." + Str(r["ext"]));
                if (!File.Exists(abs)) continue;
                try
                {
                    var outp = Path.Combine(ThumbDir, Str(r["id"]) + ".jpg");
                    if (File.Exists(outp)) File.Delete(outp);
                }
                catch { }
                MakeThumb(abs, Str(r["id"]));
                n++;
            }
            return new { ok = true, count = n };
        }

        /* ---------------- 统计 ---------------- */

        /// <summary>
        /// 第 157 条：重置统计数据。
        ///
        /// 说清一件事：统计本身是**实时从日记/番茄/打卡算出来的**，没有独立缓存可清，
        /// 所以「重置统计」实际能重置的只有那几类**可再生的行为记录**：
        ///   · 番茄记录  —— 计时器攒出来的，删了不影响日记本身
        ///   · 打卡记录  —— 同上
        /// 日记正文**绝不在这里删**，那是用户真正的劳动成果。
        ///
        /// 参数 what: 'pomodoro' | 'habits' | 'all'
        /// </summary>
        public object StatsReset(string what)
        {
            var w = (what ?? "").Trim().ToLowerInvariant();
            if (w != "pomodoro" && w != "habits" && w != "all")
                return new { ok = false, err = "what 只能是 pomodoro / habits / all" };

            int p = 0, h = 0;
            try
            {
                if (w == "pomodoro" || w == "all")
                {
                    p = Int(Scalar("SELECT COUNT(*) FROM pomodoro"));
                    Exec("DELETE FROM pomodoro");
                }
                if (w == "habits" || w == "all")
                {
                    h = Int(Scalar("SELECT COUNT(*) FROM habit_logs"));
                    Exec("DELETE FROM habit_logs");
                }
                Diag.Info("db.stats", $"重置统计 what={w} 番茄={p} 打卡={h}");
                return new { ok = true, pomodoro = p, habits = h };
            }
            catch (Exception ex)
            {
                Diag.Error("db.stats", "重置统计失败 what=" + w, ex);
                return new { ok = false, err = ex.Message };
            }
        }

        public object Overview(string from = null, string to = null)
        {
            /*
             * 第 12 条：用户要「更多元、更多角度、更详细」，并点出缺自定义时间区间。
             * 以前所有数字都是「 lifetime 全量」，想看「这三个月写了多少」只能自己去日历里翻。
             *
             * 这里的做法：把区间做成两个可选参数，能挂的地方都挂上 ——
             *   · 日记相关的（条数 / 字数 / 活跃天 / 心情 / 标签 / 月分布）：按 date 过滤
             *   · 打卡：按 habit_logs.date 过滤
             *   · 番茄：按 pomodoro.date 过滤
             *   · 待办：按 done_at 过滤已完成数；未完成数是「当前状态」没法切区间，保持全量
             *   · 连续天数 / 最长连续：这两个天然是「横跨全历史」的指标，切区间就没意义，
             *     保持全量，但前端会标注出来，避免用户误读。
             * 不传就是全量，行为跟以前完全一致（reset / 其它调用点不用改）。
             */
            var hasFrom = !string.IsNullOrWhiteSpace(from) && from.Length >= 8;
            var hasTo = !string.IsNullOrWhiteSpace(to) && to.Length >= 8;
            var rangeSql = "";
            var rangeArgs = new List<(string, object)>();
            if (hasFrom) { rangeSql += " AND date >= $from"; rangeArgs.Add(("$from", from)); }
            if (hasTo) { rangeSql += " AND date <= $to"; rangeArgs.Add(("$to", to)); }

            var rows = Rows("SELECT e.date, e.plain, e.updated_at FROM entries e WHERE 1=1" + rangeSql + " ORDER BY e.date DESC",
                rangeArgs.ToArray());
            var perDay = new List<object>();
            var activeDates = new List<DateTime>();
            int totalChars = 0, activeDays = 0, maxChars = 0;
            string maxCharsDate = null;
            foreach (var r in rows)
            {
                var d = Str(r["date"]);
                var chars = Str(r["plain"]).Replace(" ", "").Length;
                var checks = Int(Scalar("SELECT COUNT(*) FROM habit_logs WHERE date=$d AND val NOT IN ('','0','[]','null')", ("$d", d)));
                checks += Int(Scalar("SELECT COUNT(*) FROM checks WHERE date=$d", ("$d", d)));
                var mood = Int(Scalar("SELECT CAST(val AS INTEGER) FROM vals WHERE date=$d AND module_id IN (SELECT id FROM modules WHERE type='mood') LIMIT 1", ("$d", d)));
                if (chars > 0 || checks > 0)
                {
                    activeDays++;
                    if (DateTime.TryParse(d, out var dt)) activeDates.Add(dt);
                }
                if (chars > maxChars) { maxChars = chars; maxCharsDate = d; }
                totalChars += chars;
                perDay.Add(new { d, chars, checks, mood, fav = Int(Scalar("SELECT fav FROM entries WHERE date=$d", ("$d", d))) });
            }

            // 连续记录
            int streak = 0;
            var day = DateTime.Today;
            bool HasEntry(DateTime x)
            {
                var k = x.ToString("yyyy-MM-dd");
                var c = Int(Scalar("SELECT COUNT(*) FROM habit_logs WHERE date=$d AND val NOT IN ('','0','[]','null')", ("$d", k)));
                c += Int(Scalar("SELECT COUNT(*) FROM checks WHERE date=$d", ("$d", k)));
                var has = Int(Scalar("SELECT COUNT(*) FROM entries WHERE date=$d AND LENGTH(plain)>0", ("$d", k)));
                return c > 0 || has > 0;
            }
            if (!HasEntry(day)) day = day.AddDays(-1);
            while (HasEntry(day)) { streak++; day = day.AddDays(-1); }

            // 历史最长连续 & 星期分布
            int longestStreak = 0, run = 0;
            DateTime? prev = null;
            var byWeekday = new int[7];
            foreach (var dt in activeDates.OrderBy(x => x))
            {
                run = (prev.HasValue && (dt - prev.Value).TotalDays == 1) ? run + 1 : 1;
                if (run > longestStreak) longestStreak = run;
                byWeekday[(int)dt.DayOfWeek]++;
                prev = dt;
            }

            var moodDist = new int[6];
            for (int i = 1; i <= 5; i++)
                moodDist[i] = Int(Scalar(
                    "SELECT COUNT(*) FROM vals WHERE val=$v AND module_id IN (SELECT id FROM modules WHERE type='mood')"
                    + (hasFrom || hasTo ? " AND date IN (SELECT date FROM entries WHERE 1=1" + rangeSql + ")" : ""),
                    new List<(string, object)>(rangeArgs) { ("$v", i.ToString()) }.ToArray()));

            var monthWords = Rows(@"SELECT substr(date,1,7) AS m, COUNT(*) AS n FROM entries WHERE 1=1" + rangeSql + " GROUP BY m ORDER BY m DESC LIMIT 8",
                    rangeArgs.ToArray())
                .Select(r => new { m = Str(r["m"]), n = Int(r["n"]) }).ToList();

            var tagTop = Rows(@"SELECT tag, COUNT(*) AS n FROM entry_tags WHERE 1=1"
                    + (hasFrom || hasTo ? " AND date IN (SELECT date FROM entries WHERE 1=1" + rangeSql + ")" : "")
                    + " GROUP BY tag ORDER BY n DESC, tag LIMIT 10",
                    rangeArgs.ToArray())
                .Select(r => new { tag = Str(r["tag"]), n = Int(r["n"]) }).ToList();

            var firstLast = Rows("SELECT MIN(date) AS a, MAX(date) AS b FROM entries WHERE LENGTH(plain)>0").FirstOrDefault();

            /* 区间内的「第一天 / 最后一天」—— 顶栏那句「x 起 · 共 n 天」在切了区间之后要跟着变，
               否则用户选了 3 个月，抬头还是「2023-01-01 起 · 共 900 天」，会以为是 bug。 */
            var inRange = Rows("SELECT MIN(date) AS a, MAX(date) AS b, COUNT(*) AS n FROM entries WHERE LENGTH(plain)>0"
                    + rangeSql, rangeArgs.ToArray()).FirstOrDefault();

            /* 第 12 条：区间内的打卡 / 番茄也要能切，不然「这个月」的标题下面挂的是全量数字 */
            var logRange = " AND IFNULL(date,'')>=$lx AND IFNULL(date,'')<=$ly";
            var logArgs = new[]
            {
                ("$lx", (object)(hasFrom ? from : "0000-00-00")),
                ("$ly", (object)(hasTo ? to : "9999-99-99")),
            };

            /* 待办已完成数：done_at 是纯日期，只有切了区间才过滤 */
            var todoDoneSql = "SELECT COUNT(*) FROM todos WHERE done=1 AND trashed=0 AND deleted_at IS NULL";
            var todoDoneArgs = new List<(string, object)>();
            if (hasFrom) { todoDoneSql += " AND IFNULL(done_at,'')>=$f"; todoDoneArgs.Add(("$f", from)); }
            if (hasTo) { todoDoneSql += " AND IFNULL(done_at,'')<=$t"; todoDoneArgs.Add(("$t", to)); }

            /* 区间跨度：用 entries 里落在区间内的最早/最晚一天，没有就退回区间本身 */
            var rdA = Str(inRange?["a"]);
            var rdB = Str(inRange?["b"]);
            var rangeDays = 0;
            if (rdA != "" && rdB != ""
                && DateTime.TryParse(rdA, CultureInfo.InvariantCulture, DateTimeStyles.None, out var rdtA)
                && DateTime.TryParse(rdB, CultureInfo.InvariantCulture, DateTimeStyles.None, out var rdtB))
                rangeDays = (int)(rdtB - rdtA).TotalDays + 1;
            else if (hasFrom && hasTo
                && DateTime.TryParse(from, CultureInfo.InvariantCulture, DateTimeStyles.None, out var fdt)
                && DateTime.TryParse(to, CultureInfo.InvariantCulture, DateTimeStyles.None, out var tdt))
                rangeDays = Math.Max(0, (int)(tdt - fdt).TotalDays + 1);

            return new
            {
                entries = rows.Count,
                activeDays,
                totalChars,
                streak,
                perDay,
                moodDist = moodDist.Skip(1).ToList(),
                monthWords,
                todos = new
                {
                    open = Int(Scalar("SELECT COUNT(*) FROM todos WHERE done=0 AND trashed=0 AND deleted_at IS NULL")),
                    done = Int(Scalar(todoDoneSql, todoDoneArgs.ToArray())),
                    trashed = Int(Scalar("SELECT COUNT(*) FROM todos WHERE trashed=1 AND deleted_at IS NULL")),
                    done7 = Int(Scalar("SELECT COUNT(*) FROM todos WHERE done=1 AND trashed=0 AND deleted_at IS NULL AND done_at>=$f",
                        ("$f", DateTime.Today.AddDays(-7).ToString("yyyy-MM-dd"))))
                },
                favorites = Int(Scalar("SELECT COUNT(*) FROM entries WHERE fav=1" + rangeSql, rangeArgs.ToArray())),
                links = Int(Scalar("SELECT COUNT(*) FROM links")),
                // —— 下面这些是这次新增的统计维度 ——
                longestStreak,
                avgChars = activeDays > 0 ? totalChars / activeDays : 0,
                maxChars,
                maxCharsDate,
                byWeekday,
                tagTop,
                firstDate = Str(firstLast?["a"]),
                lastDate = Str(firstLast?["b"]),
                mediaCount = Int(Scalar("SELECT COUNT(*) FROM media WHERE deleted_at IS NULL")),
                habitLogs = Int(Scalar("SELECT COUNT(*) FROM habit_logs WHERE val NOT IN ('','0','[]','null')" + logRange, logArgs)),
                habitNotes = Int(Scalar("SELECT COUNT(*) FROM habit_logs WHERE IFNULL(note,'')<>''" + logRange, logArgs)),
                pomodoroCount = Int(Scalar("SELECT COUNT(*) FROM pomodoro WHERE kind='focus'" + logRange, logArgs)),
                pomodoroMinutes = Int(Scalar("SELECT IFNULL(SUM(minutes),0) FROM pomodoro WHERE kind='focus'" + logRange, logArgs)),
                countdowns = Int(Scalar("SELECT COUNT(*) FROM countdowns WHERE deleted_at IS NULL")),
                templates = Int(Scalar("SELECT COUNT(*) FROM templates")),
                updatedAt = rows.Count > 0 ? Str(rows[0]["updated_at"]) : null,
                /* 回给前端：这次到底切没切区间、切的是哪一段。
                   前端顶栏和「核心」卡片都靠这两个字段决定要不要加「（区间内）」的注脚。 */
                rangeFrom = hasFrom ? from : null,
                rangeTo = hasTo ? to : null,
                rangeDays
            };
        }

        /**
         * #249：那年今日（历史上的今天）。
         *
         * 原来固定用 DateTime.Today —— 用户翻到 10-31 看旧日记时，
         * 右边那块「那年今日」显示的仍是**今天**（11-10）的周年，
         * 和正在看的那一天毫无关系。这种错位不会报错，只会让人觉得
         * 「这功能有点怪但说不上哪怪」。
         *
         * 现在接受日期参数，跟着当前打开的那一天走。
         */
        public object OnThisDay(string date)
        {
            DateTime baseDay;
            if (string.IsNullOrWhiteSpace(date)
                || !DateTime.TryParse(date, out baseDay)) baseDay = DateTime.Today;

            var list = new List<object>();
            /* 去重：整年那段和「同月同日」那段会命中同一天。
               实测「1 年前的今天」会同时被两段捞到，界面上就会出现两条一模一样的。 */
            var seen = new HashSet<string>(StringComparer.Ordinal);

            /*
             * 加锁的日记不能往这里摘正文（和 #244 同一个道理）。
             * 摘要也算泄露 —— 这里还截了开头几十个字，比列表泄露得更多。
             */
            void AddIfOpen(string d, int years, string plain)
            {
                if (IsDiaryLocked(d)) return;
                if (!seen.Add(d)) return;
                list.Add(new { years, date = d, plain });
            }

            foreach (var yearsAgo in new[] { 1, 2, 3, 5, 10 })
            {
                var d = baseDay.AddYears(-yearsAgo).ToString("yyyy-MM-dd");
                var r = Rows("SELECT date,plain FROM entries WHERE date=$d AND LENGTH(plain)>0", ("$d", d)).FirstOrDefault();
                if (r != null) AddIfOpen(d, yearsAgo, Str(r["plain"]));
            }

            // 同月同一天更久远的记录（不是整年，但也是"这一天"）
            var mmdd = baseDay.ToString("MM-dd");
            var self = baseDay.ToString("yyyy-MM-dd");
            foreach (var r in Rows(@"SELECT date,plain FROM entries
                                     WHERE substr(date,6,5)=$m AND date<>$t AND LENGTH(plain)>0
                                     ORDER BY date DESC LIMIT 3",
                ("$m", mmdd), ("$t", self)))
            {
                var d = Str(r["date"]);
                int yr;
                try { yr = baseDay.Year - DateTime.Parse(d).Year; } catch { yr = 0; }
                AddIfOpen(d, yr, Str(r["plain"]));
            }
            return list;
        }

        public object Calendar(string ym)
        {
            var rows = Rows(@"SELECT e.date, LENGTH(e.plain) AS chars, e.fav,
                              (SELECT COUNT(*) FROM habit_logs h WHERE h.date=e.date AND h.val NOT IN ('','0','[]','null')) AS checks,
                              (SELECT CAST(val AS INTEGER) FROM vals v WHERE v.date=e.date AND v.module_id IN (SELECT id FROM modules WHERE type='mood')) AS mood
                              FROM entries e WHERE e.date LIKE $m", ("$m", ym + "%"));
            return rows.Select(r => new
            {
                date = Str(r["date"]),
                chars = Int(r["chars"]),
                fav = Int(r["fav"]),
                checks = Int(r["checks"]),
                mood = Int(r["mood"])
            }).ToList();
        }

        /* ---------------- 导出 ---------------- */

        public object ExportJson()
        {
            var all = new
            {
                version = 2,
                exportedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                settings = SettingsAll(),
                modules = Modules(),
                entries = Rows("SELECT * FROM entries").Select(r => new
                {
                    date = Str(r["date"]),
                    fav = Int(r["fav"]),
                    bg = Str(r["bg"]),
                    values = Rows("SELECT module_id,val FROM vals WHERE date=$d", ("$d", Str(r["date"])))
                               .ToDictionary(x => Str(x["module_id"]), x => Parse(Str(x["val"])))
                }),
                tags = Rows("SELECT * FROM entry_tags"),
                links = Rows("SELECT * FROM links"),
                todos = Todos(),
                countdowns = Countdowns(),
                habits = Habits(),
                habitLogs = Rows("SELECT * FROM habit_logs"),
                checks = Rows("SELECT * FROM checks"),
                pomodoro = Rows("SELECT * FROM pomodoro"),
                templates = Templates(),
                /*
                 * #250 衍生：新表也要进备份。
                 *
                 * 加这张表的时候漏了导出 —— 用户导出一份「完整备份」，
                 * 愿望单一个字都不在里面，换台机器恢复就全没了。
                 * 原来的结构本身也漏了 jars / milestones / alarms / ledger 等，
                 * 那是历史欠账，这轮至少不能让自己新加的表继续欠。
                 */
                wishes = Rows("SELECT * FROM wishes WHERE IFNULL(deleted_at,'')=''").Select(r => new
                {
                    id = Str(r["id"]),
                    title = Str(r["title"]),
                    note = Str(r["note"]),
                    priceCents = Int(r["price_cents"]),
                    url = Str(r["url"]),
                    priority = Int(r["priority"]),
                    targetDate = Str(r["target_date"]),
                    done = Int(r["done"]),
                    doneAt = Str(r["done_at"]),
                    createdAt = Str(r["created_at"]),
                    updatedAt = Str(r["updated_at"]),
                })
            };
            var path = Path.Combine(ExportDir, "日签备份-" + Today + ".json");
            File.WriteAllText(path, JsonSerializer.Serialize(all, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
            return new { ok = true, path };
        }

        public object ExportMd()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# 日签 · 我的记录\n");
            var mods = ModulesRaw().Where(m => Int(m["enabled"]) == 1).ToList();
            var types = mods.ToDictionary(m => Str(m["id"]), m => (Str(m["type"]), Str(m["title"])));
            foreach (var e in Rows("SELECT * FROM entries ORDER BY date"))
            {
                var date = Str(e["date"]);
                sb.AppendLine($"## {date} 星期{"日一二三四五六"[(int)DateTime.Parse(date).DayOfWeek]}");
                if (Int(e["fav"]) == 1) sb.AppendLine("*★ 已收藏*");
                foreach (var v in Rows("SELECT module_id,val FROM vals WHERE date=$d", ("$d", date)))
                {
                    var mid = Str(v["module_id"]);
                    if (!types.TryGetValue(mid, out var ti)) continue;
                    var node = Parse(Str(v["val"]));
                    if (node is JsonElement je)
                    {
                        if (ti.Item1 == "richtext" || ti.Item1 == "heading")
                        {
                            var t = StripHtml(je.GetString() ?? "");
                            if (t.Length > 0) sb.AppendLine(t + "\n");
                        }
                        else if (ti.Item1 == "tags" && je.ValueKind == JsonValueKind.Array)
                            sb.AppendLine("标签：" + string.Join("、", je.EnumerateArray().Select(x => x.ToString())) + "\n");
                        else if (ti.Item1 == "mood")
                            sb.AppendLine($"心情：{je.GetInt32()}/5\n");
                        else if (ti.Item1 == "weather")
                            sb.AppendLine($"天气：{je.GetString()}\n");
                    }
                }
                sb.AppendLine();
            }
            var path = Path.Combine(ExportDir, "日签-" + Today + ".md");
            File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            return new { ok = true, path };
        }

        public object ExportCsv()
        {
            var sb = new StringBuilder();
            sb.AppendLine("日期,心情,天气,字数,收藏,标签,正文");
            string Q(string s) => "\"" + (s ?? "").Replace("\"", "\"\"") + "\"";
            foreach (var e in Rows("SELECT * FROM entries ORDER BY date"))
            {
                var d = Str(e["date"]);
                var mood = Str(Scalar("SELECT val FROM vals WHERE date=$d AND module_id IN (SELECT id FROM modules WHERE type='mood')", ("$d", d)));
                var wea = Str(Scalar("SELECT val FROM vals WHERE date=$d AND module_id IN (SELECT id FROM modules WHERE type='weather')", ("$d", d)));
                var tags = string.Join("、", Rows("SELECT tag FROM entry_tags WHERE date=$d", ("$d", d)).Select(r => Str(r["tag"])));
                sb.AppendLine(string.Join(",", new[] {
                    Q(d), Q(mood), Q(wea), Q(Str(e["plain"]).Replace(" ","").Length.ToString()),
                    Q(Int(e["fav"]) == 1 ? "是" : ""), Q(tags), Q(Str(e["plain"])) }));
            }
            var path = Path.Combine(ExportDir, "日签-" + Today + ".csv");
            File.WriteAllText(path, "\uFEFF" + sb, new UTF8Encoding(false));
            return new { ok = true, path };
        }

        /// <summary>把 WAL 里的内容并回主库文件，然后报一下两边的大小。</summary>
        public object ForceCheckpoint()
        {
            long WalBytes()
            {
                try { var f = DbPath + "-wal"; return File.Exists(f) ? new FileInfo(f).Length : 0; }
                catch { return -1; }
            }
            var before = WalBytes();
            int busy;
            try
            {
                // wal_checkpoint 返回 (busy, log, checkpointed)，busy=0 说明没有别的连接挡着
                var r = Rows("PRAGMA wal_checkpoint(TRUNCATE);").FirstOrDefault();
                busy = r == null ? -1 : Int(r["busy"]);
            }
            catch { busy = -1; }
            var after = WalBytes();
            return new
            {
                ok = after >= 0 && after < Math.Max(before, 1),
                busy,
                walBefore = before,
                walAfter = after,
                dbBytes = File.Exists(DbPath) ? new FileInfo(DbPath).Length : 0,
            };
        }

        /* ---------------- 路径迁移 ---------------- */

        public object ChangeRoot(string newRoot)
        {
            if (string.IsNullOrWhiteSpace(newRoot)) return new { ok = false, err = "路径为空" };
            if (string.Equals(Path.GetFullPath(newRoot), Path.GetFullPath(Root), StringComparison.OrdinalIgnoreCase))
                return new { ok = false, err = "已经是这个路径" };

            /* 先留好老状态，万一后面任何一步失败都要能原样退回去。
               conn 是 Open() 里 new 出来的对象，关掉之后必须重新 Open()，
               否则 conn 停在 Closed 状态，之后每一次读写都会报"连接未打开" ——
               界面还在、按钮还能点、但什么都存不进去，只能重启。 */
            var oldRoot = Root;
            var oldDb = DbPath;
            var oldMedia = MediaDir;
            var oldBackup = BackupDir;
            var oldExport = ExportDir;

            var dst = Path.Combine(newRoot, "riqian.db");
            var dstMedia = Path.Combine(newRoot, "图片库");

            try
            {
                Directory.CreateDirectory(newRoot);
                Directory.CreateDirectory(dstMedia);

                /*
                 * 第 1 步：把 WAL 里的东西并回主库文件。
                 *
                 * 库是 PRAGMA journal_mode=WAL，已提交但还没 checkpoint 的页全在 riqian.db-wal 里，
                 * 主库文件可能只有真实数据的一小部分（实测 356 KB vs 2.77 MB）。
                 * File.Copy 只拷主库，直接拷就会丢掉绝大部分数据。
                 * checkpoint(TRUNCATE) 之后 -wal 归零，主库文件才是完整的。
                 *
                 * 和 DailyBackup（同文件 466 行）保持同一套做法，别再各写各的。
                 */
                try { Exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { }

                conn.Close();

                // 第 2 步：目标已存在就先挪开，别让新数据覆盖掉用户上一次迁移留下的库
                if (File.Exists(dst))
                {
                    var bak = dst + ".bak-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                    try { File.Copy(dst, bak, true); } catch { }
                }
                File.Copy(DbPath, dst, true);

                // 第 3 步：媒体文件。用 FileName 逐个拷，源和目标相同时跳过（防自我覆盖报错）
                foreach (var f in Directory.GetFiles(MediaDir))
                {
                    var target = Path.Combine(dstMedia, Path.GetFileName(f));
                    if (string.Equals(Path.GetFullPath(f), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase))
                        continue;
                    File.Copy(f, target, true);
                }

                // 第 4 步：验一遍拷出来的库是不是好的。坏的就别切换过去，留在原地更安全
                if (!IntegrityOk(dst))
                    throw new InvalidOperationException("拷出来的数据库完整性校验没通过，已中止迁移（原数据没动）");

                Root = newRoot;
                DbPath = dst;
                MediaDir = dstMedia;
                BackupDir = Path.Combine(newRoot, "自动备份");
                ExportDir = Path.Combine(newRoot, "导出");
                Open();
                return new { ok = true, root = Root };
            }
            catch (Exception ex)
            {
                // 无论哪一步炸了，都要退回到老路径并把连接重新打开
                Root = oldRoot;
                DbPath = oldDb;
                MediaDir = oldMedia;
                BackupDir = oldBackup;
                ExportDir = oldExport;
                try { if (conn.State != System.Data.ConnectionState.Open) Open(); }
                catch { }
                return new { ok = false, err = ex.Message };
            }
        }

        /// <summary>拷完的库能不能读、页面有没有坏。用独立连接读，不碰主连接。</summary>
        private static bool IntegrityOk(string path)
        {
            /* 先试着只读打开（最干净，不会在目标目录留文件）。
               如果 -wal 还在（checkpoint 那步被 catch 吞掉时会这样），只读连接
               建不出 -shm 会直接失败 —— 那不是库坏，是打开方式不对，
               所以再退一步用可写方式打开，让 SQLite 自己回放 WAL。 */
            foreach (var mode in new[] { ";Mode=ReadOnly", "" })
            {
                try
                {
                    using var c = new SqliteConnection("Data Source=" + path + mode);
                    c.Open();
                    using var cmd = c.CreateCommand();
                    cmd.CommandText = "PRAGMA integrity_check;";
                    var r = cmd.ExecuteScalar();
                    return r != null && string.Equals(r.ToString(), "ok", StringComparison.OrdinalIgnoreCase);
                }
                catch
                {
                    // 换一种打开方式再试
                }
            }
            return false;
        }
    }
}
