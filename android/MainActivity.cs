using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;
using Android.Webkit;
using Android.Widget;
using Android.Views;
using Java.Interop;

namespace Riqian
{
    /// <summary>
    /// 日签安卓版的主界面：一个铺满的 WebView + 一层原生壳。
    ///
    /// 为什么不套 MAUI / Xamarin.Forms：真正要显示的东西只有一张 HTML。
    /// 引入一个跨平台 UI 框架只会多一层要适配的抽象，而它提供的东西
    /// （布局、控件）我们一个都不用 —— 界面全是 Web。
    ///
    /// 与桌面版的结构对照：
    ///   桌面：Form + WebView2，chrome.webview.postMessage 双向通信
    ///   安卓：Activity + Android.Webkit.WebView，WebMessagePort 双向通信
    ///
    /// 两者的差别只在**传输通道**上，消息格式 {id, m, a} / {id, ok, data, err}
    /// 完全一致。所以前端 api.ts 只需要换掉 HOST 那一个变量，其余 4 万行不动。
    /// </summary>
    [Activity(
        Label = "日签",
        MainLauncher = true,
        // 键盘弹出时不要让系统把整个页面往上顶，否则日记编辑时长文本会跳
        WindowSoftInputMode = SoftInput.AdjustResize,
        ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize | ConfigChanges.KeyboardHidden
                               | ConfigChanges.UiMode | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
    public class MainActivity : Activity
    {
        private WebView _web;
        private Db _db;
        private WebMessagePort[] _ports;

        /// <summary>
        /// 让 CsBridge 能回调回来。CsBridge 是被 JS 用 @JavascriptInterface 调用的，
        /// 它拿不到 Activity 的实例字段，只能靠这个静态引用。
        /// 只有一个 Activity，不存在多实例竞争。
        /// </summary>
        internal static MainActivity Current;

        protected override void OnCreate(Bundle savedInstanceState)
        {
            base.OnCreate(savedInstanceState);
            Current = this;

            /*
             * 全局兜底：没被接住的异常先写进日志文件，再弹一句人话。
             *
             * 为什么必须做：手机上出问题时用户只能看到「日签已停止运行」，
             * 没有堆栈、没有日志，等于完全瞎。而这类问题的第一现场
             * （数据库建表失败 / 原生库加载失败 / 权限被拦）恰好都在启动阶段。
             * 把堆栈落到文件里，用户把日志发出来就能定位 ——
             * 这比反复猜「是不是没装好」高效得多。
             */
            Android.Runtime.AndroidEnvironment.UnhandledExceptionRaiser += (s, e) =>
            {
                try
                {
                    Diag.Error("android.crash", "未捕获异常", e.Exception);
                    Alert("日签出错了", e.Exception?.ToString() ?? "未知错误");
                }
                catch { }
            };

            var root = AndroidDataRoot();
            PlatformAndroid.Register();

            /*
             * 数据库打开失败不能就这么崩掉。
             * 手机上最可能的两种原因：存储权限被系统拦、外部存储没挂载。
             * 这两种都不是「程序坏了」，要让用户看得懂、能自己处理。
             */
            try
            {
                _db = new Db(root);
            }
            catch (Exception ex)
            {
                Diag.Error("android.db", "打开数据库失败 root=" + root, ex);
                Alert("打不开数据目录", "位置：" + root + "\n\n" + ex.Message
                    + "\n\n数据在应用私有目录里，卸载应用会一起删掉。");
                return;
            }

            /*
             * 注册壳实现。和桌面版 MainForm 构造函数里那行一一对应。
             * 必须在这一步就装好：页面一加载完 JS 就会发 bootstrap，
             * 晚一步就有「依赖时序才不崩」的隐患。
             */
            Shell.Current = new ShellAndroid(this);
            RegisterHostHooks();
            AskNotificationPermission();

            _web = new WebView(this);
            SetContentView(_web);

            var settings = _web.Settings;
            // 界面产物在本地 assets 里，靠 assetLoader 映射成 https://appassets.androidplatform.net/
            // 这样页面有真实 origin，localStorage 才能用（about:blank 是 opaque origin）
            settings.JavaScriptEnabled = true;
            settings.DomStorageEnabled = true;
            settings.AllowFileAccess = false;
            settings.AllowContentAccess = false;
            settings.SetSupportZoom(false);
            settings.BuiltInZoomControls = false;
            settings.MediaPlaybackRequiresUserGesture = false;
            // 日记是中文，别让系统按语言自动缩放导致字号莫名变大
            settings.TextZoom = 100;

            _web.SetWebViewClient(new AssetClient());
            _web.SetWebChromeClient(new ChromeClient());

            _web.AddJavascriptInterface(new CsBridge(), "RiqianHost");

            _web.LoadUrl("https://appassets.androidplatform.net/assets/index.html");
        }

        /// <summary>
        /// 数据目录。
        ///
        /// Android 10 起引入分区存储，getExternalFilesDir 返回的路径
        /// 不需要任何权限就能读写，且用 USB 连电脑能直接访问到
        /// （Android/data/&lt;包名&gt;/files）。这对"日记得能自己拿走"很关键。
        /// </summary>
        /// <summary>
        /// 弹一个原生对话框说清楚出了什么事。
        ///
        /// 为什么不用 Toast：Toast 两秒就没了，而「打不开数据目录」这种信息
        /// 用户需要看完、需要截图给我们。对话框会停在那里等他点。
        /// </summary>
        private void Alert(string title, string message)
        {
            try
            {
                RunOnUiThread(() =>
                {
                    try
                    {
                        new AlertDialog.Builder(this)
                            .SetTitle(title)
                            .SetMessage(message)
                            .SetPositiveButton("知道了", (s, e) => { })
                            .Show();
                    }
                    catch { }
                });
            }
            catch { }
        }

        /// <summary>
        /// 数据目录。
        ///
        /// Android 10 起引入分区存储，getExternalFilesDir 返回的路径
        /// 不需要任何权限就能读写，且用 USB 连电脑能直接访问到
        /// （Android/data/&lt;包名&gt;/files）。这对"日记得能自己拿走"很关键。
        /// 不用 InternalFilesDir 的原因很实际 —— 那目录在非 root 设备上
        /// 用户根本看不见，日记是用户自己的东西，不该锁在一个他打不开的地方。
        /// </summary>
        private string AndroidDataRoot()
        {
            var dir = GetExternalFilesDir(null)?.AbsolutePath;
            if (string.IsNullOrEmpty(dir))
                dir = FilesDir.AbsolutePath;   // 没有外部存储时的兜底
            var root = Path.Combine(dir, "日签");
            Directory.CreateDirectory(root);
            return root;
        }

        protected override void OnDestroy()
        {
            // ⚠️ 必须 Dispose：Db 持有 SQLite 连接和 WAL 文件。
            // 不 checkpoint 直接让进程被杀，最后一次写入会留在 -wal 里没并回主库。
            // 桌面版栽过这个坑（见 Db.Dispose 的注释），手机更容易被杀进程，更不能漏。
            try { _db?.Dispose(); } catch { }
            base.OnDestroy();
        }

        /// <summary>
        /// 注册「分发层里各平台手段不同」的那些动作。
        ///
        /// 和桌面版的区别：桌面上有一整套（托盘、老板键、全局热键、贴桌面、调试网关），
        /// 手机上一个都没有对应物。这里**只注册真能实现的**，其余交给 Host 的默认降级
        /// —— 调用时得到「本平台不支持…」这种能看懂的话，而不是 NullReferenceException，
        /// 更不是假装成功（假装成功最坏：用户以为开了，实际没开）。
        /// </summary>
        private void RegisterHostHooks()
        {
            // 用系统浏览器 / 邮件客户端打开外链。WebView 里 mailto: 点了没反应，必须转到系统。
            Host.OpenExternalFn = (url) =>
            {
                try
                {
                    var uri = Android.Net.Uri.Parse(url ?? "");
                    StartActivity(new Intent(Intent.ActionView, uri));
                    return new { ok = true };
                }
                catch (Exception e) { return new { ok = false, err = e.Message }; }
            };

            // 屏幕信息：设置页的「关于」会显示；纯信息读取，手机上也能给。
            Host.ScreenInfoFn = () =>
            {
                try
                {
                    var dm = Resources?.DisplayMetrics;
                    var m = Resources?.DisplayMetrics;
                    var w = dm?.WidthPixels ?? 0;
                    var h = dm?.HeightPixels ?? 0;
                    var dpi = m?.DensityDpi ?? 0;
                    return new
                    {
                        ok = true,
                        width = w,
                        height = h,
                        dpi,
                        scale = m?.Density ?? 1f,
                        platform = "android",
                    };
                }
                catch (Exception e) { return new { ok = false, err = e.Message }; }
            };

            /*
             * 提醒：走系统通知（ShellAndroid.Notify 已经实现了 NotificationManager）。
             * 这里直接复用，不另写一套。
             */
            Host.NotifyPushFn = (a) =>
            {
                try
                {
                    var title = RpcArgs.S(a, "title", "日签");
                    var body = RpcArgs.S(a, "body", "");
                    return Shell.Current.Notify(title, body);
                }
                catch (Exception e) { return new { ok = false, err = e.Message }; }
            };

            /* 托盘 / 老板键 / 悬浮球 / 全局热键 / 贴桌面 / 调试网关：
               手机上没有这些概念，**一个都不注册**。Host 会返回「本平台不支持」。 */
        }

        /// <summary>
        /// 打开系统文件选择器（选图片/音频/视频）。
        ///
        /// 用 ACTION_OPEN_DOCUMENT 而不是 READ_EXTERNAL_STORAGE：
        /// 前者是 SAF，用户选哪个我们只能读那个，**不需要任何存储权限**；
        /// 后者要在清单里声明「读取所有文件」，用户看到就不敢装了。
        ///
        /// 注意这是异步的：RPC 只能立刻返回 pending，选完之后在 OnActivityResult
        /// 里真正导入，然后通知界面刷新（__HOST_CMD__('media:changed')）。
        /// </summary>
        internal void StartPickFiles()
        {
            try
            {
                var intent = new Intent(Intent.ActionOpenDocument);
                intent.AddCategory(Intent.CategoryOpenable);
                intent.SetType("*/*");
                intent.PutExtra(Intent.ExtraAllowMultiple, true);
                StartActivityForResult(intent, ReqPickFiles);
            }
            catch (Exception e)
            {
                Toast.MakeText(this, "打不开文件选择器：" + e.Message, ToastLength.Short)?.Show();
            }
        }

        private const int ReqPickFiles = 1001;

        protected override void OnActivityResult(int requestCode, Result resultCode, Intent data)
        {
            base.OnActivityResult(requestCode, resultCode, data);
            if (requestCode != ReqPickFiles || resultCode != Result.Ok || data == null) return;

            var temps = new System.Collections.Generic.List<string>();
            try
            {
                var uris = new System.Collections.Generic.List<Android.Net.Uri>();
                if (data.ClipData != null)
                {
                    for (var i = 0; i < data.ClipData.ItemCount; i++)
                    {
                        var u = data.ClipData.GetItemAt(i)?.Uri;
                        if (u != null) uris.Add(u);
                    }
                }
                if (data.Data != null && uris.Count == 0) uris.Add(data.Data);

                var tmpDir = System.IO.Path.Combine(CacheDir.AbsolutePath, "import");
                System.IO.Directory.CreateDirectory(tmpDir);

                foreach (var u in uris)
                {
                    /*
                     * content:// 不是文件路径，Db 那边要的是真实路径。
                     * 所以先原样拷到缓存目录再导入 —— 导入完成后立刻删掉副本，
                     * 不然每导一次就多占一份空间。
                     */
                    var name = QueryDisplayName(u) ?? ("导入_" + Guid.NewGuid().ToString("N").Substring(0, 8));
                    var safe = string.Join("_", name.Split(System.IO.Path.GetInvalidFileNameChars()));
                    var tmp = System.IO.Path.Combine(tmpDir, safe);
                    using (var input = ContentResolver.OpenInputStream(u))
                    using (var output = System.IO.File.Create(tmp))
                    {
                        input?.CopyTo(output);
                    }
                    temps.Add(tmp);
                }

                object result = null;
                if (temps.Count > 0) result = _db.MediaImportFiles(temps.ToArray());

                var okCount = 0;
                try
                {
                    var t = result?.GetType().GetProperty("items")?.GetValue(result) as System.Collections.IEnumerable;
                    if (t != null) foreach (var _ in t) okCount++;
                }
                catch { }
                Toast.MakeText(this, okCount > 0 ? $"已导入 {okCount} 个文件" : "没有导入任何文件", ToastLength.Short)?.Show();

                // 让界面刷新媒体库（这条命令是给安卓加的，桌面不走）
                RunOnUiThread(() => _web?.EvaluateJavascript("window.__HOST_CMD__ && window.__HOST_CMD__('media:changed')", null));
            }
            catch (Exception e)
            {
                Toast.MakeText(this, "导入失败：" + e.Message, ToastLength.Long)?.Show();
                Diag.Error("android.import", "导入媒体失败", e);
            }
            finally
            {
                foreach (var f in temps) { try { System.IO.File.Delete(f); } catch { } }
            }
        }

        /// <summary>从 content:// 里问出原始文件名，问不到就返回 null（调用方给个兜底名）。</summary>
        private string QueryDisplayName(Android.Net.Uri uri)
        {
            try
            {
                using var c = ContentResolver.Query(uri, null, null, null, null);
                if (c != null && c.MoveToFirst())
                {
                    var idx = c.GetColumnIndex(Android.Provider.OpenableColumns.DisplayName);
                    if (idx >= 0) return c.GetString(idx);
                }
            }
            catch { }
            return null;
        }

        /// <summary>发一条系统通知。安卓 8 起必须先建渠道，否则通知静默丢弃。</summary>
        internal void ShowNotification(string title, string body)
        {
            const string chanId = "riqian_remind";
            var nm = (NotificationManager)GetSystemService(NotificationService);
            if (nm == null) return;

            if (Build.VERSION.SdkInt >= BuildVersionCodes.O)
            {
                var chan = new NotificationChannel(chanId, "日签提醒", NotificationImportance.Default)
                {
                    Description = "打卡、待办、倒计时的到点提醒",
                };
                nm.CreateNotificationChannel(chan);
            }

            var intent = new Intent(this, typeof(MainActivity));
            intent.AddFlags(ActivityFlags.SingleTop);
            var pi = PendingIntent.GetActivity(this, 0, intent,
                Build.VERSION.SdkInt >= BuildVersionCodes.M ? PendingIntentFlags.Immutable : 0);

            /*
             * 两个构造函数的差别是真会崩的：
             *   · Builder(Context, channelId) 是 API 26 才有的
             *   · minSdk 是 24，在 24/25 的设备上直接调会 NoSuchMethodError
             * 所以按版本分支。老设备上不发通知只是少个提醒，不该整个应用崩掉。
             */
            var nb = Build.VERSION.SdkInt >= BuildVersionCodes.O
                ? new Notification.Builder(this, chanId)
                : new Notification.Builder(this);

            var n = nb
                .SetContentTitle(title ?? "日签")
                .SetContentText(body ?? "")
                .SetSmallIcon(Android.Resource.Drawable.IcDialogInfo)
                .SetContentIntent(pi)
                .SetAutoCancel(true)
                .Build();
            nm.Notify(1, n);
        }        /// <summary>
        /// Android 13（API 33）起，发通知要先拿到运行时权限，否则 Notify 静默丢弃 ——
        /// 用户看到的是「提醒功能没反应」，且没有任何报错。
        ///
        /// 只问一次（系统自己会记住「拒绝过」），拒绝也不影响主功能：
        /// 日记本的核心是记录，提醒是附加项。
        /// </summary>
        private void AskNotificationPermission()
        {
            try
            {
                if (Build.VERSION.SdkInt < BuildVersionCodes.Tiramisu) return;
                if (CheckSelfPermission("android.permission.POST_NOTIFICATIONS") == Android.Content.PM.Permission.Granted)
                    return;
                RequestPermissions(new[] { "android.permission.POST_NOTIFICATIONS" }, ReqNotifyPerm);
            }
            catch (Exception e)
            {
                Diag.Warn("android.perm", "申请通知权限失败：" + e.Message);
            }
        }

        private const int ReqNotifyPerm = 1002;

        /// <summary>把页面里的资源请求指到 assets。</summary>
        private sealed class AssetClient : WebViewClient
        {
            public override WebResourceResponse ShouldInterceptRequest(WebView view, IWebResourceRequest request)
            {
                var url = request.Url?.ToString() ?? "";

                /*
                 * riqian.local 是**媒体库**的虚拟主机，不是界面资源。
                 *
                 * 桌面上这一条是 WebView2 的 SetVirtualHostNameToFolderMapping 做的
                 * （见 MainForm.MapMedia）。安卓没有那个 API，如果不在这里接住，
                 * 前端拼出来的每一张图都会 404 —— 表现是「日记里图片全裂、背景全白」，
                 * 而数据其实完好。这是换壳时最容易漏的一处，因为界面本身能正常显示。
                 */
                if (url.StartsWith("https://riqian.local/"))
                {
                    var a = MainActivity.Current;
                    if (a?._db == null) return NotFound("no db");
                    var rel = Uri.UnescapeDataString(url.Substring("https://riqian.local/".Length));
                    return ServeFile(a._db.MediaDir, rel);
                }

                if (!url.StartsWith("https://appassets.androidplatform.net/")) return null;

                var relAsset = url.Substring("https://appassets.androidplatform.net/".Length);
                try
                {
                    var stream = view.Context.Assets.Open(relAsset);
                    return new WebResourceResponse(MimeOf(relAsset), "UTF-8", stream);
                }
                catch
                {
                    return NotFound("not found: " + relAsset);
                }
            }

            /// <summary>
            /// 从媒体目录里取一个文件。
            ///
            /// 必须防目录穿越：rel 里可能出现 ../，拼接之后就能读到数据目录以外的文件。
            /// 这里用「解析成绝对路径后确认它确实在 mediaDir 之下」，而不是简单地
            /// 过滤 "../" —— 后者能被 %2e%2e%2f 之类的编码绕过去。
            /// </summary>
            private static WebResourceResponse ServeFile(string mediaDir, string rel)
            {
                try
                {
                    var rootFull = System.IO.Path.GetFullPath(mediaDir);
                    var target = System.IO.Path.GetFullPath(System.IO.Path.Combine(rootFull, rel));
                    if (!target.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
                        return NotFound("forbidden");
                    if (!System.IO.File.Exists(target)) return NotFound("miss: " + rel);

                    // 图片可能被删了又被人拿着旧 URL 请求，这里给 404 而不是抛异常 ——
                    // 抛异常会把整个 WebView 的请求链打断，后续图片也跟着不显示。
                    var fs = System.IO.File.OpenRead(target);
                    var resp = new WebResourceResponse(MimeOf(rel), null, fs);
                    if (Build.VERSION.SdkInt >= BuildVersionCodes.Lollipop)
                    {
                        resp.ResponseHeaders = new System.Collections.Generic.Dictionary<string, string>
                        {
                            // 媒体文件按内容哈希命名，内容不会变，可以放心长缓存
                            ["Cache-Control"] = "public, max-age=31536000, immutable",
                        };
                    }
                    return resp;
                }
                catch (Exception e)
                {
                    return NotFound("err: " + e.Message);
                }
            }

            private static WebResourceResponse NotFound(string why)
                => new WebResourceResponse("text/plain", "UTF-8",
                    new MemoryStream(System.Text.Encoding.UTF8.GetBytes(why)));

            private static string MimeOf(string path)
            {
                var p = path.ToLowerInvariant();
                if (p.EndsWith(".html") || p.EndsWith(".htm")) return "text/html";
                if (p.EndsWith(".js")) return "application/javascript";
                if (p.EndsWith(".css")) return "text/css";
                if (p.EndsWith(".woff2")) return "font/woff2";
                if (p.EndsWith(".svg")) return "image/svg+xml";
                if (p.EndsWith(".png")) return "image/png";
                if (p.EndsWith(".jpg") || p.EndsWith(".jpeg")) return "image/jpeg";
                if (p.EndsWith(".webp")) return "image/webp";
                if (p.EndsWith(".gif")) return "image/gif";
                if (p.EndsWith(".mp3")) return "audio/mpeg";
                if (p.EndsWith(".m4a")) return "audio/mp4";
                if (p.EndsWith(".wav")) return "audio/wav";
                if (p.EndsWith(".ogg")) return "audio/ogg";
                if (p.EndsWith(".flac")) return "audio/flac";
                if (p.EndsWith(".mp4")) return "video/mp4";
                if (p.EndsWith(".webm")) return "video/webm";
                return "application/octet-stream";
            }
        }

        private sealed class ChromeClient : WebChromeClient
        {
            // 保留给后续：console 输出、进度条、文件选择器（媒体导入要用）
        }

        /// <summary>
        /// JS → C# 的入口。
        ///
        /// 用 @JavascriptInterface 而不是 WebMessagePort 做请求方向，是因为
        /// 前者是**同步可达**的：页面里 window.RiqianHost.call(json) 直接返回字符串，
        /// 前端 rpc() 那个 Promise 立刻能 resolve，改动最小。
        ///
        /// 注意：JavascriptInterface 的方法运行在 WebView 的 JavaBridge 线程，
        /// 不是 UI 线程。所以这里**绝对不能碰任何 View**。
        /// 本次实现里所有 RPC 都是纯数据操作，天然满足；以后若要加"弹原生窗口"
        /// 之类的能力，必须切回 RunOnUiThread。
        /// </summary>
        private sealed class CsBridge : Java.Lang.Object
        {
            [JavascriptInterface]
            [Java.Interop.Export("call")]
            public string Call(string payload)
            {
                long id = 0;
                try
                {
                    using var doc = JsonDocument.Parse(payload ?? "{}");
                    var root = doc.RootElement;
                    id = root.TryGetProperty("id", out var idEl) ? idEl.GetInt64() : 0;
                    var m = root.GetProperty("m").GetString();
                    var a = root.TryGetProperty("a", out var aEl) ? aEl.Clone() : default;

                    var data = Current?._db == null
                        ? new { ok = false, err = "数据库还没打开" }
                        : RpcDispatcher.Invoke(Current._db, m, a);

                    return JsonSerializer.Serialize(new { id, ok = true, data, err = (string)null },
                        JsonOpts);
                }
                catch (Exception ex)
                {
                    return JsonSerializer.Serialize(new { id, ok = false, data = (object)null, err = ex.Message },
                        JsonOpts);
                }
            }

            private static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
            {
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            };
        }
    }
}