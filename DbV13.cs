using System;
using System.Collections.Generic;
using System.Linq;

namespace Riqian
{
    /**
     * 第 97 条的延伸：储蓄罐 / 存钱目标。
     *
     * 用户原话：「记账本、储蓄罐功能。进行联网查询，查询热门的记账本、储蓄罐功能。可以设置。」
     *
     * 查了市面上的做法（一羽记账、Pennyjar 存钱目标、52周存钱挑战），
     * 存的模式收敛成三种，本实现照这三种来：
     *
     *   free  自由存钱 —— 不设周期，想存就存。应急金就是这种。
     *   fixed 定额存钱 —— 每期固定金额，比如每周 ¥500。
     *   step  递增存钱 —— 每期在上次基础上加一笔，52 周和 365 天都是它。
     *                      52 周：10+20+…+520 = 13780
     *                      365 天：1+2+…+365 = 66795
     *
     * 三个关键设计决定：
     *
     * ① 存钱不新开一张流水表，而是往 ledger 里记一笔，带 jar_id。
     *    一羽记账说得很直白：「存钱本质上就是将自己的钱从一个账户，
     *    转移到一个固定的存钱账户」。我们的账本已经有账户体系了，
     *    再开一张平行的表，等于让用户在两处看到同一笔钱，迟早对不上。
     *    所以：存钱 = 一条带 jar_id 的 ledger 记录，
     *    分类固定叫「存钱」，用户在账本里一眼能认出来，
     *    也不会被当成"这个月赚了一笔"（它 kind 跟着方向走，进账本很正常）。
     *
     * ② 余额不能为负。取出超过罐子里现有的钱，直接拒绝并把差额告诉他。
     *    这不是过度小心：负数余额会让「完成百分比」变成负数，
     *    进度条会反向画，看着像出了 bug。
     *
     * ③ 不碰真实资金。不做银行连接、不算利息、不给理财建议 ——
     *    它只是把用户自己决定存下的钱记下来。
     */
    public partial class Db
    {
        /// <summary>
        /// v13 迁移：储蓄罐表 + ledger 的两个关联列。
        ///
        /// internal 是为了让 Db.cs 的启动迁移链能调（原先是 private，
        /// 只能在罐子接口里懒调用，导致新库缺列 —— 详见 Db.cs 里那处调用的注释）。
        /// 各接口里的懒调用保留：一来重复执行是幂等的（全是 IF NOT EXISTS），
        /// 二来万一有更老的库没走到启动链，靠接口也能把列补上。
        /// </summary>
        internal void EnsureV13()
        {
            Exec(@"CREATE TABLE IF NOT EXISTS jars(
                id TEXT PRIMARY KEY,
                name TEXT DEFAULT '',
                target REAL DEFAULT 0,
                mode TEXT DEFAULT 'free',
                period TEXT DEFAULT 'week',
                base_amount REAL DEFAULT 0,
                step_amount REAL DEFAULT 0,
                color TEXT DEFAULT '',
                icon TEXT DEFAULT '',
                note TEXT DEFAULT '',
                sort INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                created_at TEXT DEFAULT '',
                deleted_at TEXT DEFAULT NULL)");

            /*
             * 两条关联：
             *   jar_id   这笔钱属于哪个罐子（空 = 普通收支配账）
             *   jar_base 只有递增模式用：这一笔"本来该是多少"
             *
             * 为什么要存 jar_base：52周存钱法里第 37 周该存 370，
             * 但人可能一次补两周。没有 base 就不知道"现在是第几期"，
             * 每次都要从第一期累加一遍才能算出下一期该存多少。
             */
            EnsureColumn("ledger", "jar_id", "TEXT DEFAULT ''");
            EnsureColumn("ledger", "jar_base", "REAL DEFAULT 0");
        }

        // ---------------- 读取 ----------------

