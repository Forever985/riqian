using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Riqian
{
    /// <summary>
    /// v7 宿主扩展：托盘、右下角提醒窗、系统通知、缓存与安全相关 RPC。
    /// </summary>
    public partial class MainForm
    {
        private NotifyIcon tray;
        private ToastForm toast;
        private bool reallyExit;
        private long _lastToastTest;

        /* ================= 托盘 ================= */

        private void InitTray()
        {
            try
            {
                if (tray != null) return;
                var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
                var menu = new ContextMenuStrip();
                menu.Items.Add("打开日签", null, (s, e) => ShowMain());
                menu.Items.Add("专注 25 分钟", null, (s, e) => StartPomoFromTray(25));
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("退出", null, (s, e) => QuitApp());

                menu.Font = new System.Drawing.Font("Microsoft YaHei UI", 9.25f);
                menu.Padding = new Padding(5, 6, 5, 6);
                menu.ShowImageMargin = false;
                tray = new NotifyIcon
                {
                    Icon = icon,
                    Visible = true,
                    Text = "日签 · 打卡日记本",
                    ContextMenuStrip = menu,
                };
                ApplyTrayTheme();
                tray.DoubleClick += (s, e) => ShowMain();
            }
            catch (Exception ex) { Diag.Error("dispatch.v7", "v7 分发失败", ex); }
        }

        private void ShowMain()
        {
            try
            {
                /*
                 * 用户报的「又莫名其妙弹出来这个记事本了」，根子就在这里。
                 *
                 * 老板键（ToggleBoss）做的是：Hide() 主窗 → 显示一个标题为「记事本」的伪装窗。
                 * 但 ShowMain 只 Show() 主窗，**从来没检查过老板键是不是还开着**，
                 * 于是从托盘「打开日签」/ 双击托盘图标 / 点悬浮球 / 按唤出热键这几条路进来的话，
                 * 结果是：主窗回来了，伪装窗也还在，而且它最后被 Activate() 过，压在桌面最前面。
                 * 用户看到的就是「凭空又多了一个记事本」，关掉它主窗又跟着消失 —— 越点越乱。
                 *
                 * 正确语义：任何「把日签叫出来」的动作，都意味着退出伪装状态。
                 */
                if (_bossOn || (_disguise != null && !_disguise.IsDisposed && _disguise.Visible))
                {
                    _bossOn = false;
                    try { if (_disguise != null && !_disguise.IsDisposed) _disguise.Hide(); } catch { }
                    Diag.Info("boss", "从其它入口唤回主窗，已自动退出伪装");
                }

                Show();
                WindowState = FormWindowState.Normal;
                Activate();
                BringToFront();
            }
            catch { }
        }

        /// <summary>
        /// 托盘「退出」走这里。
        ///
        /// ⚠️ 这里必须自己跑一遍 GracefulShutdownAsync，不能指望 OnClosing：
        /// 它第一行就是 `if (reallyExit) return;`，而这里正要先置 reallyExit。
        /// 以前就是这么漏的 —— 从托盘退出时 db 从来没被 Dispose 过，
        /// WAL 也就从来没 checkpoint 过。
        ///
        /// `async void` 在这里可接受（事件处理器的终点，没人 await 它），
        /// 但整段必须自己 try/catch，否则异常会直接冒到全局处理器弹框。
        /// </summary>
        private async void QuitApp()
        {
            try
            {
                if (closing) { Close(); return; }   // 另一条路径已在关，别关两遍

                closing = true;
                reallyExit = true;
                try { tray.Visible = false; tray.Dispose(); } catch { }

                await GracefulShutdownAsync();
                Close();
            }
            catch (Exception ex)
            {
                Diag.Error("app.exit", "退出过程中出错", ex);
                try { Close(); } catch { }
            }
        }

        private async void StartPomoFromTray(int minutes)
        {
            ShowMain();
            try { await web.CoreWebView2.ExecuteScriptAsync($"window.__POMO_START__ && window.__POMO_START__({minutes});"); }
            catch { }
        }

        /// <summary>是否最小化到托盘（读设置，失败时默认开）。</summary>
        private bool TrayEnabled
        {
            get
            {
                try
                {
                    var s = db.SettingsAll() as Dictionary<string, string>;
                    if (s != null && s.TryGetValue("minimizeToTray", out var v)) return v == "1";
                    return true;
                }
                catch { return false; }
            }
        }

        private async System.Threading.Tasks.Task HideToTray()
        {
            try
            {
                if (web.CoreWebView2 != null)
                    await web.CoreWebView2.ExecuteScriptAsync("window.__FLUSH__ && window.__FLUSH__();");
                await System.Threading.Tasks.Task.Delay(150);
            }
            catch { }
            Hide();
            try
            {
                if (tray != null)
                    // 第 85 条：这个气泡每次最小化都弹，用户嫌烦 —— 给个开关，默认开
                    if (Get(Settings(), "minimizeTip", "1") == "1")
                        tray.ShowBalloonTip(2200, "日签还在运行", "点托盘图标可以回来。番茄钟到点仍会提醒。", ToolTipIcon.Info);
            }
            catch { }
        }

        /* ================= 提醒 ================= */

        private object NotifyPush(JsonElement a)
        {
            string title = S(a, "title", "提醒");
            string body = S(a, "body", "");
            string kind = S(a, "kind", "info");
            int sec = I(a, "duration", 0);
            if (sec <= 0)
            {
                var ss = db.SettingsAll() as Dictionary<string, string>;
                sec = ss != null && ss.TryGetValue("notifyDuration", out var d) && int.TryParse(d, out var n) ? n : 8;
            }

            var st = db.SettingsAll() as Dictionary<string, string> ?? new Dictionary<string, string>();
            bool desktop = !st.ContainsKey("notifyDesktop") || st["notifyDesktop"] == "1";
            bool trayOn = st.ContainsKey("notifyTray") && st["notifyTray"] == "1";

            // 第 143 条：单条提醒可以覆盖全局开关。desktop / tray 传 -1（或不传）就跟随设置，
            // 传 0/1 就强制关/开 —— 「只弹窗」的提醒不该因为用户关了托盘气泡而不弹。
            int dOv = I(a, "desktop", -1);
            int tOv = I(a, "tray", -1);
            if (dOv >= 0) desktop = dOv == 1;
            if (tOv >= 0) trayOn = tOv == 1;

            if (desktop) ShowToast(title, body, kind, sec);
            if (trayOn && tray != null)
            {
                try { tray.ShowBalloonTip(4000, title, body, kind == "error" ? ToolTipIcon.Error : ToolTipIcon.Info); }
                catch { }
            }
            return new { ok = true, desktop, tray = trayOn };
        }

        private void ShowToast(string title, string body, string kind, int seconds, bool topmost = true)
        {
            try
            {
                // 第 71 条：桌面提醒窗停留多久，设置里可调（应用内那条小提示是另一项 toastMs）
                if (int.TryParse(Get(Settings(), "notifyDuration", "8"), out var cfgSec) && cfgSec > 0)
                    seconds = cfgSec;
                if (toast != null && !toast.IsDisposed) { toast.Close(); toast = null; }
                toast = new ToastForm(title, body, kind, Math.Max(2, seconds), () => ShowMain(), topmost);
                toast.Show();
            }
            catch (Exception ex) { Diag.Error("dispatch.v7", "v7 分发失败", ex); }
        }

        /* ================= 缓存目录 ================= */

        private string CacheDir
        {
            get
            {
                var d = Path.Combine(db.Root, "缓存");
                Directory.CreateDirectory(d);
                return d;
            }
        }

        /* ================= RPC 分发 ================= */

        /// <summary>
        /// 可用工作区尺寸。
        ///
        /// 单独包一层是因为它原来是
        /// <c>Screen.PrimaryScreen.WorkingArea.Width</c> 直接写在 case 里 ——
        /// Screen 是 WinForms 专有的，安卓那边没有对应概念（那边是整屏）。
        /// 放进 IShell 会让接口变胖（只为这一个返回值），所以留在壳这一侧，
        /// 由各自的 partial 提供。安卓版见 android\MainFormAndroid.cs。
        /// </summary>
        private object ScreenInfo()
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            return new { w = wa.Width, h = wa.Height };
        }

        /// <summary>返回 null 表示不归这里管，交回主 switch。</summary>
        /* V7Dispatch 已搬到 RpcDispatcher.cs（桌面与安卓共用同一份实现），见该文件。 */

        /* ================= 音乐导入 ================= */

        private object MusicImport()
        {
            using var dlg = new OpenFileDialog
            {
                Title = "选择音频或视频（视频只播放声音）",
                Filter = "音频/视频|*.mp3;*.m4a;*.wav;*.ogg;*.flac;*.aac;*.mp4;*.mkv;*.webm;*.mov|所有文件|*.*",
                Multiselect = true,
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return new { ok = false, items = new object[0] };
            var items = new List<object>();
            foreach (var f in dlg.FileNames)
            {
                try { items.Add(db.MediaImportPath(f)); }
                catch (Exception e) { items.Add(new { ok = false, err = e.Message, name = Path.GetFileName(f) }); }
            }
            return new { ok = true, items };
        }

        private object ExportNote(string id)
        {
            var n = db.NoteGet(id);
            var t = n.GetType();
            var title = (string)t.GetProperty("title").GetValue(n);
            var body = (string)t.GetProperty("body").GetValue(n);
            Directory.CreateDirectory(db.ExportDir);
            var safe = string.Join("_", (title ?? "笔记").Split(Path.GetInvalidFileNameChars()));
            var path = Path.Combine(db.ExportDir, (string.IsNullOrWhiteSpace(safe) ? "笔记" : safe) + ".html");
            var html = "<!DOCTYPE html><meta charset=\"utf-8\"><title>" + System.Net.WebUtility.HtmlEncode(title) +
                       "</title><body style=\"max-width:720px;margin:40px auto;font:16px/1.9 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#26221d\"><h1>" +
                       System.Net.WebUtility.HtmlEncode(title) + "</h1>" + body + "</body>";
            File.WriteAllText(path, html, Encoding.UTF8);
            return new { ok = true, path };
        }
    }

    /* ==================================================================
       右下角提醒窗：无边框、置顶、淡入淡出、点击回到主窗口
       —— 不用 Windows Toast，因为 Toast 需要注册 AppUserModelID 与快捷方式，
          在单文件便携 exe 下不可靠；自绘窗反而能控制样式、时长与点击行为。
       ================================================================== */
    internal class ToastForm : Form
    {
        private readonly string _title, _body, _kind;
        private readonly int _seconds;
        private readonly Action _onClick;
        private readonly bool _topmost;
        private readonly System.Windows.Forms.Timer _life = new System.Windows.Forms.Timer();
        private readonly System.Windows.Forms.Timer _fade = new System.Windows.Forms.Timer();
        private int _left;
        private bool _closing;

        private const int W = 360, H = 116;

        protected override bool ShowWithoutActivation => true;
        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x08000000;   // WS_EX_NOACTIVATE：不抢焦点
                cp.ExStyle |= 0x00000080;   // WS_EX_TOOLWINDOW：不占任务栏
                return cp;
            }
        }

        public ToastForm(string title, string body, string kind, int seconds, Action onClick, bool topmost = true)
        {
            _title = title; _body = body; _kind = kind; _seconds = seconds; _onClick = onClick; _topmost = topmost;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = topmost;
            BackColor = Color.FromArgb(250, 247, 240);
            DoubleBuffered = true;
            Opacity = 0;

            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - W - 18, wa.Bottom - H - 18);
            Size = new Size(W, H);
            _left = _seconds;

            _life.Interval = 1000;
            _life.Tick += (s, e) =>
            {
                /*
                 * 必须先确认窗体还活着。
                 *
                 * 这个 tick 会调 Invalidate()，而它是要 Handle 的 —— 窗体已经
                 * 被 Close()/Dispose() 之后调就是 ObjectDisposedException。
                 * 定时器不会因为窗体释放而自动停（见下面 Dispose 的注释），
                 * 所以这道判断是必须的，不是防御性冗余。
                 */
                if (!Alive()) { _life.Stop(); return; }
                _left--;
                Invalidate();
                if (_left <= 0) FadeOut();
            };
            _fade.Interval = 16;
            _fade.Tick += (s, e) =>
            {
                /*
                 * 这里是 **11-02 / 11-09 / 11-10 三次界面线程崩溃的现场**。
                 *
                 * 堆栈特征：set_Opacity → get_Handle → CreateHandle → ObjectDisposedException
                 * "Object name: 'Riqian.ToastForm'"。
                 *
                 * 触发条件：提醒窗正在淡入（约 130 ms）时被关掉 ——
                 * 用户点了它，或者紧接着又来了一个提醒（ShowToast 会关掉上一个）。
                 * 窗体的 Handle 没了，_fade 定时器却还在按 16 ms 一跳，
                 * 下一跳就去 set_Opacity，于是崩在界面线程上、弹一个警告框。
                 *
                 * 修法两条：① 这里先判 Alive()；② Dispose 里把定时器停掉并释放。
                 * 只做其中一条都还会漏 —— 判活管"关掉之后的下一跳"，
                 * 释放管"定时器本身别继续占着消息循环"。
                 */
                if (!Alive()) { _fade.Stop(); return; }

                if (_closing)
                {
                    // 先算再赋值：算出来已经到 0 就不必再写一次属性（写属性才会碰 Handle）
                    var next = Opacity - 0.12;
                    if (next <= 0.02) { _fade.Stop(); SafeClose(); }
                    else Opacity = next;
                }
                else
                {
                    var next = Opacity + 0.12;
                    if (next >= 0.98) { Opacity = 0.98; _fade.Stop(); }
                    else Opacity = next;
                }
            };

            Click += (s, e) => { _onClick?.Invoke(); SafeClose(); };
            foreach (Control c in Controls) c.Click += (s, e) => { _onClick?.Invoke(); SafeClose(); };
        }

        /// <summary>窗体还活着吗。IsDisposed 和 Disposing 两个都要看 ——
        /// Dispose 过程中 IsDisposed 还是 false，但 Handle 已经不能碰了。</summary>
        private bool Alive() => !IsDisposed && !Disposing;

        /// <summary>
        /// 两个定时器是否还在跑。**只给自检用**（ToastSelfTest）。
        ///
        /// 为什么需要这个可见性：从外面「连发两个提醒」复现那个
        /// ObjectDisposedException 试了二十轮一次没中 —— 要撞上
        /// 「IsDisposed 已为 true、Handle 还没清」那几十毫秒，概率太低。
        /// 与其留一个常年撞不到 bug 的绿测试，不如直接断言修复真正保证的事：
        /// **窗体关掉之后，定时器不该还在跑。**
        /// 这一条是确定性的：没停就是没停，骗不了人。
        /// </summary>
        internal bool TimersStillRunning => _life.Enabled || _fade.Enabled;

        private void SafeClose()
        {
            try { if (Alive()) Close(); } catch { }
        }

        /// <summary>
        /// 释放时把两个定时器停掉并扔掉。
        ///
        /// 为什么必须写：`System.Windows.Forms.Timer` **不会**因为宿主窗体被 Dispose
        /// 而自动停。它有自己的隐藏窗口，只要不 Stop 就继续按 16 ms 发 tick，
        /// 于是窗体没了、tick 还在跑 → 每次都在访问已释放对象。
        ///
        /// 顺带解决一个泄漏：Timer 不释放会一直占着一个原生窗口句柄。
        /// 提醒窗在一天里可能弹很多次，这个泄漏是累加的。
        /// </summary>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                try { _life.Stop(); _life.Dispose(); } catch { }
                try { _fade.Stop(); _fade.Dispose(); } catch { }
            }
            base.Dispose(disposing);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            _fade.Start();
            _life.Start();
        }

        private void FadeOut()
        {
            _closing = true;
            _life.Stop();
            _fade.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            var rect = new Rectangle(0, 0, W - 1, H - 1);
            using (var path = Round(rect, 12))
            {
                using (var b = new SolidBrush(Color.FromArgb(250, 247, 240))) g.FillPath(b, path);
                using (var p = new Pen(Color.FromArgb(228, 221, 206))) g.DrawPath(p, path);
            }

            // 左侧色条：区分专注 / 休息 / 提醒
            var accent = _kind == "break" ? Color.FromArgb(95, 130, 86)
                       : _kind == "error" ? Color.FromArgb(179, 72, 63)
                       : Color.FromArgb(184, 98, 58);
            using (var b = new SolidBrush(accent)) g.FillRectangle(b, 1, 14, 3, H - 28);

            using (var f = new Font("Microsoft YaHei", 10.5f, FontStyle.Bold))
            using (var b = new SolidBrush(Color.FromArgb(38, 34, 29)))
                g.DrawString(_title, f, b, new RectangleF(18, 14, W - 36, 24));

            using (var f = new Font("Microsoft YaHei", 9f))
            using (var b = new SolidBrush(Color.FromArgb(109, 100, 89)))
            {
                var fmt = new StringFormat { Trimming = StringTrimming.EllipsisCharacter };
                g.DrawString(_body, f, b, new RectangleF(18, 40, W - 36, 44), fmt);
            }

            // 剩余时间进度
            var ratio = _seconds <= 0 ? 0f : Math.Max(0f, (float)_left / _seconds);
            using (var b = new SolidBrush(Color.FromArgb(238, 233, 220))) g.FillRectangle(b, 18, H - 22, W - 36, 3);
            using (var b = new SolidBrush(accent)) g.FillRectangle(b, 18, H - 22, (int)((W - 36) * ratio), 3);

            using (var f = new Font("Microsoft YaHei", 7.5f))
            using (var b = new SolidBrush(Color.FromArgb(156, 147, 134)))
                g.DrawString("点击打开日签 · 悬停可继续停留", f, b, new PointF(W - 190, H - 40));
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

        protected override void OnMouseEnter(EventArgs e)
        {
            base.OnMouseEnter(e);
            _life.Stop();                 // 鼠标停在上面就不倒计时，避免"看到一半消失"
            _left = _seconds;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            _life.Start();
        }
    }
}
