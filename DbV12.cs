using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Riqian
{
    /**
     * 第 178 条：画板。
     *
     * 原话：「在笔记中增加画板……应该直接在整个轮子中增加画板。画板也是可编辑、
     * 可删除、可以被放入多媒体库的」。
     *
     * 为什么不做成一张 canvas 记录：
     *   · 画板要能被笔记引用、被日记引用、还要能在多媒体库里单独管理，
     *     那就必须有自己的稳定 id 和独立的存在周期；
     *   · 用户想「再改改」时，重画一遍是最糟的体验，所以必须存笔画而不是存图片。
     *
     * 存储分两层：
     *   · drawing 表 — 元数据（标题、尺寸、缩略图 media id、更新时间）
     *   · drawing.strokes — 笔画 JSON，全在一个 TEXT 字段里
     *
     * 为什么不把笔画拆成一张表：一根线就是一个点数组，拆表之后「读一整个画板」
     * 要 join 几百行再拼回顺序，而画板本来就是整体读写的（打开→画→存），
     * 一次读写一整块 JSON 又快又不会拼错顺序。
     *
     * 缩略图单独存进 media 表（kind='image'），所以画板天然就能
     * 「被放入多媒体库」—— 不用为画板再写一套预览逻辑。
     */
    public partial class Db
    {
        private void EnsureDrawingTable()
        {
            Exec(@"CREATE TABLE IF NOT EXISTS drawings(
              id TEXT PRIMARY KEY,
              title TEXT DEFAULT '',
              w INTEGER DEFAULT 0,
              h INTEGER DEFAULT 0,
              strokes TEXT DEFAULT '',
              thumb_id TEXT DEFAULT '',
              note TEXT DEFAULT '',
              created_at TEXT,
              updated_at TEXT,
              deleted_at TEXT
            )");
            Exec("CREATE INDEX IF NOT EXISTS ix_drawings_updated ON drawings(updated_at)");
        }

        /** 列表：只给元数据，不带笔画（一个画板几百 KB，列表页不需要） */
        public object DrawingList()
        {
            EnsureDrawingTable();
            var rows = Rows(@"SELECT id,title,w,h,thumb_id,note,created_at,updated_at FROM drawings
                              WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500");
            return new
            {
                ok = true,
                items = rows.Select(r => new
                {
                    id = Str(r["id"]),
                    title = Str(r["title"]),
                    w = Int(r["w"]),
                    h = Int(r["h"]),
                    thumb = Str(r["thumb_id"]),
                    note = Str(r["note"]),
                    createdAt = Str(r["created_at"]),
                    updatedAt = Str(r["updated_at"]),
                }).ToArray(),
            };
        }

        /** 读一整块：打开画板时才调 */
        public object DrawingGet(string id)
        {
            EnsureDrawingTable();
            var r = Rows("SELECT * FROM drawings WHERE id=$i AND deleted_at IS NULL", ("$i", id ?? "")).FirstOrDefault();
            if (r == null) return new { ok = false, err = "画板不存在（可能已删除）" };
            return new
            {
                ok = true,
                id = Str(r["id"]),
                title = Str(r["title"]),
                w = Int(r["w"]),
                h = Int(r["h"]),
                strokes = Str(r["strokes"]),
                thumb = Str(r["thumb_id"]),
                note = Str(r["note"]),
                createdAt = Str(r["created_at"]),
                updatedAt = Str(r["updated_at"]),
            };
        }

        /**
         * 保存。
         *
         * drawingId 为空 = 新建，由后端生成 id 返回给前端 —— 不让前端自己造 id，
         * 否则两台机器（或两个标签页）可能造出同一个。
         */
        public object DrawingSave(string id, string title, int w, int h, string strokes, string thumbId, string note)
        {
            EnsureDrawingTable();
            var now = Now;

            /* 笔画是纯 JSON，但也要有个上限，免得一次粘进来几 MB 把界面拖死 */
            var s = strokes ?? "";
            if (s.Length > 8 * 1024 * 1024) return new { ok = false, err = "画板太大了（超过 8MB），试试少画几笔或降低尺寸" };

            if (string.IsNullOrWhiteSpace(id))
            {
                var nid = "dr" + DateTime.Now.ToString("yyMMddHHmmss") + Guid.NewGuid().ToString("N").Substring(0, 4);
                Exec(@"INSERT INTO drawings(id,title,w,h,strokes,thumb_id,note,created_at,updated_at)
                       VALUES($i,$t,$w,$h,$s,$th,$n,$c,$u)",
                    ("$i", nid), ("$t", title ?? ""), ("$w", w), ("$h", h), ("$s", s),
                    ("$th", thumbId ?? ""), ("$n", note ?? ""), ("$c", now), ("$u", now));
                return new { ok = true, id = nid };
            }

            var exist = Scalar("SELECT id FROM drawings WHERE id=$i", ("$i", id));
            if (exist == null) return new { ok = false, err = "要保存的画板不存在" };

            Exec(@"UPDATE drawings SET title=$t,w=$w,h=$h,strokes=$s,thumb_id=$th,note=$n,updated_at=$u
                   WHERE id=$i",
                ("$t", title ?? ""), ("$w", w), ("$h", h), ("$s", s),
                ("$th", thumbId ?? ""), ("$n", note ?? ""), ("$u", now), ("$i", id));

            /* 顺手把「引用了这个画板的笔记」的更新时间也标一下，方便回看 */
            return new { ok = true, id };
        }

        /**
         * 删除。
         *
         * 默认软删（进回收站），hard=1 才真删。
         * 缩略图故意**不删**：那张图可能已经被用户放进日记或笔记里了，
         * 跟着画板一起没了会留下一个破图。要清就单独去多媒体库清。
         */
        public object DrawingDelete(string id, int hard)
        {
            EnsureDrawingTable();
            if (string.IsNullOrWhiteSpace(id)) return new { ok = false, err = "缺少 id" };
            if (hard == 1)
            {
                Exec("DELETE FROM drawings WHERE id=$i", ("$i", id));
                return new { ok = true, hard = true };
            }
            Exec("UPDATE drawings SET deleted_at=$d,updated_at=$d WHERE id=$i", ("$d", Now), ("$i", id));
            return new { ok = true };
        }

        /** 回收站 */
        public object DrawingTrash()
        {
            EnsureDrawingTable();
            var rows = Rows(@"SELECT id,title,thumb_id,deleted_at FROM drawings
                              WHERE deleted_at IS NOT NULL AND deleted_at<>'' ORDER BY deleted_at DESC LIMIT 200");
            return new
            {
                ok = true,
                items = rows.Select(r => new
                {
                    id = Str(r["id"]),
                    title = Str(r["title"]),
                    thumb = Str(r["thumb_id"]),
                    deletedAt = Str(r["deleted_at"]),
                }).ToArray(),
            };
        }

        public object DrawingRestore(string id)
        {
            EnsureDrawingTable();
            Exec("UPDATE drawings SET deleted_at='',updated_at=$u WHERE id=$i", ("$u", Now), ("$i", id ?? ""));
            return new { ok = true };
        }

        /** 改名（列表里直接双击就能改） */
        public object DrawingRename(string id, string title)
        {
            EnsureDrawingTable();
            Exec("UPDATE drawings SET title=$t,updated_at=$u WHERE id=$i",
                ("$t", title ?? ""), ("$u", Now), ("$i", id ?? ""));
            return new { ok = true };
        }

        /**
         * 导出成 PNG 存进媒体库。
         *
         * 不走 DrawingSave 的缩略图字段，而是**新建**一条 media 记录：
         * 用户点「放进多媒体库」想要的是能单独拖走的那个图，
         * 和画板内部的缩略图是两个用途，混用会让删画板时把图一起带走。
         */
        public object DrawingToMedia(string id, string b64, string name)
        {
            EnsureDrawingTable();
            if (string.IsNullOrWhiteSpace(b64)) return new { ok = false, err = "没有图片数据" };
            var r = MediaSaveBase64(name ?? "画板.png", b64);
            return r;
        }
    }
}