        /// <summary>
        /// 罐子列表 + 每个罐子的实际余额。
        ///
        /// 余额 = 罐子里所有 in 的钱 − 所有 out 的钱。
        /// 用一次 group by 算完，不在循环里一个个查 —— 罐子多了会很慢。
        /// </summary>
        public object JarList()
        {
            EnsureV13();
            var jars = Rows(@"SELECT * FROM jars WHERE deleted_at IS NULL
                              ORDER BY archived, sort, created_at");

            var bal = new Dictionary<string, double>();
            var cnt = new Dictionary<string, int>();
            var sums = Rows($@"SELECT jar_id,
                                     {JarBalanceSql} AS b,
                                     COUNT(*) AS n
                              FROM ledger
                              WHERE jar_id IS NOT NULL AND jar_id <> '' AND deleted_at IS NULL
                              GROUP BY jar_id");
            foreach (var s in sums)
            {
                var id = Str(s["jar_id"]);
                bal[id] = Double(s["b"]);
                cnt[id] = Int(s["n"]);
            }

            var list = new List<object>();
            foreach (var j in jars)
            {
                var id = Str(j["id"]);
                var target = Double(j["target"]);
                var now = bal.TryGetValue(id, out var b) ? b : 0;
                list.Add(new
                {
                    id,
                    name = Str(j["name"]),
                    target,
                    mode = Str(j["mode"]),
                    period = Str(j["period"]),
                    baseAmount = Double(j["base_amount"]),
                    stepAmount = Double(j["step_amount"]),
                    color = Str(j["color"]),
                    icon = Str(j["icon"]),
                    note = Str(j["note"]),
                    sort = Int(j["sort"]),
                    archived = Int(j["archived"]),
                    balance = Math.Round(now, 2),
                    deposits = cnt.TryGetValue(id, out var n) ? n : 0,
                    // 没设目标就是纯攒钱罐，不给百分比（而不是显示 0%）
                    pct = target > 0 ? Math.Round(Math.Min(100, now / target * 100), 1) : (double?)null,
                    done = target > 0 && now >= target,
                    createdAt = Str(j["created_at"]),
                });
            }
            return new { jars = list, total = Math.Round(bal.Values.Sum(), 2) };
        }

        /// <summary>一个罐子的明细：每一笔存入 / 取出</summary>
        public object JarDetail(string id)
        {
            EnsureV13();
            var jar = Rows("SELECT * FROM jars WHERE id=@i AND deleted_at IS NULL",
                ("@i", id));
            if (jar.Count == 0) return new { ok = false };

            var items = Rows(@"SELECT * FROM ledger WHERE jar_id=@i AND deleted_at IS NULL
                               ORDER BY date DESC, created_at DESC",
                ("@i", id));

            var balance = 0.0;
            foreach (var it in items)
                balance += Str(it["kind"]) == "in" ? Double(it["amount"]) : -Double(it["amount"]);

            var j0 = jar[0];
            return new
            {
                ok = true,
                jar = new
                {
                    id,
                    name = Str(j0["name"]),
                    target = Double(j0["target"]),
                    mode = Str(j0["mode"]),
                    period = Str(j0["period"]),
                    baseAmount = Double(j0["base_amount"]),
                    stepAmount = Double(j0["step_amount"]),
                    color = Str(j0["color"]),
                    note = Str(j0["note"]),
                },
                balance = Math.Round(balance, 2),
                items = items.Select((it) => new
                {
                    id = Str(it["id"]),
                    date = Str(it["date"]),
                    amount = Double(it["amount"]),
                    // in = 往里存，out = 取出来用
                    dir = Str(it["kind"]) == "in" ? "in" : "out",
                    note = Str(it["note"]),
                }).ToList(),
                /* 递增模式：下一期该存多少。
                   从已有记录里最大的 jar_base 往后推一步，
                   而不是按"第几笔"推 —— 补存、跳期都不会算错。 */
                nextAmount = NextStepAmount(j0, items),
            };
        }

        /// <summary>
        /// 递增存钱：下一期该存多少。
        /// 没有任何记录时就是起存额；否则取「最大的一期」再加一档。
        /// </summary>
        private static double NextStepAmount(Dictionary<string, object> jar, List<Dictionary<string, object>> items)
        {
            var baseAmt = Double(jar["base_amount"]);
            var step = Double(jar["step_amount"]);
            if (Str(jar["mode"]) != "step") return baseAmt;

            var maxBase = 0.0;
            foreach (var it in items)
            {
                if (Str(it["kind"]) != "in") continue;
                var b = Double(it["jar_base"]);
                if (b > maxBase) maxBase = b;
            }
            return maxBase > 0 ? maxBase + step : baseAmt;
        }

        // ---------------- 写入 ----------------

        public object JarAdd(string name, double target, string mode, string period,
            double baseAmount, double stepAmount, string color, string icon, string note)
        {
            EnsureV13();
            if (string.IsNullOrWhiteSpace(name)) return new { ok = false, err = "先给储蓄罐起个名字" };
            if (target < 0) return new { ok = false, err = "目标金额不能是负数" };

            var id = NewId();
            Exec(@"INSERT INTO jars(id,name,target,mode,period,base_amount,step_amount,color,icon,note,sort,archived,created_at)
                   VALUES(@i,@n,@t,@m,@p,@b,@s,@c,@ic,@no,
                          (SELECT IFNULL(MAX(sort),0)+1 FROM jars),0,@ca)",
                ("@i", id), ("@n", name.Trim()), ("@t", target), ("@m", mode),
                ("@p", period), ("@b", baseAmount), ("@s", stepAmount),
                ("@c", color), ("@ic", icon), ("@no", note ?? ""),
                ("@ca", DateTime.Now.ToString("s")));
            return new { ok = true, id };
        }

        public object JarUpdate(string id, string name, double target, string mode, string period,
            double baseAmount, double stepAmount, string color, string icon, string note)
        {
            EnsureV13();
            Exec(@"UPDATE jars SET name=@n,target=@t,mode=@m,period=@p,
                     base_amount=@b,step_amount=@s,color=@c,icon=@ic,note=@no
                   WHERE id=@i",
                ("@i", id), ("@n", name.Trim()), ("@t", target), ("@m", mode),
                ("@p", period), ("@b", baseAmount), ("@s", stepAmount),
                ("@c", color), ("@ic", icon), ("@no", note ?? ""));
            return new { ok = true };
        }

        /// <summary>
        /// 存钱 / 取钱。dir = "in" 存入，"out" 取出。
        ///
        /// accountId 是「这笔钱从哪个账户进出」。传了的话账户余额会跟着变，
        /// 这样「账户余额 + 罐子余额」才等于真实总资产；
        /// 不传（空）就是不管账户，只记罐子的账 —— 适合不想细到账户的人。
        /// </summary>
        public object JarDeposit(string jarId, string dir, double amount, string date, string note,
            string accountId = "")
        {
            EnsureV13();
            if (amount <= 0) return new { ok = false, err = "金额要大于 0" };

            var jar = Rows("SELECT * FROM jars WHERE id=@i AND deleted_at IS NULL", ("@i", jarId));
            if (jar.Count == 0) return new { ok = false, err = "找不到这个储蓄罐" };

            // 取出不能超过罐子里现有的钱 —— 负数余额会让进度条反向画
            if (dir == "out")
            {
                var cur = Scalar($@"SELECT IFNULL({JarBalanceSql},0)
                                   FROM ledger WHERE jar_id=@i AND deleted_at IS NULL", ("@i", jarId));
                var have = Double(cur);
                if (amount > have + 1e-9)
                    return new { ok = false, err = $"罐子里只有 {have:0.##}，取不出 {amount:0.##}" };
            }

            var j = jar[0];
            var d = string.IsNullOrWhiteSpace(date) ? Today : date;

            /* 递增模式记下"这一笔本来该是多少"，供 NextStepAmount 推算下一期。
               用户实际存多少就记多少 —— 补存和少存都按真实金额走，下一期从它加一档。 */
            var baseAmt = Str(j["mode"]) == "step" && dir == "in" ? amount : 0.0;

            var id = NewId();
            /*
             * 存钱记成 ledger 的一笔，分类固定「存钱」。
             *
             * 但 kind 这里**必须和账本的收支口径分开看**，不能简单照抄方向：
             * 从账本角度，存钱不是「花掉了」，它只是钱换了个地方待着。
             * 如果 kind='out' 直接进账本合计，用户存 2000 块，
             * 这个月的「支出」就凭空多出 2000，预算条也跟着告急 —— 那是假的。
             *
             * 所以约定：jar_id 非空的流水，账本合计（LedgerList / LedgerInsight）
             * 一律按「转账」处理，既不算收入也不算支出。
             * 罐子的余额仍然按 in/out 正负累加，两边各算各的，互不污染。
             */
            Exec(@"INSERT INTO ledger(id,date,kind,amount,cat,note,account_id,created_at,jar_id,jar_base)
                   VALUES(@i,@d,@k,@a,'存钱',@no,@acc,@ca,@j,@b)",
                ("@i", id), ("@d", d), ("@k", dir), ("@a", amount),
                ("@no", note ?? ""), ("@acc", accountId ?? ""),
                ("@ca", DateTime.Now.ToString("s")),
                ("@j", jarId), ("@b", baseAmt));

            return new { ok = true, id };
        }

        /// <summary>删掉某一笔存钱记录（记错了）。会同时从账本里消失 —— 本来就同一条。</summary>
        public object JarRemoveItem(string ledgerId)
        {
            EnsureV13();
            Exec("UPDATE ledger SET deleted_at=@t WHERE id=@i",
                ("@i", ledgerId), ("@t", DateTime.Now.ToString("s")));
            return new { ok = true };
        }

        public object JarDelete(string id)
        {
            EnsureV13();
            /* 软删罐子，但**不动**里面的流水：
               钱已经花了或存了，从账本里凭空抹掉会让收支对不上。
               罐子可以消失，账要留着。 */
            Exec("UPDATE jars SET deleted_at=@t WHERE id=@i",
                ("@i", id), ("@t", DateTime.Now.ToString("s")));
            return new { ok = true };
        }

        public object JarArchive(string id, int archived)
        {
            EnsureV13();
            Exec("UPDATE jars SET archived=@a WHERE id=@i", ("@i", id), ("@a", archived));
            return new { ok = true };
        }

        public object JarReorder(string[] ids)
        {
            EnsureV13();
            for (var i = 0; i < ids.Length; i++)
                Exec("UPDATE jars SET sort=@s WHERE id=@i", ("@i", ids[i]), ("@s", i));
            return new { ok = true };
        }

        /// <summary>
        /// 三种模式的预设。用户不用自己去算 52 周总额是多少 ——
        /// 这些是公开的经典存钱法，直接给出比让他填四个框友好得多。
        /// </summary>
        public object JarPresets()
        {
            EnsureV13();
            return new[]
            {
                new { k = "52w", name = "52 周存钱", mode = "step", period = "week",
                      baseAmount = 10.0, stepAmount = 10.0, target = 13780.0,
                      desc = "第 1 周 10 元，每周多 10 元，第 52 周 520 元，一年存 13780" },
                new { k = "365d", name = "365 天存钱", mode = "step", period = "day",
                      baseAmount = 1.0, stepAmount = 1.0, target = 66795.0,
                      desc = "第 1 天 1 元，每天多 1 元，第 365 天 365 元，一年存 66795" },
                new { k = "weekly", name = "每周定额", mode = "fixed", period = "week",
                      baseAmount = 500.0, stepAmount = 0.0, target = 26000.0,
                      desc = "每周固定 500 元，一年 26000" },
                new { k = "monthly", name = "每月定额", mode = "fixed", period = "month",
                      baseAmount = 2000.0, stepAmount = 0.0, target = 24000.0,
                      desc = "每月固定 2000 元，一年 24000" },
                new { k = "free", name = "自由攒钱", mode = "free", period = "",
                      baseAmount = 0.0, stepAmount = 0.0, target = 0.0,
                      desc = "不设周期，想存就存；适合应急金" },
            };
        }
    }
}