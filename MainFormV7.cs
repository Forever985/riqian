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
                Show();
                WindowState = FormWindowState.Normal;
                Activate();
                BringToFront();
            }
            catch { }
        }

        private void QuitApp()
        {
            reallyExit = true;
            try { tray.Visible = false; tray.Dispose(); } catch { }
            Close();
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

        /// <summary>返回 null 表示不归这里管，交回主 switch。</summary>
        private object V7Dispatch(string m, JsonElement a)
        {
            /* ---- 提醒与窗口 ---- */
            if (m == "notify.push") return NotifyPush(a);
            if (m == "app.hide") { _ = HideToTray(); return new { ok = true }; }
            if (m == "app.quit") { QuitApp(); return new { ok = true }; }
            if (m == "app.minimize") { WindowState = FormWindowState.Minimized; return new { ok = true }; }
            if (m == "app.tray") { InitTray(); return new { ok = true }; }
            if (m == "app.screen") return new { w = Screen.PrimaryScreen.WorkingArea.Width, h = Screen.PrimaryScreen.WorkingArea.Height };

            /* ---- 音频试听（返回本地路径，前端用 <audio> 播） ---- */
            if (m == "notify.test")
            {
                // 连点不再叠窗：1.2 秒内只认一次；测试窗不置顶，免得盖住别的窗口让人以为 alt+tab 失效
                var now = Environment.TickCount64;
                if (now - _lastToastTest < 1200) return new { ok = true, skipped = true };
                _lastToastTest = now;
                ShowToast("日签 · 提醒测试", "如果你看到这个窗口，说明桌面提醒是通的。", "focus", 5, false);
                return new { ok = true };
            }

            /* ---- 备忘录 ---- */
            if (m == "habit.reorder")
            {
                var arr = a.TryGetProperty("ids", out var ia) && ia.ValueKind == JsonValueKind.Array
                    ? ia.EnumerateArray().Select(x => x.GetString()).ToArray()
                    : new string[0];
                return db.HabitReorder(arr);
            }
            if (m == "notebooks.list") return db.Notebooks();
            if (m == "notebook.add") return db.NotebookAdd(S(a, "name"), S(a, "color"));
            if (m == "notebook.update") return db.NotebookUpdate(S(a, "id"), S(a, "name"), S(a, "color"));
            if (m == "notebook.delete") return db.NotebookDelete(S(a, "id"));
            if (m == "notes.list") return db.Notes(S(a, "notebookId"), S(a, "q"), I(a, "limit", 300));
            if (m == "note.get") return db.NoteGet(S(a, "id"));
            if (m == "note.save") return db.NoteSave(S(a, "id"), S(a, "notebookId"), S(a, "title"), S(a, "body"), I(a, "pinned", 0),
                /* 第 128 条：颜色 / 图标。不传 = null，等于「这次别动」，自动保存不会把色点抹掉 */
                S(a, "color"), S(a, "icon"));
            if (m == "note.delete") return db.NoteDelete(S(a, "id"));
            if (m == "note.restore") return db.NoteRestore(S(a, "id"));
            if (m == "notes.trash") return db.NotesTrash();
            if (m == "export.note") return ExportNote(S(a, "id"));

            /* ---- 用户中心 ---- */
            if (m == "user.get") return db.UserGet();
            if (m == "user.save") return db.UserSave(S(a, "nickname"), S(a, "signature"), S(a, "avatar"),
                                                   S(a, "birthday"), S(a, "lunarBirthday"));

            /* ---- 密码 ---- */
            if (m == "vault.status") return db.VaultStatus();
            if (m == "vault.setMain") return db.VaultSetMain(S(a, "password"));
            if (m == "vault.clearMain") return db.VaultClearMain(S(a, "password"));
            if (m == "vault.add") return db.VaultAdd(S(a, "scope"), S(a, "target"), S(a, "label"), S(a, "password"));
            if (m == "vault.remove") return db.VaultRemove(S(a, "id"));
            if (m == "vault.check") return db.VaultCheck(S(a, "scope"), S(a, "target"));
            if (m == "vault.unlock") return db.VaultUnlock(S(a, "scope"), S(a, "target"), S(a, "password"), I(a, "minutes", 0));
            if (m == "vault.lock") return db.VaultLock();

            /* ---- 缓存 ---- */
            if (m == "cache.stats") return db.CacheStats();
            if (m == "cache.prune") return db.CachePrune(I(a, "days", 0), I(a, "maxMB", 0));
            if (m == "cache.clear") return db.CacheClear(S(a, "what", "cache"));
            if (m == "cache.open") { OpenPath(CacheDir); return new { ok = true }; }

            /* ---- 第 42 条：桌面常驻便签 ---- */
            if (m == "sticky.open") return StickyOpen(S(a, "id"));
            if (m == "sticky.close") return StickyClose(S(a, "id"));
            if (m == "sticky.list") return StickyList();

            /* ---- 设置导出导入 ---- */
            if (m == "settings.export") return db.SettingsExport();
            if (m == "settings.import") return db.SettingsImport(S(a, "json"));

            /* ---- 节日 ---- */
            if (m == "festival.upcoming") return db.FestivalsUpcoming(I(a, "days", 30));
            if (m == "festival.add") return db.FestivalAdd(S(a, "name"), S(a, "date"), I(a, "lunarMonth", 0), I(a, "lunarDay", 0));
            if (m == "festival.delete") return db.FestivalDelete(S(a, "id"));
            if (m == "festival.day") return db.DayFestival(S(a, "date"));
            if (m == "festival.month") return db.FestivalMonth(S(a, "ym"));
            if (m == "festival.lunar") return Festivals.LunarText(DateTime.Today);

            /* ---- 导出 HTML ---- */
            if (m == "export.html") return db.ExportHtml();

            /* ---- 待办：带重复规则 ---- */
            if (m == "todo.add")
            {
                var r = db.TodoAdd2(S(a, "title"), S(a, "due", ""), S(a, "dueTime", ""),
                                    I(a, "priority", 1), S(a, "note", ""), S(a, "listId", ""));
                var id = (string)r.GetType().GetProperty("id").GetValue(r);
                db.TodoSetRepeat(id, S(a, "repeat", ""));
                return r;
            }
            if (m == "todo.repeat") { db.TodoSetRepeat(S(a, "id"), S(a, "repeat")); return new { ok = true }; }
            if (m == "todo.movelist") { db.TodoSetList(S(a, "id"), S(a, "listId")); return new { ok = true }; }
            if (m == "todos.recycle") return db.TodosRecycle();
            if (m == "todo.restore") return db.TodoRestore(S(a, "id"));
            if (m == "todo.purge") return db.TodoPurge(S(a, "id"));
            if (m == "todo.purgeAll") return db.TodoPurgeAll();

            /* ---- 倒计时：带重复规则 ---- */
            if (m == "cd.add")
            {
                return db.CdAdd2(S(a, "title"), S(a, "date"), S(a, "repeat", ""), S(a, "color"), S(a, "note", ""));
            }
            if (m == "cd.repeat") { db.CdSetRepeat(S(a, "id"), S(a, "repeat")); return new { ok = true }; }

            /* ---- 音乐库 ---- */
            if (m == "music.import") return MusicImport();
            if (m == "music.addUrl") return db.MediaAddUrl(S(a, "url"), S(a, "name"));
            if (m == "music.list") return db.MediaByKind("audio,video");
            /* 第 26/27 条：把网络链接真的下载到本地。之前只有开关没有下载代码。 */
            if (m == "media.cacheUrl") return db.MediaCacheUrl(S(a, "id"));
            if (m == "media.cacheAll") return db.MediaCacheAll();

            return null;
        }

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
                _left--;
                Invalidate();
                if (_left <= 0) FadeOut();
            };
            _fade.Interval = 16;
            _fade.Tick += (s, e) =>
            {
                if (_closing) { Opacity -= 0.12; if (Opacity <= 0.02) { _fade.Stop(); Close(); } }
                else { Opacity += 0.12; if (Opacity >= 0.98) { Opacity = 0.98; _fade.Stop(); } }
            };

            Click += (s, e) => { _onClick?.Invoke(); Close(); };
            foreach (Control c in Controls) c.Click += (s, e) => { _onClick?.Invoke(); Close(); };
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
