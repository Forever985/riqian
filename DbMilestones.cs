using System;
using System.Collections.Generic;
using System.Linq;

namespace Riqian
{
    public partial class Db
    {
        /* ================================================================== */
        /* 第 188 条：大事时间轴                                              */
        /*                                                                     */
        /* 原来的「时间轴」其实是日记的另一种排版方式，和「记录」页是同一批   */
        /* 数据的两个视图 —— 那个已经并进记录页了。这里是一条新的、独立的线： */
        /* 用户自己挑出来记的「大事」，不求多，求能一眼看完这几年的路。       */
        /* ================================================================== */

        public void EnsureMilestones()
        {
            Exec(@"CREATE TABLE IF NOT EXISTS milestones(
                     id TEXT PRIMARY KEY,
                     date TEXT NOT NULL DEFAULT '',
                     title TEXT DEFAULT '',
                     note TEXT DEFAULT '',
                     kind TEXT DEFAULT '',
                     created_at TEXT DEFAULT '',
                     updated_at TEXT DEFAULT '',
                     deleted_at INTEGER DEFAULT 0,
                     rev INTEGER DEFAULT 1)");
            Exec("CREATE INDEX IF NOT EXISTS ix_milestone_date ON milestones(date)");
        }

        public object MilestoneList()
        {
            var rows = Rows(@"SELECT * FROM milestones WHERE IFNULL(deleted_at,0)=0
                              ORDER BY date DESC, created_at DESC");
            return rows.Select(r => new
            {
                id = Str(r["id"]),
                date = Str(r["date"]),
                title = Str(r["title"]),
                note = Str(r["note"]),
                kind = Str(r["kind"]),
                createdAt = Str(r["created_at"]),
                updatedAt = Str(r["updated_at"]),
            }).ToList();
        }

        public object MilestoneSave(string id, string date, string title, string note, string kind)
        {
            date = (date ?? "").Trim();
            title = (title ?? "").Trim();
            if (date.Length < 8) return new { ok = false, err = "日期没填对" };
            if (title.Length == 0) return new { ok = false, err = "写一句这是什么" };

            if (string.IsNullOrEmpty(id))
            {
                id = NewId();
                Exec(@"INSERT INTO milestones(id,date,title,note,kind,created_at,updated_at,rev)
                       VALUES($i,$d,$t,$n,$k,$c,$c,1)",
                    ("$i", id), ("$d", date), ("$t", title), ("$n", note ?? ""),
                    ("$k", kind ?? ""), ("$c", Now));
            }
            else
            {
                Exec(@"UPDATE milestones SET date=$d,title=$t,note=$n,kind=$k,updated_at=$c,
                             rev=IFNULL(rev,0)+1 WHERE id=$i",
                    ("$i", id), ("$d", date), ("$t", title), ("$n", note ?? ""),
                    ("$k", kind ?? ""), ("$c", Now));
            }
            return new { ok = true, id };
        }

        /// <summary>软删除，留个后悔的机会（和其他模块一致）</summary>
        public object MilestoneDelete(string id)
        {
            Exec("UPDATE milestones SET deleted_at=$t WHERE id=$i", ("$t", DateTimeOffset.UtcNow.ToUnixTimeSeconds()), ("$i", id));
            return new { ok = true };
        }
    }
}
