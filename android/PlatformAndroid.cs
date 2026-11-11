using System;
using System.IO;
using Android.App;
using Android.Content;
using Android.Graphics;
using Android.OS;

namespace Riqian
{
    /// <summary>
    /// Platform 的安卓实现：缩略图、剪贴板、图片尺寸。
    ///
    /// 和 Platform.Windows.cs 一一对应，只是手段换成 Android 的：
    ///   缩略图   → BitmapFactory 解码 + CreateScaledBitmap
    ///   剪贴板   → ClipboardManager
    ///   图片尺寸 → BitmapFactory.Bounds（只读头，不解全图）
    ///
    /// 为什么必须注册这四个钩子：Db.cs 里生成缩略图和往剪贴板塞图的地方
    /// 原来是直接调 System.Drawing 的，那在安卓上编译都过不了。
    /// 钩子不注册的话 Platform.MakeThumb 返回 false（"没有缩略图"），
    /// 图片照样能看，只是列表里没有预览 —— 属于可接受的降级，但能实现就别降。
    /// </summary>
    internal static class PlatformAndroid
    {
        public static void Register()
        {
            Platform.ThumbMaker = MakeThumb;
            Platform.CopyImageToClipboard = CopyImage;
            Platform.CopyTextToClipboard = CopyText;
            Platform.ImageSizeReader = ImageSize;
        }

        /// <summary>
        /// 生成缩略图。安卓上没有 GDI+，用 BitmapFactory 解码再缩放。
        ///
        /// 先只读尺寸算出采样率再解码（inSampleSize），而不是把原图整张读进内存 ——
        /// 手机上一张 4000×3000 的照片直接解码要 48 MB，几张就能把应用撑崩。
        /// </summary>
        private static bool MakeThumb(string absPath, string outPath)
        {
            try
            {
                if (!System.IO.File.Exists(absPath)) return false;

                // 第一遍：只读头拿尺寸
                var bounds = new BitmapFactory.Options { InJustDecodeBounds = true };
                BitmapFactory.DecodeFile(absPath, bounds);
                if (bounds.OutWidth <= 0 || bounds.OutHeight <= 0) return false;

                // 第二遍：按 2 的幂降采样，让短边落在 320 附近
                const int target = 320;
                var sample = 1;
                while (Math.Min(bounds.OutWidth, bounds.OutHeight) / (sample * 2) >= target) sample *= 2;

                var opt = new BitmapFactory.Options { InSampleSize = sample };
                using var src = BitmapFactory.DecodeFile(absPath, opt);
                if (src == null) return false;

                // 等比缩到最长边 640（列表里的卡片够用，也不至于糊）
                const int maxSide = 640;
                var scale = Math.Min(1.0, (double)maxSide / Math.Max(src.Width, src.Height));
                var w = Math.Max(1, (int)(src.Width * scale));
                var h = Math.Max(1, (int)(src.Height * scale));
                using var small = Bitmap.CreateScaledBitmap(src, w, h, true);

                var dir = System.IO.Path.GetDirectoryName(outPath);
                if (!string.IsNullOrEmpty(dir)) System.IO.Directory.CreateDirectory(dir);

                using (var fs = System.IO.File.Create(outPath))
                {
                    // 缩略图统一存 JPEG：体积小，列表里也够看。
                    // 原图不动，需要原画质时走原文件。
                    small.Compress(Bitmap.CompressFormat.Jpeg, 82, fs);
                }
                return true;
            }
            catch (Exception e)
            {
                Diag.Warn("platform.android", "缩略图生成失败 " + absPath + "：" + e.Message);
                return false;
            }
        }

        /// <summary>读图片像素尺寸。只解码头，不分配整张位图。</summary>
        private static (int W, int H) ImageSize(string path)
        {
            try
            {
                var b = new BitmapFactory.Options { InJustDecodeBounds = true };
                BitmapFactory.DecodeFile(path, b);
                return b.OutWidth > 0 && b.OutHeight > 0 ? (b.OutWidth, b.OutHeight) : (0, 0);
            }
            catch { return (0, 0); }
        }

        /// <summary>
        /// 把 base64 图片放进剪贴板。
        ///
        /// 安卓上**做不干净**，所以直接如实拒绝：
        /// 要往剪贴板放图片，必须先用 ContentProvider 把图暴露成一个 content:// URI，
        /// 否则别的应用拿到这个 clip 也读不出图（剪贴板里放的只是一个已失效的路径）。
        /// 为这一个按钮挂一套 FileProvider 不值得 —— 手机上分享图片走系统分享面板，
        /// 本来就比「复制到剪贴板再粘贴」顺手。
        ///
        /// 桌面版这里是真能复制的，所以只在安卓侧降级。
        /// </summary>
        private static string CopyImage(string dataUrl)
            => "手机上请用「分享」直接发图，剪贴板不存图片";

        private static string CopyText(string text)
        {
            try
            {
                var ctx = Application.Context;
                var cm = (ClipboardManager)ctx.GetSystemService(Context.ClipboardService);
                if (cm == null) return "系统剪贴板不可用";
                cm.PrimaryClip = ClipData.NewPlainText("日签", text ?? "");
                return null;
            }
            catch (Exception e) { return e.Message; }
        }
    }
}
