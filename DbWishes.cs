using System;
using System.Collections.Generic;
using System.Linq;

namespace Riqian
{
    public partial class Db
    {
        /* ================================================================== */
        /* 第 250 条：愿望单                                                  */
        /*                                                                     */
        /* 用户原话：「愿望单功能」。                                          */
        /*                                                                     */
        /* 和「待办」的区别必须一开始就划清楚，否则会做成第二个待办清单：      */
        /*   · 待办 = 该做的事。有截止日，有优先级，做不完会焦虑。            */
        /*   · 愿望 = 想要的东西 / 想去的日子。可以一直放着，不是欠债。        */
        /* 所以这里**不做逾期、不做催办**，只做「攒够了就打勾」这一件事。      */
        /*                                                                     */
        /* 金额用整数「分」存，不用浮点：                                     */
        /* 0.1 + 0.2 != 0.3 这种误差在记账类数据上是硬伤，用户一对账就发现     */
        /* 差了几分钱，然后就再也不信这个功能了。                              */
        /* ================================================================== */

        public void EnsureWishes()
        {
            Exec(@"CREATE TABLE IF NOT EXISTS wishes(
                     id TEXT PRIMARY KEY,
                     title TEXT NOT NULL DEFAULT '',
                     note TEXT DEFAULT '',
                     price_cents INTEGER DEFAULT 0,
                     url TEXT DEFAULT '',
                     priority INTEGER DEFAULT 1,
                     target_date TEXT DEFAULT '',
                     done INTEGER DEFAULT 0,
                     done_at TEXT DEFAULT '',
                     created_at TEXT DEFAULT '',
                     updated_at TEXT DEFAULT '',
                     deleted_at TEXT DEFAULT '',
                     rev INTEGER DEFAULT 1)");
            Exec("CREATE INDEX IF NOT EXISTS ix_wishes_done ON wishes(done)");
        }

        /**
         * 列表。
         *
         * 默认按「还没实现 → 优先级高 → 想得久」排：愿望单的价值是提醒你
         * 还有什么是想要的，实现过的应该往后沉，别占着最上面。
         */
        public object WishList()
        {
            EnsureWishes();
            var rows = Rows(@"SELECT * FROM wishes
                              WHERE IFNULL(deleted_at,'')=''
                              ORDER BY done ASC, priority DESC, created_at DESC");
            return rows.Select(r =>
            {
                var price = Int(r["price_cents"]);
                return new
                {
                    id = Str(r["id"]),
                    title = Str(r["title"]),
                    note = Str(r["note"]),
                    /* 两个都给：cents 给汇总计算用，yuan 给界面直接显示，
                       省得前端每处都要除一次、还各除各的 */
                    priceCents = price,
                    priceYuan = Math.Round(price / 100.0, 2),
                    url = Str(r["url"]),
                    priority = Int(r["priority"]),
                    targetDate = Str(r["target_date"]),
                    done = Int(r["done"]),
                    doneAt = Str(r["done_at"]),
                    createdAt = Str(r["created_at"]),
                    updatedAt = Str(r["updated_at"]),
                };
            }).ToList();
        }

        public object WishSave(string id, string title, long priceCents, string note,
            string url, int priority, string targetDate)
        {
            EnsureWishes();
            title = (title ?? "").Trim();
            if (title.Length == 0) return new { ok = false, err = "想许个什么愿？先写一句" };
            if (title.Length > 80) return new { ok = false, err = "标题太长了（最多 80 字）" };
            if (priceCents < 0) return new { ok = false, err = "金额不能是负数" };
            /*
             * 一亿元上限（10_000_000_000 分）。
             *
             * 用 long 而不是 int 是必须的：int 最大只有 21.4 亿分 ≈ 2147 万元，
             * 「一亿」这个上限在 int 里根本装不下，写成 int 那句判断会永远为假 ——
             * 看起来有校验，实际一行都不生效。
             */
            const long MAX_CENTS = 10_000_000_000L;
            if (priceCents > MAX_CENTS) return new { ok = false, err = "金额太大了，确认一下是不是多打了 0" };
            if (priority < 1) priority = 1;
            if (priority > 3) priority = 3;

            var td = (targetDate ?? "").Trim();
            if (td.Length > 0 && td.Length < 8) return new { ok = false, err = "目标日期格式不对" };

            if (string.IsNullOrEmpty(id))
            {
                id = "w" + NewId();
                Exec(@"INSERT INTO wishes(id,title,note,price_cents,url,priority,target_date,
                             done,done_at,created_at,updated_at,deleted_at,rev)
                       VALUES($i,$t,$n,$p,$u,$pr,$td,0,'',$c,$c,'',1)",
                    ("$i", id), ("$t", title), ("$n", note ?? ""), ("$p", priceCents),
                    ("$u", url ?? ""), ("$pr", priority), ("$td", td), ("$c", Now));
                return new { ok = true, id };
            }

            if (Scalar("SELECT id FROM wishes WHERE id=$i", ("$i", id)) == null)
                return new { ok = false, err = "这条愿望不存在（可能已经删掉了）" };

            Exec(@"UPDATE wishes SET title=$t,note=$n,price_cents=$p,url=$u,
                         priority=$pr,target_date=$td,updated_at=$c,rev=IFNULL(rev,0)+1
                   WHERE id=$i",
                ("$t", title), ("$n", note ?? ""), ("$p", priceCents), ("$u", url ?? ""),
                ("$pr", priority), ("$td", td), ("$c", Now), ("$i", id));
            return new { ok = true, id };
        }

        /** 实现 / 取消实现。单独一个接口，因为这是这页最高频的一个动作 */
        public object WishDone(string id, int done)
        {
            EnsureWishes();
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, err = "缺少 id" };
            Exec("UPDATE wishes SET done=$d,done_at=$a,updated_at=$u,rev=IFNULL(rev,0)+1 WHERE id=$i",
                ("$d", done == 1 ? 1 : 0),
                ("$a", done == 1 ? Now : ""),
                ("$u", Now), ("$i", id));
            return new { ok = true };
        }

        /** 软删除，和其他模块一致 —— 剪掉的愿望也能找回来 */
        public object WishDelete(string id)
        {
            EnsureWishes();
            Exec("UPDATE wishes SET deleted_at=$d WHERE id=$i", ("$d", Now), ("$i", id));
            return new { ok = true };
        }

        /**
         * 汇总：还想要几件、已经实现几件、总共要多少钱、实现了的多少钱。
         *
         * 放在后端算而不是前端加总：前端加总要先拿到全表，
         * 愿望多了（几百条）之后每次进页面都要传一遍全量数据只为算个数字。
         */
        public object WishStats()
        {
            EnsureWishes();
            var rows = Rows(@"SELECT done, IFNULL(price_cents,0) AS p FROM wishes
                              WHERE IFNULL(deleted_at,'')=''");
            int open = 0, done = 0;
            long openCents = 0, doneCents = 0;
            foreach (var r in rows)
            {
                var p = (long)Int(r["p"]);
                if (Int(r["done"]) == 1) { done++; doneCents += p; }
                else { open++; openCents += p; }
            }
            return new
            {
                ok = true,
                open,
                done,
                openCents,
                openYuan = Math.Round(openCents / 100.0, 2),
                doneCents,
                doneYuan = Math.Round(doneCents / 100.0, 2),
            };
        }
    }
}
