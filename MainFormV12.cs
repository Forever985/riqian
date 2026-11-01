using System.Text.Json;

namespace Riqian
{
    /**
     * 第 178 条：画板的 RPC 面。
     *
     * 单独开一个 V12Dispatch，而不是塞进主 switch ——
     * 主 switch 已经两千多行，再加七个 case 只会更难找。
     */
    public partial class MainForm
    {
        private object V12Dispatch(string m, JsonElement a)
        {
            /* 第 107 / 170 条：字体库。命名 space 沿用 "font."，和上面的 "draw." 平级 */
            if (m != null && m.StartsWith("font."))
            {
                if (m == "font.list") return db.FontList();
                if (m == "font.import") return FontImport();
                if (m == "font.delete") return db.FontDelete(S(a, "file"));
                if (m == "font.bytes") return db.FontBytes(S(a, "file"));
                return null;
            }

            if (m == null || !m.StartsWith("draw.")) return null;

            if (m == "draw.list") return db.DrawingList();
            if (m == "draw.get") return db.DrawingGet(S(a, "id"));
            if (m == "draw.save")
                return db.DrawingSave(
                    S(a, "id"), S(a, "title"), I(a, "w", 0), I(a, "h", 0),
                    S(a, "strokes"), S(a, "thumb"), S(a, "note"));
            if (m == "draw.delete") return db.DrawingDelete(S(a, "id"), I(a, "hard", 0));
            if (m == "draw.trash") return db.DrawingTrash();
            if (m == "draw.restore") return db.DrawingRestore(S(a, "id"));
            if (m == "draw.rename") return db.DrawingRename(S(a, "id"), S(a, "title"));
            if (m == "draw.toMedia") return db.DrawingToMedia(S(a, "id"), S(a, "data"), S(a, "name"));

            return null;
        }

        /// <summary>
        /// 第 170 条：弹文件框导入字体。
        ///
        /// 放这里而不是 Db 里的原因和 MediaImport 一样 —— Db 层不碰任何 UI。
        /// 文件框本身支持多选，选完交给 db 去复制。
        /// </summary>
        private object FontImport()
        {
            Directory.CreateDirectory(db.FontDir);
            using var dlg = new OpenFileDialog
            {
                Title = "选择要导入的字体文件（可多选，复制到「字体」目录，不会改动原文件）",
                Filter =
                    "字体文件|*.woff2;*.woff;*.ttf;*.otf;*.ttc" +
                    "|woff2（网页字体，最小）|*.woff2" +
                    "|TrueType / OpenType|*.ttf;*.otf;*.ttc" +
                    "|所有文件 (*.*)|*.*",
                Multiselect = true,
                InitialDirectory = db.FontDir,
                CheckFileExists = true,
            };
            if (dlg.ShowDialog(this) != DialogResult.OK)
                return new { ok = false, items = new object[0] };
            return db.FontImportFiles(dlg.FileNames);
        }
    }
}