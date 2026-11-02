using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// 给 AI 用的本地调试网关。
    ///
    /// **为什么需要它**：日签的所有能力都在 227 个 RPC 里，但那些 RPC 跑在 WebView2 的
    /// 进程内消息通道上 —— 外部程序（命令行、脚本、AI Agent）一个都够不着。
    /// 想验证「加了新接口有没有通」只能靠 Playwright 开着 CDP 手动点，效率极低。
    ///
    /// **它做什么**：在 127.0.0.1 上开一个极小的 HTTP 服务，把 HTTP 请求翻译成内部
    /// Dispatch 调用。于是任何能发 HTTP 的东西都能操作日签、读日志、查接口清单。
    ///
    /// **安全边界**（这几条是硬要求，不是建议）：
    ///  1. 默认**关闭**。必须在设置里手动打开，或加启动参数 `--debug-api=端口`。
    ///     一个私人日记本不该默认对外开端口。
    ///  2. 只绑 `127.0.0.1`（回环），不绑 0.0.0.0。局域网里别的机器连不上。
    ///  3. 必须带 token。token 每次启动随机生成，写在 `%APPDATA%\Riqian\debug-api.json`，
    ///     只有本机用户能读。防止同机的其它程序趁虚而入。
    ///  4. 所有调用串行进 UI 线程执行。**这是硬性的** —— 数据库用的是单个 SqliteConnection
    ///     且没有加锁，两个线程同时访问会直接把库写坏。
    /// </summary>
    public static class DebugApi
    {
        private const string Prefix = "http://127.0.0.1:";
        private static HttpListener _listener;
        private static Thread _thread;
        private static Control _ui;
        private static Func<string, JsonElement, object> _dispatch;
        private static string _token = "";
        private static int _port;
        private static volatile bool _running;

        public static bool IsRunning => _running;
        public static int Port => _port;
        public static string TokenForShow => _token;

        /// <summary>
        /// token 文件放哪。**必须和 MainForm.ConfigDir 用同一套判据**。
        ///
        /// 以前这里写死 %APPDATA%\Riqian，便携版（绿色版）启动后会把
        /// debug-api.json 扔到 %APPDATA% 去 —— 用户「拷走文件夹就完整迁移」
        /// 的承诺当场破了一半：数据在文件夹里，token 文件留在系统盘。
        /// 更糟的是绿色版和安装版会互相覆盖这个文件，探针读到上一个进程的 token。
        ///
        /// 判据只能有一处（MainForm.IsPortable），这里复用，不自己再猜一遍路径。
        /// </summary>
        public static string InfoFile =>
            Path.Combine(MainForm.ConfigDir, "debug-api.json");

        /// <summary>
        /// 启动网关。
        /// </summary>
        /// <param name="port">端口。0 表示让系统分配一个空闲端口（推荐，避免撞端口）。</param>
        /// <param name="ui">UI 控件，用来把调用切回主线程（调用方必须传窗体自身或其子控件）</param>
        /// <param name="dispatch">实际的分发函数，通常就是 MainForm.Dispatch</param>
        public static string Start(int port, Control ui, Func<string, JsonElement, object> dispatch)
        {
            if (_running) return "已在运行（端口 " + _port + "）";
            if (ui == null) throw new ArgumentNullException(nameof(ui));

            try
            {
                _ui = ui;
                _dispatch = dispatch;
                _token = NewToken();

                // port=0 时先试系统分配；但 HttpListener 不支持 0，得自己找个空闲端口
                _port = port > 0 ? port : FreePort();

                _listener = new HttpListener();
                _listener.Prefixes.Add(Prefix + _port + "/");
                _listener.Start();

                _running = true;
                _thread = new Thread(Loop) { IsBackground = true, Name = "riqian-debugapi" };
                _thread.Start();

                WriteInfoFile();
                Diag.Info("debugapi", "调试网关已开启 http://127.0.0.1:" + _port + "/  用法见 " + InfoFile);
                return null;
            }
            catch (Exception ex)
            {
                _running = false;
                Diag.Error("debugapi", "启动失败（端口 " + port + "）: " + ex.Message, ex);
                return ex.Message;
            }
        }

        public static void Stop()
        {
            try
            {
                _running = false;
                _listener?.Stop();
                _listener?.Close();
                _listener = null;
                Diag.Info("debugapi", "调试网关已关闭");
            }
            catch (Exception ex) { Diag.Warn("debugapi", "关闭时出错", ex); }
        }

        private static string NewToken()
        {
            var b = new byte[24];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create()) rng.GetBytes(b);
            return Convert.ToBase64String(b).Replace("+", "").Replace("/", "").Replace("=", "");
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            var p = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return p;
        }

        private static void WriteInfoFile()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(InfoFile));
                var info = new
                {
                    hint = "把这个文件的内容给 AI，它就知道怎么调日签了。用完记得在设置里关掉。",
                    baseUrl = Prefix + _port,
                    port = _port,
                    token = _token,
                    startedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    pid = Environment.ProcessId,
                    examples = new
                    {
                        health = "GET /health  （不需要 token）",
                        listMethods = "GET /methods  （header: X-Token: " + _token + "）",
                        callRpc = "POST /rpc  body: {\"m\":\"bootstrap\",\"a\":{}}",
                        readLogs = "GET /logs?lines=200",
                        note = "所有请求除 /health 外都要带 X-Token 头"
                    }
                };
                File.WriteAllText(InfoFile, JsonSerializer.Serialize(info,
                    new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }),
                    new UTF8Encoding(false));
            }
            catch (Exception ex) { Diag.Warn("debugapi", "写 info 文件失败", ex); }
        }

        /* ---------------- HTTP 主循环 ---------------- */

        private static void Loop()
        {
            while (_running)
            {
                HttpListenerContext ctx;
                try { ctx = _listener.GetContext(); }
                catch (Exception ex)
                {
                    if (_running) Diag.Warn("debugapi", "接受连接失败: " + ex.Message);
                    break;
                }

                // 每个请求单独线程处理：一个慢调用不该把整个网关堵住
                ThreadPool.QueueUserWorkItem(_ => { try { Handle(ctx); } catch { } });
            }
        }

        private static void Handle(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var res = ctx.Response;
            var path = req.Url.AbsolutePath.TrimEnd('/').ToLowerInvariant();
            if (path == "") path = "/";

            try
            {
                // CORS：允许本机页面/工具直接调用（网关本来就只听回环，不存在跨机器风险）
                res.Headers["Access-Control-Allow-Origin"] = "*";
                res.Headers["Access-Control-Allow-Headers"] = "X-Token, Content-Type";
                res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                if (req.HttpMethod == "OPTIONS") { res.StatusCode = 204; res.Close(); return; }

                // /health 是唯一不需要 token 的：用来探活，不含任何数据
                if (path == "/health" || path == "/")
                {
                    Json(res, new
                    {
                        ok = true,
                        app = "日签",
                        version = Diag.AppVersion,
                        pid = Environment.ProcessId,
                        uptime = (DateTime.Now - _startedAt).ToString(@"hh\:mm\:ss"),
                        needsToken = true
                    });
                    return;
                }

                if (!CheckToken(req))
                {
                    Diag.Warn("debugapi", "拒绝了一个没带对 token 的请求: " + path);
                    res.StatusCode = 401;
                    Json(res, new { ok = false, err = "token 不对。看 %APPDATA%\\Riqian\\debug-api.json" });
                    return;
                }

                switch (path)
                {
                    case "/methods":
                        Json(res, RunOnUi(() => RpcCatalog.List(IntParam(req, "limit", 0))));
                        return;

                    case "/method":
                        Json(res, RunOnUi(() => RpcCatalog.Describe(req.QueryString["name"])));
                        return;

                    case "/logs":
                        Json(res, new
                        {
                            ok = true,
                            text = Diag.Tail(IntParam(req, "lines", 200), req.QueryString["day"]),
                            stats = Diag.Stats()
                        });
                        return;

                    case "/stats":
                        Json(res, new { ok = true, stats = Diag.Stats(), env = Diag.Snapshot() });
                        return;

                    case "/rpc":
                        HandleRpc(req, res);
                        return;

                    default:
                        res.StatusCode = 404;
                        Json(res, new
                        {
                            ok = false,
                            err = "没有这个路径",
                            available = new[] { "/health", "/methods", "/method?name=", "/rpc", "/logs", "/stats" }
                        });
                        return;
                }
            }
            catch (Exception ex)
            {
                Diag.Error("debugapi", "处理请求失败 " + req.HttpMethod + " " + path, ex);
                try { res.StatusCode = 500; Json(res, new { ok = false, err = ex.Message }); } catch { }
            }
        }

        private static DateTime _startedAt = DateTime.Now;

        private static bool CheckToken(HttpListenerRequest req)
        {
            var t = req.Headers["X-Token"] ?? req.QueryString["token"];
            return !string.IsNullOrEmpty(t) && string.Equals(t, _token, StringComparison.Ordinal);
        }

        private static void HandleRpc(HttpListenerRequest req, HttpListenerResponse res)
        {
            string body;
            using (var sr = new StreamReader(req.InputStream, Encoding.UTF8)) body = sr.ReadToEnd();
            if (string.IsNullOrWhiteSpace(body)) { res.StatusCode = 400; Json(res, new { ok = false, err = "body 是空的" }); return; }

            string method;
            JsonElement args;
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                // 两种写法都收：{"m":"x","a":{}}  或者 {"method":"x","args":{}}
                method = root.TryGetProperty("m", out var m1) ? m1.GetString()
                       : root.TryGetProperty("method", out var m2) ? m2.GetString() : null;
                args = root.TryGetProperty("a", out var a1) ? a1.Clone()
                     : root.TryGetProperty("args", out var a2) ? a2.Clone()
                     : JsonDocument.Parse("{}").RootElement.Clone();
            }
            catch (Exception ex)
            {
                res.StatusCode = 400;
                Json(res, new { ok = false, err = "body 不是合法 JSON: " + ex.Message });
                return;
            }

            if (string.IsNullOrEmpty(method)) { res.StatusCode = 400; Json(res, new { ok = false, err = "缺 m 字段" }); return; }

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var data = RunOnUi(() => _dispatch(method, args));
                sw.Stop();
                Diag.Info("debugapi", "RPC " + method + " 成功 " + sw.ElapsedMilliseconds + "ms" +
                          " · 参数 " + Diag.Redact(args.GetRawText(), 300, method));
                Json(res, new { ok = true, data, ms = sw.ElapsedMilliseconds });
            }
            catch (Exception ex)
            {
                sw.Stop();
                // 这里不抛出，返回结构化错误 —— AI 拿到 err 比拿到 500 更有用
                Diag.Error("debugapi", "RPC " + method + " 失败 " + sw.ElapsedMilliseconds + "ms" +
                           " · 参数 " + Diag.Redact(args.GetRawText(), 300, method), ex);
                Json(res, new
                {
                    ok = false,
                    err = ex.Message,
                    type = ex.GetType().Name,
                    ms = sw.ElapsedMilliseconds,
                    hint = "看 /logs 或 %APPDATA%\\Riqian\\logs 里的完整堆栈"
                });
            }
        }

        /// <summary>
        /// 把一段操作搬到 UI 线程执行并等结果。
        ///
        /// **必须这么做**：数据库是单个 SqliteConnection 且没加锁，
        /// HTTP 线程直接调会和界面线程同时用同一个连接，轻则报 "database is locked"，
        /// 重则把库写坏。串行化是唯一安全的做法。
        /// </summary>
        private static object RunOnUi(Func<object> fn)
        {
            if (_ui == null || _ui.IsDisposed) return fn();     // 窗体没了就直连（退出流程里）
            if (!_ui.InvokeRequired) return fn();

            object result = null;
            Exception error = null;
            _ui.Invoke(new Action(() =>
            {
                try { result = fn(); }
                catch (Exception ex) { error = ex; }
            }));

            if (error != null) throw error;
            return result;
        }

        private static void Json(HttpListenerResponse res, object payload)
        {
            try
            {
                var text = JsonSerializer.Serialize(payload, new JsonSerializerOptions
                {
                    Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
                    WriteIndented = false
                });
                var bytes = Encoding.UTF8.GetBytes(text);
                res.ContentType = "application/json; charset=utf-8";
                res.ContentLength64 = bytes.Length;
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
            catch (Exception ex) { Diag.Warn("debugapi", "写响应失败", ex); }
            finally { try { res.Close(); } catch { } }
        }

        private static int IntParam(HttpListenerRequest req, string k, int def)
        {
            var s = req.QueryString[k];
            return int.TryParse(s, out var n) ? n : def;
        }
    }
}