using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// 第 42 条：桌面常驻便签（Simple Sticky Notes 那一类）。
    ///
    /// 用户原话是「关于第 41 条的后半截，希望你能够进行联网查询，查询『simple sticky note』…」，
    /// 也就是希望像那些便签软件一样：**桌面上钉着几张小便签，一直在那儿，随时写两笔**。
    ///
    /// 和已有的「快捷浮窗」(QuickNoteForm) 的区别：
    ///   · 快捷浮窗是「记一笔就走」—— 无输入就失焦消失，不保存窗口状态；
    ///   · 便签是「一直钉在桌面上」—— 不抢焦点、不占任务栏、不随主窗口隐藏，
    ///     内容实时写进 notes 表（还是同一批笔记，不是另一套数据）。
    ///
    /// 关键实现点：
    ///   · WS_EX_NOACTIVATE + ShowWithoutActivation：点它不把焦点从正在用的软件抢走；
    ///   · 双击标题栏 / 拖动标题栏可以挪位置，位置按便签 id 记在 meta 里，重启还在原地；
    ///   · 三档尺寸（小 / 中 / 大），字号跟着变，就是便签本来的样子；
    ///   · 失焦不关闭（和快捷浮窗相反），只有点 × 才关。
    /// </summary>
    public partial class MainForm
    {
        /// <summary>当前钉在桌面上的便签：noteId → 窗口</summary>
        private readonly Dictionary<string, StickyForm> _stickies = new Dictionary<string, StickyForm>();

        /// <summary>把一篇笔记钉到桌面（已经在钉就前置一下）</summary>
        internal object StickyOpen(string noteId)
        {
            if (string.IsNullOrWhiteSpace(noteId)) return new { ok = false, err = "没指定笔记" };
            var rows = db.NoteGet(noteId) as dynamic;
            if (rows == null) return new { ok = false, err = "笔记不存在" };

            if (_stickies.TryGetValue(noteId, out var old) && old != null && !old.IsDisposed)
            {
                old.Show();
                old.BringToFront();
                return new { ok = true, already = true };
            }

            try
            {
                var f = new StickyForm(this, noteId);
                _stickies[noteId] = f;
                f.FormClosed += (s, e) => { _stickies.Remove(noteId); };
                f.Show();
                return new { ok = true, n = _stickies.Count };
            }
            catch (Exception ex)
            {
                Diag.Error("sticky", "便签打不开 noteId=" + noteId, ex);
                return new { ok = false, err = "便签打不开：" + ex.Message };
            }
        }

        internal object StickyClose(string noteId)
        {
            if (_stickies.TryGetValue(noteId ?? "", out var f) && f != null && !f.IsDisposed) f.Close();
            return new { ok = true, n = _stickies.Count };
        }

        /// <summary>当前钉了几张、分别是谁 —— 前端据此把「已钉」标出来</summary>
        internal object StickyList()
        {
            var list = _stickies.Where(kv => kv.Value != null && !kv.Value.IsDisposed)
                .Select(kv => new { id = kv.Key, visible = kv.Value.Visible })
                .ToList();
            return new { ok = true, items = list, n = list.Count };
        }

        /// <summary>便签保存：直接落 notes 表，和笔记页共用一份数据</summary>
        internal void StickySave(string noteId, string title, string body)
        {
            try
            {
                var cur = db.NoteGet(noteId) as dynamic;
                if (cur == null) return;
                // 只改标题和正文；笔记本 / 置顶 / 颜色 / 图标一律保持原样（传 null 表示不动）
                db.NoteSave(noteId, (string)cur.notebookId, title, body, (int)cur.pinned, null, null);
                // 主窗口开着的话顺手刷一下，不然刚在便签里写的东西笔记页看不到
                if (Visible) _ = web.CoreWebView2?.ExecuteScriptAsync("window.__RELOAD_NOTES__ && window.__RELOAD_NOTES__();");
            }
            catch (Exception ex) { Diag.Warn("sticky", "便签保存失败：" + ex.Message); }
        }

        /* 便签是独立 Form（不是 MainForm 的内部类），拿不到私有字段，开几个只读口子 */
        internal object StickyNoteGet(string id) => db.NoteGet(id);
        internal string StickyMeta(string k, string def = "") => db.GetSetting(k, def);
        internal void StickyMetaSet(string k, string v) => db.SettingSet(k, v);
        /// <summary>当前钉着的便签数量，给新便签算一个不重叠的初始位置</summary>
        internal int StickyCount => _stickies.Count;
    }

    /// <summary>
    /// 一张桌面便签。无边框、不抢焦点、不占任务栏、永远置顶。
    /// </summary>
    internal sealed class StickyForm : Form
    {
        private readonly MainForm _owner;
        private readonly string _noteId;

        private readonly Panel _bar = new Panel();
        private readonly TextBox _title = new TextBox();
        private readonly TextBox _body = new TextBox();
        private readonly Label _hint = new Label();
        private readonly Button _close = new Button();
        private readonly Button _size = new Button();

        private bool _drag;
        private Point _grab;
        private bool _dirty;
        private readonly System.Windows.Forms.Timer _autoSave = new System.Windows.Forms.Timer { Interval = 900 };
        private int _sizeStep;           // 0 小 / 1 中 / 2 大

        private const int Radius = 10;

        /// <summary>不抢焦点：点便签不会把你正在打的字中断</summary>
        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x08000000;   // WS_EX_NOACTIVATE
                cp.ExStyle |= 0x00000080;   // WS_EX_TOOLWINDOW：不占任务栏
                return cp;
            }
        }

        internal StickyForm(MainForm owner, string noteId)
        {
            _owner = owner;
            _noteId = noteId;

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;              // 便签就该一直看得见
            DoubleBuffered = true;
            BackColor = Color.FromArgb(255, 249, 219);   // 便签黄
            MinimumSize = new Size(180, 140);

            /*
             * 位置：按 noteId 记在 meta 里。
             * 用 noteId 当键而不是序号，这样删掉一张便签不会把别人的位置挤乱。
             */
            var saved = owner.StickyMeta("sticky.pos." + noteId, "");
            var (w, h) = SizeOf(_sizeStep);
            Size = new Size(w, h);
            var wa = Screen.PrimaryScreen.WorkingArea;
            if (TryParsePos(saved, out var pos) && wa.Contains(new Rectangle(pos, new Size(60, 40))))
                Location = pos;
            else
                Location = new Point(
                    wa.Right - w - 28 - (owner.StickyCount % 5) * 26,
                    wa.Bottom - h - 28 - (owner.StickyCount % 5) * 26);

            BuildUi();
            LoadNote(owner, noteId);
            _autoSave.Tick += (s, e) => Flush();
            _autoSave.Start();
        }

        private static (int w, int h) SizeOf(int step) => step switch
        {
            0 => (230, 176),
            2 => (360, 300),
            _ => (290, 230),
        };

        private static bool TryParsePos(string s, out Point p)
        {
            p = Point.Empty;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var parts = s.Split(',');
            if (parts.Length != 2) return false;
            if (!int.TryParse(parts[0], out var x) || !int.TryParse(parts[1], out var y)) return false;
            p = new Point(x, y);
            return true;
        }

        private void BuildUi()
        {
            _bar.Dock = DockStyle.Top;
            _bar.Height = 26;
            _bar.BackColor = Color.FromArgb(247, 236, 190);
            _bar.Cursor = Cursors.SizeAll;
            _bar.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) { _drag = false; _grab = e.Location; } };
            _bar.MouseMove += (s, e) =>
            {
                if (e.Button != MouseButtons.Left) return;
                if (!_drag && Math.Abs(e.X - _grab.X) + Math.Abs(e.Y - _grab.Y) > 3) _drag = true;
                if (_drag) Location = new Point(Location.X + e.X - _grab.X, Location.Y + e.Y - _grab.Y);
            };
            _bar.MouseUp += (s, e) =>
            {
                if (!_drag) return;
                _drag = false;
                Remember();
            };
            // 双击标题栏换个尺寸 —— 便签最常用的操作就是「太小了 / 太占地方」
            _bar.DoubleClick += (s, e) => CycleSize();

            _close.Text = "×";
            _close.FlatStyle = FlatStyle.Flat;
            _close.FlatAppearance.BorderSize = 0;
            _close.Size = new Size(22, 22);
            _close.Location = new Point(Width - 26, 2);
            _close.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _close.ForeColor = Color.FromArgb(120, 108, 74);
            _close.Cursor = Cursors.Hand;
            _close.Click += (s, e) => Close();
            _close.MouseEnter += (s, e) => _close.ForeColor = Color.FromArgb(190, 46, 38);
            _close.MouseLeave += (s, e) => _close.ForeColor = Color.FromArgb(120, 108, 74);

            _size.Text = "⤢";
            _size.FlatStyle = FlatStyle.Flat;
            _size.FlatAppearance.BorderSize = 0;
            _size.Size = new Size(22, 22);
            _size.Location = new Point(Width - 50, 2);
            _size.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            _size.ForeColor = Color.FromArgb(120, 108, 74);
            _size.Cursor = Cursors.Hand;
            _size.Click += (s, e) => CycleSize();

            // 无边框窗口上按钮不接收点击，必须手工 SetStyle（Comctl32 的已知行为）
            _close.SetStyle(ControlStyles.Selectable, false);
            _size.SetStyle(ControlStyles.Selectable, false);

            _title.BorderStyle = BorderStyle.None;
            _title.BackColor = Color.FromArgb(255, 249, 219);
            _title.ForeColor = Color.FromArgb(44, 38, 24);
            _title.Font = new Font("Microsoft YaHei UI", 10.5f, FontStyle.Bold);
            _title.Dock = DockStyle.Top;
            _title.Height = 30;
            _title.TextChanged += (s, e) => _dirty = true;

            _body.BorderStyle = BorderStyle.None;
            _body.BackColor = Color.FromArgb(255, 249, 219);
            _body.ForeColor = Color.FromArgb(58, 50, 32);
            _body.Font = new Font("Microsoft YaHei UI", 10f);
            _body.Multiline = true;
            _body.ScrollBars = ScrollBars.Vertical;
            _body.AcceptsReturn = true;
            _body.Dock = DockStyle.Fill;
            _body.TextChanged += (s, e) => _dirty = true;

            _hint.Dock = DockStyle.Bottom;
            _hint.Height = 20;
            _hint.TextAlign = ContentAlignment.MiddleRight;
            _hint.Font = new Font("Microsoft YaHei UI", 8.5f);
            _hint.ForeColor = Color.FromArgb(150, 138, 100);
            _hint.Text = "写点就自动存";

            Controls.Add(_body);
            Controls.Add(_title);
            Controls.Add(_hint);
            Controls.Add(_bar);
            _bar.Controls.Add(_size);
            _bar.Controls.Add(_close);
            _bar.BringToFront();

            ApplyFontScale();
        }

        private void ApplyFontScale()
        {
            var k = _sizeStep switch { 0 => 0.9f, 2 => 1.2f, _ => 1f };
            _title.Font = new Font("Microsoft YaHei UI", 10.5f * k, FontStyle.Bold);
            _body.Font = new Font("Microsoft YaHei UI", 10f * k);
        }

        private void CycleSize()
        {
            _sizeStep = (_sizeStep + 1) % 3;
            var (w, h) = SizeOf(_sizeStep);
            // 从右下角往回收：保持左上角不动，视觉上像「一张纸变大」
            Size = new Size(w, h);
            ApplyFontScale();
            Remember();
        }

        private void LoadNote(MainForm owner, string noteId)
        {
            try
            {
                var cur = owner.StickyNoteGet(noteId) as dynamic;
                if (cur == null) { _title.Text = "(笔记不存在)"; return; }
                Text = (string)cur.title ?? "";
                _title.Text = string.IsNullOrWhiteSpace(Text) ? "无标题" : Text;
                // 便签里只放纯文本：正文是富文本 HTML，直接塞进 TextBox 会满屏尖括号
                _body.Text = (string)cur.plain ?? "";
                _dirty = false;
            }
            catch (Exception ex) { Diag.Warn("sticky", "便签读取失败：" + ex.Message); }
        }

        private void Flush()
        {
            if (!_dirty) return;
            _dirty = false;
            var t = _title.Text == "无标题" ? "" : _title.Text;
            // 便签写的是纯文本，转义后再包一层段落，避免 < > 被当成标签
            var html = "<p>" + System.Net.WebUtility.HtmlEncode(_body.Text ?? "").Replace("\r\n", "<br>").Replace("\n", "<br>") + "</p>";
            _owner.StickySave(_noteId, t, html);
            _hint.Text = "已存 " + DateTime.Now.ToString("HH:mm:ss");
        }

        /// <summary>把当前位置写回 meta，重启后还在原地</summary>
        private void Remember()
        {
            try { _owner.StickyMetaSet("sticky.pos." + _noteId, $"{Left},{Top}"); }
            catch { /* 位置记不住不影响用 */ }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var b = new SolidBrush(BackColor);
            g.FillRectangle(b, ClientRectangle);
            using var p = new Pen(Color.FromArgb(226, 210, 158));
            g.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            using (var path = Round(new Rectangle(0, 0, Width, Height), Radius))
                Region = new Region(path);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (WindowState == FormWindowState.Minimized) return;
            try
            {
                using var path = Round(new Rectangle(0, 0, Width, Height), Radius);
                Region = new Region(path);
            }
            catch { }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            Flush();
            Remember();
            _autoSave.Stop();
            _autoSave.Dispose();
            base.OnFormClosing(e);
        }

        private static GraphicsPath Round(Rectangle r, int radius)
        {
            var p = new GraphicsPath();
            var d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }

    /// <summary>给 Button 补一个 SetStyle（Control.SetStyle 是 protected）</summary>
    internal static class StickyControlExt
    {
        public static void SetStyle(this Control c, ControlStyles flag, bool value)
        {
            // 通过反射调 protected 方法，避免为两个按钮写一整个自定义控件类
            var mi = typeof(Control).GetMethod("SetStyle",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            mi?.Invoke(c, new object[] { flag, value });
        }
    }
}