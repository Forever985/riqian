using System;
using System.Windows.Forms;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// IShell 的桌面实现。
    ///
    /// 这个类存在的唯一理由：让 MainForm 的五个 partial 文件里那 400 多行
    /// 分发逻辑不再直接摸 Form 成员，从而能原样拿到安卓上编译。
    ///
    /// 每个方法都是**转发**，不在这里加业务判断 —— 一旦在这里写 if，
    /// 逻辑就又分叉了。判断属于 Dispatch，执行属于这里。
    /// </summary>
    internal sealed class ShellWindows : IShell
    {
        private readonly MainForm _f;

        public ShellWindows(MainForm f) { _f = f; }

        public void OpenPath(string path) => _f.OpenPathPublic(path);

        public string PickFolder(string startAt) => _f.PickFolderPublic(startAt);

        public object ImportMedia() => _f.MediaImportPublic();

        public object ImportMediaFolder() => _f.MediaImportFolderPublic();

        public void QuickCapture(string kind) => _f.QuickCapturePublic(kind);

        public void Minimize() => _f.MinimizePublic();

        public void Quit() => _f.QuitPublic();

        public object Notify(string title, string body)
        {
            // 桌面版的通知走完整链路（弹窗 + 托盘 + 设置里的开关），
            // 那套逻辑在 NotifyPush 里，这里不重复实现，直接借道。
            // 安卓版那边没有托盘概念，会给出自己的实现。
            return _f.NotifySimple(title, body);
        }
    }
}