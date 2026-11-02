using System;
using System.IO;
using System.Reflection;
using System.Text;

namespace Riqian
{
    /// <summary>
    /// 界面页面的本地承载方式。
    ///
    /// 以前是 core.NavigateToString(LoadHtml())，把整个前端产物当成一个字符串塞进 WebView2。
    /// 这条路有个**硬上限：2 MB**（按 UTF-16 算，即约 104 万字符），超了 ICoreWebView2.NavigateToString
    /// 直接抛 ArgumentException "Value does not fall within the expected range."（E_INVALIDARG），
    /// 表现就是「启动失败」——2026-11-01 那一版加完记账本图表 + Semi 图标后就撞上了（1,529,060 字符 ≈ 3.06 MB）。
    ///
    /// 而且这个上限是躲不开的：前端只会越来越大，压缩也只是把撞线推后。
    /// 所以改成走虚拟主机映射 —— 把 index.html 落到临时目录，用 SetVirtualHostNameToFolderMapping
    /// 映射成 https://<Host>/ 再导航。这条路没有大小限制，页面还有真正的 origin
    /// （以前 about:blank 是 opaque origin，localStorage 基本存不住）。
    ///
    /// 为什么还要写临时文件：内嵌资源不能直接当目录映射，而 publish 出来的 exe 是单文件，
    /// wwwroot 不一定在旁边。写一份到 %TEMP%\Riqian\ui\ 是最省事的落地点。
    /// </summary>
    internal static class HtmlHost
    {
        /// <summary>
        /// 虚拟主机名。用 .example 是因为 RFC 6761 保留它、保证不与真实站点重名；
        /// 不用 .local 是因为 WebView2 文档明确提到 .local 在导航时会有可感知的延迟。
        /// </summary>
        public const string Host = "riqian-app.example";

        /// <summary>页面入口地址</summary>
        public static string Url => "https://" + Host + "/index.html";

        /// <summary>
        /// 把界面产物落成磁盘上的 index.html，返回它所在的目录（供虚拟主机映射用）。
        ///
        /// 每次启动都重写：产物 1.5 MB，写入是毫秒级，但换来的是「换版本立刻生效」，
        /// 不用再操心缓存目录的版本清理。单实例互斥量保证同一时刻只有一个进程在写。
        /// </summary>
        public static string Prepare()
        {
            var dir = Path.Combine(Path.GetTempPath(), "Riqian", "ui");
            Directory.CreateDirectory(dir);
            var html = Path.Combine(dir, "index.html");

            var text = LoadHtml();
            // 带 BOM 会让某些解析路径上的首字符出问题，统一按无 BOM 写
            File.WriteAllText(html, text, new UTF8Encoding(false));

            WriteFonts(dir);
            return dir;
        }

        /// <summary>
        /// 把 KaTeX 的 20 个 .woff2 字体落到 <c>ui/fonts/</c>。
        ///
        /// 以前这些字体是 base64 内嵌在 CSS 里的（346 KB，占整个 index.html 的 20%），
        /// 而字体字节几乎不可压缩 —— 实测它把整包的 gzip 率拖坏了（含字体 284 KB
        /// vs 不含字体 27 KB）。外置成真实文件后 index.html 从 1755 KB 降到 1428 KB。
        ///
        /// 落盘策略：只写不存在或大小不同的。字体是纯静态内容、永不变化，
        /// 每次启动重写 304 KB 纯属浪费磁盘 I/O；而大小不同就说明换了 KaTeX 版本，
        /// 那时必须覆盖。比哈希便宜，也够用。
        /// </summary>
        private static void WriteFonts(string dir)
        {
            var fontDir = Path.Combine(dir, "fonts");
            Directory.CreateDirectory(fontDir);

            var asm = Assembly.GetExecutingAssembly();
            foreach (var name in asm.GetManifestResourceNames())
            {
                // 资源名形如 Riqian.fonts.KaTeX_AMS-Regular.woff2
                if (!name.StartsWith(FontPrefix, StringComparison.Ordinal)) continue;
                if (!name.EndsWith(".woff2", StringComparison.OrdinalIgnoreCase)) continue;

                var file = Path.Combine(fontDir, name.Substring(FontPrefix.Length));
                using var s = asm.GetManifestResourceStream(name);
                if (s == null) continue;
                if (File.Exists(file) && new FileInfo(file).Length == s.Length) continue;

                using var f = File.Create(file);
                s.CopyTo(f);
            }
        }

        /// <summary>字体内嵌资源的名字前缀（见 Riqian.csproj 的 EmbeddedResource）</summary>
        private const string FontPrefix = "Riqian.fonts.";

        /// <summary>
        /// 取界面 HTML：优先用 exe 旁边的 wwwroot（开发时热替换），否则读内嵌资源。
        /// </summary>
        private static string LoadHtml()
        {
            var dev = Path.Combine(AppContext.BaseDirectory, "wwwroot", "index.html");
            if (File.Exists(dev)) return File.ReadAllText(dev, Encoding.UTF8);

            using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("index.html");
            if (s == null) throw new InvalidOperationException("找不到内嵌界面资源");
            using var r = new StreamReader(s, Encoding.UTF8);
            return r.ReadToEnd();
        }
    }
}