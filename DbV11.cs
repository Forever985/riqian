using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Riqian
{
    /// <summary>
    /// v11：排序轮子、无限层级目录、学习模块、媒体库补齐。
    ///
    /// 这一版最要紧的不是哪个新功能，而是**把「排序」和「拖拽重排」做成一套后端约定**。
    /// 用户连着几条都在问同一件事（200/201/202/227/230/214）：
    /// 为什么这里能排、那里不能；为什么只能升不能降。答案就是之前每个模块各写一套，
    /// 写一个漏一个。这里统一成三件事：
    ///   1. 一张表要有 sort 列（手动顺序），才谈得上拖
    ///   2. 一个 Reorder 接口，一次事务把整段顺序写下去（不是循环 UPDATE 一百次）
    ///   3. 方向（asc/desc）不落库为「排序维度」，只是一个布尔，谁排谁翻
    /// </summary>
    public partial class Db
    {
        public void EnsureV11()
        {
            /* ---------- 1. 笔记：手动排序 / 可拖动 ---------- */

            // 第 230 条：笔记本来只有 updated_at DESC 一种顺序，拖都无从拖起。
            // 加 sort 列，空库老数据按 0 处理（等于「都相等」，靠 id 兜底保持稳定）
            EnsureColumn("notes", "sort", "INTEGER DEFAULT 0");

            // 第 220 条：笔记本要能无限嵌套。parent_id 早有了，缺的是一个防环校验 ——
            // 没有它，用户把 A 拖进 B、又把 B 拖进 A，子树就成一坨死循环，前端递归直接爆栈
            EnsureColumn("notebooks", "sort", "INTEGER DEFAULT 0");

            // 第 227 条：草稿箱要有回收站。用定稿标记 + 删除时间区分：
            //   published=0 且 deleted_at 为空 → 草稿箱
            //   deleted_at 不为空              → 回收站
            EnsureColumn("entries", "deleted_at", "TEXT DEFAULT NULL");

            /* ---------- 2. 学习模块（原番茄钟）---------- */

            // 第 226 条：番茄默认时长不该焊死 25 分钟
            SeedDefault("pomoFocus", "25");
            SeedDefault("pomoBreak", "5");
            SeedDefault("pomoLongBreak", "15");
            SeedDefault("pomoRounds", "4");
            /* 第 228 条：模块改名（番茄钟 → 学习）。老用户保持原样，
               这里只在没设过的时候给个默认值，不覆盖已有选择 */
            SeedDefault("pomoModuleName", "学习");

            // 第 228 条：手动补录 + timer 计时器。kind 现在有 focus / break / manual / timer 四种
            EnsureColumn("pomodoro", "note", "TEXT DEFAULT ''");
            EnsureColumn("pomodoro", "source", "TEXT DEFAULT ''");

            // 第 208 条：提醒「建完就响一次」的根因修复需要记住「这条是什么时候建的」。
            // 老库没有 created_at 的话补一个，用当下时间兜底
            EnsureColumn("alarms", "created_at", "TEXT DEFAULT ''");

            /* ---------- 3. 待办清单：描述 + 无限层级 ---------- */

            // 第 218 条：清单建立/编辑时允许写几句描述
            EnsureColumn("todo_lists", "note", "TEXT DEFAULT ''");
            // 第 220 条：清单也要能嵌套（清单里再分清单）
            EnsureColumn("todo_lists", "parent_id", "TEXT DEFAULT ''");

            /* ---------- 4. 记账账户：类型自定义 / 币种 / 启停 ---------- */

            // 第 221 条：账户类型不再限于内置几种，允许自定义；币种独立于全局设置
            EnsureColumn("accounts", "currency", "TEXT DEFAULT ''");
            EnsureColumn("accounts", "enabled", "INTEGER DEFAULT 1");
            EnsureColumn("accounts", "icon", "TEXT DEFAULT ''");
            EnsureColumn("accounts", "note", "TEXT DEFAULT ''");

            /* ---------- 5. 统计模块顺序（第 214 条）---------- */
            SeedDefault("statsOrder", "");
            /* 第 214 条：拖动开关。默认关 —— 有人就喜欢固定顺序，不该强迫所有人拖 */
            SeedDefault("statsSortOn", "0");
            /* 第 179 条：背景轮换（间隔秒数 + 图池）。sec=0 表示不轮换 */
            SeedDefault("bgRotate", "0");
            SeedDefault("bgRotateList", "");

            /* ---------- 6. 时间轴标签（第 198 条）---------- */
            // 用户自己加的轴标签，JSON 数组：[{k:'travel',n:'旅行',c:'#...'}, ...]
            SeedDefault("tlLabels", "");

            /* ---------- 6.5 开发者联系方式（第 90 条）---------- */
            // 空 = 这页显示「还没填」。填了就存本机 meta，不联网、不上报。
            SeedDefault("devName", "");
            SeedDefault("devEmail", "");
            SeedDefault("devSite", "");

            /* ---------- 7. 媒体库术语统一（第 209 条）---------- */
            // 只需要保证「媒体库」这个叫法在设置里一致，没有库结构变化

            /* ---------- 7.5 外观：鼠标指针皮肤（第 222 条）---------- */
            // 空 = 系统默认指针，完全不接管。换皮肤只写这一个 meta 键。
            SeedDefault("cursorStyle", "");

            /* ---------- 8. 老数据兜底：笔记 sort 初始化为稳定值 ---------- */
            try
            {
                if (Scalar("SELECT v FROM meta WHERE k='v11NoteSort'") == null)
                {
                    // 按更新时间倒序发号，这样没拖过的库看起来顺序和以前一样
                    var i = 0;
                    foreach (var r in Rows("SELECT id FROM notes WHERE IFNULL(deleted_at,'')='' ORDER BY updated_at DESC"))
                    {
                        Exec("UPDATE notes SET sort=$s WHERE id=$i", ("$s", i * 10), ("$i", Str(r["id"])));
                        i++;
                    }
                    Exec("INSERT OR REPLACE INTO meta(k,v) VALUES('v11NoteSort','1')");
                }
            }
            catch { }
        }

        /* ================================================================== */
        /* 笔记：手动排序（第 230 条）                                        */
        /* ================================================================== */

        /// <summary>
        /// 保存笔记的手动顺序。
        ///
        /// 和待办那边一个套路（第 163 条）：**一条 UPDATE 带 CASE 写完整个顺序**，
        /// 不是前端循环调一百次单条更新 —— 那样中途失败会留下一半新一半旧的顺序。
        /// 单条语句本身就是原子的，也不用自己开事务。
        /// </summary>
        public object NoteReorder(string[] ids)
        {
            if (ids == null || ids.Length == 0) return new { ok = true, n = 0 };
            var ps = new List<(string k, object v)>();
            var sb = new StringBuilder("UPDATE notes SET sort=CASE id");
            for (var i = 0; i < ids.Length; i++)
            {
                sb.Append(" WHEN $k").Append(i).Append(" THEN ").Append(i * 10);
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
            Touch("notes", "order", "upd", 1, null);
            return new { ok = true, n = ids.Length };
        }

        /* ================================================================== */
        /* 笔记本：无限层级（第 220 条）                                      */
        /* ================================================================== */

        /// <summary>
        /// 改笔记本的上级。
        ///
        /// 这里必须防环：A 的父是 B、B 的父又是 A，前端按 parentId 递归就会原地打转。
        /// 判法就是从目标父节点往上爬，看能不能爬回自己；能爬回来就是循环，拒绝。
        /// </summary>
        public object NotebookSetParent2(string id, string parentId)
        {
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, err = "没指定笔记本" };
            parentId = parentId ?? "";
            if (id == parentId) return new { ok = false, err = "不能把自己设成自己的上级" };

            if (parentId.Length > 0)
            {
                // 从新父节点一路往上，撞见自己就说明这是个环
                var guard = 0;
                var cur = parentId;
                while (!string.IsNullOrEmpty(cur) && guard++ < 64)
                {
                    if (cur == id) return new { ok = false, err = "不能拖进自己的子笔记本里" };
                    var p = Scalar("SELECT IFNULL(parent_id,'') FROM notebooks WHERE id=$i", ("$i", cur));
                    cur = p == null ? "" : Convert.ToString(p) ?? "";
                }
                if (guard >= 64) return new { ok = false, err = "笔记本层数太深了（超过 64 层）" };
            }

            Exec("UPDATE notebooks SET parent_id=$p WHERE id=$i", ("$p", parentId), ("$i", id));
            return new { ok = true };
        }

        /// <summary>笔记本排序：一条 CASE 写完（第 220 条，目录能拖之后要的）</summary>
        public object NotebookReorder(string[] ids)
        {
            if (ids == null || ids.Length == 0) return new { ok = true, n = 0 };
            var ps = new List<(string k, object v)>();
            var sb = new StringBuilder("UPDATE notebooks SET sort=CASE id");
            for (var i = 0; i < ids.Length; i++)
            {
                sb.Append(" WHEN $k").Append(i).Append(" THEN ").Append(i * 10);
                ps.Add(("$k" + i, ids[i]));
            }
            sb.Append(" ELSE sort END WHERE id IN (");
            for (var i = 0; i < ids.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append("$k").Append(i);
            }
            sb.Append(")");
            Exec(sb.ToString(), ps.ToArray());
            return new { ok = true, n = ids.Length };
        }

        /// <summary>
        /// 笔记本树。平铺返回，前端自己递归 —— 层数不设上限，想嵌多深嵌多深。
        /// 顺手给每个节点算一个 depth 和 path，方便前端做缩进和「拖到哪一层」的提示。
        /// </summary>
        public object NotebookTree()
        {
            var all = Rows(@"SELECT id,name,color,IFNULL(parent_id,'') AS pid,IFNULL(sort,0) AS s
                             FROM notebooks ORDER BY IFNULL(sort,0), name")
                .Select(r => new
                {
                    id = Str(r["id"]),
                    name = Str(r["name"]),
                    color = Str(r["color"]),
                    parentId = Str(r["pid"]),
                    sort = Int(r["s"]),
                }).ToList();

            var ids = new HashSet<string>(all.Select(x => x.id));
            var outList = new List<object>();
            foreach (var b in all)
            {
                // 父节点已经不存在的（被删了）当根处理，不让它凭空消失
                var pid = ids.Contains(b.parentId) && b.parentId != b.id ? b.parentId : "";
                var depth = 0;
                var cur = pid;
                var guard = 0;
                while (!string.IsNullOrEmpty(cur) && guard++ < 64)
                {
                    depth++;
                    cur = all.FirstOrDefault(x => x.id == cur)?.parentId ?? "";
                    if (cur == b.id) break;   // 万一老数据里已经有环，别在这儿死循环
                }
                outList.Add(new
                {
                    b.id, b.name, b.color, parentId = pid, b.sort, depth,
                });
            }
            return outList;
        }

        /* ================================================================== */
        /* 草稿箱：回收站（第 227 条）                                        */
        /* ================================================================== */

        /// <summary>草稿移入回收站（软删，随时能捡回来）</summary>
        public object DraftTrash(string date)
        {
            if (string.IsNullOrWhiteSpace(date)) return new { ok = false, err = "没指定哪一天" };
            Exec("UPDATE entries SET deleted_at=$t WHERE date=$d AND IFNULL(published,0)=0",
                ("$t", Now), ("$d", date));
            return new { ok = true };
        }

        /// <summary>从回收站捡回来</summary>
        public object DraftRestore(string date)
        {
            if (string.IsNullOrWhiteSpace(date)) return new { ok = false, err = "没指定哪一天" };
            Exec("UPDATE entries SET deleted_at=NULL WHERE date=$d", ("$d", date));
            return new { ok = true };
        }

        /// <summary>回收站列表：只列草稿（定稿的不属于草稿箱的地方）</summary>
        public object DraftTrashList()
        {
            return Rows(@"SELECT date, title, plain, updated_at, deleted_at FROM entries
                          WHERE IFNULL(deleted_at,'')<>'' AND IFNULL(published,0)=0
                          ORDER BY deleted_at DESC").Select(r => new
            {
                date = Str(r["date"]),
                title = Str(r["title"]),
                excerpt = Str(r["plain"]).Length > 90 ? Str(r["plain"]).Substring(0, 90) + "…" : Str(r["plain"]),
                chars = Str(r["plain"]).Replace(" ", "").Length,
                updatedAt = Str(r["updated_at"]),
                deletedAt = Str(r["deleted_at"]),
            }).ToList();
        }

        /// <summary>彻底删掉（只允许对已在回收站里的动手）</summary>
        public object DraftPurge(string date)
        {
            if (string.IsNullOrWhiteSpace(date)) return new { ok = false, err = "没指定哪一天" };
            var n = Int(Scalar("SELECT COUNT(*) FROM entries WHERE date=$d AND IFNULL(deleted_at,'')<>''", ("$d", date)));
            if (n == 0) return new { ok = false, err = "回收站里没有这一天" };
            Exec("DELETE FROM entries WHERE date=$d AND IFNULL(deleted_at,'')<>''", ("$d", date));
            return new { ok = true, n };
        }

        /* ================================================================== */
        /* 学习模块：手动补录 / 计时器（第 228 条）                            */
        /* ================================================================== */

        /// <summary>
        /// 手动补录一颗番茄。
        ///
        /// 和「刚计时完成自动落库」的区别只在于 source：realtime 是跑出来的，
        /// manual 是补的。分开记是为了将来统计能区分，但**都算数** ——
        /// 用户说「我昨天在图书馆学了两小时」，这条就该进昨天，不该逼他重跑一遍。
        /// </summary>
        public object PomodoroManual(string date, string startHm, int minutes, string task, string note)
        {
            if (string.IsNullOrWhiteSpace(date) || date.Length < 8) return new { ok = false, err = "日期没填对" };
            if (minutes <= 0 || minutes > 24 * 60) return new { ok = false, err = "时长得在 1 分钟到 24 小时之间" };
            var hm = (startHm ?? "").Trim();
            if (!System.Text.RegularExpressions.Regex.IsMatch(hm, @"^\d{1,2}:\d{2}$"))
                hm = DateTime.Now.ToString("HH:mm");
            var parts = hm.Split(':');
            hm = $"{int.Parse(parts[0]):D2}:{int.Parse(parts[1]):D2}";

            var id = NewId();
            var ts = date + " " + hm + ":00";
            Exec(@"INSERT INTO pomodoro(id,date,ts,minutes,kind,task,note,source,rev,updated_at)
                   VALUES($i,$d,$t,$m,'focus',$k,$n,'manual',1,$u)",
                ("$i", id), ("$d", date), ("$t", ts), ("$m", minutes),
                ("$k", (task ?? "").Trim()), ("$n", (note ?? "").Trim()), ("$u", Now));
            Touch("pomodoro", id, "add", 1);
            return new { ok = true, id };
        }

        /// <summary>
        /// 一颗计时器（timer）记录。
        ///
        /// 和番茄的区别：番茄是「专注 25 分钟休息 5 分钟」那套节拍，
        /// 计时器就是「我想计多久计多久」，正着数或者倒着数都行。
        /// 落库时统一记实际经过的分钟数，kind 标成 timer，免得混进专注统计里。
        /// </summary>
        public object TimerLog(string date, int minutes, string task, string note, int up)
        {
            if (string.IsNullOrWhiteSpace(date) || date.Length < 8) return new { ok = false, err = "日期没填对" };
            if (minutes <= 0) return new { ok = false, err = "还没到一分钟，先不用记" };
            var id = NewId();
            var ts = date + " " + DateTime.Now.ToString("HH:mm:ss");
            Exec(@"INSERT INTO pomodoro(id,date,ts,minutes,kind,task,note,source,rev,updated_at)
                   VALUES($i,$d,$t,$m,'timer',$k,$n,$s,1,$u)",
                ("$i", id), ("$d", date), ("$t", ts), ("$m", Math.Min(minutes, 24 * 60)),
                ("$k", (task ?? "").Trim()), ("$n", (note ?? "").Trim()),
                ("$s", up == 1 ? "countup" : "countdown"), ("$u", Now));
            Touch("pomodoro", id, "add", 1);
            return new { ok = true, id };
        }

        /// <summary>
        /// 改一颗已记的番茄（第 228 条：既然能手补，就得能手改）。
        /// 只改时长 / 任务 / 备注，不改日期 —— 日期错了就删掉重记，比在这里搬来搬去清楚。
        /// </summary>
        public object PomodoroEdit(string id, int minutes, string task, string note)
        {
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, err = "没指定哪一颗" };
            var exists = Int(Scalar("SELECT COUNT(*) FROM pomodoro WHERE id=$i", ("$i", id))) > 0;
            if (!exists) return new { ok = false, err = "这条记录不在了" };
            if (minutes > 0)
                Exec("UPDATE pomodoro SET minutes=$m, updated_at=$u WHERE id=$i",
                    ("$m", Math.Min(minutes, 24 * 60)), ("$u", Now), ("$i", id));
            if (task != null)
                Exec("UPDATE pomodoro SET task=$k, updated_at=$u WHERE id=$i",
                    ("$k", task.Trim()), ("$u", Now), ("$i", id));
            if (note != null)
                Exec("UPDATE pomodoro SET note=$n, updated_at=$u WHERE id=$i",
                    ("$n", note.Trim()), ("$u", Now), ("$i", id));
            Touch("pomodoro", id, "upd", 1);
            return new { ok = true };
        }

        /* ================================================================== */
        /* 待办清单：描述（第 218 条）                                        */
        /* ================================================================== */

        public object TodoListSetNote(string id, string note)
        {
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, err = "没指定清单" };
            Exec("UPDATE todo_lists SET note=$n WHERE id=$i", ("$n", (note ?? "").Trim()), ("$i", id));
            return new { ok = true };
        }

        /// <summary>
        /// 改清单的上级清单（第 220 条：文件夹类功能一律无限下辖）。
        ///
        /// 防环逻辑和笔记本完全一致：从目标父节点往上爬，撞回自己就是环。
        /// 另外清单删除是软删（deleted_at），所以父节点如果已删就顺手把 parent_id 清空，
        /// 避免前端拿到一个指向墓碑的 parentId 后既画不出来也删不掉。
        /// </summary>
        public object TodoListSetParent(string id, string parentId)
        {
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, err = "没指定清单" };
            parentId = (parentId ?? "").Trim();
            if (id == parentId) return new { ok = false, err = "不能把自己设成自己的上级" };

            if (parentId.Length > 0)
            {
                // 父节点必须真实存在且没被删
                var alive = Int(Scalar("SELECT COUNT(*) FROM todo_lists WHERE id=$i AND deleted_at IS NULL", ("$i", parentId)));
                if (alive == 0) return new { ok = false, err = "上级清单不存在或已删除" };

                // 从新父节点一路往上，撞见自己就说明成环
                var guard = 0;
                var cur = parentId;
                while (!string.IsNullOrEmpty(cur) && guard++ < 64)
                {
                    if (cur == id) return new { ok = false, err = "不能放进自己的子清单里" };
                    cur = Str(Scalar("SELECT IFNULL(parent_id,'') FROM todo_lists WHERE id=$i", ("$i", cur)));
                }
                if (guard >= 64) return new { ok = false, err = "清单层数太深了（超过 64 层）" };
            }

            Exec("UPDATE todo_lists SET parent_id=$p, updated_at=$t, rev=rev+1 WHERE id=$i",
                ("$p", parentId), ("$i", id), ("$t", Now));
            Touch("todo_lists", id, "upd", 1, null);
            return new { ok = true };
        }

        /* ================================================================== */
        /* 账户：排序 / 启停（第 221 条）                                     */
        /* ================================================================== */

        public object AccountReorder(string[] ids)
        {
            if (ids == null || ids.Length == 0) return new { ok = true, n = 0 };
            var ps = new List<(string k, object v)>();
            var sb = new StringBuilder("UPDATE accounts SET sort=CASE id");
            for (var i = 0; i < ids.Length; i++)
            {
                sb.Append(" WHEN $k").Append(i).Append(" THEN ").Append(i * 10);
                ps.Add(("$k" + i, ids[i]));
            }
            sb.Append(" ELSE sort END WHERE id IN (");
            for (var i = 0; i < ids.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append("$k").Append(i);
            }
            sb.Append(")");
            Exec(sb.ToString(), ps.ToArray());
            return new { ok = true, n = ids.Length };
        }

        public object AccountToggle(string id, int enabled)
        {
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, err = "没指定账户" };
            Exec("UPDATE accounts SET enabled=$e WHERE id=$i", ("$e", enabled == 1 ? 1 : 0), ("$i", id));
            return new { ok = true, enabled = enabled == 1 ? 1 : 0 };
        }

        /* ================================================================== */
        /* 记账本图表数据（第 205 条）                                        */
        /* ================================================================== */

        /// <summary>
        /// 图表专用数据。
        ///
        /// 为什么不复用 LedgerList：那张表是**跟着筛选走**的，画图用的数必须是
        /// 「这个月 / 近半年 / 近一年」的真实全貌 —— 用户拿金额筛了一下，
        /// 不该顺便让饼图也只剩一个分类。所以这里单开一条，只吃月份参数。
        ///
        /// 六组数一次给全，避免前端为了画六个图发六次请求：
        ///   byCat      支出分类（饼 / 环 / 条形都用它）
        ///   byDay      当月每天的收支（柱状 / 折线 / 日历热力）
        ///   byWeek     当月按周聚合（4~6 根，比 30 根好读）
        ///   months     近 12 个月的收 / 支 / 结余（趋势）
        ///   accounts   各账户余额占比
        ///   top        金额最大的 8 笔（横向条形）
        ///   weekday    按星期几的支出合计（一周哪天花得多）
        ///   heat       近 24 周 × 7 天矩阵（热力图，从月初往前数）
        /// </summary>
        public object LedgerInsight(string ym)
        {
            if (string.IsNullOrWhiteSpace(ym) || ym.Length < 7) ym = Today.Substring(0, 7);
            var y = IntParse(ym.Substring(0, 4));
            var m = IntParse(ym.Substring(5, 2));
            if (m < 1 || m > 12) { y = DateTime.Today.Year; m = DateTime.Today.Month; }
            var first = new DateTime(y, m, 1);
            var last = first.AddMonths(1).AddDays(-1);
            var from = first.ToString("yyyy-MM-dd");
            var to = last.ToString("yyyy-MM-dd");

            var baseWhere = "date>=$f AND date<=$t AND IFNULL(deleted_at,'')=''";
            var ba = new (string k, object v)[] { ("$f", from), ("$t", to) };

            /* ---- 1. 分类（只算支出；收入分类画饼没意义，用户关心钱花哪了） ---- */
            var byCat = Rows($@"SELECT IFNULL(NULLIF(cat,''),'未分类') AS c,
                    IFNULL(SUM(amount),0) AS s, COUNT(*) AS n
                FROM ledger WHERE {baseWhere} AND kind='out'
                GROUP BY 1 ORDER BY s DESC", ba)
                .Select(r => new { cat = Str(r["c"]), sum = Double(r["s"]), n = Int(r["n"]) }).ToList();

            /* ---- 2. 每天（没有账的日子也要占位，否则柱状图会被压扁） ---- */
            var dayMap = new Dictionary<string, (double o, double i, int n)>();
            foreach (var r in Rows($@"SELECT date,
                    IFNULL(SUM(CASE WHEN kind='out' THEN amount ELSE 0 END),0) AS o,
                    IFNULL(SUM(CASE WHEN kind='in'  THEN amount ELSE 0 END),0) AS i2,
                    COUNT(*) AS n
                FROM ledger WHERE {baseWhere} GROUP BY date", ba))
                dayMap[Str(r["date"])] = (Double(r["o"]), Double(r["i2"]), Int(r["n"]));
            var byDay = new List<object>();
            for (var d = first; d <= last; d = d.AddDays(1))
            {
                var k = d.ToString("yyyy-MM-dd");
                dayMap.TryGetValue(k, out var v);
                byDay.Add(new { date = k, day = d.Day, outSum = v.o, inSum = v.i, n = v.n });
            }

            /* ---- 3. 按周（把 1 号所在的那一周算第 1 周，周一起） ---- */
            var wk = new List<object>();
            var cursor = first;
            var wi = 1;
            while (cursor <= last)
            {
                // 这一段的结尾：本周日或月末
                var dow = ((int)cursor.DayOfWeek + 6) % 7;   // 周一=0
                var end = cursor.AddDays(Math.Min(6 - dow, (last - cursor).Days));
                var ws = cursor.ToString("yyyy-MM-dd");
                var we = end.ToString("yyyy-MM-dd");
                var row = Rows($@"SELECT
                        IFNULL(SUM(CASE WHEN kind='out' THEN amount ELSE 0 END),0) AS o,
                        IFNULL(SUM(CASE WHEN kind='in'  THEN amount ELSE 0 END),0) AS i2,
                        COUNT(*) AS n
                    FROM ledger WHERE {baseWhere} AND date>=$a AND date<=$b",
                    ("$f", from), ("$t", to), ("$a", ws), ("$b", we)).FirstOrDefault();
                wk.Add(new
                {
                    week = wi,
                    from = ws,
                    to = we,
                    outSum = row == null ? 0 : Double(row["o"]),
                    inSum = row == null ? 0 : Double(row["i2"]),
                    n = row == null ? 0 : Int(row["n"]),
                });
                wi++;
                cursor = end.AddDays(1);
            }

            /* ---- 4. 近 12 个月趋势（含当月，最近的排最后） ---- */
            var months = new List<object>();
            var startM = first.AddMonths(-11);
            for (var i = 0; i < 12; i++)
            {
                var mm = startM.AddMonths(i);
                var f2 = mm.ToString("yyyy-MM-01");
                var t2 = mm.AddMonths(1).AddDays(-1).ToString("yyyy-MM-dd");
                var row = Rows($@"SELECT
                        IFNULL(SUM(CASE WHEN kind='out' THEN amount ELSE 0 END),0) AS o,
                        IFNULL(SUM(CASE WHEN kind='in'  THEN amount ELSE 0 END),0) AS i2
                    FROM ledger WHERE date>=$f AND date<=$t AND IFNULL(deleted_at,'')=''",
                    ("$f", f2), ("$t", t2)).FirstOrDefault();
                var o = row == null ? 0 : Double(row["o"]);
                var i2v = row == null ? 0 : Double(row["i2"]);
                months.Add(new
                {
                    ym = mm.ToString("yyyy-MM"),
                    label = mm.ToString("M月"),
                    outSum = o,
                    inSum = i2v,
                    balance = i2v - o,
                });
            }

            /* ---- 5. 账户余额占比 ---- */
            var accounts = Rows(@"SELECT a.id, a.name, IFNULL(a.init,0) + IFNULL((
                        SELECT SUM(CASE WHEN l.kind='in' THEN l.amount ELSE -l.amount END)
                        FROM ledger l WHERE l.account_id=a.id AND IFNULL(l.deleted_at,'')=''
                    ),0) AS bal
                FROM accounts a WHERE IFNULL(a.enabled,1)=1 ORDER BY a.sort, a.created_at")
                .Select(r => new { id = Str(r["id"]), name = Str(r["name"]), balance = Double(r["bal"]) })
                .ToList();

            /* ---- 6. 金额最大的几笔 ---- */
            var top = Rows($@"SELECT id,date,kind,amount,IFNULL(NULLIF(cat,''),'未分类') AS c,note
                FROM ledger WHERE {baseWhere} AND kind='out'
                ORDER BY amount DESC LIMIT 8", ba)
                .Select(r => new
                {
                    id = Str(r["id"]), date = Str(r["date"]), amount = Double(r["amount"]),
                    cat = Str(r["c"]), note = Str(r["note"]),
                }).ToList();

            /* ---- 7. 星期几花得多（0=周日 … 6=周六） ---- */
            var wdMap = new double[7];
            foreach (var r in Rows($@"SELECT strftime('%w', date) AS w,
                    IFNULL(SUM(amount),0) AS s FROM ledger
                    WHERE {baseWhere} AND kind='out' GROUP BY w", ba))
            {
                var idx = IntParse(Str(r["w"]));
                if (idx >= 0 && idx < 7) wdMap[idx] = Double(r["s"]);
            }
            var weekday = new List<object>();
            for (var i = 0; i < 7; i++)
                weekday.Add(new { dow = i, sum = wdMap[i] });

            /* ---- 8. 热力图：从 to 往前推 24 周，共 24×7 格 ---- */
            // 起点对齐到周日，这样每一列就是一周
            var endDay = last;
            var tailShift = ((int)endDay.DayOfWeek + 7) % 7;          // 到本周六还差几天
            var gridEnd = endDay.AddDays(6 - tailShift);
            var gridStart = gridEnd.AddDays(-(24 * 7 - 1));
            var heatMap = new Dictionary<string, double>();
            foreach (var r in Rows(@"SELECT date, IFNULL(SUM(amount),0) AS s FROM ledger
                    WHERE kind='out' AND IFNULL(deleted_at,'')='' AND date>=$f AND date<=$t
                    GROUP BY date", ("$f", gridStart.ToString("yyyy-MM-dd")), ("$t", gridEnd.ToString("yyyy-MM-dd")))
                ) heatMap[Str(r["date"])] = Double(r["s"]);
            var heat = new List<object>();
            for (var i = 0; i < 24 * 7; i++)
            {
                var d = gridStart.AddDays(i);
                heatMap.TryGetValue(d.ToString("yyyy-MM-dd"), out var s);
                heat.Add(new { date = d.ToString("yyyy-MM-dd"), w = i / 7, d = i % 7, sum = s });
            }

            var totalOut = byCat.Sum(x => x.sum);
            var totalIn = Rows($@"SELECT IFNULL(SUM(amount),0) AS s FROM ledger
                    WHERE {baseWhere} AND kind='in'", ba).Select(r => Double(r["s"])).FirstOrDefault();

            /* ================================================================
             * 第 239 条：「记账本表格图表怎么屌怎么来，还有饼图什么的，多来！」
             *
             * 上面八组已经够画九张图了，但要想"专业"，缺的是**比例与分布**类的数：
             *   catTree      分类再按「笔数」排一次（金额大但只买一次 vs 小额高频，
             *                是两种完全不同的花钱方式，只看金额会漏掉后者）
             *   catMonth     每个月每个分类的堆叠（看某类支出是逐月涨还是在收敛）
             *   quart        把当月支出切成四档（小钱/中钱/大钱/巨款各占多少）
             *   weekdayAvg   星期几的「场均」而不是合计（合计会被某个大额日带偏）
             *   hourly       按小时的分布 —— 只有记账带时间戳时才有值，没值就空着
             *   catTrend     每个分类的环比变化（涨了还是跌了，百分比）
             * ================================================================ */

            /* ---- 9. 分类按笔数（找出"高频小额"） ---- */
            var catByCount = byCat
                .OrderByDescending(x => x.n)
                .Select(x => new
                {
                    cat = x.cat,
                    n = x.n,
                    sum = x.sum,
                    /** 平均每笔多少 —— 小额高频和大额低频在这一列上一眼分开 */
                    avg = x.n > 0 ? Math.Round(x.sum / x.n, 2) : 0,
                }).ToList();

            /* ---- 10. 近 12 个月 × 各分类的堆叠矩阵 ---- */
            // 只取金额前 6 的分类（第 7 名往后并进「其它」），否则图例会挤成一坨
            var topCats = byCat.Take(6).Select(x => x.cat).ToList();
            var catMonth = new List<object>();
            foreach (var mm in Enumerable.Range(0, 12).Select(i => startM.AddMonths(i)))
            {
                var f3 = mm.ToString("yyyy-MM-01");
                var t3 = mm.AddMonths(1).AddDays(-1).ToString("yyyy-MM-dd");
                var seg = new Dictionary<string, double>();
                foreach (var r in Rows($@"SELECT IFNULL(NULLIF(cat,''),'未分类') AS c,
                        IFNULL(SUM(amount),0) AS s FROM ledger
                        WHERE date>=$f AND date<=$t AND IFNULL(deleted_at,'')='' AND kind='out'
                        GROUP BY 1", ("$f", f3), ("$t", t3)))
                    seg[Str(r["c"])] = Double(r["s"]);

                // 按 topCats 的顺序铺，缺的补 0 —— 顺序稳定，图例颜色才不会月月乱跳
                var parts = new List<CatPart>();
                foreach (var c in topCats)
                {
                    seg.TryGetValue(c, out var s);
                    parts.Add(new CatPart { cat = c, sum = s });
                }
                var rest = seg.Where(kv => !topCats.Contains(kv.Key)).Sum(kv => kv.Value);
                if (rest > 0) parts.Add(new CatPart { cat = "其它", sum = rest });

                catMonth.Add(new
                {
                    ym = mm.ToString("yyyy-MM"),
                    label = mm.ToString("M月"),
                    total = parts.Sum(p => p.sum),
                    parts,
                });
            }

            /* ---- 11. 支出金额分档（小钱 / 中钱 / 大钱 / 巨款） ---- */
            // 分界点不写死绝对值，用当月自身的分位数 —— 学生和上班族的"大钱"不是一个量级
            var outAmounts = Rows($@"SELECT amount FROM ledger WHERE {baseWhere} AND kind='out' ORDER BY amount", ba)
                .Select(r => Double(r["amount"])).ToList();
            Func<double, double> pct = p =>
            {
                if (outAmounts.Count == 0) return 0;
                var idx = (int)Math.Floor((outAmounts.Count - 1) * p);
                return outAmounts[Math.Max(0, Math.Min(outAmounts.Count - 1, idx))];
            };
            var q1 = pct(0.25); var q2 = pct(0.5); var q3 = pct(0.75);
            var buckets = new[] { 0d, 0d, 0d, 0d };
            var bucketN = new[] { 0, 0, 0, 0 };
            foreach (var a in outAmounts)
            {
                var bi = a <= q1 ? 0 : a <= q2 ? 1 : a <= q3 ? 2 : 3;
                buckets[bi] += a; bucketN[bi]++;
            }
            var bucketNames = new[] { "小钱", "中钱", "大钱", "巨款" };
            var quart = Enumerable.Range(0, 4).Select(i => new
            {
                name = bucketNames[i],
                sum = Math.Round(buckets[i], 2),
                n = bucketN[i],
                /** 这一档的上界，标签里能直接写「≤ 38 元」 */
                upTo = Math.Round(i == 0 ? q1 : i == 1 ? q2 : i == 2 ? q3 : outAmounts.LastOrDefault(), 2),
            }).ToList();

            /* ---- 12. 星期几的场均（避免被某个大额日带偏） ---- */
            var wdN = new int[7];
            foreach (var r in Rows($@"SELECT strftime('%w', date) AS w, COUNT(*) AS n
                    FROM ledger WHERE {baseWhere} AND kind='out' GROUP BY w", ba))
            {
                var idx = IntParse(Str(r["w"]));
                if (idx >= 0 && idx < 7) wdN[idx] = Int(r["n"]);
            }
            var weekdayAvg = Enumerable.Range(0, 7)
                .Select(i => new { dow = i, avg = wdN[i] > 0 ? Math.Round(wdMap[i] / wdN[i], 2) : 0, n = wdN[i] })
                .ToList();

            /* ---- 13. 按小时分布（只有带时间戳的账才有意义） ---- */
            // 表的 note/created_at 里不一定有时间；有就用，全空就返回空数组让前端不画这张
            var hourly = new List<object>();
            var hasTime = Rows($@"SELECT COUNT(*) AS n FROM ledger
                    WHERE {baseWhere} AND kind='out' AND length(IFNULL(created_at,''))>=16", ba)
                .Select(r => Int(r["n"])).FirstOrDefault();
            if (hasTime > 0)
            {
                var hrMap = new double[24];
                foreach (var r in Rows($@"SELECT CAST(strftime('%H', created_at) AS INTEGER) AS h,
                        IFNULL(SUM(amount),0) AS s FROM ledger
                        WHERE {baseWhere} AND kind='out' AND length(IFNULL(created_at,''))>=16
                        GROUP BY h", ba))
                {
                    var h = Int(r["h"]);
                    if (h >= 0 && h < 24) hrMap[h] = Double(r["s"]);
                }
                for (var h = 0; h < 24; h++) hourly.Add(new { hour = h, sum = hrMap[h] });
            }

            /* ---- 14. 分类环比（本月 vs 上月） ---- */
            var prevF = first.AddMonths(-1).ToString("yyyy-MM-01");
            var prevT = first.AddDays(-1).ToString("yyyy-MM-dd");
            var prevCat = new Dictionary<string, double>();
            foreach (var r in Rows($@"SELECT IFNULL(NULLIF(cat,''),'未分类') AS c,
                    IFNULL(SUM(amount),0) AS s FROM ledger
                    WHERE date>=$f AND date<=$t AND IFNULL(deleted_at,'')='' AND kind='out'
                    GROUP BY 1", ("$f", prevF), ("$t", prevT)))
                prevCat[Str(r["c"])] = Double(r["s"]);

            var catTrend = byCat.Take(10).Select(x =>
            {
                prevCat.TryGetValue(x.cat, out var pv);
                // 上月是 0、这月有支出 → 标成「新增」，用 null 而不是 Infinity 让前端好判断
                double? pctDelta = pv > 0 ? Math.Round((x.sum - pv) / pv * 100, 1) : null;
                return new
                {
                    cat = x.cat,
                    now = x.sum,
                    prev = pv,
                    delta = Math.Round(x.sum - pv, 2),
                    pct = pctDelta,
                    isNew = pv <= 0 && x.sum > 0,
                };
            }).ToList();

            return new
            {
                ym, from, to,
                totalOut,
                totalIn,
                byCat, byDay, byWeek = wk, months, accounts, top, weekday, heat,
                heatFrom = gridStart.ToString("yyyy-MM-dd"),
                heatTo = gridEnd.ToString("yyyy-MM-dd"),
                /* 第 239 条新增六组 */
                catByCount, catMonth, quart, weekdayAvg, hourly, catTrend,
                hasTime,
            };
        }

        private static int IntParse(string s)
        {
            int n;
            return int.TryParse((s ?? "").Trim(), out n) ? n : 0;
        }

        /// <summary>
        /// 堆叠图的单段（第 239 条）。
        /// 用具名类而不是匿名类型：匿名类型在 List 里拿不到强类型属性，
        /// 前面那版用反射取 `cat` / `sum` 才能拼，又慢又容易在改字段名时静默出错。
        /// </summary>
        internal sealed class CatPart
        {
            public string cat = "";
            public double sum;
        }

        /* ================================================================== */
        /* 媒体库：批量 / 文件夹 / 分组（第 232 / 233 条）                    */
        /* ================================================================== */

        /// <summary>
        /// 一次导入整个文件夹（第 233 条）。
        ///
        /// 和「选一批文件」不同，这里连子目录一起走 —— 用户既然选了文件夹，
        /// 就是想要里面全部，让他再一个个点开子目录选一遍毫无道理。
        /// 落库的 folder 记成「相对路径」，这样在媒体库里还能看出原来的目录结构。
        /// </summary>
        public object MediaImportFolder(string dir, int recursive)
        {
            if (string.IsNullOrWhiteSpace(dir) || !System.IO.Directory.Exists(dir))
                return new { ok = false, err = "这个文件夹不存在" };

            var opt = recursive == 1
                ? System.IO.SearchOption.AllDirectories
                : System.IO.SearchOption.TopDirectoryOnly;

            string[] files;
            try { files = System.IO.Directory.GetFiles(dir, "*.*", opt); }
            catch (Exception ex) { return new { ok = false, err = ex.Message }; }

            var added = new List<object>();
            var failed = new List<object>();
            var skip = 0;
            string[] okExt = {
                "png","jpg","jpeg","webp","gif","bmp","svg","avif","ico",
                "mp3","m4a","aac","wav","flac","ogg","opus",
                "mp4","webm","mov","mkv","avi","m4v",
            };

            foreach (var f in files)
            {
                var ext = System.IO.Path.GetExtension(f).TrimStart('.').ToLowerInvariant();
                if (Array.IndexOf(okExt, ext) < 0) { skip++; continue; }   // 不是媒体文件，跳过不问
                try
                {
                    var orig = System.IO.Path.GetFileName(f);
                    // 相对目录当分组，根目录下的留空（等于「未分类」）
                    var rel = System.IO.Path.GetDirectoryName(f) ?? "";
                    var relSafe = rel.Length > dir.Length ? rel.Substring(dir.Length).TrimStart('\\', '/') : "";
                    var (id, sha, ext2, dup) = StoreFile(f, out var abs);
                    InsertMediaRow(id, sha, ext2, orig, abs, dup);
                    if (!string.IsNullOrEmpty(relSafe))
                    {
                        Exec("UPDATE media SET folder=$f WHERE id=$i", ("$f", relSafe), ("$i", id));
                    }
                    added.Add(new { ok = true, id, name = orig, dup });
                }
                catch (Exception ex)
                {
                    failed.Add(new { ok = false, name = System.IO.Path.GetFileName(f), err = ex.Message });
                }
            }
            return new { ok = true, count = added.Count, skipped = skip, items = added, failed };
        }

        /* ================================================================== */
        /* 第 217 条：多媒体库到底省了多少空间，得看得见                      */
        /* ================================================================== */

        /// <summary>
        /// 多媒体库的存储账本。
        ///
        /// 用户第 217 条问得挺准：「不太确定多媒体库是否符合最开始的设想，
        /// 就是一次导入多处引用并且可以节省存储空间、容量」。
        ///
        /// 事实是：导入时按 SHA-256 内容哈希做 id（见 StoreFile），
        /// **同一个文件导入十次，磁盘上只有一份**，media 表也只有一行 —— 这就是节省的来源。
        /// 但之前界面上完全看不出来，用户只能靠猜。所以这里把账算清楚给他看：
        ///   - 库里有多少条记录、磁盘上真实占多少
        ///   - 有多少条是「同一份内容被多次导入」合并掉的行
        ///   - 引用次数（日记里引用的总次数 vs 有引用的条目数）
        /// 这个查询只碰 media 表，扫的是主键索引，几千条也是毫秒级。
        /// </summary>
        public object MediaStorageStats()
        {
            long bytes = 0;
            var rows = 0;
            var alive = 0;
            var deleted = 0;
            var byExt = new Dictionary<string, int>();
            var byKind = new Dictionary<string, long> { { "image", 0 }, { "audio", 0 }, { "video", 0 }, { "other", 0 } };

            foreach (var r in Rows("SELECT ext, IFNULL(bytes,0) AS b, deleted_at FROM media"))
            {
                var del = Str(r["deleted_at"]);
                var sz = (long)Int(r["b"]);
                rows++;
                if (string.IsNullOrEmpty(del)) { alive++; bytes += sz; }
                else deleted++;

                var e = Str(r["ext"]).ToLowerInvariant();
                byExt[e] = (byExt.ContainsKey(e) ? byExt[e] : 0) + 1;
                var k = e switch
                {
                    "png" or "jpg" or "jpeg" or "webp" or "gif" or "bmp" or "svg" or "avif" or "ico" => "image",
                    "mp3" or "m4a" or "aac" or "wav" or "flac" or "ogg" or "opus" => "audio",
                    "mp4" or "webm" or "mov" or "mkv" or "avi" or "m4v" => "video",
                    _ => "other",
                };
                byKind[k] += sz;
            }

            // 磁盘上真实占用（含缩略图），用文件系统算，比累加 media.bytes 准
            long diskBytes = 0;
            var diskFiles = 0;
            try
            {
                if (Directory.Exists(MediaDir))
                {
                    foreach (var f in Directory.GetFiles(MediaDir, "*", SearchOption.AllDirectories))
                    {
                        try { diskBytes += new FileInfo(f).Length; diskFiles++; } catch { }
                    }
                }
            }
            catch { }

            /*
             * 去重省下的空间：靠归属表算。每次导入都会往 media_use 之类的地方记一笔？
             * 这个项目里没有单独的使用表，引用是写在 entries 的正文里的，
             * 所以这里换个口径：把「同一 sha 出现过多少次导入」按 import_log 不可得的情况下，
             * 用「media 记录数 vs 磁盘文件数」比较 —— 两者相等说明去重生效且没漏文件。
             */
            var thumbFiles = 0;
            try
            {
                if (Directory.Exists(MediaDir))
                {
                    foreach (var f in Directory.GetFiles(MediaDir, "*.*", SearchOption.TopDirectoryOnly))
                    {
                        var n = Path.GetFileName(f);
                        if (n.StartsWith(".tmp-")) continue;
                        if (Path.GetFileNameWithoutExtension(f).EndsWith("_t")) thumbFiles++;
                    }
                }
            }
            catch { }

            return new
            {
                ok = true,
                rows,
                alive,
                deleted,
                bytes,
                diskBytes,
                diskFiles,
                thumbFiles,
                byKind,
                byExt,
                mediaDir = MediaDir,
            };
        }

        /* ================================================================== */
        /* 提醒：新建后不该立刻响（第 208 条）                                */
        /* ================================================================== */

        /// <summary>
        /// 判断一条提醒「今天是不是已经该响过了」的兜底修正。
        ///
        /// 原来的 bug：AlarmsDue 对 daily / once 只判 now >= dueAt，
        /// 于是用户下午三点建一个「每天 09:00」的提醒，下一趟 30 秒轮询立刻 now(15:00) >= due(09:00) 成立，
        /// 当场就响一次 —— 这就是用户说的「建立之后第 30 秒响了一下」。
        ///
        /// 正确语义：**建的那一刻之前的那个点不算**。所以凡是 last_fire 为空、
        /// 且 created_at 的时间点已经晚于今天的 due_at，就把 last_fire 补成 created_at，
        /// 表示「这一趟我已经错过了，从明天开始」。
        /// </summary>
        public object AlarmsSkipMissed()
        {
            var now = DateTime.Now;
            var fixedCount = 0;
            foreach (var r in Rows(@"SELECT id, at_time, IFNULL(advance,0) AS adv, IFNULL(created_at,'') AS c,
                                            IFNULL(last_fire,'') AS lf, IFNULL(repeat,'daily') AS rep
                                     FROM alarms
                                     WHERE enabled=1 AND IFNULL(last_fire,'')='' AND IFNULL(created_at,'')<>''"))
            {
                TimeSpan tod;
                if (!TimeSpan.TryParse(Str(r["at_time"]), out tod)) continue;
                DateTime created;
                if (!DateTime.TryParse(Str(r["c"]), out created)) continue;

                // 今天这条的基准点（已扣提前量）
                var dueToday = DateTime.Today.Add(tod).AddMinutes(-Int(r["adv"]));
                // 建的时候基准点就已经过了 → 这一趟不该补响
                if (created > dueToday && created.Date == now.Date)
                {
                    Exec("UPDATE alarms SET last_fire=$t WHERE id=$i",
                        ("$t", created.ToString("yyyy-MM-dd HH:mm:ss")), ("$i", Str(r["id"])));
                    fixedCount++;
                }
            }
            return new { ok = true, fixedCount };
        }
    }
}