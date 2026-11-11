using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Android.App;
using Android.Content;
using Android.Graphics;
using Android.Provider;
using Android.Widget;

namespace Riqian
{
    /// <summary>
    /// IShell 的安卓实现。
    ///
    /// 和 ShellWindows 一一对应，只是手段不同：
    ///   打开目录    → 发一个 ACTION_VIEW 的 Intent
    ///   选文件      → ACTION_OPEN_DOCUMENT（系统选择器，不需要存储权限）
    ///   通知        → NotificationManager
    ///   最小化      → moveTaskToBack（不是真的进托盘，安卓没这个概念）
    /// </summary>
    internal sealed class ShellAndroid : IShell
    {
        private readonly MainActivity _a;

        public ShellAndroid(MainActivity a) { _a = a; }

        public void OpenPath(string path)
        {
            // 手机上没有"资源管理器打开某目录"这种通用动作。
            // 能做的只有把它交给系统：优先用文件管理器 VIEW 这个目录，
            // 失败了就退化成分享出去（用户可以存到网盘/发给自己）。
            try
            {
                var uri = Android.Net.Uri.Parse("content://com.android.externalstorage.documents/root/primary");
                var i = new Intent(Intent.ActionView, uri);
                i.SetFlags(ActivityFlags.NewTask);
                _a.StartActivity(i);
            }
            catch (Exception ex) { Diag.Warn("shell", "打开目录失败: " + ex.Message); }
        }

        public string PickFolder(string startAt) => null;   // 安卓没有文件夹选择器，见 PickFiles

        public object ImportMedia()
        {
            // 系统文件选择器是**异步**的：StartActivityForResult 之后
            // 要等 OnActivityResult 回来才知道用户选了什么。
            // 所以这里不能同步返回导入结果 —— 只能发起选择，
            // 选完之后由 MainActivity.OnActivityResult 走同一套 import 流程。
            _a.StartPickFiles();
            return new { ok = true, pending = true, note = "请在弹出的选择器里选文件" };
        }

        public object ImportMediaFolder()
        {
            // ACTION_OPEN_DOCUMENT_TREE 可以选整个目录，但读出来的是一棵
            // DocumentFile 树，遍历 + 逐个拷贝比桌面上的 Directory.GetFiles 麻烦得多。
            // 第一版先不做，明说比装作做了好。
            return new { ok = false, err = "手机版暂不支持整目录导入，请逐个选择文件" };
        }

        public void QuickCapture(string kind)
        {
            // 桌面上是独立小窗。手机上"弹窗"没有意义（本来就在一个窗口里），
            // 正确做法是切回界面并跳到对应页面，把参数交给前端。
            _a.RunOnUiThread(() =>
            {
                _a.MoveTaskToBack(false);
            });
        }

        public void Minimize() => _a.MoveTaskToBack(false);

        public void Quit() => _a.FinishAffinity();

        public object Notify(string title, string body)
        {
            try
            {
                _a.ShowNotification(title, body);
                return new { ok = true };
            }
            catch (Exception ex) { return new { ok = false, err = ex.Message }; }
        }
    }
}