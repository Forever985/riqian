using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Riqian
{
    internal static class Program
    {
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);

        /// <summary>
        /// 单实例：以前每点一次图标就多开一个进程，两个进程各写一个 SQLite 连接，
        /// 会互相看不见对方的改动（用户看到的就是"每次启动都是独立的"）。
        /// 这里用命名互斥量挡住第二个实例，并尽量把已有窗口唤到前台。
        /// </summary>
        [STAThread]
        static void Main()
        {
            /*
             * 平台实现要在**任何 Db 操作之前**注册。
             *
             * 缩略图和剪贴板这两件事原来直接写在 Db*.cs 里用 GDI+，
             * 现在收到 Platform 那一层（见 Platform.cs 顶部注释）。
             * 注册晚了不会报错，只会静默地"缩略图是空的"—— 那种问题
             * 要到用户导入几十张图之后才会被发现，而且看不出原因。
             */
            PlatformWindows.Register();

            /*
             * `--selfcheck`：不开窗口，只验"全新装机的库能不能建对"。
             *
             * 必须放在**单实例互斥量之前**：CI 上可能同时有别的步骤在跑，
             * 而且自检本来就不该受"用户已经开着一个日签"的影响 ——
             * 它用的是独立的临时目录，跟用户数据一个字都不沾。
             *
             * 也必须放在 Application.Run 之前：这一步不需要 WebView2、
             * 不需要桌面会话，纯命令行。CI 的 windows-latest 上能跑。
             *
             * 为什么要有这么个入口：见 SelfCheck.cs 顶部注释 —— 一天之内
             * 两次"只打新装用户"的 no such column，都是发布出去才发现的。
             */
            if (Environment.GetCommandLineArgs()
                .Any(a => string.Equals(a, "--selfcheck", StringComparison.OrdinalIgnoreCase)))
            {
                Environment.ExitCode = SelfCheck.Run();
                return;
            }

            // 日志要最先起。后面的任何一步都可能炸，越早起来能抓到的东西越多。
            Diag.Start();
            HookGlobalExceptions();

            /*
             * `--test-toast`：提醒窗注销自检。
             *
             * 放在单实例互斥量之前 —— 它自己开临时窗体，跟用户数据无关，
             * 不该因为「用户已经开着一个日签」就拒绝跑。
             * 见 ToastSelfTest.cs 顶部：为什么这个必须做成自检、
             * 而不是「连发两个提醒试试看」。
             */
            if (Environment.GetCommandLineArgs()
                .Any(a => string.Equals(a, "--test-toast", StringComparison.OrdinalIgnoreCase)))
            {
                Environment.ExitCode = ToastSelfTest.Run();
                return;
            }

            const string mutexName = @"Local\RiqianJournal.SingleInstance";
            Diag.Info("boot", "启动路径：检查单实例");
            using var mutex = new Mutex(true, mutexName, out var isFirst);
            if (!isFirst)
            {
                Diag.Info("boot", "已有实例在跑，本次唤醒它然后退出");
                try
                {
                    var me = Process.GetCurrentProcess();
                    foreach (var pr in Process.GetProcessesByName(me.ProcessName))
                    {
                        if (pr.Id == me.Id || pr.MainWindowHandle == IntPtr.Zero) continue;
                        ShowWindow(pr.MainWindowHandle, 9);      // SW_RESTORE
                        SetForegroundWindow(pr.MainWindowHandle);
                        break;
                    }
                }
                catch (Exception ex) { Diag.Warn("boot", "唤醒已有实例失败: " + ex.Message); }
                Diag.Flush();
                return;
            }

            try
            {
                Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

                /*
                 * 这几行 boot 埋点是给「双击了没反应」这类问题留的证据。
                 *
                 * 起因：2026-11-11 有一次启动后既没有窗口、也没有日志、端口也不通，
                 * 日志停在上一条就没了 —— 光看日志分不清是卡在「构造窗体」
                 * 还是卡在「消息循环」还是卡在 WebView2 初始化。
                 * 有了这三行，下次一眼就能定位到哪一段。
                 *
                 * 注意 WebView2 的初始化在 InitAsync 里（Load 之后），
                 * 所以「主窗口构造完成」之后如果迟迟没有下面的会话结束，
                 * 问题就在 WebView2 那一段。
                 */
                Diag.Info("boot", "开始构造主窗口");
                var form = new MainForm();
                Diag.Info("boot", "主窗口构造完成，进入消息循环");
                Application.Run(form);
            }
            catch (Exception ex)
            {
                Diag.Fatal("boot", "Application.Run 抛出未处理异常", ex);
                CrashDialog(ex);
            }
            finally
            {
                Diag.Info("boot", "===== 会话结束 =====");
                Diag.Flush(TimeSpan.FromSeconds(3));
            }
        }

        /// <summary>
        /// 三道网，缺一不可：
        ///  · ThreadException       —— 界面线程上的异常（绝大多数用户能遇到的都在这里）
        ///  · UnhandledException    —— 任意线程彻底没接住的，进程即将死，只能留遗言
        ///  · UnobservedTaskException —— 被 async 吞掉的异常，不处理会静默消失
        /// </summary>
        private static void HookGlobalExceptions()
        {
            Application.ThreadException += (s, e) =>
            {
                Diag.Error("ui", "界面线程未处理异常", e.Exception);
                MessageBox.Show(
                    "出了点问题，但不影响已经存下的内容。\n\n" + e.Exception.Message +
                    "\n\n详细信息已记到日志：\n" + Diag.Dir,
                    "日签", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            };

            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                var ex = e.ExceptionObject as Exception;
                Diag.Fatal("domain", "进程级未处理异常，即将退出（IsTerminating=" + e.IsTerminating + "）", ex);
                // 进程要死了，必须同步把缓冲刷下去，否则这一段等于没记
                Diag.Flush(TimeSpan.FromSeconds(3));
                if (e.IsTerminating) CrashDialog(ex);
            };

            TaskScheduler.UnobservedTaskException += (s, e) =>
            {
                // 这类异常最容易不被发现：调用方没 await，错误就沉底了
                Diag.Error("task", "未观察的任务异常（某处 await 漏了）", e.Exception);
                e.SetObserved();   // 标成已处理，否则 .NET Framework 会直接把进程干掉
            };
        }

        /// <summary>
        /// 崩溃时给用户看的东西。不摊堆栈（看不懂），只告诉他两件事：
        /// 数据没丢，日志在哪。堆栈在日志文件里，需要时发给我就行。
        /// </summary>
        private static void CrashDialog(Exception ex)
        {
            try
            {
                MessageBox.Show(
                    "日签遇到严重错误，需要关掉了。\n\n" +
                    "你的日记和设置都在本地数据库里，不会因此丢失。\n\n" +
                    "错误： " + (ex?.Message ?? "未知") + "\n\n" +
                    "诊断日志已保存在：\n" + Diag.Dir + "\n\n" +
                    "重新打开即可继续使用；如果反复出现，把日志里最新的那个文件发给我。",
                    "日签 · 启动异常", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            catch { /* 弹窗都弹不出来就算了 */ }
        }
    }
}