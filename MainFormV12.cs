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
        /* V12Dispatch 已搬到 RpcDispatcher.cs（桌面与安卓共用同一份实现），见该文件。 */

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