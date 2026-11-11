using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// Platform 的 Windows 实现。内容基本是从 Db.MakeThumb 原样搬过来的，
    /// 只是把「算缩略图路径」这一步留给调用方（安卓那边的目录布局不一样）。
    /// </summary>
    internal static class PlatformWindows
    {
        /// <summary>
        /// 注册实现。在 Program.Main 的最开头调一次 —— 必须在任何 Db 操作之前，
        /// 否则第一次导入图片时缩略图就是空实现，得等到下次启动才补上。
        /// </summary>
        public static void Register()
        {
            Platform.ThumbMaker = MakeThumb;
            Platform.CopyImageToClipboard = CopyImage;
            Platform.CopyTextToClipboard = CopyText;
            Platform.ImageSizeReader = ImageSize;
        }

        private static (int, int) ImageSize(string path)
        {
            using var img = Image.FromFile(path);
            return (img.Width, img.Height);
        }

        private static bool MakeThumb(string absPath, string outp)
        {
            try
            {
                using var img = Image.FromFile(absPath);
                // 手机照片常带 EXIF 方向，不校正会横躺
                try
                {
                    if (img.PropertyIdList.Contains(0x0112))
                    {
                        var o = BitConverter.ToUInt16(img.GetPropertyItem(0x0112).Value, 0);
                        if (o == 3) img.RotateFlip(RotateFlipType.Rotate180FlipNone);
                        else if (o == 6) img.RotateFlip(RotateFlipType.Rotate90FlipNone);
                        else if (o == 8) img.RotateFlip(RotateFlipType.Rotate270FlipNone);
                    }
                }
                catch { }

                const int max = 360;
                double k = Math.Min(1.0, Math.Min((double)max / img.Width, (double)max / img.Height));
                int w = Math.Max(1, (int)(img.Width * k)), h = Math.Max(1, (int)(img.Height * k));

                using var bmp = new Bitmap(w, h);
                using (var g = Graphics.FromImage(bmp))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.Clear(Color.White);
                    g.DrawImage(img, 0, 0, w, h);
                }
                var jpg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
                using var ps = new EncoderParameters(1);
                ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
                bmp.Save(outp, jpg, ps);
                return true;
            }
            catch (Exception ex)
            {
                Diag.Warn("media.thumb", "缩略图生成失败 path=" + absPath, ex);
                return false;
            }
        }

        private static string CopyImage(string dataUrl)
        {
            try
            {
                var i = (dataUrl ?? "").IndexOf("base64,", StringComparison.OrdinalIgnoreCase);
                if (i < 0) return "没有图片数据";
                var bytes = Convert.FromBase64String(dataUrl.Substring(i + 7));
                using var ms = new MemoryStream(bytes);
                using var img = Image.FromStream(ms);
                Clipboard.SetImage(new Bitmap(img));
                return null;
            }
            catch (Exception ex) { return ex.Message; }
        }

        private static string CopyText(string text)
        {
            try
            {
                if (!string.IsNullOrEmpty(text)) Clipboard.SetText(text);
                return null;
            }
            catch (Exception ex) { return ex.Message; }
        }
    }
}