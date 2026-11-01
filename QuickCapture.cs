using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// 第 165 条：快捷浮窗（用户原话「快捷建立是能直接生成一个浮窗的」）。
    ///
    /// 以前所有「快速记一笔」的热键都走 <c>HostCmd</c>：先 ShowMain() 把主窗口整个拽出来，
    /// 再 ExecuteScript 让前端弹一个浮层。用户手上正在别的软件里干活，突然整块屏幕被日签占满，
    /// 记完还得再关一次 —— 这不叫快速。
    ///
    /// 这里做的是真·独立小窗：
    ///  · 不经过 WebView2，不唤主窗口，主窗口保持隐藏也不影响它；
    ///  · 无边框 + 圆角 + 跟随主题色，看着像浮在桌面上的便签；
    ///  · 按 Esc 或失焦就收起来（失焦收起是刻意的：记完切回去，它自己就退了）；
    ///  · 输入框一出来就聚焦，回车保存、不关窗，可以连着敲好几条（待办场景）。
    /// </summary>
    public partial class MainForm
    {
        private QuickNoteForm _quickNote;

        /* 浮窗是独立 Form，拿不到 MainForm 的私有字段，这里开三个只读口子 */
        /// <summary>浮窗直接落库用；db 是 MainForm 的私有字段，浮窗不是它的内部类，得开个口</summary>
        internal (bool ok, string err, int n) QuickSave(string kind, string text)
            => db.QuickCaptureSave(kind, text);

        internal Color UiPanel => _uiPanel;
        internal Color UiInk => _uiInk;
        internal Color UiLine => _uiLine;
        internal Color UiAccent => _uiAccent;
        internal bool UiDark => _uiDark;

        /// <summary>
        /// 浮窗当前状态。加这个是因为浮窗 ShowInTaskbar=false，
        /// 从外面（EnumWindows / MainWindowTitle）根本看不见它，
        /// 排障时只能靠猜。有了这条 RPC，测试脚本能直接断言。
        /// </summary>
        internal object QuickState()
        {
            var alive = _quickNote != null && !_quickNote.IsDisposed;
            return new
            {
                ok = true,
                exists = alive,
                visible = alive && _quickNote.Visible,
                kind = alive ? _quickNote.Kind : "",
                mainVisible = Visible,
                // 位置和尺寸也报出来：光看 visible=true 不能证明它没弹到屏幕外面
                bounds = alive ? new
                {
                    x = _quickNote.Left, y = _quickNote.Top,
                    w = _quickNote.Width, h = _quickNote.Height,
                } : null,
                screen = System.Windows.Forms.Screen.PrimaryScreen.WorkingArea.Width + "x"
                       + System.Windows.Forms.Screen.PrimaryScreen.WorkingArea.Height,
                input = alive ? _quickNote.InputText : "",
            };
        }

        /// <summary>热键 / 托盘 / 悬浮球统一入口：先看是不是该走浮窗，不是再交给主窗口。</summary>
        private void QuickCapture(string kind)
        {
            try
            {
                if (_quickNote == null || _quickNote.IsDisposed) _quickNote = new QuickNoteForm(this, kind);
                else _quickNote.SetKind(kind);
                _quickNote.ShowNear();
                Diag.Info("quick", $"浮窗已弹出 kind={kind} visible={_quickNote.Visible} mainVisible={Visible}");
            }
            catch (Exception ex)
            {
                Diag.Error("quick", "浮窗打不开，退回主窗口", ex);
                HostCmd("quick:" + kind);
            }
        }

        /// <summary>
        /// 浮窗关闭后刷新前端（如果主窗口正好是打开的），
        /// 不然用户切回日签会看到「刚加的待办不在列表里」。
        /// </summary>
        internal void QuickAfterSave(string kind)
        {
            try
            {
                if (!Visible) return;
                var js = kind == "todo" ? "window.__RELOAD_TODOS__ && window.__RELOAD_TODOS__();"
                       : kind == "note" ? "window.__RELOAD_NOTES__ && window.__RELOAD_NOTES__();"
                       : "window.__HOST_CMD__ && window.__HOST_CMD__('nav:home');";
                _ = web.CoreWebView2?.ExecuteScriptAsync(js);
            }
            catch (Exception ex) { Diag.Warn("quick", "保存后通知前端失败：" + ex.Message); }
        }
    }

    /// <summary>极简的快捷记录浮窗。见 <see cref="MainForm.QuickCapture"/> 的说明。</summary>
    internal sealed class QuickNoteForm : Form
    {
        private readonly MainForm _owner;
        private string _kind;

        /// <summary>当前模式，给 MainForm.QuickState 用</summary>
        internal string Kind => _kind;

        /// <summary>已输入但还没存的内容，测试和排障都用得上</summary>
        internal string InputText => _input.Text;
        private readonly Label _tip = new Label();
        private readonly TextBox _input = new TextBox();
        private readonly Label _foot = new Label();
        private readonly Panel _body = new Panel();
        private bool _saved;

        private const int Radius = 12;

        /** 三种模式共用一套窗口，只换提示语和保存动作 */
        private static readonly Dictionary<string, (string title, string hint)> Kinds =
            new Dictionary<string, (string, string)>
            {
                ["todo"] = ("记一条待办", "回车加一条 · 可以连着敲 · Esc 收起"),
                ["note"] = ("记一条笔记", "回车存进备忘录 · Esc 收起"),
                ["diary"] = ("写进今天", "回车追加到今天的正文末尾 · Esc 收起"),
            };

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x00000080;   // WS_EX_TOOLWINDOW：不占任务栏、不出现在 Alt+Tab 里
                return cp;
            }
        }

        public QuickNoteForm(MainForm owner, string kind)
        {
            _owner = owner;
            _kind = Kinds.ContainsKey(kind) ? kind : "todo";

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(430, 150);
            DoubleBuffered = true;
            Padding = new Padding(1);
            KeyPreview = true;

            BuildUi();
            ApplyTheme();
            SetKind(_kind);

            Deactivate += (s, e) =>
            {
                // 失焦就把已经敲下的字存掉，再退 —— 不让人白敲
                if (!_saved && !string.IsNullOrWhiteSpace(_input.Text)) Save();
                Hide();
                Diag.Info("quick", "浮窗失焦收起");
            };
        }

        private void BuildUi()
        {
            _body.Dock = DockStyle.Fill;
            _body.Padding = new Padding(16, 12, 16, 8);

            _tip.Dock = DockStyle.Top;
            _tip.Height = 22;
            _tip.Font = new Font("Microsoft YaHei", 9.5f, FontStyle.Bold);

            _foot.Dock = DockStyle.Bottom;
            _foot.Height = 18;
            _foot.Font = new Font("Microsoft YaHei", 8f);
            _foot.TextAlign = ContentAlignment.MiddleLeft;

            _input.Dock = DockStyle.Top;
            _input.Multiline = true;
            _input.Height = 62;
            _input.BorderStyle = BorderStyle.FixedSingle;
            _input.Font = new Font("Microsoft YaHei", 10.5f);
            _input.ScrollBars = ScrollBars.Vertical;

            var gap = new Panel { Dock = DockStyle.Top, Height = 8 };

            _body.Controls.Add(_foot);
            _body.Controls.Add(gap);
            _body.Controls.Add(_input);
            _body.Controls.Add(_tip);
            Controls.Add(_body);

            _input.KeyDown += (s, e) =>
            {
                // 回车保存；Shift+回车让用户自己换行（多行待办靠这个）
                if (e.KeyCode == Keys.Enter && !e.Modifiers.HasFlag(Keys.Shift)) { e.SuppressKeyPress = true; Save(); }
                else if (e.KeyCode == Keys.Escape) { Hide(); e.Handled = true; Diag.Info("quick", "浮窗 Esc 收起"); }
            };
        }

        private void ApplyTheme()
        {
            try
            {
                var panel = _owner.UiPanel;
                var ink = _owner.UiInk;
                var dark = _owner.UiDark;

                BackColor = panel;
                _body.BackColor = panel;
                _tip.BackColor = panel;
                _foot.BackColor = panel;
                _tip.ForeColor = ink;
                _foot.ForeColor = Blend(ink, panel, 0.42);
                _input.BackColor = dark ? Blend(panel, Color.White, 0.06) : Blend(panel, Color.Black, 0.03);
                _input.ForeColor = ink;
            }
            catch { /* 主题取不到就用系统默认，能用就行 */ }
        }

        public void SetKind(string kind)
        {
            if (!Kinds.ContainsKey(kind)) return;
            _kind = kind;
            var k = Kinds[kind];
            _tip.Text = k.title;
            _foot.Text = k.hint;
            _foot.ForeColor = Blend(_owner.UiInk, _owner.UiPanel, 0.42);
            _input.Text = "";
            _saved = false;
        }

        /// <summary>冒在鼠标旁边；下面放不下就翻到上面。</summary>
        public void ShowNear()
        {
            var cursor = Cursor.Position;
            var wa = Screen.FromPoint(cursor).WorkingArea;
            var x = Math.Min(Math.Max(cursor.X - Width / 2, wa.Left + 12), wa.Right - Width - 12);
            var y = cursor.Y + 18;
            if (y + Height > wa.Bottom - 12) y = cursor.Y - Height - 18;
            Location = new Point(x, Math.Max(wa.Top + 12, y));

            Show();
            Activate();
            BringToFront();
            _input.Focus();
            _input.SelectionStart = _input.TextLength;
        }

        private void Save()
        {
            var text = _input.Text;
            if (string.IsNullOrWhiteSpace(text)) { Hide(); return; }
            try
            {
                var r = _owner.QuickSave(_kind, text);
                if (!r.ok)
                {
                    _foot.Text = "没存上：" + (r.err ?? "未知原因");
                    _foot.ForeColor = _owner.UiAccent;
                    return;
                }
                _saved = true;
                _owner.QuickAfterSave(_kind);

                if (_kind == "todo")
                {
                    // 待办是「连敲」场景，存完留在原地继续
                    _input.Text = "";
                    _saved = false;
                    _foot.Text = r.n > 1 ? $"已加 {r.n} 条 · 继续敲，Esc 结束" : "已加一条 · 继续敲，Esc 结束";
                    _foot.ForeColor = _owner.UiAccent;
                    _input.Focus();
                }
                else
                {
                    _foot.Text = "已保存";
                    _foot.ForeColor = _owner.UiAccent;
                    Hide();
                }
            }
            catch (Exception ex)
            {
                Diag.Error("quick", "浮窗保存失败", ex);
                _foot.Text = "保存出错，详见日志";
                _foot.ForeColor = _owner.UiAccent;
            }
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

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            // 圆角区域裁掉了外框，边缘得自己描一圈，否则和桌面糊在一起分不清边界
            using var pen = new Pen(_owner.UiLine);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.DrawPath(pen, Round(new Rectangle(0, 0, Width - 1, Height - 1), Radius));
        }
    }
}