using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

namespace Riqian
{
    /**
     * 第 107 / 170 条：字体库。
     *
     * 用户原话：「"字体"字体库大幅缺少，而且尚未允许用户自行导入」「提供更多字体」。
     * 原来字体就是一个硬编码的 6 项下拉框，选完写 settings.fontFamily ——
     * 也就是说「能选的」和「系统里装了的」之间差着一整层，而用户真正想要的是后者。
     *
     * 为什么要走宿主而不是纯前端：
     *   页面 origin 是 https://riqian-app.example，字体文件在另一处。
     *   @font-face 跨 origin 拉字体要 CORS，WebView2 的虚拟主机映射不给你发这个头；
     *   把字体塞进 HTML 内联成 base64 又会让本来 1.6 MB 的产物继续长。
     *   所以这里只做「目录 + 读字节」，前端拿到 base64 后用 FontFace 自己注册 ——
     *   FontFace 吃 ArrayBuffer，不受 origin 限制。
     *
     * 存储：<Root>/字体/ ，和图片库平级。放进 Root 而不是 MediaDir，
     * 是因为媒体库那套有缩略图、去重、软删除，字体只有「在不在」两种状态，套进来是负担。
     */
    public partial class Db
    {
        /// <summary>字体目录。<see cref="ChangeRoot"/> 换根时会跟着重算</summary>
        public string FontDir => Path.Combine(Root, "字体");

        /// <summary>认的字体扩展名。woff2 优先，ttf/otf 兜底，woff 是上一代格式</summary>
        private static readonly string[] FontExts = { ".woff2", ".woff", ".ttf", ".otf", ".ttc" };

        /// <summary>
        /// 字体族名的兜底推断。
        ///
        /// 真正的名字在文件内部的 name 表里，解析它要拖一个 sfnt 解析器进来 ——
        /// 为了一个显示名不值得。文件名是用户在 Windows 里看到的名字，
        /// 照它去掉版本号后缀就够用了，而且用户能认出自己刚放进去的是哪个。
        /// </summary>
        private static string FontLabelFromFile(string path)
        {
            var n = Path.GetFileNameWithoutExtension(path) ?? "";
            // "SourceHanSansSC-Bold" / "LXGWWenKai-Regular" → 空格分开，看着像人话
            n = n.Replace('_', ' ').Trim();
            return n.Length == 0 ? Path.GetFileName(path) : n;
        }

        /// <summary>字体文件大小上限。整套中日韩字体常在 10 MB+，给到 64 MB 不至于拦人</summary>
        private const long FontSizeLimit = 64L * 1024 * 1024;

        /// <summary>
        /// 列出「字体」目录里已有的文件。不扫系统字体（那要枚举注册表和 Fonts 目录，
        /// 而且系统字体前端本来就能直接用名字引用，不需要走这条路）。
        /// </summary>
        public object FontList()
        {
            try
            {
                Directory.CreateDirectory(FontDir);
                var items = new List<object>();
                foreach (var f in Directory.GetFiles(FontDir).OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
                {
                    var ext = Path.GetExtension(f).ToLowerInvariant();
                    if (!FontExts.Contains(ext)) continue;
                    var fi = new FileInfo(f);
                    items.Add(new
                    {
                        file = fi.Name,
                        label = FontLabelFromFile(f),
                        size = fi.Length,
                        ext = ext.TrimStart('.'),
                        at = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm"),
                    });
                }
                return new { ok = true, dir = FontDir, items };
            }
            catch (Exception ex)
            {
                Diag.Warn("font.list", "列字体失败", ex);
                return new { ok = false, dir = FontDir, items = new List<object>(), err = ex.Message };
            }
        }

