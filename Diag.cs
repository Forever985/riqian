using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace Riqian
{
    public enum LogLevel { Trace = 0, Info = 1, Warn = 2, Error = 3, Fatal = 4 }

    /// <summary>
    /// 统一日志。之前全项目散着 89 处 Debug.WriteLine，那些东西在 Release 版里被直接丢弃
    /// —— 用户报「出错了」，我们手上一个字都没有，只能靠猜。这个类就是来收编它们的。
    ///
    /// 设计上守着几条硬要求：
    ///  1. **绝不抛异常**。日志系统自己崩了比没日志还糟。所有写入路径都包在 try/catch 里，
    ///     写不下去就安静吞掉（并记一个内存里的失败计数，自诊断时能看到）。
    ///  2. **不阻塞调用方**。落盘走后台线程 + 队列。RPC 路径上每次调用都打日志，
    ///     同步写盘会把界面拖出肉眼可见的卡顿。
    ///  3. **按天滚动**。`logs/2026-11-01.log`，超过保留天数自动清。
    ///  4. **脱敏**。日记正文、密码这类东西不进日志（见 <see cref="Redact"/>）。
    ///  5. **崩溃可回溯**。进程要是直接挂了，队列里还没落盘的内容会丢，
    ///     所以 Error 及以上是**同步写**（宁可慢一点，也要保证 crash 前那行落地）。
    /// </summary>
    public static class Diag
    {
        /* ---------------- 路径 ---------------- */

        public static string Dir { get; private set; } = "";
        public static string FilePath { get; private set; } = "";

        /// <summary>保留多少天。可在设置里改（diagKeepDays）。</summary>
        public static int KeepDays { get; set; } = 14;

        /// <summary>当前最低落盘级别。设置里可调（diagLevel）。</summary>
        public static LogLevel MinLevel { get; set; } = LogLevel.Info;

        private static readonly object FileLock = new object();
        private static readonly BlockingCollection<string> Queue = new BlockingCollection<string>(20000);
        private static Thread _writer;
        private static volatile bool _ready;

        /// <summary>写盘失败了多少次。日志自己出问题时的唯一线索，自诊断接口会读它。</summary>
        public static long WriteFailures;

        /// <summary>进程内已记录各条数，自诊断用</summary>
        private static readonly long[] Counts = new long[5];

        /* ---------------- 初始化 ---------------- */

        /// <summary>
        /// 启日志。必须在任何别的代码之前调用 —— 越早，能抓到的启动期问题越多。
        ///
        /// 注意目录用的是 **LocalApplicationData 下的 Riqian/logs**，跟着数据库走
        /// （数据目录是可配的，但日志是「本机这台设备上出过什么事」，不该跟着数据搬家）。
        /// </summary>
        public static void Start(string rootHint = null)
        {
            try
            {
                /*
                 * 目录优先 LocalApplicationData（桌面：%LOCALAPPDATA%\Riqian\logs）。
                 *
                 * 安卓上这个 API 会返回空串或不可写路径 —— 直接 Path.Combine 会抛，
                 * 结果是「手机上完全没有日志」。手机出问题最难查，恰恰最需要日志，
                 * 所以这里回退到数据目录（rootHint）下的 logs。
                 */
                var baseDir = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (string.IsNullOrWhiteSpace(baseDir) || !CanWrite(baseDir))
                    baseDir = !string.IsNullOrWhiteSpace(rootHint) ? rootHint : Path.GetTempPath();

                Dir = Path.Combine(baseDir, "Riqian", "logs");
                Directory.CreateDirectory(Dir);
                RotateTo(DateTime.Now);

                _ready = true;
                _writer = new Thread(WriteLoop) { IsBackground = true, Name = "riqian-log" };
                _writer.Start();

                PruneOld();
                Info("diag", "===== 会话开始 =====");
                Info("diag", Snapshot());
            }
            catch
            {
                // 连日志都起不来，只能放弃（但别让启动因此失败）
                _ready = false;
            }
        }

        /// <summary>
        /// 能不能往这个目录写。安卓上 GetFolderPath 常返回拿不到的路径，光判空不够。
        ///
        /// 判据是「写得进去」，**不是「删得掉」**。
        /// 2026-11-11 踩到了：写探针文件成功、删它被安全策略拦下，
        /// 于是这个函数返回 false，日志被错误地落到 %TEMP% ——
        /// 用户找不到日志，而目录其实是好的。
        /// 删除只是清理，失败不该影响结论。
        /// </summary>
        private static bool CanWrite(string dir)
        {
            string probe = null;
            try
            {
                Directory.CreateDirectory(dir);
                probe = Path.Combine(dir, ".w_" + Guid.NewGuid().ToString("N").Substring(0, 6));
                File.WriteAllText(probe, "1");
            }
            catch { return false; }

            try { if (probe != null) File.Delete(probe); } catch { /* 删不掉无所谓，能写就行 */ }
            return true;
        }

        /// <summary>进程退出时把队列里剩下的写完</summary>
        public static void Flush(TimeSpan? timeout = null)
        {
            try
            {
                if (_ready) Queue.CompleteAdding();
                _writer?.Join(timeout ?? TimeSpan.FromSeconds(2));
            }
            catch { /* 退出路径上不许再抛 */ }
        }

        /* ---------------- 对外 API ---------------- */

        public static void Trace(string scope, string msg) => Write(LogLevel.Trace, scope, msg, null);
        public static void Info(string scope, string msg) => Write(LogLevel.Info, scope, msg, null);

        public static void Warn(string scope, string msg) => Write(LogLevel.Warn, scope, msg, null);

        /// <summary>带异常的 Warn。很多「不影响主流程但要知道」的失败属于这一档。</summary>
        public static void Warn(string scope, string msg, Exception ex) => Write(LogLevel.Warn, scope, msg, ex);

        public static void Error(string scope, string msg, Exception ex = null) =>
            Write(LogLevel.Error, scope, msg, ex);

        public static void Fatal(string scope, string msg, Exception ex = null) =>
            Write(LogLevel.Fatal, scope, msg, ex);

        /* ---------------- 核心写入 ---------------- */

        private static void Write(LogLevel lv, string scope, string msg, Exception ex)
        {
            try
            {
                if ((int)lv < (int)MinLevel) return;
                Counts[(int)lv]++;

                var line = new StringBuilder(256);
                line.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff"))
                    .Append(' ').Append(Tag(lv))
                    .Append(' ').Append(string.IsNullOrEmpty(scope) ? "-" : scope)
                    .Append(" | ").Append(msg ?? "");

                if (ex != null) AppendException(line, ex);

                var text = line.ToString();

                if (!_ready) { Debug.WriteLine(text); return; }

                // Error 及以上同步写：进程随时可能没了，留不住就没意义
                if (lv >= LogLevel.Error) DirectWrite(text);
                else if (!Queue.TryAdd(text)) DirectWrite(text);   // 队列满了直接写，宁可慢
            }
            catch { Interlocked.Increment(ref WriteFailures); }
        }

        /// <summary>异常树完整铺开。只写 Message 的话，InnerException 里的真凶永远看不见。</summary>
        private static void AppendException(StringBuilder sb, Exception ex)
        {
            var depth = 0;
            for (var e = ex; e != null && depth < 6; e = e.InnerException, depth++)
            {
                sb.AppendLine();
                sb.Append(depth == 0 ? "  ✗ " : "    ↳ ")
                  .Append(e.GetType().FullName).Append(": ").Append(e.Message);

                // 堆栈只留真正有用的前几帧，全铺出来日志会变成噪音
                if (!string.IsNullOrEmpty(e.StackTrace))
                {
                    var frames = e.StackTrace.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (var f in frames.Take(8)) sb.AppendLine().Append("      ").Append(f.TrimEnd());
                    if (frames.Length > 8) sb.AppendLine().Append("      … 另有 ").Append(frames.Length - 8).Append(" 帧");
                }
            }
        }

        private static string Tag(LogLevel lv)
        {
            switch (lv)
            {
                case LogLevel.Trace: return "TRC";
                case LogLevel.Info: return "INF";
                case LogLevel.Warn: return "WRN";
                case LogLevel.Error: return "ERR";
                default: return "FTL";
            }
        }

        private static void WriteLoop()
        {
            try
            {
                foreach (var line in Queue.GetConsumingEnumerable()) DirectWrite(line);
            }
            catch { Interlocked.Increment(ref WriteFailures); }
        }

        private static void DirectWrite(string line)
        {
            try
            {
                lock (FileLock)
                {
                    // 跨天自动换文件
                    if (DateTime.Now.Date != _curDate) RotateTo(DateTime.Now);
                    System.IO.File.AppendAllText(FilePath, line + Environment.NewLine, Utf8NoBom);
                }
            }
            catch { Interlocked.Increment(ref WriteFailures); }
        }

        private static DateTime _curDate = DateTime.MinValue;
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        private static void RotateTo(DateTime day)
        {
            _curDate = day.Date;
            FilePath = Path.Combine(Dir, day.ToString("yyyy-MM-dd") + ".log");
        }

        /// <summary>清掉超过保留天数的老日志</summary>
        private static void PruneOld()
        {
            try
            {
                if (KeepDays <= 0) return;
                var cutoff = DateTime.Now.Date.AddDays(-KeepDays);
                foreach (var f in Directory.GetFiles(Dir, "*.log"))
                {
                    var name = Path.GetFileNameWithoutExtension(f);
                    if (!DateTime.TryParse(name, out var d)) continue;
                    if (d.Date < cutoff) System.IO.File.Delete(f);
                }
            }
            catch { /* 清不掉就算了，不能因为清理失败影响启动 */ }
        }

        /* ---------------- 脱敏 ---------------- */

        private static readonly string[] SecretKeys =
        {
            "password", "passwd", "pwd", "secret", "token", "answer", "密保", "密码"
        };

        /// <summary>
        /// 这些前缀的方法，参数**整体**脱敏（只留键名）。
        ///
        /// 为什么需要它：密保答案的参数名叫 `a`，光靠字段名匹配不到 —— 而 `a` 这个键
        /// 在别的接口里是「参数对象」的通用容器名，加进 <see cref="SecretKeys"/>
        /// 会把一堆无关参数也抹掉。所以改成按方法名判定：只要调的是这几个前缀下的方法，
        /// 无论参数叫什么，值一律不落盘。
        ///
        /// 只收「参数本身就是秘密」的模块。`account.*` 不在里面 —— 那是记账账户
        ///（名字/余额/类型），抹掉只会让排障变难，又保护不到什么。
        /// </summary>
        private static readonly string[] SecretMethodPrefixes =
        {
            "vault.", "lock.", "share."
        };

        /// <summary>
        /// 把一串 JSON 里的敏感字段值换成 ***。
        /// RPC 日志要把参数记下来（否则排障无从下手），但密码和日记正文不能落盘。
        /// </summary>
        public static string Redact(string json, int maxLen = 600) => Redact(json, maxLen, null);

        /// <param name="method">当前调用的 RPC 方法名。传了就能对安全类方法整体脱敏。</param>
        public static string Redact(string json, int maxLen, string method)
        {
            if (string.IsNullOrEmpty(json)) return "";
            var s = json;
            try
            {
                // 安全类方法：键名留下（排障要知道传了哪几个参数），值全抹掉
                if (!string.IsNullOrEmpty(method) && IsSecretMethod(method))
                {
                    s = System.Text.RegularExpressions.Regex.Replace(
                        s, "(\\\"[^\\\"]+\\\"\\s*:\\s*)(\\\"[^\\\"]*\\\"|[^,}\\]\\s]+)", "$1\"***\"");
                }
                else
                {
                    foreach (var k in SecretKeys)
                    {
                        // "key":"value" → "key":"***"
                        s = System.Text.RegularExpressions.Regex.Replace(
                            s, "(\"" + System.Text.RegularExpressions.Regex.Escape(k) + "\"\\s*:\\s*)\"[^\"]*\"",
                            "$1\"***\"",
                            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                    }
                }
            }
            catch { /* 替换失败也要把原文截断返回 */ }

            if (s.Length > maxLen) s = s.Substring(0, maxLen) + "…(" + s.Length + " 字符)";
            return s;
        }

        private static bool IsSecretMethod(string m)
        {
            foreach (var p in SecretMethodPrefixes)
                if (m.StartsWith(p, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /* ---------------- 环境快照 ---------------- */

        /// <summary>
        /// 出问题时要的第一份材料：什么版本、什么系统、数据在哪。
        /// 这张快照会在启动、崩溃、反馈时各记一次。
        /// </summary>
        public static string Snapshot()
        {
            var sb = new StringBuilder();
            try
            {
                sb.Append("版本=").Append(AppVersion)
                  .Append(" 系统=").Append(Environment.OSVersion.VersionString)
                  .Append(" 64位=").Append(Environment.Is64BitProcess)
                  .Append(" CLR=").Append(Environment.Version)
                  .Append(" CPU=").Append(Environment.ProcessorCount);
                sb.AppendLine();
                sb.Append("WebView2=").Append(WebView2Version ?? "未知")
                  .Append(" 时区=").Append(TimeZoneInfo.Local.Id)
                  .Append(" 内存=").Append(GC.GetTotalMemory(false) / 1024 / 1024).Append("MB");
            }
            catch { }
            return sb.ToString();
        }

        public static string WebView2Version;

        /// <summary>程序版本号。跟 csproj 的 Version 对齐。</summary>
        public static string AppVersion =
            typeof(Diag).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

        /* ---------------- 给自诊断 / AI 接口读 ---------------- */

        public static object Stats()
        {
            long total = 0;
            foreach (var c in Counts) total += c;
            return new
            {
                dir = Dir,
                file = FilePath,
                minLevel = MinLevel.ToString(),
                keepDays = KeepDays,
                total,
                trace = Counts[0],
                info = Counts[1],
                warn = Counts[2],
                error = Counts[3],
                fatal = Counts[4],
                writeFailures = Interlocked.Read(ref WriteFailures),
                queued = _ready ? Queue.Count : 0,
                files = SafeListLogs()
            };
        }

        private static List<object> SafeListLogs()
        {
            var outList = new List<object>();
            try
            {
                foreach (var f in Directory.GetFiles(Dir, "*.log").OrderByDescending(x => x))
                {
                    var fi = new FileInfo(f);
                    outList.Add(new { name = fi.Name, bytes = fi.Length, mtime = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss") });
                }
            }
            catch { }
            return outList;
        }

        /// <summary>读最近 N 行日志（AI 接口 / 设置页的「查看日志」用）</summary>
        public static string Tail(int lines = 300, string day = null)
        {
            try
            {
                // 前端传的是空字符串（下拉选「今天」），DebugApi 传的可能是 null —— 两种都得兜住。
                // 之前只判 null，导致 day="" 拼出 ".log" 这种文件名，设置页永远显示空日志。
                var path = string.IsNullOrWhiteSpace(day)
                    ? Path.Combine(Dir, DateTime.Now.ToString("yyyy-MM-dd") + ".log")
                    : Path.Combine(Dir, day.Trim() + ".log");
                if (!System.IO.File.Exists(path)) return "";
                var all = System.IO.File.ReadAllLines(path);
                var take = Math.Max(1, lines);
                return string.Join("\n", all.Skip(Math.Max(0, all.Length - take)));
            }
            catch (Exception ex)
            {
                return "(读日志失败: " + ex.Message + ")";
            }
        }
    }
}