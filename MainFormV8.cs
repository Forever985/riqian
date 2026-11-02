using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace Riqian
{
    /// <summary>
    /// v8 宿主扩展：全局热键、可配置托盘、老板键伪装窗、右下角悬浮小 logo、任务栏显隐。
    ///
    /// 设计参考（用户点名让学的四款软件）：
    /// - Snipaste：默认键要短、要能背下来，且藏在设置里不打扰人。
    /// - Simple Sticky Notes / Kite：托盘是主入口，双击回主窗、右键出菜单、常驻不退出。
    /// - EcoPaste：唤起是「浮层 + 键盘优先」，所以快捕窗一出来就聚焦输入框，Esc 收掉。
    /// </summary>
    public partial class MainForm
    {
        /* ================= Win32 ================= */

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr hIcon);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        private const int WM_HOTKEY = 0x0312;
        private const uint MOD_ALT = 0x1, MOD_CTRL = 0x2, MOD_SHIFT = 0x4, MOD_WIN = 0x8;

        /// <summary>热键 id → 动作名。动作名同时是前端 __HOST_CMD__ 的参数。</summary>
        private static readonly (int id, string key, string action, string name)[] HotkeyMap =
        {
            (9101, "hotkeyToggle", "toggle",     "唤出 / 收起"),
            (9102, "hotkeyBoss",   "boss",       "老板键"),
            (9103, "hotkeyDiary",  "quick:diary","快速写日记"),
            (9104, "hotkeyNote",   "quick:note", "快速记笔记"),
            (9105, "hotkeyTodo",   "quick:todo", "快速记待办"),
            (9106, "hotkeyCd",     "quick:cd",   "快速倒计时"),
            (9107, "hotkeyPomo",   "quick:pomo", "快速番茄钟"),
        };

        private readonly HashSet<int> _hotkeyOn = new();
        private bool _bossOn;
        private DisguiseForm _disguise;
        private OrbForm _orb;

        private Dictionary<string, string> Settings()
        {
            try { return db?.SettingsAll() as Dictionary<string, string> ?? new Dictionary<string, string>(); }
            catch { return new Dictionary<string, string>(); }
        }

        private static string Get(Dictionary<string, string> s, string k, string def = "")
            => s != null && s.TryGetValue(k, out var v) && v != null ? v : def;

        /* ================= 热键 ================= */

        /// <summary>把 "Ctrl+Alt+J" 解析成 (modifiers, vk)。解析不了返回 false。</summary>
        private static bool ParseKey(string text, out uint mods, out uint vk)
        {
            mods = 0; vk = 0;
            if (string.IsNullOrWhiteSpace(text)) return false;

            foreach (var raw in text.Split('+'))
            {
                var p = raw.Trim();
                if (p.Length == 0) continue;
                var lo = p.ToLowerInvariant();
                if (lo == "ctrl" || lo == "control") { mods |= MOD_CTRL; continue; }
                if (lo == "alt") { mods |= MOD_ALT; continue; }
                if (lo == "shift") { mods |= MOD_SHIFT; continue; }
                if (lo == "win" || lo == "meta") { mods |= MOD_WIN; continue; }

                if (p.Length == 1)
                {
                    var c = char.ToUpperInvariant(p[0]);
                    if (c >= 'A' && c <= 'Z') { vk = (uint)c; continue; }
                    if (c >= '0' && c <= '9') { vk = (uint)c; continue; }
                    if (p == "`") { vk = 0xC0; continue; }
                    if (p == "-") { vk = 0xBD; continue; }
                    if (p == "=") { vk = 0xBB; continue; }
                    return false;
                }
                if (lo.StartsWith("f") && int.TryParse(lo.Substring(1), out var fn) && fn >= 1 && fn <= 24)
                {
                    vk = (uint)(0x70 + fn - 1);
                    continue;
                }
                switch (lo)
                {
                    case "space": vk = 0x20; break;
                    case "tab": vk = 0x09; break;
                    case "enter": vk = 0x0D; break;
                    case "esc":
                    case "escape": vk = 0x1B; break;
                    case "left": vk = 0x25; break;
                    case "up": vk = 0x26; break;
                    case "right": vk = 0x27; break;
                    case "down": vk = 0x28; break;
                    case "home": vk = 0x24; break;
                    case "end": vk = 0x23; break;
                    case "insert": vk = 0x2D; break;
                    case "delete": vk = 0x2E; break;
                    default: return false;
                }
            }
            // 至少要有一个修饰键，否则会跟正常打字抢键（这也是一种隐私保护）
            if (vk == 0 || mods == 0) return false;
            return true;
        }

        /// <summary>按当前设置重新注册全部热键。返回注册失败的条目，前端据此提示冲突。</summary>
        private object ApplyHotkeys()
        {
            var s = Settings();
            foreach (var id in _hotkeyOn) { try { UnregisterHotKey(Handle, id); } catch { } }
            _hotkeyOn.Clear();

            var failed = new List<object>();
            var registered = new List<string>();
            if (Get(s, "hotkeyEnable", "1") != "1") return new { ok = true, disabled = true, failed, registered };

            foreach (var (id, key, action, name) in HotkeyMap)
            {
                var combo = Get(s, key, "");
                if (string.IsNullOrWhiteSpace(combo)) continue;
                if (!ParseKey(combo, out var mods, out var vk))
                {
                    failed.Add(new { key, combo, name, reason = "格式无法识别" });
                    continue;
                }
                if (RegisterHotKey(Handle, id, mods, vk)) { _hotkeyOn.Add(id); registered.Add(key); }
                else failed.Add(new { key, combo, name, reason = "被别的软件占用了" });
            }
            return new { ok = true, failed, registered };
        }

        private bool HotkeyEnabled(string key)
        {
            var s = Settings();
            if (Get(s, "hotkeyEnable", "1") != "1") return false;
            return !string.IsNullOrWhiteSpace(Get(s, key, ""));
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY)
            {
                var id = m.WParam.ToInt32();
                var hit = HotkeyMap.FirstOrDefault(x => x.id == id);
                if (hit.action != null) { OnHotkey(hit.action); return; }
            }
            base.WndProc(ref m);
        }

        private void OnHotkey(string action)
        {
            switch (action)
            {
                case "toggle": ToggleMain(); break;
                case "boss": ToggleBoss(); break;
                /*
                 * 第 165 条：这三个走独立浮窗，不再把主窗口整个拽出来。
                 * 用户原话「快捷建立是能直接生成一个浮窗的」——
                 * 记一条待办不该换来一次整屏切走再切回。
                 */
                case "quick:todo": QuickCapture("todo"); break;
                case "quick:note": QuickCapture("note"); break;
                case "quick:diary": QuickCapture("diary"); break;
                default: HostCmd(action); break;
            }
        }

        /// <summary>唤出 / 收起。收起走隐藏，不最小化 —— 最小化还会占任务栏。</summary>
        private void ToggleMain()
        {
            if (Visible && WindowState != FormWindowState.Minimized)
            {
                _ = HideToTray();
                return;
            }
            ShowMain();
        }

        /* ================= 老板键 ================= */

        private void ToggleBoss()
        {
            if (_bossOn) { RestoreFromBoss(); return; }
            _bossOn = true;
            try
            {
                Hide();
                if (_disguise == null || _disguise.IsDisposed)
                {
                    var style = Get(Settings(), "disguiseStyle", "note");
                    _disguise = new DisguiseForm(style, RestoreFromBoss);
                }
                _disguise.Show();
                _disguise.Activate();
            }
            catch (Exception ex) { Diag.Error("boss", "老板键切换失败，已强制回到正常界面", ex); _bossOn = false; ShowMain(); }
        }

        private void RestoreFromBoss()
        {
            _bossOn = false;
            try { if (_disguise != null && !_disguise.IsDisposed) _disguise.Hide(); } catch { }
            ShowMain();
        }

        /* ================= 托盘 ================= */

        /// <summary>托盘菜单项：id → 文字 + 动作。顺序由设置里的 trayMenu 决定。</summary>
        private static readonly Dictionary<string, (string text, Action<MainForm> run)> TrayItems =
            new Dictionary<string, (string, Action<MainForm>)>
        {
            ["open"]  = ("打开日签", f => f.ShowMain()),
            ["today"] = ("今日总结", f => f.HostCmd("nav:review")),
            /* 第 165 条：这三项改成弹独立浮窗，不再先把主窗口拽出来 */
            ["diary"] = ("写今天的日记", f => f.QuickCapture("diary")),
            ["note"]  = ("快速记笔记", f => f.QuickCapture("note")),
            ["todo"]  = ("快速加待办", f => f.QuickCapture("todo")),
            ["cd"]    = ("新建倒计时", f => f.HostCmd("quick:cd")),
            ["pomo"]  = ("开始番茄钟", f => f.StartPomoFromTray(f.TrayPomoMinutes())),
            ["boss"]  = ("隐形模式", f => f.ToggleBoss()),
            ["lock"]  = ("立即锁定", f => f.HostCmd("lock")),
            /* 第 75 条：用户说「小锁 icon 或者 Logo 什么的……托盘里面也要」。
               托盘本来就常驻，但界面锁了之后图标还是那个「签」，看不出状态。
               这一项把「现在锁着没」直接画在图标上。 */
            ["lockstate"] = ("锁状态显示在托盘图标上", f => f.ToggleTrayLockIcon()),
            ["hide"]  = ("隐藏窗口", f => f.HideToTray()),
            ["quit"]  = ("退出日签", f => f.QuitApp()),
        };

        /* ================= 第 88b 条：托盘「开始番茄钟」的时长 =================
         *
         * 用户原话：「接87条。也可以提前设置好时间。这一点要在设置里面允许用户调整。
         * 到底是否允许提前设置好时间，并且提前设置的时间是多少也要用户自行调整。」
         *
         * 之前这里是写死的：直接读 pomoPreset，用户既不能关掉「预览时长」这件事，
         * 也不能单独指定托盘点一下就是多少分钟。现在两件事都交给设置：
         *   trayPomoPreset = 0  → 不预设，点了按默认专注时长走
         *   trayPomoPreset > 0  → 就按这个分钟数开
         */
        internal int TrayPomoMinutes()
        {
            var s = Settings();
            var raw = s.GetValueOrDefault("trayPomoPreset", "");
            if (!string.IsNullOrWhiteSpace(raw) && int.TryParse(raw, out var n))
                return n <= 0 ? DefaultFocusMinutes() : Math.Min(240, Math.Max(1, n));
            return DefaultFocusMinutes();
        }

        private int DefaultFocusMinutes()
        {
            var s = Settings();
            // pomoPreset 是用户设的「默认专注时长」，没有就用 25
            if (int.TryParse(s.GetValueOrDefault("pomoPreset", "25"), out var m) && m > 0) return Math.Min(240, m);
            return 25;
        }

        /* ========== 第 75 条：托盘图标反映「当前锁没锁」 ==========
         *
         * 用户原话：「小锁 icon 或者 Logo 什么的……托盘里面也要」。
         * 托盘本来就常驻，但界面锁上之后图标还是那个「签」，一眼看不出状态 ——
         * 尤其老板键伪装 / 离开工位的时候，用户需要一个「瞟一眼就知道锁了没」的信号。
         *
         * 做法：不换整套图标资源（那要重新打包 ico），而是在原图标右下角叠一个小锁/开锁角标。
         *   trayLockIcon = 0  → 关掉这个特性，托盘永远是原图标
         *   trayLockIcon = 1  → 锁着时叠一把实心小锁，解锁后回到原图标
         */
        private bool _trayLocked;
        private Icon _trayBaseIcon;

        /// <summary>前端锁定状态变化时由宿主调用（前端通过 RPC 通知）。</summary>
        internal void SetTrayLocked(bool locked)
        {
            if (_trayLocked == locked) return;
            _trayLocked = locked;
            ApplyTrayIcon();
        }

        /// <summary>托盘菜单里「锁状态显示在托盘图标上」的开关。</summary>
        internal void ToggleTrayLockIcon()
        {
            var cur = Get(Settings(), "trayLockIcon", "1") == "1";
            var next = cur ? "0" : "1";
            try { db.SettingSet("trayLockIcon", next); }
            catch (Exception ex) { Diag.Error("dispatch.v8", "写 trayLockIcon 失败", ex); }
            ApplyTrayIcon();
        }

        /// <summary>按当前（设置 × 锁定状态）重画托盘图标。任何时候调都安全。</summary>
        private void ApplyTrayIcon()
        {
            try
            {
                if (tray == null) return;
                if (_trayBaseIcon == null)
                    _trayBaseIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

                var showLock = Get(Settings(), "trayLockIcon", "1") == "1";
                if (!showLock)
                {
                    // 关掉特性时把角标摘掉，别留一个上次画上去的锁
                    tray.Icon = _trayBaseIcon;
                    return;
                }
                tray.Icon = _trayLocked ? WithLockBadge(_trayBaseIcon, true) : _trayBaseIcon;
            }
            catch (Exception ex) { Diag.Warn("dispatch.v8", "重画托盘图标失败", ex); }
        }

        /// <summary>把原图标右下角叠一把小锁（locked=true）或开锁轮廓（false）。</summary>
        private static Icon WithLockBadge(Icon baseIcon, bool locked)
        {
            const int size = 32;
            using var bmp = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.Clear(Color.Transparent);
                using (var b = baseIcon.ToBitmap()) g.DrawImage(b, 0, 0, size, size);

                // 角标占右下 14×14，底色用一块半透明圆角让它从任何图标上都看得清
                var r = new Rectangle(size - 15, size - 15, 13, 13);
                using (var bg = new SolidBrush(Color.FromArgb(236, 255, 255, 255)))
                    g.FillEllipse(bg, r);
                using (var pen = new Pen(locked ? Color.FromArgb(190, 46, 38) : Color.FromArgb(120, 120, 120), 1.4f))
                    g.DrawEllipse(pen, r);

                // 锁体
                var body = new Rectangle(r.X + 3, r.Y + 6, 7, 6);
                using (var sb = new SolidBrush(locked ? Color.FromArgb(190, 46, 38) : Color.FromArgb(120, 120, 120)))
                    g.FillRectangle(sb, body);
                // 锁梁：锁着是闭合的半圆，开锁时缺口朝左上
                using (var pen = new Pen(locked ? Color.FromArgb(190, 46, 38) : Color.FromArgb(120, 120, 120), 1.5f))
                {
                    if (locked)
                        g.DrawArc(pen, r.X + 4, r.Y + 3, 6, 6, 180, 180);
                    else
                        g.DrawArc(pen, r.X + 6, r.Y + 2, 6, 7, 200, 160);
                }
            }
            // GetHicon 出来的 HICON 必须自己 DestroyIcon，否则每切一次锁状态就漏一个 GDI 句柄
            var h = bmp.GetHicon();
            try
            {
                using var tmp = Icon.FromHandle(h);
                return (Icon)tmp.Clone();
            }
            finally { DestroyIcon(h); }
        }

        /* ================= 第 191 条：开机自启 =================
         * 用 HKCU 的 Run 键，不用计划任务也不用服务：
         *   · 只有当前用户生效，不需要管理员权限 —— 提权会让每次开机弹 UAC，很烦
         *   · 卸载/搬家时用户自己就能在任务管理器里关掉
         * 写的时候带引号包住路径，安装目录有空格也不会坏。
         */
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "Riqian";

        private string ExePathForAutostart()
        {
            // 优先用真实 exe 路径；dotnet run 那种场景下 ProcessPath 会是 dotnet.exe，
            // 那就退回程序集位置（虽然那种场景本来也不该开自启）
            var p = Environment.ProcessPath;
            if (string.IsNullOrEmpty(p) || p.EndsWith("dotnet.exe", StringComparison.OrdinalIgnoreCase))
            {
                var asm = System.Reflection.Assembly.GetEntryAssembly()?.Location;
                if (!string.IsNullOrEmpty(asm)) p = Path.ChangeExtension(asm, ".exe");
            }
            return p ?? "";
        }

        private object AutostartSet(int on)
        {
            try
            {
                using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey, true)
                              ?? Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey);
                if (k == null) return new { ok = false, err = "打不开注册表 Run 键" };

                if (on == 1)
                {
                    var exe = ExePathForAutostart();
                    if (string.IsNullOrEmpty(exe) || !File.Exists(exe))
                        return new { ok = false, err = "找不到程序路径，无法设置自启" };
                    k.SetValue(RunValue, $"\"{exe}\"");
                    Diag.Info("shell", "已开启开机自启：" + exe);
                }
                else
                {
                    k.DeleteValue(RunValue, false);
                    Diag.Info("shell", "已关闭开机自启");
                }
                return new { ok = true, on };
            }
            catch (Exception e)
            {
                Diag.Error("shell", "设置开机自启失败 on=" + on, e);
                return new { ok = false, err = e.Message };
            }
        }

        private bool AutostartGet()
        {
            try
            {
                using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey, false);
                return k?.GetValue(RunValue) != null;
            }
            catch { return false; }
        }

        /// <summary>
        /// 第 90 条：用系统默认程序打开外链（mailto: / https:// / 本地路径）。
        /// 只放行三种 scheme，避免前端被注入个 file:// 就把整块磁盘交出控制权。
        /// </summary>
        private object OpenExternal(string url)
        {
            var u = (url ?? "").Trim();
            if (u == "") return new { ok = false, err = "地址是空的" };

            var allow = false;
            var low = u.ToLowerInvariant();
            if (low.StartsWith("http://") || low.StartsWith("https://") || low.StartsWith("mailto:")) allow = true;
            if (!allow) return new { ok = false, err = "只支持 http / https / mailto 链接" };

            try
            {
                Process.Start(new ProcessStartInfo(u) { UseShellExecute = true });
                return new { ok = true };
            }
            catch (Exception ex)
            {
                Diag.Error("shell", "打开外链失败：" + u, ex);
                return new { ok = false, err = "系统没有能打开它的程序" };
            }
        }

        /// <summary>按设置重建托盘菜单，并同步图标显隐 / 任务栏 / 悬浮球。</summary>
        private void ApplyShell()
        {
            var s = Settings();
            try
            {
                InitTray();
                if (tray == null) return;

                var mode = Get(s, "trayIconMode", "full");
                tray.Visible = mode != "off";
                tray.Text = mode == "mini" ? "日签" : "日签 · 打卡日记本";
                ApplyTrayIcon();

                var menu = new ContextMenuStrip();
                var ids = Get(s, "trayMenu", "open,today,diary,note,todo,pomo,sep,hide,boss,sep,quit")
                    .Split(',').Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
                foreach (var id in ids)
                {
                    if (id == "sep") { menu.Items.Add(new ToolStripSeparator()); continue; }
                    if (!TrayItems.TryGetValue(id, out var item)) continue;
                    var act = item.run;
                    menu.Items.Add(item.text, null, (a, b) => act(this));
                }
                if (menu.Items.Count == 0) menu.Items.Add("打开日签", null, (a, b) => ShowMain());
                // 第 164 条：菜单建好之后立刻套主题渲染，否则还是系统那套灰方块
                menu.Font = new System.Drawing.Font("Microsoft YaHei UI", 9.25f);
                menu.Padding = new Padding(5, 6, 5, 6);
                menu.ShowImageMargin = false;
                tray.ContextMenuStrip = menu;
                ApplyTrayTheme();

                // 任务栏：用 ShowInTaskbar 控制；句柄会重建，所以热键要跟着重注册
                var wantTaskbar = Get(s, "taskbarShow", "1") == "1";
                if (ShowInTaskbar != wantTaskbar)
                {
                    ShowInTaskbar = wantTaskbar;
                    ApplyHotkeys();
                }

                ApplyOrb(Get(s, "orbEnabled", "0") == "1");
            }
            catch (Exception ex) { Diag.Error("dispatch.v8", "v8 分发失败", ex); }
        }

        private void ApplyOrb(bool on)
        {
            try
            {
                if (on)
                {
                    if (_orb == null || _orb.IsDisposed) _orb = new OrbForm(this);
                    _orb.Show();
                    _orb.BringToFront();
                }
                else if (_orb != null && !_orb.IsDisposed)
                {
                    _orb.Hide();
                }
            }
            catch (Exception ex) { Diag.Error("dispatch.v8", "v8 分发失败", ex); }
        }

        /* ================= 宿主 → 前端 ================= */

        /// <summary>
        /// 宿主发命令给界面。前端在 store 里挂了 window.__HOST_CMD__，
        /// 托盘、热键、悬浮球都走这一条通道，避免每加一个入口就写一段 ExecuteScript。
        /// </summary>
        private void HostCmd(string cmd)
        {
            try
            {
                ShowMain();
                var safe = cmd.Replace("'", "");
                _ = web.CoreWebView2?.ExecuteScriptAsync(
                    $"window.__HOST_CMD__ && window.__HOST_CMD__('{safe}');");
            }
            catch (Exception ex) { Diag.Error("dispatch.v8", "v8 分发失败", ex); }
        }

        /* ================= RPC ================= */

        private object V8Dispatch(string m, JsonElement a)
        {
            if (m == "hotkey.apply") return ApplyHotkeys();
            /*
             * 第 165 条：浮窗的落库口子。
             * 浮窗本身不经过 WebView2，但前端也需要一条「和浮窗完全同一套保存逻辑」的通道 ——
             * 免得快速面板和浮窗对同一句话的落库行为不一样（那是两个 bug）。
             */
            if (m == "quick.capture")
            {
                var r = db.QuickCaptureSave(S(a, "kind", "todo"), S(a, "text"));
                return new { ok = r.ok, err = r.err, n = r.n };
            }
            /* 浮窗的显示口子：前端也可以主动叫出来（比如按钮点一下） */
            if (m == "quick.popup") { QuickCapture(S(a, "kind", "todo")); return QuickState(); }
            if (m == "quick.state") return QuickState();
            /* 第 75 条：前端锁屏 / 解锁时把状态同步给宿主，托盘图标据此叠小锁角标 */
            if (m == "shell.lockState")
            {
                SetTrayLocked(I(a, "locked", 0) == 1);
                return new { ok = true, locked = _trayLocked, icon = Get(Settings(), "trayLockIcon", "1") };
            }
            if (m == "shell.apply") { ApplyShell(); return new { ok = true, boss = _bossOn }; }
            /* 第 191 条：开机自启。默认不启动，用户点了才写注册表。 */
            if (m == "shell.autostart") return AutostartSet(I(a, "on", 0));
            if (m == "shell.autostartGet") return new { ok = true, on = AutostartGet() ? 1 : 0 };
            /* 第 90 条：用系统默认程序打开外链 / mailto。
               WebView2 里 <a href="mailto:"> 点了没反应，必须转到宿主这边用 ShellExecute。 */
            if (m == "shell.openUrl") return OpenExternal(S(a, "url"));
            if (m == "shell.hotkeyState")
            {
                var s = Settings();
                return new
                {
                    enabled = Get(s, "hotkeyEnable", "1") == "1",
                    registered = _hotkeyOn.Count,
                    boss = _bossOn,
                    orb = _orb != null && !_orb.IsDisposed && _orb.Visible,
                };
            }
            if (m == "boss.toggle") { ToggleBoss(); return new { ok = true, on = _bossOn }; }
            if (m == "orb.toggle") { ApplyOrb(I(a, "on", 1) == 1); return new { ok = true }; }

            /* ---- 分享 ---- */
            if (m == "share.image") return db.ShareSaveImage(S(a, "data"), S(a, "name"));
            if (m == "share.copyImage") return db.ShareCopyImage(S(a, "data"));
            if (m == "share.copyText") return db.ShareCopyText(S(a, "text"));
            if (m == "share.html") return db.ShareSaveHtml(S(a, "html"), S(a, "name"));

            /* ---- 总结 ---- */
            if (m == "summary.list") return db.Summaries();
            if (m == "summary.get") return db.SummaryGet(S(a, "id"));
            if (m == "summary.save") return db.SummarySave(S(a, "id"), S(a, "kind"), S(a, "from"), S(a, "to"),
                                                       S(a, "title"), S(a, "body"), S(a, "plain"));
            if (m == "summary.delete") return db.SummaryDelete(S(a, "id"));
            if (m == "summary.pin") return db.SummaryPin(S(a, "id"), I(a, "pinned", 0));
            if (m == "review.day") return db.ReviewDay(S(a, "date"));
            if (m == "review.range") return db.ReviewRange(S(a, "from"), S(a, "to"));

            /* ---- 密码提示与密保 ---- */
            if (m == "vault.hint") return db.VaultSetHint(S(a, "hint"));
            if (m == "vault.qa.list") return db.VaultQaList();
            if (m == "vault.qa.save") return db.VaultQaSave(a.TryGetProperty("list", out var ql) ? ql : default);
            if (m == "vault.qa.verify") return db.VaultQaVerify(a.TryGetProperty("answers", out var qa) ? qa : default);
            if (m == "vault.qa.reset") return db.VaultResetByQa(
                a.TryGetProperty("answers", out var ra) ? ra : default, S(a, "password", ""));

            return null;
        }

        /* ================= 伪装窗 ================= */

        private class DisguiseForm : Form
        {
            private readonly Action _restore;
            private readonly RichTextBox _doc = new RichTextBox();

            protected override bool ShowWithoutActivation => false;

            public DisguiseForm(string style, Action restore)
            {
                _restore = restore;
                Text = "记事本";
                ClientSize = new Size(660, 460);
                StartPosition = FormStartPosition.CenterScreen;
                BackColor = Color.White;
                Font = new Font("Microsoft YaHei", 9.5f);
                MinimizeBox = true;
                MaximizeBox = false;

                _doc.Dock = DockStyle.Fill;
                _doc.BorderStyle = BorderStyle.None;
                _doc.ReadOnly = true;
                _doc.BackColor = Color.White;
                _doc.ForeColor = Color.FromArgb(40, 40, 40);
                _doc.Font = new Font("Microsoft YaHei", 10.5f);
                _doc.Text = style == "blank"
                    ? "\r\n"
                    : "第三季度工作复盘（草稿）\r\n\r\n" +
                      "一、本季度完成情况\r\n" +
                      "  1. 项目排期按计划推进，关键节点均已交付；\r\n" +
                      "  2. 与相关部门完成了两轮需求对齐，范围基本冻结；\r\n" +
                      "  3. 遗留问题清单已同步，等待下周例会确认。\r\n\r\n" +
                      "二、存在的问题\r\n" +
                      "  1. 部分环节沟通成本偏高，信息同步不够及时；\r\n" +
                      "  2. 排期缓冲预留不足，遇到变更时调整空间有限。\r\n\r\n" +
                      "三、下季度计划\r\n" +
                      "  1. 把月度复盘固定下来，减少临时对齐；\r\n" +
                      "  2. 关键路径上的任务提前一周做风险预判。\r\n\r\n" +
                      "（待补充：数据部分、案例部分）\r\n";
                Controls.Add(_doc);

                // 双击空白处或关掉这个假窗口，都回到真正的日签 —— 免得用户以为程序没了
                _doc.DoubleClick += (s, e) => _restore();
                FormClosing += (s, e) => { e.Cancel = true; _restore(); };
            }
        }

        /* ================= 右下角悬浮小 logo ================= */

        private class OrbForm : Form
        {
            private readonly MainForm _owner;
            private bool _drag;
            private Point _grab;

            protected override bool ShowWithoutActivation => true;

            protected override CreateParams CreateParams
            {
                get
                {
                    var cp = base.CreateParams;
                    cp.ExStyle |= 0x08000000;   // WS_EX_NOACTIVATE：点它不抢焦点
                    cp.ExStyle |= 0x00000080;   // WS_EX_TOOLWINDOW：不占任务栏
                    return cp;
                }
            }

            public OrbForm(MainForm owner)
            {
                _owner = owner;
                FormBorderStyle = FormBorderStyle.None;
                ShowInTaskbar = false;
                TopMost = true;
                Size = new Size(58, 58);
                DoubleBuffered = true;
                BackColor = Color.FromArgb(38, 34, 29);
                var wa = Screen.PrimaryScreen.WorkingArea;
                Location = new Point(wa.Right - Width - 24, wa.Bottom - Height - 24);

                using (var p = Round(new Rectangle(0, 0, Width, Height), 16))
                    Region = new Region(p);

                var menu = new ContextMenuStrip();
                menu.Items.Add("打开日签", null, (s, e) => _owner.ShowMain());
                menu.Items.Add("写今天的日记", null, (s, e) => _owner.HostCmd("quick:diary"));
                menu.Items.Add("快速记笔记", null, (s, e) => _owner.HostCmd("quick:note"));
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("隐藏小图标", null, (s, e) => { Hide(); _owner.db.SettingSet("orbEnabled", "0"); });
                ContextMenuStrip = menu;

                MouseDown += (s, e) =>
                {
                    if (e.Button == MouseButtons.Left) { _drag = false; _grab = e.Location; }
                };
                MouseMove += (s, e) =>
                {
                    if (e.Button != MouseButtons.Left) return;
                    if (!_drag && (Math.Abs(e.X - _grab.X) + Math.Abs(e.Y - _grab.Y)) > 3) _drag = true;
                    if (_drag) Location = new Point(Location.X + e.X - _grab.X, Location.Y + e.Y - _grab.Y);
                };
                MouseUp += (s, e) =>
                {
                    if (e.Button != MouseButtons.Left) return;
                    if (!_drag) _owner.ToggleMain();
                    _drag = false;
                };
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                var g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                using (var b = new SolidBrush(Color.FromArgb(38, 34, 29))) g.FillRectangle(b, ClientRectangle);
                using (var pen = new Pen(Color.FromArgb(255, 255, 255, 26))) g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
                using (var f = new Font("Microsoft YaHei", 17f, FontStyle.Bold))
                using (var b = new SolidBrush(Color.FromArgb(246, 243, 236)))
                {
                    var sz = g.MeasureString("签", f);
                    g.DrawString("签", f, b, (Width - sz.Width) / 2, (Height - sz.Height) / 2);
                }
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
    }
}
