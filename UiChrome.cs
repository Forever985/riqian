using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// 窗口外壳（标题栏 / 边框）与托盘菜单的配色。
    ///
    /// 第 195 条：以前窗口是 Windows 默认那套「白底 + 蓝灰标题栏」，在深色主题下特别突兀。
    /// 不做无边框重绘（那样要自己实现拖动、吸附、最大化动画，坑比收益多），
    /// 而是用 DWM 的几个属性把标题栏颜色交给系统去画 —— 圆角、阴影、动画全都保留，
    /// 只是颜色跟着应用主题走。
    ///
    /// 第 164 条：托盘右键菜单同理，默认 ContextMenuStrip 是灰色方块，
    /// 这里换成扁平渲染 + 主题色。
    /// </summary>
    public partial class MainForm
    {
        /* ---------------- 主题色缓存（前端 push 过来） ---------------- */

        private Color _uiPanel = Color.FromArgb(255, 253, 248);
        private Color _uiInk = Color.FromArgb(38, 34, 29);
        private Color _uiLine = Color.FromArgb(228, 221, 206);
        private Color _uiAccent = Color.FromArgb(184, 98, 58);
        private bool _uiDark;

        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        /// <summary>#rrggbb / #aarrggbb → Color；认不出来就用兜底色</summary>
        private static Color ParseColor(string s, Color fallback)
        {
            try
            {
                var t = (s ?? "").Trim().TrimStart('#');
                if (t.Length == 6)
                    return Color.FromArgb(
                        Convert.ToInt32(t.Substring(0, 2), 16),
                        Convert.ToInt32(t.Substring(2, 2), 16),
                        Convert.ToInt32(t.Substring(4, 2), 16));
                if (t.Length == 8)
                    return Color.FromArgb(
                        Convert.ToInt32(t.Substring(0, 2), 16),
                        Convert.ToInt32(t.Substring(2, 2), 16),
                        Convert.ToInt32(t.Substring(4, 2), 16),
                        Convert.ToInt32(t.Substring(6, 2), 16));
            }
            catch { }
            return fallback;
        }

        /// <summary>COLORREF 是 0x00BBGGRR，别写成 RGB</summary>
        private static int ToColorRef(Color c) => c.R | (c.G << 8) | (c.B << 16);

        /// <summary>前端把当前主题的几个关键色推过来（applyAppearance 时调用）</summary>
        private void SetUiChrome(string panel, string ink, string line, string accent, int dark)
        {
            _uiPanel = ParseColor(panel, _uiPanel);
            _uiInk = ParseColor(ink, _uiInk);
            _uiLine = ParseColor(line, _uiLine);
            _uiAccent = ParseColor(accent, _uiAccent);
            _uiDark = dark == 1;
            ApplyWindowChrome();
            ApplyTrayTheme();
        }

        /// <summary>句柄一建好就把标题栏颜色刷上去（否则要等前端第一次推送才生效）</summary>
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplyWindowChrome();
        }

        private void ApplyWindowChrome()
        {
            if (!IsHandleCreated) return;
            try
            {
                var h = Handle;
                // 深色标题栏（20 是 1809+ 的编号，19 是更早的写法，两个都试）
                int dark = _uiDark ? 1 : 0;
                if (DwmSetWindowAttribute(h, 20, ref dark, sizeof(int)) != 0)
                    DwmSetWindowAttribute(h, 19, ref dark, sizeof(int));

                // 标题栏 / 标题文字 / 边框颜色：让整个窗口跟主题一个色系
                int caption = ToColorRef(_uiPanel);
                DwmSetWindowAttribute(h, 35, ref caption, sizeof(int));
                int text = ToColorRef(_uiInk);
                DwmSetWindowAttribute(h, 36, ref text, sizeof(int));
                int border = ToColorRef(_uiLine);
                DwmSetWindowAttribute(h, 34, ref border, sizeof(int));

                // Win11 圆角（Win10 上调用会返回失败，忽略即可）
                int corner = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(h, 33, ref corner, sizeof(int));
            }
            catch { /* 老系统没有这些属性，保持系统默认就好 */ }
        }

        private void ApplyTrayTheme()
        {
            try
            {
                if (tray?.ContextMenuStrip is ContextMenuStrip m)
                {
                    m.BackColor = _uiPanel;
                    m.ForeColor = _uiInk;
                    m.Renderer = new FlatMenuRenderer(_uiPanel, _uiInk, _uiLine, _uiAccent, _uiDark);
                    foreach (ToolStripItem it in m.Items)
                    {
                        it.ForeColor = _uiInk;
                        it.BackColor = Color.Transparent;
                    }
                }
            }
            catch { }
        }
    }

    /// <summary>托盘菜单的扁平渲染：去掉系统那套渐变和粗边框</summary>
    public class FlatMenuRenderer : ToolStripProfessionalRenderer
    {
        private readonly Color _bg;
        private readonly Color _fg;
        private readonly Color _line;
        private readonly Color _accent;
        private readonly bool _dark;

        public FlatMenuRenderer(Color bg, Color fg, Color line, Color accent, bool dark)
            : base(new FlatColorTable(bg, fg, line, accent, dark))
        {
            _bg = bg; _fg = fg; _line = line; _accent = accent; _dark = dark;
            RoundedEdges = false;
        }

        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var b = new SolidBrush(_bg);
            e.Graphics.FillRectangle(b, e.AffectedBounds);
        }

        protected override void OnRenderImageMargin(ToolStripRenderEventArgs e)
        {
            // 左侧那条竖条（图标区）默认是渐变，抹平
            using var b = new SolidBrush(_bg);
            e.Graphics.FillRectangle(b, e.AffectedBounds);
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            var item = e.Item;
            if (!item.Selected && !item.Pressed) return;
            var r = new Rectangle(4, 1, item.Width - 8, item.Height - 2);
            using var path = Round(r, 6);
            using var b = new SolidBrush(_dark
                ? Blend(_bg, Color.White, 0.10)
                : Blend(_bg, Color.Black, 0.06));
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.FillPath(b, path);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Enabled ? _fg : Blend(_fg, _bg, 0.55);
            base.OnRenderItemText(e);
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            var r = e.Item.ContentRectangle;
            using var p = new Pen(_line);
            var y = r.Top + r.Height / 2;
            e.Graphics.DrawLine(p, r.Left + 10, y, r.Right - 10, y);
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            var r = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            using var p = new Pen(_line);
            e.Graphics.DrawRectangle(p, r);
        }

        private static GraphicsPath Round(Rectangle r, int radius)
        {
            var path = new GraphicsPath();
            var d = radius * 2;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static Color Blend(Color a, Color b, double t) => Color.FromArgb(
            (int)(a.R + (b.R - a.R) * t),
            (int)(a.G + (b.G - a.G) * t),
            (int)(a.B + (b.B - a.B) * t));
    }

    /// <summary>配合 FlatMenuRenderer 的色表：把系统默认的蓝灰渐变全部换成主题色</summary>
    public class FlatColorTable : ProfessionalColorTable
    {
        private readonly Color _bg, _fg, _line, _accent;
        private readonly bool _dark;

        public FlatColorTable(Color bg, Color fg, Color line, Color accent, bool dark)
        {
            _bg = bg; _fg = fg; _line = line; _accent = accent; _dark = dark;
            UseSystemColors = false;
        }

        private Color Hover => _dark
            ? Color.FromArgb(Math.Min(255, _bg.R + 26), Math.Min(255, _bg.G + 26), Math.Min(255, _bg.B + 26))
            : Color.FromArgb(Math.Max(0, _bg.R - 12), Math.Max(0, _bg.G - 12), Math.Max(0, _bg.B - 12));

        public override Color MenuItemSelected => Hover;
        public override Color MenuItemSelectedGradientBegin => Hover;
        public override Color MenuItemSelectedGradientEnd => Hover;
        public override Color MenuItemPressedGradientBegin => Hover;
        public override Color MenuItemPressedGradientEnd => Hover;
        public override Color MenuItemBorder => Color.Transparent;
        public override Color MenuBorder => _line;
        public override Color ToolStripDropDownBackground => _bg;
        public override Color ImageMarginGradientBegin => _bg;
        public override Color ImageMarginGradientMiddle => _bg;
        public override Color ImageMarginGradientEnd => _bg;
        public override Color SeparatorDark => _line;
        public override Color SeparatorLight => _line;
        public override Color CheckBackground => _accent;
        public override Color CheckSelectedBackground => _accent;
        public override Color CheckPressedBackground => _accent;
    }
}
