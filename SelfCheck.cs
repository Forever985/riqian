using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;

namespace Riqian
{
    /// <summary>
    /// 全新装机的自检：开一个空的临时库，走完整迁移链，检查建出来的表结构对不对。
    ///
    /// **为什么需要它**：2026-11-02 一天之内踩了两次同一个坑 ——
    /// 新用户第一次打开就报 `no such column`，而开发者本地永远复现不了，
    /// 因为老库那条路早就把列补齐了。
    ///   · 上午：`EnsureV13()` 只在罐子接口里懒调用，没进启动迁移链 → 记账本整页报错
    ///   · 傍晚：`countdowns.sort` 在 `MigrateIdsToText()` **之前**补，
    ///          被整表重建吃掉，重建后的二次补列又漏了它 → 倒计时整页报错
    /// 两次都是「老库看不见、只打新装用户」，两次都是发布出去才被 CI 之前的
    /// 本地启动验证抓到。所以必须有一步能在**不需要 WebView2、不需要桌面会话**的
    /// 情况下验证这件事 —— 这个文件就是那一步。
    ///
    /// **为什么查 schema 而不是调接口**：RPC 名（`cd.list`）和 Db 方法名（`Countdowns`）
    /// 对不上，分发是 5 个文件里的 if-else 字符串匹配，反射扫不到；
    /// 要调接口就得起 Form + WebView2，在 CI 上不可靠。
    /// 而这两次 bug 的**根因都在 schema 层**，查表结构就是查根因，比调接口更直接。
    ///
    /// **为什么期望清单是手写的、不从代码生成**：
    /// 如果从 `MigrateIdsToText()` 的列清单或 `EnsureColumn()` 调用反推，
    /// 那么源头漏了哪一列，期望值也跟着漏 —— 测试和目标共用同一份错误数据，等于没测。
    /// 这份清单必须**独立写一遍**，才可能发现源头的不一致。
    ///
    /// 用法：
    ///     Riqian.exe --selfcheck
    /// 退出码 0 = 通过，1 = 有列缺失。CI 直接看退出码。
    /// </summary>
    internal static class SelfCheck
    {
        /// <summary>
        /// 每张表「新装之后必须有」的列。
        ///
        /// 覆盖范围：被 `MigrateIdsToText()` 重建的 3 张表（todos / countdowns / pomodoro），
        /// 加上所有靠 `EnsureColumn()` 逐版本补列的表（这种"补"的方式最容易漏）。
        /// 纯建表就完整的表（如 changes / meta）不放进来，放进来只是噪音。
        ///
        /// ⚠️ 往 Db.cs 加列时**必须同步这里**。忘了的话 CI 会在新装的路径上红，
        /// 这正是我们想要的效果 —— 而不是等用户装上之后才发现。
        /// </summary>
        private static readonly Dictionary<string, string[]> Expected = new()
        {
            // —— 被整表重建的三张（新增列最容易在这里丢）——
            ["todos"] = new[]
            {
                "id", "title", "done", "due", "due_time", "priority", "note",
                "created_at", "done_at", "sort", "list_id", "trashed", "repeat",
                "rev", "updated_at", "deleted_at",
            },
            ["countdowns"] = new[]
            {
                "id", "title", "date", "yearly", "color", "note", "sort", "repeat", "star",
                "rev", "updated_at", "deleted_at",
            },
            ["pomodoro"] = new[]
            {
                "id", "date", "ts", "minutes", "kind", "task", "note", "source",
                "rev", "updated_at", "deleted_at",
            },

            // —— 靠 EnsureColumn 逐版本补的表 ——
            ["habits"] = new[]
            {
                "id", "name", "color", "archived", "sort",
                "type", "unit", "options", "goal", "icon", "deleted_from",
                "rev", "updated_at", "deleted_at",
            },
            ["habit_logs"] = new[] { "date", "habit_id", "note", "val", "rev", "updated_at", "deleted_at" },
            ["ledger"] = new[] { "id", "date", "kind", "amount", "cat", "note", "account_id", "created_at", "jar_id", "jar_base" },
            ["accounts"] = new[] { "id", "init", "currency", "enabled", "icon", "note" },
            ["notebooks"] = new[] { "id", "name", "icon", "color", "sort", "parent_id", "rev", "updated_at", "deleted_at" },
            ["notes"] = new[] { "id", "notebook_id", "title", "body", "plain", "pinned", "sort", "icon", "color", "rev", "updated_at", "deleted_at" },
            ["media"] = new[] { "id", "sha", "orig_name", "ext", "bytes", "width", "height", "folder", "kind", "tone", "tags", "alias", "cached", "src_url", "note", "rev", "updated_at", "deleted_at" },
            ["todo_lists"] = new[] { "id", "name", "color", "sort", "parent_id", "note", "rev", "updated_at", "deleted_at" },
            ["entries"] = new[] { "date", "bg", "plain", "fav", "updated_at", "title", "status", "published_at", "bg_tone", "deleted_at" },
            ["alarms"] = new[] { "id", "mode", "advance", "interval_min", "sound", "snooze_until", "created_at", "last_fire", "repeat" },
            ["vault"] = new[] { "id", "hash", "salt", "hint", "scope", "target", "label", "rev" },
        };

