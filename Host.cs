using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// 分发层里「各平台手段确实不同」的那批动作。
    ///
    /// 和 IShell 的分工：IShell 管**壳**（打开目录、选文件、通知、退出），
    /// 这里管**分发里剩下的那些平台动作** —— 换数据目录、导入字体/音乐、
    /// 开机自启、屏幕尺寸、桌面提醒窗、托盘与老板键的状态。
    ///
    /// 为什么不再并进 IShell：IShell 是「壳」，语义清楚；而托盘、老板键、
    /// 桌面提醒窗这些是 Windows 桌面专有的概念，安卓上根本没有对应物。
    /// 混进 IShell 会让实现方以为「必须实现」，实际只能返回不支持。
    /// 单独一层的好处是：**安卓那边一个都不用注册，默认就是合理降级**。
    ///
    /// 降级原则（和 IShell 一致）：返回 ok:false + 一句人话，不抛异常。
    /// 抛异常会被 RPC 框架包成「程序坏了」，而事实只是「手机上没有这个功能」。
    /// </summary>
    public static class Host
    {
        /* ---------------- 由平台注册的委托 ---------------- */

        /// <summary>换数据目录（桌面弹文件夹选择框；安卓没有可写的外部目录选择器）。</summary>
        public static Func<object> ChangeRootFn;

        /// <summary>把一篇笔记导出成文件（桌面弹保存框）。</summary>
        public static Func<string, object> ExportNoteFn;

        /// <summary>导入字体文件。</summary>
        public static Func<object> FontImportFn;

        /// <summary>导入音乐文件。</summary>
        public static Func<object> MusicImportFn;

        /// <summary>发系统通知 / 桌面提醒窗。</summary>
        public static Func<JsonElement, object> NotifyPushFn;

        /// <summary>用系统默认程序打开外链。</summary>
        public static Func<string, object> OpenExternalFn;

        /// <summary>开机自启（桌面写注册表；安卓由系统管）。</summary>
        public static Func<int, object> AutostartSetFn;

        /// <summary>读开机自启状态。</summary>
        public static Func<bool> AutostartGetFn;

        /// <summary>屏幕信息。</summary>
        public static Func<object> ScreenInfoFn;

        /// <summary>弹一条桌面提醒窗（秒数、是否置顶）。</summary>
        public static Action<string, string, string, int, bool> ShowToastFn;

        /// <summary>初始化托盘图标。</summary>
        public static Action InitTrayFn;

        /// <summary>托盘锁角标。</summary>
        public static Action<bool> SetTrayLockedFn;

        /// <summary>读当前托盘锁状态。做成委托而不是字段 ——
        /// 字段快照会和 MainForm 的真实状态脱节（用户在托盘点了锁，分发层还以为是旧值）。</summary>
        public static Func<bool> TrayLockedFn;

        /// <summary>当前托盘锁状态。</summary>
        public static bool TrayLocked => SafeCall(TrayLockedFn);

        /// <summary>重新应用窗体外观（伪装 / 老板键）。</summary>
        public static Action ApplyShellFn;

        /// <summary>读当前老板键状态（理由同 TrayLocked）。</summary>
        public static Func<bool> BossOnFn;

        /// <summary>当前老板键状态。</summary>
        public static bool BossOn => SafeCall(BossOnFn);

        /// <summary>悬浮球显隐。</summary>
        public static Action<bool> ApplyOrbFn;

        /// <summary>读悬浮球是否可见（理由同 TrayLocked）。</summary>
        public static Func<bool> OrbVisibleFn;

        /// <summary>悬浮球当前是否可见。</summary>
        public static bool OrbVisible => SafeCall(OrbVisibleFn);

        /// <summary>切换老板键。</summary>
        public static Action<string> ToggleBossFn;

        /// <summary>读已注册的全局热键数量（理由同 TrayLocked）。</summary>
        public static Func<int> HotkeyCountFn;

        /// <summary>已注册的全局热键数量。</summary>
        public static int HotkeyCount => SafeCallInt(HotkeyCountFn);

        /// <summary>速记窗当前状态。</summary>
        public static Func<object> QuickStateFn;

        /* ---- 桌面专有的窗口类功能 ---- */

        /// <summary>贴一张便利贴（桌面是独立小窗；手机没有多窗口概念）。</summary>
        public static Func<string, object> StickyOpenFn;

        /// <summary>关掉一张便利贴。</summary>
        public static Func<string, object> StickyCloseFn;

        /// <summary>列出当前贴着的便利贴。</summary>
        public static Func<object> StickyListFn;

        /// <summary>
        /// 开关本地调试网关（供外部 AI / 自动化调用 RPC）。
        /// want: ""=只查状态 / "1"=开 / "0"=关。桌面用 HttpListener，安卓理论也可，
        /// 但手机上没有"外部调试"这个使用场景，默认不提供。
        /// </summary>
        public static Func<string, int, object> DebugApiApplyFn;

        /// <summary>读调试网关的 info 文件内容（设置页要展示「怎么调」）。</summary>
        public static Func<object> DebugApiInfoFn;

        /* ---------------- 带降级的调用入口 ---------------- */

        private static bool SafeCall(Func<bool> f)
        {
            if (f == null) return false;
            try { return f(); } catch { return false; }
        }

        private static int SafeCallInt(Func<int> f)
        {
            if (f == null) return 0;
            try { return f(); } catch { return 0; }
        }

        public static object ChangeRoot()
        {
            var f = ChangeRootFn;
            if (f == null) return new { ok = false, err = "本平台不支持换数据目录" };
            try { return f(); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object ExportNote(string id)
        {
            var f = ExportNoteFn;
            if (f == null) return new { ok = false, err = "本平台不支持把笔记导出成文件" };
            try { return f(id); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object FontImport()
        {
            var f = FontImportFn;
            if (f == null) return new { ok = false, items = new object[0], err = "本平台不支持导入字体" };
            try { return f(); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object MusicImport()
        {
            var f = MusicImportFn;
            if (f == null) return new { ok = false, items = new object[0], err = "本平台不支持导入音乐" };
            try { return f(); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object NotifyPush(JsonElement a)
        {
            var f = NotifyPushFn;
            if (f == null) return new { ok = false, err = "本平台不支持系统通知" };
            try { return f(a); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object OpenExternal(string url)
        {
            var f = OpenExternalFn;
            if (f == null) return new { ok = false, err = "本平台不支持打开外部链接" };
            try { return f(url ?? ""); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object AutostartSet(int on)
        {
            var f = AutostartSetFn;
            if (f == null) return new { ok = false, err = "本平台没有开机自启这个概念" };
            try { return f(on); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static bool AutostartGet()
        {
            var f = AutostartGetFn;
            if (f == null) return false;
            try { return f(); } catch { return false; }
        }

        public static object ScreenInfo()
        {
            var f = ScreenInfoFn;
            if (f == null) return new { ok = false, err = "本平台读不到屏幕信息" };
            try { return f(); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static void ShowToast(string title, string body, string kind, int seconds, bool topmost)
        {
            var f = ShowToastFn;
            if (f == null) return;
            try { f(title, body, kind, seconds, topmost); } catch { /* 提醒窗失败不该影响 RPC */ }
        }

        public static void InitTray() { try { InitTrayFn?.Invoke(); } catch { } }
        public static void SetTrayLocked(bool on) { try { SetTrayLockedFn?.Invoke(on); } catch { } }
        public static void ApplyShell() { try { ApplyShellFn?.Invoke(); } catch { } }
        public static void ApplyOrb(bool on) { try { ApplyOrbFn?.Invoke(on); } catch { } }
        public static void ToggleBoss(string here) { try { ToggleBossFn?.Invoke(here); } catch { } }

        public static object QuickState()
        {
            var f = QuickStateFn;
            if (f == null) return new { ok = true, open = false, mode = "" };
            try { return f(); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object StickyOpen(string noteId)
        {
            var f = StickyOpenFn;
            if (f == null) return new { ok = false, err = "本平台不支持把笔记贴到桌面" };
            try { return f(noteId); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object StickyClose(string noteId)
        {
            var f = StickyCloseFn;
            if (f == null) return new { ok = true, skipped = true };
            try { return f(noteId); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }

        public static object StickyList()
        {
            var f = StickyListFn;
            if (f == null) return new object[0];
            try { return f(); } catch { return new object[0]; }
        }

        public static object DebugApiInfo()
        {
            var f = DebugApiInfoFn;
            if (f == null) return new { ok = true, path = "", text = "" };
            try { return f(); } catch (Exception e) { return new { ok = false, err = e.Message, path = "", text = "" }; }
        }

        public static object DebugApiApply(string want, int port)
        {
            var f = DebugApiApplyFn;
            if (f == null) return new { ok = false, err = "本平台不支持本地调试网关" };
            try { return f(want ?? "", port); } catch (Exception e) { return new { ok = false, err = e.Message }; }
        }
    }
}
