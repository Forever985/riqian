using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Riqian
{
    public partial class MainForm : Form
    {
        private readonly WebView2 web = new WebView2();
        private Db db;
        private bool closing;

        /* 便携模式下配置也跟着 exe 走。
         *
         * 不这么做的话，绿色版拷到另一台机器仍然读 %APPDATA%\Riqian\config.json ——
         * 而那台机器上的 config.json 可能压根不存在（于是走默认目录，数据没跟着来），
         * 也可能存在（于是读到别人留下的路径）。两种都不是「拷走文件夹 = 完整迁移」。
         *
         * 改成按需计算而不是 static readonly：static 字段在类第一次被访问时就求值，
         * 那时 Environment.ProcessPath 拿得到，但这个决策依赖"exe 旁边有没有 portable.txt"，
         * 写成延迟属性更直白，也避免初始化顺序上的意外。 */
        private static bool IsPortable
        {
            get
            {
                try
                {
                    var dir = Path.GetDirectoryName(Environment.ProcessPath);
                    return !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "portable.txt"));
                }
                catch { return false; }
            }
        }

        /// <summary>
        /// 配置目录。便携模式判据的唯一实现就在 IsPortable 里。
        ///
        /// 为什么开 internal 而不是 public：DebugApi 要把 token 文件写到
        /// 同一个目录（它以前硬编码 %APPDATA%，便携模式下就把文件落到
        /// exe 外面去了）。给兄弟类开一个只读窄口子，比让它自己再猜一遍
        /// 路径好 —— 两处判据迟早会分叉。
        /// </summary>
        internal static string ConfigDir
        {
            get
            {
                if (IsPortable)
                {
                    var exeDir = Path.GetDirectoryName(Environment.ProcessPath);
                    if (!string.IsNullOrEmpty(exeDir)) return Path.Combine(exeDir, "日签数据");
                }
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Riqian");
            }
        }

        private static string ConfigFile => Path.Combine(ConfigDir, "config.json");

        public MainForm()
        {
            Text = "日签 · 打卡日记本";
            ClientSize = new Size(1380, 920);
            MinimumSize = new Size(1000, 680);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(246, 243, 236);
            AutoScaleMode = AutoScaleMode.Dpi;

            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(246, 243, 236);
            Controls.Add(web);

            Load += async (s, e) => await InitAsync();
            FormClosing += OnClosing;
            StartV10();
        }

        private async Task InitAsync()
        {
            try
            {
                db = new Db(ResolveRoot());

                var userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Riqian", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                await web.EnsureCoreWebView2Async(env);

                var core = web.CoreWebView2;
                Diag.WebView2Version = core.Environment.BrowserVersionString;
                Diag.Info("boot", "WebView2 已就绪 " + Diag.WebView2Version);

                // 渲染进程崩了／无响应，界面会白屏或者卡死。没有这三个钩子的话，
                // 用户看到的就是「突然白了」，日志里一个字都没有。
                core.ProcessFailed += (s2, e2) =>
                    Diag.Error("webview", "渲染进程异常: " + e2.ProcessFailedKind +
                               " · 原因: " + e2.Reason + " · 退出码: " + e2.ExitCode);

                core.NavigationCompleted += (s2, e2) =>
                {
                    if (e2.IsSuccess) Diag.Info("webview", "页面加载完成");
                    else Diag.Error("webview", "页面加载失败: " + e2.WebErrorStatus + " (" + e2.HttpStatusCode + ")");
                };

                // 页面里的 console.error 由前端自己拦（WebView2 的 CoreWebView2 没有 console 事件，
// 只能从 JS 侧接管），见 web/src/lib/diag.ts 的 installConsoleHook()。

                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsSwipeNavigationEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                // 第 194 条：右键菜单里那个「检查」会把 DevTools 直接摊给用户看，
                // 一个笔记本软件露出这个太掉价。应用自己的右键菜单（日历、导航、媒体）是自己画的，不受影响。
                core.Settings.AreDefaultContextMenusEnabled = false;
                // 浏览器的 F5 / Ctrl+F / Ctrl+P 之类也不该混进来；编辑快捷键（复制粘贴撤销）不受影响
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;

                // 把图片库映射成一个虚拟站点，页面里就能用 <img src="https://riqian.local/xxx.jpg">
                MapMedia(core);

                core.WebMessageReceived += OnMessage;
                // 界面启动后自己调 bootstrap 拉数据，宿主不再注入初始化脚本
                //
                // 注意：这里**不能**再用 core.NavigateToString(LoadHtml())。
                // 那个 API 有 2 MB 硬上限（UTF-16 计），前端产物 2026-11-01 已经涨到
                // 1,529,060 字符 ≈ 3.06 MB，直接抛 E_INVALIDARG（"Value does not fall
                // within the expected range."）导致启动失败。改走虚拟主机映射，
                // 顺便让页面拿到真正的 origin，localStorage 才存得住。
                core.SetVirtualHostNameToFolderMapping(HtmlHost.Host, HtmlHost.Prepare(),
                    CoreWebView2HostResourceAccessKind.Allow);
                core.Navigate(HtmlHost.Url);

                InitTray();     // 托盘常驻：番茄钟到点、关闭窗口后仍能提醒
                ApplyShell();   // 托盘菜单 / 任务栏 / 悬浮球按设置生效
                ApplyHotkeys(); // 全局热键必须在窗体句柄创建之后注册

                StartDebugApiIfAsked();   // AI 调试网关（默认关闭，见 DebugApi 的注释）
                RpcCatalog.SelfCheck(RealRpcMethods);
            }
            catch (Exception ex)
            {
                // 启动失败是最致命的一类：用户看到的就是「打不开」，什么线索都没有。
                // 日志 + 一份独立的 boot-error.log（老路径保留，方便直接发给我）+ 带路径的弹窗。
                Diag.Fatal("boot", "启动失败", ex);
                try
                {
                    File.WriteAllText(
                        Path.Combine(Path.GetTempPath(), "riqian-boot-error.log"),
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\r\n" + ex +
                        "\r\n\r\n环境: " + Diag.Snapshot() +
                        "\r\n完整日志: " + Diag.Dir);
                }
                catch { /* 写不了日志也不能因为日志再崩一次 */ }

                var inner = ex.InnerException;
                var more = "";
                while (inner != null) { more += "\n\n" + inner.Message; inner = inner.InnerException; }

                MessageBox.Show(this,
                    "启动失败。\n\n" + ex.Message + more +
                    "\n\n诊断日志：\n" + Diag.Dir,
                    "日签", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        /* ---------------- 数据目录 ---------------- */

        private static string ResolveRoot()
        {
            /* `--data-root=<路径>`：临时指定数据目录，**一个字都不写配置文件**。
             *
             * 这是给自动化探针（tests/smoke-startup.ps1）和 CI 用的。
             * 之前那版探针是"先备份 config.json → 改写 → 跑完还原"，两次事故：
             *   ① ConvertTo-Json 把中文路径转义一次、写回时又按别的编码解释，
             *      结果 E:\日签-abtest 变成了 E:\鏃ョ-abtest，配置直接坏掉
             *   ② 万一探针进程被强杀，finally 不执行，用户的配置就永久停在临时目录上
             * 改配置这种事，从一开始就不该让测试去做。
             *
             * 优先级最高、且直接 return —— 不走下面的"能不能建出来"判断，
             * 也不参与 rewriteConfig 那套决策。给测试用的口子就该是纯粹的旁路。 */
            foreach (var a in Environment.GetCommandLineArgs())
            {
                const string flag = "--data-root=";
                if (a.StartsWith(flag, StringComparison.OrdinalIgnoreCase))
                {
                    var dir = a.Substring(flag.Length).Trim('"');
                    if (dir.Length > 0) return dir;
                }
            }

            /* 便携模式：exe 同目录下有 `portable.txt` 就把数据放它旁边。
             *
             * 为什么用标记文件而不是"检测是不是在 Program Files 下"：
             * 绿色版的定义是「拷走整个文件夹 = 完整迁移」，这必须由**打包那一刻**
             * 决定，不能靠运行时猜路径。同一个 exe 既可能是安装版（数据该进用户目录）
             * 也可能是绿色版（数据该跟着走），靠路径猜一定会猜错 ——
             * 有人就喜欢把绿色版解到 Program Files 旁边。
             *
             * 用一个空文件当开关：打包脚本决定放不放，运行时只认它的存在。
             * 优先级排在 --data-root 之后（测试用的旁路参数仍然最高），
             * 但排在配置文件之前 —— 便携版不该被别的机器上遗留的 config.json 带跑。
             *
             * 目录名取 `日签数据` 而不是直接扔在 exe 旁边：
             * 旁边会生成 riqian.db / 图片库 / 自动备份 / 导出 四个条目，
             * 跟 exe 混在一起看着很乱，也容易误删。 */
            try
            {
                var exeDir = Path.GetDirectoryName(Environment.ProcessPath);
                if (!string.IsNullOrEmpty(exeDir) &&
                    File.Exists(Path.Combine(exeDir, "portable.txt")))
                {
                    return Path.Combine(exeDir, "日签数据");
                }
            }
            catch (Exception ex)
            {
                // 便携判断失败不该拦住启动，退回正常流程就行
                Diag.Warn("app.config", "便携模式判断失败，按常规方式解析数据目录", ex);
            }

            var fallback = Directory.Exists(@"E:\")
                ? @"E:\日签"
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "日签日记");

            /* 本次要不要把 fallback 写回配置文件？
               只有"配置本来就不存在"或"配置确实坏了"才该写。
               如果配置里明明有个好路径，只是这会儿盘没插上，
               写完就等于把用户的路径永久改掉了，插回盘也找不回来。 */
            var rewriteConfig = true;

            try
            {
                if (File.Exists(ConfigFile))
                {
                    var raw = File.ReadAllText(ConfigFile);
                    var cfg = JsonSafe(raw);
                    if (cfg.HasValue && cfg.Value.TryGetProperty("root", out var r))
                    {
                        var s = r.GetString();
                        /* 配了路径就按配的走，但目录建不出来时不能假装成功 ——
                           原来 Directory.CreateDirectory 抛一下就被外层 catch 吞了，
                           然后默默回落到默认目录，用户会以为"数据丢了"。
                           盘符拔了、外置硬盘没插、网络盘掉线，都属于这种情况。 */
                        if (!string.IsNullOrWhiteSpace(s))
                        {
                            try
                            {
                                Directory.CreateDirectory(s);
                                return s;
                            }
                            catch (Exception ex)
                            {
                                /* 路径是好的，只是暂时够不着 —— 保留配置，本次用默认目录顶着。
                                   下次插回盘再启动，还会回到用户配的那个目录。 */
                                rewriteConfig = false;
                                Diag.Error("app.config",
                                    $"配置里的数据目录暂时不可用：{s}（本次先用 {fallback}，原配置保持不变，下次启动会再试）", ex);
                            }
                        }
                    }
                    else
                    {
                        /*
                         * 文件在，但读不出 root。这一定是有人手工改坏了（用记事本存成了别的编码之类）。
                         * 绝不能拿默认路径 SaveConfig 覆盖掉它 —— 那等于把用户的配置抹了，
                         * 下次启动就永远去默认目录找库，而真正的库还在老地方。
                         * 原文件另存一份 .bak，然后才用默认值。
                         */
                        var bak = ConfigFile + ".bak-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                        try { File.Copy(ConfigFile, bak, true); } catch { }
                        Diag.Error("app.config",
                            $"配置文件读不出 root，已另存为 {bak}，本次先使用默认目录 {fallback}", null);
                    }
                }
            }
            catch (Exception ex) { Diag.Error("app.config", "读配置文件失败", ex); }

            if (rewriteConfig) SaveConfig(fallback);
            return fallback;
        }

        private static void SaveConfig(string root)
        {
            try
            {
                Directory.CreateDirectory(ConfigDir);
                File.WriteAllText(ConfigFile,
                    JsonSerializer.Serialize(new { root }, new JsonSerializerOptions { WriteIndented = true }),
                    new UTF8Encoding(false));
            }
            catch { }
        }

        /// <summary>
        /// 把文本里所有"看不见但会让 JSON 解析器直接报错"的前缀去掉。
        ///
        /// 最主要的是 BOM（U+FEFF）。用记事本、旧版 PowerShell 的 Out-File、
        /// 以及 .NET 的 Encoding.UTF8 写出来的文件，开头都会带这三个字节。
        /// System.Text.Json 见到它第一个字节是 0xEF 就直接抛
        /// "'0xEF' is an invalid start of a value"，连内容都不看。
        ///
        /// 这个函数是**唯一**该做这件事的地方 —— 任何读用户/外部文件的入口都调它，
        /// 别在每个调用点各写一遍 TrimStart。设置导入就是因为只在导出侧管了 BOM、
        /// 导入侧没管，"导出再导入"这条路断了很久没人发现。
        /// </summary>
        internal static string StripJsonPreamble(string text)
        {
            if (string.IsNullOrEmpty(text)) return text ?? "";
            return text.TrimStart('\uFEFF', '\u200B', '\u00A0', ' ', '\t', '\r', '\n');
        }

        private static JsonElement? JsonSafe(string text)
        {
            try
            {
                using var d = JsonDocument.Parse(StripJsonPreamble(text));
                return d.RootElement.Clone();
            }
            catch { return null; }
        }

        private void MapMedia(CoreWebView2 core)
        {
            try
            {
                Directory.CreateDirectory(db.MediaDir);
                core.SetVirtualHostNameToFolderMapping("riqian.local", db.MediaDir,
                    CoreWebView2HostResourceAccessKind.Allow);
            }
            catch (Exception ex) { Diag.Error("host", "宿主操作失败", ex); }
        }

        /* ---------------- 页面 ---------------- */

        // 页面加载已迁到 HtmlHost（虚拟主机映射，绕开 NavigateToString 的 2 MB 上限）

        /* ---------------- AI 调试网关 ---------------- */

        /// <summary>
        /// 真实存在的 RPC 方法名。由 tools/gen-rpc-list.py 从源码抽出后生成，
        /// 用来和 RpcCatalog 的清单做交叉校验（清单漏更新时日志里会 WARN）。
        /// 这个数组不参与任何分发逻辑，只做自检。
        /// </summary>
        public static readonly string[] RealRpcMethods = new string[]
        {
            /* @@RPC_LIST_BEGIN@@ 由 tools/gen-rpc-list.py 自动生成，别手改 */
            "account.delete", "account.reorder", "account.save", "account.toggle",
            "alarm.delete", "alarm.list", "alarm.save", "alarm.skipMissed",
            "alarm.snooze", "app.changeRoot", "app.chrome", "app.diagnostics",
            "app.facts", "app.hide", "app.minimize", "app.openExport",
            "app.openMedia", "app.openRoot", "app.pickFolder", "app.quit",
            "app.screen", "app.tray", "bootstrap", "boss.toggle",
            "cache.clear", "cache.open", "cache.prune", "cache.stats",
            "cd.add", "cd.delete", "cd.list", "cd.purge",
            "cd.repeat", "cd.restore", "cd.trash", "cd.update",
            "diag.action", "diag.api", "diag.apiInfo", "diag.checkpoint",
            "diag.config", "diag.frontend", "diag.logs", "diag.method",
            "diag.methods", "diag.openDir", "diag.ping", "diag.stats",
            "draft.purge", "draft.restore", "draft.trash", "draft.trashList",
            "draw.delete", "draw.get", "draw.list", "draw.rename",
            "draw.restore", "draw.save", "draw.toMedia", "draw.trash",
            "encourage.delete", "encourage.list", "encourage.save", "entry.bg",
            "entry.delete", "entry.drafts", "entry.fav", "entry.get",
            "entry.list", "entry.publish", "entry.save", "entry.status",
            "export.csv", "export.html", "export.json", "export.md",
            "export.note", "feedback.save", "festival.add", "festival.day",
            "festival.delete", "festival.lunar", "festival.month", "festival.remindPreview",
            "festival.upcoming", "font.bytes", "font.delete", "font.import",
            "font.list", "habit.add", "habit.delete", "habit.history",
            "habit.log", "habit.logs", "habit.notes", "habit.purge",
            "habit.remindCheck", "habit.remindPreview", "habit.reorder", "habit.restore",
            "habit.stats", "habit.trash", "habit.update", "habits.list",
            "hotkey.apply", "jar.add", "jar.archive", "jar.delete",
            "jar.deposit", "jar.detail", "jar.list", "jar.presets",
            "jar.removeItem", "jar.reorder", "jar.update", "ledger.accounts",
            "ledger.add", "ledger.catDrop", "ledger.catRename", "ledger.delete",
            "ledger.insight", "ledger.list", "ledger.recur.delete", "ledger.recur.list",
            "ledger.recur.run", "ledger.recur.save", "ledger.update", "link.add",
            "link.addMany", "link.delete", "media.alias", "media.bulk",
            "media.cacheAll", "media.cacheUrl", "media.delete", "media.folders",
            "media.import", "media.importFolder", "media.importFolderDlg", "media.list",
            "media.list2", "media.openFolder", "media.openImport", "media.rebuildThumbs",
            "media.rename", "media.renameFolder", "media.resolve", "media.saveBase64",
            "media.scan", "media.setTags", "media.storage", "media.tags",
            "media.tone", "milestone.delete", "milestone.list", "milestone.save",
            "modules.add", "modules.delete", "modules.hiddenOn", "modules.hideOn",
            "modules.list", "modules.reorder", "modules.showOn", "modules.shownOn",
            "modules.update", "music.addUrl", "music.import", "music.list",
            "note.delete", "note.get", "note.purge", "note.purgeAll",
            "note.reorder", "note.restore", "note.save", "notebook.add",
            "notebook.add2", "notebook.delete", "notebook.parent", "notebook.parent2",
            "notebook.reorder", "notebook.tree", "notebook.update", "notebooks.list",
            "notes.list", "notes.trash", "notify.push", "notify.test",
            "orb.toggle", "pomo.day", "pomo.insight", "pomo.months",
            "pomodoro.add", "pomodoro.delete", "pomodoro.edit", "pomodoro.manual",
            "pomodoro.stats", "pomodoro.timer", "quick.capture", "quick.popup",
            "quick.state", "rev.dedup", "rev.get", "rev.list",
            "rev.restore", "review.day", "review.range", "search.all",
            "setting.set", "settings.export", "settings.import", "share.copyImage",
            "share.copyText", "share.html", "share.image", "shell.apply",
            "shell.autostart", "shell.autostartGet", "shell.hotkeyState", "shell.lockState",
            "shell.openUrl", "stats.calMonths", "stats.calendar", "stats.overview",
            "stats.rank", "stats.rankExtra", "stats.reset", "sticky.close",
            "sticky.list", "sticky.open", "summary.delete", "summary.get",
            "summary.list", "summary.pin", "summary.save", "tag.set",
            "tags.list", "template.apply", "templates.delete", "templates.list",
            "templates.save", "todo.add", "todo.clearDone", "todo.delete",
            "todo.list.add", "todo.list.delete", "todo.list.note", "todo.list.parent",
            "todo.list.update", "todo.lists", "todo.movelist", "todo.purge",
            "todo.purgeAll", "todo.repeat", "todo.restore", "todo.trash",
            "todo.update", "todos.list", "todos.recycle", "todos.reorder",
            "user.get", "user.save", "vault.add", "vault.check",
            "vault.clearMain", "vault.hint", "vault.lock", "vault.qa.list",
            "vault.qa.reset", "vault.qa.save", "vault.qa.verify", "vault.remove",
            "vault.setMain", "vault.status", "vault.unlock",
            /* @@RPC_LIST_END@@ */
            };

        /// <summary>
        /// 按启动参数或设置决定要不要开调试网关。
        ///
        /// 两种开法：
        ///  · 命令行 `日签.exe --debug-api`（端口随机）或 `--debug-api=57100`（指定端口）
        ///  · 设置里把「AI 调试接口」打开（下次启动生效）
        ///
        /// 默认关闭是有意的：这是私人日记本，不该默认对外开端口。
        /// </summary>
        private void StartDebugApiIfAsked()
        {
            try
            {
                var args = Environment.GetCommandLineArgs();
                var flag = args.FirstOrDefault(x =>
                    x.StartsWith("--debug-api", StringComparison.OrdinalIgnoreCase));

                var settingOn = db.GetSetting("debugApi") == "1";
                if (flag == null && !settingOn) return;

                var port = 0;
                if (flag != null && flag.Contains('='))
                    int.TryParse(flag.Split('=').Last(), out port);

                var err = DebugApi.Start(port, this, Dispatch);
                if (err != null) Diag.Error("debugapi", "启用失败: " + err);
            }
            catch (Exception ex) { Diag.Error("debugapi", "启用过程异常", ex); }
        }

        /* ---------------- RPC ---------------- */

        private void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw = e.WebMessageAsJson;
            long id = 0;
            var sw = Stopwatch.StartNew();
            string method = null;
            try
            {
                using (var probe = JsonDocument.Parse(raw))
                    if (probe.RootElement.ValueKind == JsonValueKind.String)
                        raw = probe.RootElement.GetString();

                using var doc = JsonDocument.Parse(raw);
                var root = doc.RootElement;
                id = root.TryGetProperty("id", out var idEl) ? idEl.GetInt64() : 0;
                var m = root.GetProperty("m").GetString();
                method = m;
                var a = root.TryGetProperty("a", out var aEl) ? aEl : default;

                // Trace 级别才记参数：RPC 调用非常频繁，全量记会把日志写成几百 MB
                if (Diag.MinLevel <= LogLevel.Trace)
                    Diag.Trace("rpc", m + " ← " + Diag.Redact(a.ValueKind == JsonValueKind.Undefined ? "" : a.GetRawText(), 600, m));

                object data;
                try { data = Dispatch(m, a); }
                catch (Exception ex)
                {
                    // 这里是问题最多的地方：某个 RPC 内部抛了，前端只会收到一句 msg。
                    // 日志里必须带上方法名 + 参数 + 完整堆栈，否则只能靠猜是哪个调用炸的。
                    Diag.Error("rpc", "方法 " + m + " 执行失败 · 耗时 " + sw.ElapsedMilliseconds + "ms" +
                               " · 参数 " + Diag.Redact(a.ValueKind == JsonValueKind.Undefined ? "" : a.GetRawText(), 400, m), ex);
                    Reply(id, false, null, ex.Message);
                    return;
                }

                sw.Stop();
                // 慢调用要记下来：用户感觉「点了半天没反应」时，这是唯一的证据
                if (sw.ElapsedMilliseconds > 800)
                    Diag.Warn("rpc", "慢调用 " + m + " 用了 " + sw.ElapsedMilliseconds + "ms" +
                              " · 参数 " + Diag.Redact(a.ValueKind == JsonValueKind.Undefined ? "" : a.GetRawText(), 300, m));

                Reply(id, true, data, null);
            }
            catch (Exception ex)
            {
                Diag.Error("rpc", "RPC 框架层失败（消息本身解析不了）· raw=" + Diag.Redact(raw, 300), ex);
                if (id != 0) Reply(id, false, null, ex.Message);
            }
        }

        private void Reply(long id, bool ok, object data, string err)
        {
            var payload = JsonSerializer.Serialize(new { id, ok, data, err },
                new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
            try { web.CoreWebView2?.PostWebMessageAsJson(payload); } catch { }
        }

        private static string S(JsonElement a, string k, string def = null)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v)) return def;
            return v.ValueKind == JsonValueKind.String ? v.GetString() : v.ValueKind == JsonValueKind.Null ? def : v.ToString();
        }

        private static int I(JsonElement a, string k, int def = -1)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v)) return def;
            if (v.ValueKind == JsonValueKind.Number) return v.GetInt32();
            if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var n)) return n;
            return def;
        }

        private static double D(JsonElement a, string k, double def = 0)
        {
            if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v))
            {
                if (v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d)) return d;
                if (v.ValueKind == JsonValueKind.String && double.TryParse(v.GetString(), out var d2)) return d2;
            }
            return def;
        }

        private static string[] Arr(JsonElement a, string k)
        {
            if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(k, out var v) || v.ValueKind != JsonValueKind.Array)
                return new string[0];
            return v.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x != "").ToArray();
        }

        private object Dispatch(string m, JsonElement a)
        {
            // v12 新增能力（画板，第 178 条）先过一遍
            var v12 = V12Dispatch(m, a);
            if (v12 != null) return v12;

            // v10 新增能力（打卡回收站 / 笔记分组 / 媒体分类 / 记账 / 提醒 / 打气话 / 诊断）
            var v10 = V10Dispatch(m, a);
            if (v10 != null) return v10;

            // v9 新增能力（定稿 / 草稿箱 / 放弃 / 番茄洞察 / 反馈）
            var v9 = V9Dispatch(m, a);
            if (v9 != null) return v9;

            // v8 新增能力（热键 / 托盘 / 分享 / 总结 / 密保）先过一遍
            var v8 = V8Dispatch(m, a);
            if (v8 != null) return v8;

            // v7 新增能力先走一遍，返回 null 说明不归它管
            var v7 = V7Dispatch(m, a);
            if (v7 != null) return v7;

            switch (m)
            {
                /* 基础 */
                case "bootstrap": return new
                {
                    root = db.Root,
                    dbPath = db.DbPath,
                    mediaDir = db.MediaDir,
                    exportDir = db.ExportDir,
                    settings = db.SettingsAll(),
                    modules = db.Modules(),
                    tags = db.Tags(),
                    habits = db.Habits(),
                    today = Db.Today
                };
                case "setting.set": return db.SettingSet(S(a, "k"), S(a, "v"));

                /* 模块 */
                case "modules.list": return db.Modules();
                case "modules.add": return db.ModuleAdd(S(a, "type"), S(a, "title"));
                case "modules.update": return db.ModuleUpdate(S(a, "id"), S(a, "title"), I(a, "enabled", -1), a.TryGetProperty("config", out var cf) ? cf.GetRawText() : null);
                case "modules.delete": return db.ModuleDelete(S(a, "id"));
                case "modules.reorder": return db.ModuleReorder(Arr(a, "ids"));

                /* 日记 */
                case "entry.get": return db.EntryGet(S(a, "date"));
                case "entry.save": return db.EntrySave(S(a, "date"),
                                        a.TryGetProperty("values", out var vv) ? vv : default, I(a, "fav", 0), S(a, "bg", ""),
                                        a.TryGetProperty("title", out var tt) && tt.ValueKind != JsonValueKind.Null ? (tt.GetString() ?? "") : null,
                                        a.TryGetProperty("bgTone", out var bt2) && bt2.ValueKind != JsonValueKind.Null ? (bt2.GetString() ?? "") : null);
                case "entry.list": return db.EntryList(S(a, "q", ""), S(a, "from"), S(a, "to"),
                                        I(a, "mood", 0), S(a, "tag"), I(a, "fav", 0), I(a, "hasImg", 0),
                                        I(a, "limit", 200), I(a, "offset", 0));
                case "entry.fav": return db.EntryFav(S(a, "date"), I(a, "fav", 0));
                case "entry.bg": return db.EntryBg(S(a, "date"), S(a, "bg", ""),
                                        a.TryGetProperty("tone", out var tn) && tn.ValueKind != JsonValueKind.Null ? (tn.GetString() ?? "") : null);
                case "entry.delete": return db.EntryDelete(S(a, "date"));

                /* 版本 */
                case "rev.list": return db.Revisions(S(a, "date"));
                case "rev.get": return db.RevisionGet(I(a, "id", 0));
                case "rev.restore": return db.RevisionRestore(I(a, "id", 0));

                /* 标签 */
                case "tags.list": return db.Tags();
                case "tag.set": return db.TagSet(S(a, "date"), Arr(a, "tags"));

                /* 关联 */
                case "link.add": return db.LinkAdd(S(a, "from"), S(a, "to"), S(a, "kind", "related"), S(a, "quote", ""));
                case "link.addMany":
                    {
                        var from = S(a, "from");
                        var kind = S(a, "kind", "related");
                        foreach (var d in Arr(a, "dates")) db.LinkAdd(from, d, kind, "");
                        return new { ok = true };
                    }
                case "link.delete": return db.LinkDelete(I(a, "id", 0));
                case "backlinks": return db.Backlinks(S(a, "date"));

                /* 待办 */
                case "todos.list": return db.Todos(S(a, "sort"));
                case "todos.reorder": return db.TodoReorder(Arr(a, "ids"));
                case "todo.add": return db.TodoAdd2(S(a, "title"), S(a, "due", ""), S(a, "dueTime", ""),
                                        I(a, "priority", 1), S(a, "note", ""), S(a, "listId"));
                case "todo.update": return db.TodoUpdate2(S(a, "id"), S(a, "title"), I(a, "done", -1), S(a, "due"),
                                        S(a, "dueTime"), I(a, "priority", -1), S(a, "note"),
                                        S(a, "listId"), I(a, "trashed", -1), I(a, "sort", -1));
                case "todo.trash": return db.TodoTrash(S(a, "id"), I(a, "trashed", 1));
                case "todo.delete": return db.TodoDelete(S(a, "id"));
                case "todo.clearDone": return db.TodoClearDone();

                /* 清单 */
                case "todo.lists": return db.TodoLists();
                case "todo.list.add": return db.TodoListAdd(S(a, "name"), S(a, "color"));
                case "todo.list.update": return db.TodoListUpdate(S(a, "id"), S(a, "name"), S(a, "color"), I(a, "sort", -1));
                case "todo.list.delete": return db.TodoListDelete(S(a, "id"));

                /* 倒计时 */
                case "cd.list": return db.Countdowns();
                case "cd.add": return db.CdAdd(S(a, "title"), S(a, "date"), I(a, "yearly", 0), S(a, "color"), S(a, "note"));
                case "cd.update": return db.CdUpdate(S(a, "id"), S(a, "title"), S(a, "date"), I(a, "yearly", -1), S(a, "color"), S(a, "note"), I(a, "sort", -1), S(a, "repeat"), I(a, "star", -1));
                case "cd.delete": return db.CdDelete(S(a, "id"));
                case "cd.trash": return db.CdTrash();
                case "cd.restore": return db.CdRestore(S(a, "id"));
                case "cd.purge": return db.CdPurge(S(a, "id"));

                /* 习惯 */
                case "habits.list": return db.Habits();
                case "habit.add": return db.HabitAdd(S(a, "name"), S(a, "color"), S(a, "type", "bool"),
                                        S(a, "unit", ""), a.TryGetProperty("options", out var ho) ? ho.GetRawText() : "[]",
                                        a.TryGetProperty("goal", out var hg) && hg.ValueKind == JsonValueKind.Number ? hg.GetDouble() : 0,
                                        S(a, "icon", ""));
                case "habit.update": return db.HabitUpdate(S(a, "id"), S(a, "name"), S(a, "color"), I(a, "archived", -1),
                                        S(a, "type"), S(a, "unit"),
                                        a.TryGetProperty("options", out var ho2) ? ho2.GetRawText() : null,
                                        a.TryGetProperty("goal", out var hg2) && hg2.ValueKind == JsonValueKind.Number ? hg2.GetDouble() : -1,
                                        S(a, "icon"));
                case "habit.delete": return db.HabitDelete(S(a, "id"));
                case "habit.log": return db.HabitLog(S(a, "date"), S(a, "habitId"),
                                        a.ValueKind == JsonValueKind.Object && a.TryGetProperty("val", out var hv) && hv.ValueKind != JsonValueKind.Null
                                            ? hv.GetRawText() : null,
                                        a.ValueKind == JsonValueKind.Object && a.TryGetProperty("note", out var hn) && hn.ValueKind == JsonValueKind.String
                                            ? hn.GetString() : null);
                case "habit.notes": return db.HabitNotesFor(S(a, "date"));
                case "habit.logs": return db.HabitLogsFor(S(a, "date"));
                case "habit.history": return db.HabitHistory(S(a, "habitId"), I(a, "days", 30));
                case "check.toggle": return db.CheckToggle(S(a, "date"), S(a, "habitId"));
                case "checks.for": return db.ChecksFor(S(a, "date"));

                /* 番茄钟 */
                case "pomodoro.add": return db.PomodoroAdd(I(a, "minutes", 25), S(a, "kind", "focus"), S(a, "task", ""));
                case "pomodoro.delete": return db.PomodoroDelete(S(a, "id"));
                case "pomodoro.stats": return db.PomodoroStats(I(a, "days", 7), S(a, "from"), S(a, "to"));

                /* 模板 */
                case "templates.list": return db.Templates();
                case "templates.save": return db.TemplateSave(S(a, "name"), S(a, "body", "[]"));
                case "templates.delete": return db.TemplateDelete(S(a, "id"));
                case "template.apply": return db.ApplyTemplate(S(a, "date"), S(a, "id"));

                /* 图片 */
                case "media.list": return db.MediaList(S(a, "q", ""), I(a, "limit", 500));
                case "media.resolve": return db.MediaResolve(Arr(a, "refs"));
                case "media.import": return MediaImport();
                /* 第 233 条：整个文件夹导入 */
                case "media.importFolderDlg": return MediaImportFolder();
                case "media.saveBase64": return db.MediaSaveBase64(S(a, "name"), S(a, "data"));
                case "media.scan": return db.MediaScan();
                case "media.rename": return db.MediaRename(S(a, "id"), S(a, "name", ""));
                case "media.delete": return db.MediaDelete(S(a, "id"), I(a, "hard", 0));
                case "media.rebuildThumbs": return db.MediaRebuildThumbs();
                case "media.openFolder":
                    {
                        Directory.CreateDirectory(db.ImportDir);
                        OpenPath(db.MediaDir);
                        return new { ok = true };
                    }
                case "media.openImport":
                    {
                        Directory.CreateDirectory(db.ImportDir);
                        OpenPath(db.ImportDir);
                        return new { ok = true };
                    }

                /* 统计 */
                case "stats.overview": return db.Overview(SN(a, "from"), SN(a, "to"));
                case "stats.calendar": return db.Calendar(S(a, "ym"));
                /* 第 157 条：重置统计（只清番茄/打卡记录，日记绝不动） */
                case "stats.reset": return db.StatsReset(S(a, "what", "all"));
                case "onthisday": return db.OnThisDay();

                /* 导出 */
                case "export.json": return db.ExportJson();
                case "export.md": return db.ExportMd();
                case "export.csv": return db.ExportCsv();

                /* 系统 */
                case "app.openRoot": OpenPath(db.Root); return new { ok = true };
                case "app.openMedia": OpenPath(db.MediaDir); return new { ok = true };
                case "app.openExport": OpenPath(db.ExportDir); return new { ok = true };
                case "app.pickFolder": return PickFolder();
                case "app.changeRoot": return ChangeRoot();
                case "app.diagnostics": return db.Diagnostics();
            }
            throw new Exception("未知方法: " + m);
        }

        /* ---------------- 文件对话框 ---------------- */

        private object MediaImport()
        {
            /*
             * 第 224 条（中等强度的 BUG）：这里原来写死只认图片格式，
             * 可按钮上明明写着「图片 / 音频 / 视频都能导」——
             * 于是用户选音频视频根本选不到（Windows 的文件框会直接把它们灰掉）。
             * 现在按「媒体」而不是「图片」来过滤，和库里的 kind 三分（image/audio/video）对齐。
             *
             * 第 233 条：顺便把「选文件夹递归导入」也挂在这个文件框上 ——
             * 用户既然能一次选几百个文件，就没道理逼他一个个点开子目录。
             * OpenFileDialog 本身选不了文件夹，所以带一个按钮走 FolderBrowserDialog。
             */
            using var dlg = new OpenFileDialog
            {
                Title = "选择要加入多媒体库的文件（同名不同文件不会覆盖，相同内容自动去重）",
                Filter =
                    "所有媒体 (图片 / 音频 / 视频)|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.svg;*.avif;*.ico;" +
                    "*.mp3;*.m4a;*.aac;*.wav;*.flac;*.ogg;*.opus;" +
                    "*.mp4;*.webm;*.mov;*.mkv;*.avi;*.m4v" +
                    "|图片|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.svg;*.avif;*.ico" +
                    "|音频|*.mp3;*.m4a;*.aac;*.wav;*.flac;*.ogg;*.opus" +
                    "|视频|*.mp4;*.webm;*.mov;*.mkv;*.avi;*.m4v" +
                    "|所有文件 (*.*)|*.*",
                Multiselect = true,
                InitialDirectory = db.MediaDir,
                CheckFileExists = true,
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return new { ok = false, items = new object[0] };
            return db.MediaImportFiles(dlg.FileNames);
        }

        /// <summary>第 233 条：整个文件夹导进来（连子目录一起，按相对路径当分组）</summary>
        private object MediaImportFolder()
        {
            using var dlg = new FolderBrowserDialog
            {
                Description = "选一个文件夹，里面的图片 / 音频 / 视频会全部导入（子文件夹一起）",
                SelectedPath = db.MediaDir,
                ShowNewFolderButton = false,
            };
            if (dlg.ShowDialog(this) != DialogResult.OK) return new { ok = false, count = 0 };
            return db.MediaImportFolder(dlg.SelectedPath, 1);
        }

        private object PickFolder()
        {
            using var dlg = new FolderBrowserDialog { Description = "选择数据存放目录", SelectedPath = db.Root };
            if (dlg.ShowDialog(this) != DialogResult.OK) return new { ok = false };
            return new { ok = true, path = dlg.SelectedPath };
        }

        private object ChangeRoot()
        {
            using var dlg = new FolderBrowserDialog { Description = "把数据迁移到哪个目录？（会复制数据库和图片库）", SelectedPath = db.Root };
            if (dlg.ShowDialog(this) != DialogResult.OK) return new { ok = false };

            var res = db.ChangeRoot(dlg.SelectedPath);
            var okProp = res.GetType().GetProperty("ok");
            if (okProp != null && (bool)okProp.GetValue(res))
            {
                SaveConfig(db.Root);
                MapMedia(web.CoreWebView2);   // 目录变了，图片库映射也要跟着换
            }
            return res;
        }

        private void OpenPath(string p)
        {
            try
            {
                if (File.Exists(p) || Directory.Exists(p))
                    Process.Start(new ProcessStartInfo(p) { UseShellExecute = true });
            }
            catch (Exception ex) { Diag.Error("host", "宿主操作失败", ex); }
        }

        /* ---------------- 关闭 ---------------- */

        private async void OnClosing(object sender, FormClosingEventArgs e)
        {
            if (reallyExit) return;

            // 点窗口的 X：按设置收进托盘而不是退出，否则番茄钟就断了
            var closeToTray = Get(Settings(), "closeAction", "tray") == "tray";
            if (!closing && e.CloseReason == CloseReason.UserClosing && TrayEnabled && closeToTray)
            {
                e.Cancel = true;
                await HideToTray();
                return;
            }

            if (closing) return;
            closing = true;
            e.Cancel = true;
            try
            {
                if (web.CoreWebView2 != null)
                {
                    await web.CoreWebView2.ExecuteScriptAsync("window.__FLUSH__ && window.__FLUSH__();");
                    await Task.Delay(250);
                }
            }
            catch { }

            /* 关库必须放在 flush 之后：前端可能还在写最后一条（比如刚打完的卡），
               先把界面那边的事等干净，再 checkpoint + 关连接。
               
               以前这里没有这一句，靠进程退出时 OS 回收 —— 后果是 WAL 从来没被
               checkpoint 过，`日签.db-wal` 会一直涨（实机上见过 4 MB 的），
               而且"拷走整个数据目录"会拿到一个不含最后几次写入的库。 */
            try { db?.Dispose(); } catch (Exception ex) { Diag.Warn("app.exit", "关闭数据库时出错", ex); }

            Close();
        }
    }
}
