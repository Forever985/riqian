using System;
using System.Text.Json;

namespace Riqian
{
    /// <summary>
    /// RPC 分发时需要、但各平台实现方式不同的那几个动作。
    ///
    /// 为什么要有这个接口：Dispatch 里 297 个方法，真正依赖窗体的只有 7 个 ——
    /// 打开目录、选文件夹、导入文件、弹日记速记、最小化/隐藏/退出。
    /// 剩下的 290 个全是 db.XXX(...)，和数据层一样是纯逻辑。
    ///
    /// 把它们隔成一个接口，Dispatch 就能抽成**两端共用的同一个文件**，
    /// 而不是各维护一份。这一点很关键：两份分发逻辑必然分叉，
    /// 而"手机上调某个接口静默没反应"这种问题，报出来的时候已经过去很久了，
    /// 那时谁也想不起是哪次改动只改了一半。
    ///
    /// 桌面版实现见 ShellWindows（MainForm 那边的窗体操作）；
    /// 安卓版实现见 ShellAndroid（Intent、文件选择器等）。
    /// </summary>
    public interface IShell
    {
        /// <summary>用系统默认方式打开一个目录（资源管理器 / 文件管理器）。</summary>
        void OpenPath(string path);

        /// <summary>选一个目录，取消返回 null。</summary>
        string PickFolder(string startAt);

        /// <summary>
        /// 选若干文件并导入媒体库，返回导入结果。取消时 ok=false。
        /// 注意返回的是**业务结果对象**而不是文件列表 ——
        /// 因为各平台的导入流程不同（桌面直接读路径，安卓要先复制到私有目录）。
        /// </summary>
        object ImportMedia();

        /// <summary>整个文件夹递归导入。</summary>
        object ImportMediaFolder();

        /// <summary>
        /// 弹出速记窗。kind 是 "diary" / "note" / "todo" 三种之一 ——
        /// 这三者在桌面上是同一个窗、不同预设，参数必须保留，
        /// 否则"快速记笔记"会变成"写日记"。
        /// </summary>
        void QuickCapture(string kind);

        /// <summary>最小化 / 收进托盘 / 退到后台，各平台语义自定。</summary>
        void Minimize();

        /// <summary>彻底退出（手机上是 finish 并结束进程）。</summary>
        void Quit();

        /// <summary>发一条系统通知，返回是否成功。</summary>
        object Notify(string title, string body);
    }

    /// <summary>
    /// 给 Dispatch 用的空实现：所有壳操作都返回「本平台不支持」，而不是抛异常。
    ///
    /// 为什么不抛：一个未实现的通知能力不该让整次调用 500。
    /// 前端拿到 ok:false 会显示一句人话，用户知道"这个功能手机上还没有"；
    /// 抛异常则会被包装成 RPC 框架错误，看起来像程序坏了。
    /// </summary>
    public class ShellNone : IShell
    {
        public void OpenPath(string path) { }
        public string PickFolder(string startAt) => null;
        public object ImportMedia() => new { ok = false, err = "本平台暂不支持选文件导入" };
        public object ImportMediaFolder() => new { ok = false, err = "本平台暂不支持选文件夹导入" };
        public void QuickCapture(string kind) { }
        public void Minimize() { }
        public void Quit() { }
        public object Notify(string title, string body) => new { ok = false, err = "本平台暂不支持通知" };
    }

    /// <summary>
    /// 当前壳实现的静态入口。
    ///
    /// 为什么用静态字段而不是依赖注入传下去：Dispatch 是 MainForm 的实例方法，
    /// 挂在 partial class 的五个文件里，改签名要动 400 多行。而壳实现
    /// 一个进程只有一个，静态入口反而更符合事实，也不会在调用链上传错。
    ///
    /// 默认值是 ShellNone 而不是 null：忘了注册时得到的是"这个功能本平台没有"
    /// 这种能看懂的结果，而不是 NullReferenceException。
    /// </summary>
    public static class Shell
    {
        public static IShell Current { get; set; } = new ShellNone();

        public static void OpenPath(string p) => Current.OpenPath(p);
        public static string PickFolder(string start) => Current.PickFolder(start);
        public static object ImportMedia() => Current.ImportMedia();
        public static object ImportMediaFolder() => Current.ImportMediaFolder();
        public static void QuickCapture(string kind) => Current.QuickCapture(kind);
        public static void Minimize() => Current.Minimize();
        public static void Quit() => Current.Quit();
        public static object Notify(string t, string b) => Current.Notify(t, b);
    }
}