        /// <summary>
        /// 开库之后立刻要能跑通的读取方法。
        /// 光有列还不够 —— 列在但 `ORDER BY`、`WHERE` 里用错名字照样炸，
        /// 所以再真跑一遍几个最吃 schema 的读取。
        /// </summary>
        private static (string label, Action<Db> run)[] Smoke() => new (string, Action<Db>)[]
        {
            ("倒计时列表（曾因缺 sort 整页报错）", d => d.Countdowns()),
            ("待办列表",                         d => d.Todos()),
            ("待办清单",                         d => d.TodoLists()),
            ("笔记列表",                         d => d.Notes(null, null, 50)),
            ("模块列表",                         d => d.Modules()),
            ("设置全量",                         d => d.SettingsAll()),
            ("标签",                             d => d.Tags()),
        };

        /// <summary>
        /// 跑自检。返回退出码：0 通过，1 失败。
        /// </summary>
        public static int Run()
        {
            var root = Path.Combine(Path.GetTempPath(), "riqian-selfcheck-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            var fails = new List<string>();
            Db db = null;   // 在 try 外声明，finally 里才能释放

            Console.WriteLine("日签自检 · 全新装机路径");
            Console.WriteLine("临时库: " + root);
            Console.WriteLine();

            try
            {
                Directory.CreateDirectory(root);

                // 这一句就是"全新装机"：构造函数里走完整迁移链
                // （Schema → EnsureMilestones → Seed → DailyBackup）
                db = new Db(root);

                // ---- 1. schema 逐列核对 ----
                Console.WriteLine("【1】表结构核对");
                var schema = ReadSchema(db.DbPath);
                foreach (var kv in Expected.OrderBy(x => x.Key))
                {
                    var actual = schema.TryGetValue(kv.Key, out var cols) ? cols : null;
                    if (actual == null)
                    {
                        fails.Add($"{kv.Key}: 表不存在");
                        Console.WriteLine($"  ✗ {kv.Key,-12} 表不存在");
                        continue;
                    }
                    // 只查"该有的有没有"，不查"多出来的" ——
                    // 多一列不影响运行，漏一列就会整页报错。报错要聚焦在真问题上。
                    var missing = kv.Value.Where(c => !actual.Contains(c)).ToArray();
                    if (missing.Length == 0)
                    {
                        Console.WriteLine($"  ✓ {kv.Key,-12} {actual.Count} 列");
                    }
                    else
                    {
                        fails.Add($"{kv.Key}: 缺 {string.Join(", ", missing)}");
                        Console.WriteLine($"  ✗ {kv.Key,-12} 缺列: {string.Join(", ", missing)}");
                    }
                }

                // ---- 2. 真跑几条读取 ----
                Console.WriteLine();
                Console.WriteLine("【2】开库后读取冒烟");
                foreach (var (label, run) in Smoke())
                {
                    try
                    {
                        run(db);
                        Console.WriteLine($"  ✓ {label}");
                    }
                    catch (Exception ex)
                    {
                        fails.Add($"{label}: {ex.GetType().Name}: {ex.Message}");
                        Console.WriteLine($"  ✗ {label}");
                        Console.WriteLine($"      {ex.GetType().Name}: {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                fails.Add("建库失败: " + ex);
                Console.WriteLine();
                Console.WriteLine("✗ 建库过程直接抛异常:");
                Console.WriteLine(ex);
            }
            finally
            {
                /*
                 * 自检造的是临时库，必须删干净 —— **而且删失败要喊出来**。
                 *
                 * 第一版这里是 `try { Directory.Delete(root, true); } catch { }`，
                 * 结果跑完一看临时目录里堆了 7 个 riqian-selfcheck-*，
                 * 每跑一次多一个。根因是 Db 从没关闭 SqliteConnection，
                 * WAL 的 -shm/-wal 被占着，删除必然失败 —— 而 catch {} 把它吞了。
                 *
                 * 这跟 MEMORY 里那条「静默失败的清理比不清理更坏」是同一件事：
                 * 清理动作不检查结果，看起来"干净了"，实际上什么都没发生。
                 *
                 * 所以：先 Dispose（Db 自己负责 checkpoint + 关连接），
                 * 再删；删不掉就把路径打出来，让它可见，但不改退出码
                 * （临时文件删不掉不影响"库结构对不对"这个结论）。
                 */
                try
                {
                    db?.Dispose();
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  ! 关闭数据库连接时出错: " + ex.Message);
                }

                try
                {
                    if (Directory.Exists(root)) Directory.Delete(root, true);
                }
                catch (Exception ex)
                {
                    Console.WriteLine("  ! 临时目录没删掉（不影响结论）: " + root);
                    Console.WriteLine("    " + ex.Message);
                }
            }

            Console.WriteLine();
            if (fails.Count == 0)
            {
                Console.WriteLine("========== 自检通过 ==========");
                return 0;
            }

            Console.WriteLine($"========== 自检失败，{fails.Count} 项 ==========");
            foreach (var f in fails) Console.WriteLine("  · " + f);
            Console.WriteLine();
            Console.WriteLine("这类问题只在「全新安装 / 删档重来 / 换机器」时出现，");
            Console.WriteLine("老库因为早已升级完毕、不会触发整表重建，所以本地永远看不出来。");
            Console.WriteLine("改法通常是在 MigrateIdsToText 的重建列清单里补列，");
            Console.WriteLine("并在迁移之后再 EnsureColumn 兜一次底。");
            return 1;
        }

        /// <summary>
        /// 直接读库文件的表结构。
        ///
        /// 为什么不用 `Db.Rows("PRAGMA table_info(...)")`：它是 private，
        /// 为了自检给它开个 internal 口子不值得 —— 那等于为了测试放宽封装。
        /// 这里自己开一条连接读元数据，只读、立即关闭，不碰 `Db` 的内部状态。
        ///
        /// WAL 模式下另一个连接能看到已提交的 schema（Db 那边每步都是自动提交），
        /// 所以这里读到的就是迁移链跑完之后的真实结构。
        ///
        /// ⚠️ `Pooling=False` 不能省。不加的话 `using` 走完只是把连接还进池子，
        /// 文件句柄留在进程里，外层 `Directory.Delete(root)` 照样报
        /// "riqian.db 正被另一进程使用"。Db 那边也一样关了池化，两处必须一致。
        /// </summary>
        private static Dictionary<string, HashSet<string>> ReadSchema(string dbPath)
        {
            var map = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            using var conn = new SqliteConnection("Data Source=" + dbPath + ";Mode=ReadOnly;Pooling=False");
            conn.Open();

            var tables = new List<string>();
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
                using var rd = cmd.ExecuteReader();
                while (rd.Read()) tables.Add(rd.GetString(0));
            }

            foreach (var t in tables)
            {
                var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "PRAGMA table_info(\"" + t + "\")";
                using var rd = cmd.ExecuteReader();
                while (rd.Read()) set.Add(rd.GetString(1));   // 第 1 列是列名
                map[t] = set;
            }
            return map;
        }
    }
}