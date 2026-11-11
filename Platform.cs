using System;

namespace Riqian
{
    /// <summary>
    /// 平台差异的唯一出口。数据层和宿主层都只管调这里，不自己判平台。
    ///
    /// 为什么要有这么一层：Db*.cs 里原来只有两处真的碰了 Windows 专有的东西 ——
    /// MakeThumb 的 GDI+ 缩略图、ShareCopy* 的剪贴板。为了让同一份数据层代码能
    /// 在安卓上编译，最省事的写法是就地撒 #if WINDOWS，但那有个立刻能预见的后果：
    /// 以后每加一个平台相关功能就要再判一次，判据散在十几个文件里，迟早分叉
    /// （这个项目的 DebugApi.InfoFile 已经栽过一次，判据分两处，绿色版把 token
    /// 写到 %APPDATA% 去了）。
    ///
    /// 所以按既有教训来：**判据只能有一处**。这里开两个窄口子，
    /// 实现放在各自平台的文件里（Windows 在 Platform.Windows.cs，
    /// 安卓在安卓项目自己的文件里）。没有实现时就是明着不支持，抛清楚的错，
    /// 而不是抛一个 PlatformNotSupportedException 让人对着一行堆栈猜。
    /// </summary>
    public static class Platform
    {
        /// <summary>
        /// 生成图片缩略图。Windows 走 GDI+，安卓走 SkiaSharp。
        /// 返回 false 表示这张图处理不了（webp / 损坏 / 格式不认），
        /// 调用方按「没有缩略图」处理，不要当异常。
        /// </summary>
        public static Func<string, string, bool> ThumbMaker;

        /// <summary>把 base64 图片放进系统剪贴板。返回错误文案，成功返回 null。</summary>
        public static Func<string, string> CopyImageToClipboard;

        /// <summary>把文本放进系统剪贴板。返回错误文案，成功返回 null。</summary>
        public static Func<string, string> CopyTextToClipboard;

        /// <summary>
        /// 读图片的像素尺寸。同样不能直接用 Image.FromFile —— 那在安卓上一样要炸。
        /// 读不出来返回 (0,0)，调用方照旧写库（宽高只是元数据，缺了不影响显示）。
        /// </summary>
        public static Func<string, (int W, int H)> ImageSizeReader;

        internal static (int W, int H) ImageSize(string path)
        {
            var f = ImageSizeReader;
            if (f == null) return (0, 0);
            try { return f(path); } catch { return (0, 0); }
        }

        /// <summary>
        /// 缩略图。没注册实现时返回 false —— 刻意不抛异常：
        /// 这条路在「导入一张图」的流程里，抛了会把整次导入带崩，
        /// 而缩略图本来只是附属品，没有它图片照样能看。
        /// </summary>
        internal static bool MakeThumb(string absPath, string outPath)
        {
            var f = ThumbMaker;
            return f != null && f(absPath, outPath);
        }

        internal static object CopyImage(string dataUrl)
        {
            var f = CopyImageToClipboard;
            if (f == null) return new { ok = false, err = "当前平台不支持复制图片到剪贴板" };
            var err = f(dataUrl);
            return err == null ? (object)new { ok = true } : new { ok = false, err };
        }

        internal static object CopyText(string text)
        {
            var f = CopyTextToClipboard;
            if (f == null) return new { ok = false, err = "当前平台不支持复制文本到剪贴板" };
            var err = f(text);
            return err == null ? (object)new { ok = true } : new { ok = false, err };
        }
    }
}