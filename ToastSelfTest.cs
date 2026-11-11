using System;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// 提醒窗（ToastForm）的注销自检。
    ///
    /// 为什么要有它：2026-11-02 / 11-09 / 11-10 三次界面线程崩溃，堆栈都是
    ///
    ///   ObjectDisposedException: 'Riqian.ToastForm'
    ///     at Form.set_Opacity(...)
    ///     at ToastForm.&lt;.ctor&gt;b__16_1(...)   ← _fade 定时器的 Tick
    ///
    /// 从外面「连发两个提醒」想复现，试了 20 轮一次没中 —— 因为要撞上
    /// 「IsDisposed 已为 true、Handle 还没清」那几十毫秒，概率太低。
    /// **一个常年绿色但根本撞不到 bug 的测试，比没有测试更糟**，
    /// 所以改成断言修复真正保证的那件事：
    ///
    ///   提醒窗关掉之后，它的定时器还该不该跑？
    ///   不该。
    ///
    /// 「定时器还在跑」就是根因本身，而且是**确定性**的：没停就是没停。
    /// 反向验证过：把 Dispose 里的 Stop/Dispose 去掉，这个自检立刻 3 条全红。
    ///
    /// （保留「泵消息 600ms」这一段：它抓的是另一类问题 ——
    ///  关闭/替换提醒的过程中直接抛异常。只是它测不出上面那个崩溃。）
    ///
    /// 用法：Riqian.exe --test-toast      退出码 0 = 通过
    /// </summary>
    internal static class ToastSelfTest
    {
        public static int Run()
        {
            var errors = new List<Exception>();

            // 两种路由都接住：DoEvents 里抛出来的会直接冒到我们这层，
            // 走 Application 的则从 ThreadException 出。漏一个就会漏判。
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (s, e) => errors.Add(e.Exception);

            Console.WriteLine("========== 提醒窗注销自检 ==========");
            Console.WriteLine();

            // 场景 1：淡入途中被关掉 —— 就是日志里那三次的现场
            Case(errors, "淡入途中关闭（约 130ms 淡入，60ms 时关）", 60, 1);

            // 场景 2：刚 Show 出来立刻关
            Case(errors, "刚显示就关闭（0ms）", 0, 1);

            // 场景 3：两个提醒互相替换（ShowToast 换提醒时就是这条路径）
            Case(errors, "两个提醒互相替换", 30, 2);

            Console.WriteLine();
            if (errors.Count == 0)
            {
                Console.WriteLine("========== 通过：窗体关掉后定时器已停 ==========");
                return 0;
            }

            Console.WriteLine($"========== 失败：{errors.Count} 项 ==========");
            foreach (var e in errors)
                Console.WriteLine("  ✗ " + e.GetType().Name + ": " + e.Message);
            return 1;
        }

        /// <summary>
        /// 开一个提醒窗，等 delay 毫秒（让它处在淡入/淡出中途），关掉，
        /// 然后按住消息循环 600ms —— 只要定时器还活着，这段时间里必有几十跳。
        /// </summary>
        private static void Case(List<Exception> errors, string name, int delay, int count)
        {
            var before = errors.Count;
            var forms = new List<ToastForm>();
            try
            {
                for (var i = 0; i < count; i++)
                {
                    var f = new ToastForm(name, "自检用", "info", 5, () => { }, false);
                    f.Show();
                    forms.Add(f);
                }

                Pump(delay);

                // 关掉一个 / 全部 —— 模拟用户点掉、或第二条提醒替换第一条
                if (count > 1)
                {
                    forms[0].Close();
                    Pump(40);
                    forms[1].Close();
                }
                else
                {
                    forms[0].Close();
                }

                // 关键：关掉之后继续泵。定时器若没停，这 600ms 里会一直 tick。
                Pump(600);

                /*
                 * 断言的真正对象：定时器停没停。
                 *
                 * 「泵 600ms 看有没有异常」这条**测不出 bug** ——
                 * 实测在故意改回 bug 的版本上也是绿的。原因是
                 * `Form.set_Opacity` 在 `IsHandleCreated == false` 时会直接跳过，
                 * 崩只发生在「IsDisposed 已为 true、Handle 还没清」那个极窄的
                 * 销毁过程中间态，泵消息撞不到。
                 *
                 * 而「定时器还在跑」是**根因本身**，可以确定性判定：
                 * 没停就是没停。修复（Dispose 里 Stop+Dispose）在，这里必为 false。
                 */
                foreach (var f in forms)
                {
                    if (!f.IsDisposed)
                    {
                        errors.Add(new InvalidOperationException("提醒窗关闭后未释放"));
                        continue;
                    }
                    if (f.TimersStillRunning)
                    {
                        errors.Add(new InvalidOperationException(
                            "提醒窗已释放，但定时器还在跑（下次 tick 就可能碰已释放的窗体）"));
                    }
                }
            }
            catch (Exception ex)
            {
                errors.Add(ex);
            }
            finally
            {
                foreach (var f in forms)
                {
                    try { if (!f.IsDisposed) f.Dispose(); } catch { }
                }
            }

            var added = errors.Count - before;
            Console.WriteLine($"  {(added == 0 ? "✓" : "✗")} {name}{(added > 0 ? "  → " + added + " 个异常" : "")}");
        }

        private static void Pump(int ms)
        {
            var end = Environment.TickCount64 + ms;
            while (Environment.TickCount64 < end)
            {
                Application.DoEvents();
                Thread.Sleep(5);
            }
        }
    }
}