        /// <summary>
        /// 弹文件框导入字体。多选 —— 用户装中文全家族时一次拖四五个体重是常态，
        /// 逼他一个个点进来很烦。
        /// </summary>
        public object FontImportFiles(IEnumerable<string> paths)
        {
            Directory.CreateDirectory(FontDir);
            var added = new List<object>();
            foreach (var src in paths ?? Enumerable.Empty<string>())
            {
                try
                {
                    var ext = Path.GetExtension(src).ToLowerInvariant();
                    if (!FontExts.Contains(ext))
                    {
                        added.Add(new { ok = false, name = Path.GetFileName(src), err = "不是字体文件（支持 woff2 / woff / ttf / otf / ttc）" });
                        continue;
                    }
                    var fi = new FileInfo(src);
                    if (fi.Length > FontSizeLimit)
                    {
                        added.Add(new { ok = false, name = fi.Name, err = "文件超过 64 MB" });
                        continue;
                    }
                    /*
                     * 重名不覆盖：用户可能从两个版本的同名字体各导一次，
                     * 覆盖掉之后想回退就没机会了。存在就加 (2) (3) 后缀。
                     */
                    var dst = Path.Combine(FontDir, fi.Name);
                    var stem = Path.GetFileNameWithoutExtension(fi.Name);
                    for (var i = 2; File.Exists(dst); i++)
                        dst = Path.Combine(FontDir, $"{stem} ({i}){ext}");
                    File.Copy(src, dst);
                    added.Add(new { ok = true, name = Path.GetFileName(dst), label = FontLabelFromFile(dst) });
                }
                catch (Exception ex)
                {
                    Diag.Warn("font.import", "导入字体失败", ex);
                    added.Add(new { ok = false, name = Path.GetFileName(src), err = ex.Message });
                }
            }
            return new { ok = true, items = added };
        }

        /// <summary>删一个字体文件。只删本目录里的，不允许跳出</summary>
        public object FontDelete(string file)
        {
            try
            {
                var name = Path.GetFileName(file ?? "");
                if (string.IsNullOrWhiteSpace(name)) return new { ok = false, err = "文件名为空" };
                var p = Path.Combine(FontDir, name);
                if (!File.Exists(p)) return new { ok = false, err = "文件已经不在了" };
                File.Delete(p);
                // 删掉的文件如果正被 settings.fontFamily 引用，前端自己去回退，这里不管
                return new { ok = true };
            }
            catch (Exception ex)
            {
                Diag.Warn("font.delete", "删字体失败", ex);
                return new { ok = false, err = ex.Message };
            }
        }

        /// <summary>
        /// 读一个字体文件的字节，base64 返回给前端去 new FontFace()。
        ///
        /// 为什么整份读回来而不是给个 URL：见类头注释（跨 origin 的 CORS）。
        /// 单个字体最大 64 MB，base64 之后 85 MB 左右走一次进程内消息 ——
        /// 只在用户选中某个字体时读一次，且前端会缓存已注册的 FontFace，不是高频路径。
        /// </summary>
        public object FontBytes(string file)
        {
            try
            {
                var name = Path.GetFileName(file ?? "");
                if (string.IsNullOrWhiteSpace(name)) return new { ok = false, err = "文件名为空" };
                var p = Path.Combine(FontDir, name);
                if (!File.Exists(p)) return new { ok = false, err = "文件已经不在了" };
                var fi = new FileInfo(p);
                if (fi.Length > FontSizeLimit) return new { ok = false, err = "文件超过 64 MB" };

                var bytes = File.ReadAllBytes(p);
                var ext = Path.GetExtension(p).ToLowerInvariant();
                return new
                {
                    ok = true,
                    file = name,
                    label = FontLabelFromFile(p),
                    // format 要让前端写进 FontFace 的 format() 提示，省得浏览器自己嗅探
                    format = ext switch
                    {
                        ".woff2" => "woff2",
                        ".woff" => "woff",
                        ".ttf" => "truetype",
                        ".otf" => "opentype",
                        ".ttc" => "truetype",
                        _ => "",
                    },
                    data = Convert.ToBase64String(bytes),
                };
            }
            catch (Exception ex)
            {
                Diag.Warn("font.bytes", "读字体失败", ex);
                return new { ok = false, err = ex.Message };
            }
        }
    }
}