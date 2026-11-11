using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Riqian
{
    /// <summary>
    /// RPC 分发：**桌面版和安卓版共用的同一份文件**。
    ///
    /// 为什么必须共用：分发里 280 个方法，真正依赖窗体的只有 3 个
    /// （全局热键、窗体配色、以及壳操作）。剩下的全是 db.XXX(...)，是纯逻辑。
    /// 各维护一份必然分叉 —— 而「手机上调某个接口静默没反应」这种问题，
    /// 报出来的时候已经过去很久了，那时谁也想不起是哪次改动只改了一半。
    /// IShell.cs 的注释里早就写明了这个意图，这一步一直没做完，现在补上。
    ///
    /// 平台差异的出口只有两个（和 IShell 一样，判据只留一处）：
    ///   · Shell.Current         —— 打开目录/选文件/通知/最小化/退出
    ///   · RpcDispatcher.HotkeyApply / UiChrome —— 全局热键、窗体配色
    /// 没注册实现时返回「本平台没有这个能力」，而不是抛异常。
    ///
    /// db 为什么是静态字段：原来的分发是 MainForm 的实例方法，直接读 this.db。
    /// 改成静态方法要动 280 行调用点，风险远大于收益。而一个进程只有一份库，
    /// 用静态字段反而更贴合事实；Invoke 里严格配对赋值/清空，不会串。
    /// </summary>
    public static class RpcDispatcher
    {
        private static Db db;

        /// <summary>桌面注册全局热键；安卓没有这个概念，保持 null 即可。</summary>
        public static Func<object> HotkeyApply;

        /// <summary>桌面把配色刷到窗体/托盘；安卓由网页自己管，保持 null 即可。</summary>
        public static Action<string, string, string, string, int> UiChrome;

        public static object Invoke(Db database, string m, JsonElement a)
        {
            if (database == null) return new { ok = false, err = "数据库还没打开" };
            db = database;
            try { return Dispatch(m, a); }
            finally { db = null; }
        }

        /* ---- 参数读取的薄包装：和 MainForm 里的同名方法语义完全一致 ---- */
        private static string S(JsonElement a, string k, string def = null) => RpcArgs.S(a, k, def);
        private static int I(JsonElement a, string k, int def = -1) => RpcArgs.I(a, k, def);
        private static long L(JsonElement a, string k, long def = -1) => RpcArgs.L(a, k, def);
        private static double D(JsonElement a, string k, double def = 0) => RpcArgs.D(a, k, def);
        private static string[] Arr(JsonElement a, string k) => RpcArgs.Arr(a, k);
        private static string SN(JsonElement a, string k) => RpcArgs.SN(a, k);

        /// <summary>
        /// 取字符串数组。**刻意不复用 RpcArgs.Arr** —— 两者行为不同：
        /// 这个保留空串、并把非字符串元素转成字符串；Arr 会过滤空串且只认字符串。
        /// 「语义看着差不多就合并」是这类隐性回归最常见的来源。
        /// </summary>
        private static string[] AA(JsonElement a, string k)
        {
            if (!a.TryGetProperty(k, out var v) || v.ValueKind != JsonValueKind.Array)
                return new string[0];
            var list = new List<string>();
            foreach (var it in v.EnumerateArray())
                list.Add(it.ValueKind == JsonValueKind.String ? it.GetString() ?? "" : it.ToString());
            return list.ToArray();
        }

        /* ---- 设置读取：原来在 MainForm 里，本质就是 db.SettingsAll() ---- */
        private static Dictionary<string, string> Settings()
        {
            try { return db?.SettingsAll() as Dictionary<string, string> ?? new Dictionary<string, string>(); }
            catch { return new Dictionary<string, string>(); }
        }

        private static string Get(Dictionary<string, string> s, string k, string def = "")
            => s != null && s.TryGetValue(k, out var v) && v != null ? v : def;

        /// <summary>缓存目录。原来是 MainForm 的属性，本质就是 db.Root 下的「缓存」子目录 —— 纯逻辑，不需要平台钩子。</summary>
        private static string CacheDir
        {
            get
            {
                var d = System.IO.Path.Combine(db.Root, "缓存");
                System.IO.Directory.CreateDirectory(d);
                return d;
            }
        }

        /// <summary>提醒测试的防抖时间戳（原来在 MainForm 里，连点两下只响一次）</summary>
        private static long _lastToastTest;

        /* ---- 平台钩子的包装：没实现时给「本平台没有」，不抛异常 ---- */
        private static object ApplyHotkeys()
        {
            var f = HotkeyApply;
            if (f == null) return new { ok = true, skipped = true, reason = "本平台没有全局热键" };
            try { return f(); } catch (Exception ex) { return new { ok = false, err = ex.Message }; }
        }

        private static object SetUiChrome(string panel, string ink, string line, string accent, int dark)
        {
            var f = UiChrome;
            if (f == null) return new { ok = true, skipped = true, reason = "界面配色由网页自己管" };
            try { f(panel, ink, line, accent, dark); return new { ok = true }; }
            catch (Exception ex) { return new { ok = false, err = ex.Message }; }
        }

        /* ===== 来自 MainForm.cs 的 Dispatch ===== */
        private static object Dispatch(string m, JsonElement a)
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
                case "media.import": return Shell.ImportMedia();
                /* 第 233 条：整个文件夹导入 */
                case "media.importFolderDlg": return Shell.ImportMediaFolder();
                case "media.saveBase64": return db.MediaSaveBase64(S(a, "name"), S(a, "data"));
                case "media.scan": return db.MediaScan();
                case "media.rename": return db.MediaRename(S(a, "id"), S(a, "name", ""));
                case "media.delete": return db.MediaDelete(S(a, "id"), I(a, "hard", 0));
                case "media.rebuildThumbs": return db.MediaRebuildThumbs();
                case "media.openFolder":
                    {
                        Directory.CreateDirectory(db.ImportDir);
                        Shell.OpenPath(db.MediaDir);
                        return new { ok = true };
                    }
                case "media.openImport":
                    {
                        Directory.CreateDirectory(db.ImportDir);
                        Shell.OpenPath(db.ImportDir);
                        return new { ok = true };
                    }

                /* 统计 */
                case "stats.overview": return db.Overview(SN(a, "from"), SN(a, "to"));
                case "stats.calendar": return db.Calendar(S(a, "ym"));
                /* 第 157 条：重置统计（只清番茄/打卡记录，日记绝不动） */
                case "stats.reset": return db.StatsReset(S(a, "what", "all"));
                /* #249：跟着「当前打开的那一天」算，不传就退回今天 */
                case "onthisday": return db.OnThisDay(S(a, "date"));

                /* 导出 */
                case "export.json": return db.ExportJson();
                case "export.md": return db.ExportMd();
                case "export.csv": return db.ExportCsv();

                /* 系统 */
                case "app.openRoot": Shell.OpenPath(db.Root); return new { ok = true };
                case "app.openMedia": Shell.OpenPath(db.MediaDir); return new { ok = true };
                case "app.openExport": Shell.OpenPath(db.ExportDir); return new { ok = true };
                case "app.pickFolder": return new { ok = true, path = Shell.PickFolder(db.Root) };
                case "app.changeRoot": return Host.ChangeRoot();
                case "app.diagnostics": return db.Diagnostics();
            }
            throw new Exception("未知方法: " + m);
        }

        /* ===== 来自 MainFormV7.cs 的 V7Dispatch ===== */
        private static object V7Dispatch(string m, JsonElement a)
        {
            /* ---- 提醒与窗口 ----
             *
             * 这一段是**整个分发链里少数依赖窗体的地方**（另外几处在
             * MainForm.cs 的 app.open* / media.import* 和 V8 的 quick:diary）。
             * 为了让安卓版能复用同一份分发逻辑，这些动作统一走 IShell，
             * 不再直接摸 Form 的成员。桌面实现在 ShellWindows.cs。
             *
             * ⚠️ notify.push 除外：它不只是"弹一条通知"，还要读设置
             * （notifyDuration / notifyDesktop / notifyTray）、处理单条覆盖开关
             * （desktop / tray 传 -1 表示跟随设置）、再决定走弹窗还是托盘气泡。
             * 这些是业务判断，不是壳动作 —— 硬塞进 IShell 会把逻辑压扁成
             * "发一条通知"，直接丢掉上面那些行为。所以它原样保留。
             */
            if (m == "notify.push") return Host.NotifyPush(a);
            if (m == "app.hide") { Shell.Minimize(); return new { ok = true }; }
            if (m == "app.quit") { Shell.Quit(); return new { ok = true }; }
            if (m == "app.minimize") { Shell.Minimize(); return new { ok = true }; }
            if (m == "app.tray") { Host.InitTray(); return new { ok = true }; }
            if (m == "app.screen") return Host.ScreenInfo();

            /* ---- 音频试听（返回本地路径，前端用 <audio> 播） ---- */
            if (m == "notify.test")
            {
                // 连点不再叠窗：1.2 秒内只认一次；测试窗不置顶，免得盖住别的窗口让人以为 alt+tab 失效
                var now = Environment.TickCount64;
                if (now - _lastToastTest < 1200) return new { ok = true, skipped = true };
                _lastToastTest = now;
                Host.ShowToast("日签 · 提醒测试", "如果你看到这个窗口，说明桌面提醒是通的。", "focus", 5, false);
                return new { ok = true };
            }

            /* ---- 备忘录 ---- */
            if (m == "habit.reorder")
            {
                var arr = a.TryGetProperty("ids", out var ia) && ia.ValueKind == JsonValueKind.Array
                    ? ia.EnumerateArray().Select(x => x.GetString()).ToArray()
                    : new string[0];
                return db.HabitReorder(arr);
            }
            if (m == "notebooks.list") return db.Notebooks();
            if (m == "notebook.add") return db.NotebookAdd(S(a, "name"), S(a, "color"));
            if (m == "notebook.update") return db.NotebookUpdate(S(a, "id"), S(a, "name"), S(a, "color"));
            if (m == "notebook.delete") return db.NotebookDelete(S(a, "id"));
            if (m == "notes.list") return db.Notes(S(a, "notebookId"), S(a, "q"), I(a, "limit", 300));
            if (m == "note.get") return db.NoteGet(S(a, "id"));
            if (m == "note.save") return db.NoteSave(S(a, "id"), S(a, "notebookId"), S(a, "title"), S(a, "body"), I(a, "pinned", 0),
                /* 第 128 条：颜色 / 图标。不传 = null，等于「这次别动」，自动保存不会把色点抹掉 */
                S(a, "color"), S(a, "icon"));
            if (m == "note.delete") return db.NoteDelete(S(a, "id"));
            if (m == "note.restore") return db.NoteRestore(S(a, "id"));
            if (m == "notes.trash") return db.NotesTrash();
            if (m == "export.note") return Host.ExportNote(S(a, "id"));

            /* ---- 用户中心 ---- */
            if (m == "user.get") return db.UserGet();
            if (m == "user.save") return db.UserSave(S(a, "nickname"), S(a, "signature"), S(a, "avatar"),
                                                   S(a, "birthday"), S(a, "lunarBirthday"));

            /* ---- 密码 ---- */
            if (m == "vault.status") return db.VaultStatus();
            if (m == "vault.setMain") return db.VaultSetMain(S(a, "password"));
            if (m == "vault.clearMain") return db.VaultClearMain(S(a, "password"));
            if (m == "vault.add") return db.VaultAdd(S(a, "scope"), S(a, "target"), S(a, "label"), S(a, "password"));
            if (m == "vault.remove") return db.VaultRemove(S(a, "id"));
            if (m == "vault.check") return db.VaultCheck(S(a, "scope"), S(a, "target"));
            if (m == "vault.unlock") return db.VaultUnlock(S(a, "scope"), S(a, "target"), S(a, "password"), I(a, "minutes", 0));
            if (m == "vault.lock") return db.VaultLock();

            /* ---- 缓存 ---- */
            if (m == "cache.stats") return db.CacheStats();
            if (m == "cache.prune") return db.CachePrune(I(a, "days", 0), I(a, "maxMB", 0));
            if (m == "cache.clear") return db.CacheClear(S(a, "what", "cache"));
            if (m == "cache.open") { Shell.OpenPath(CacheDir); return new { ok = true }; }

            /* ---- 第 42 条：桌面常驻便签 ---- */
            if (m == "sticky.open") return Host.StickyOpen(S(a, "id"));
            if (m == "sticky.close") return Host.StickyClose(S(a, "id"));
            if (m == "sticky.list") return Host.StickyList();

            /* ---- 设置导出导入 ---- */
            if (m == "settings.export") return db.SettingsExport();
            if (m == "settings.import") return db.SettingsImport(S(a, "json"));

            /* ---- 节日 ---- */
            if (m == "festival.upcoming") return db.FestivalsUpcoming(I(a, "days", 30));
            if (m == "festival.add") return db.FestivalAdd(S(a, "name"), S(a, "date"), I(a, "lunarMonth", 0), I(a, "lunarDay", 0));
            if (m == "festival.delete") return db.FestivalDelete(S(a, "id"));
            if (m == "festival.day") return db.DayFestival(S(a, "date"));
            if (m == "festival.month") return db.FestivalMonth(S(a, "ym"));
            if (m == "festival.lunar") return Festivals.LunarText(DateTime.Today);

            /* ---- 导出 HTML ---- */
            if (m == "export.html") return db.ExportHtml();

            /* ---- 待办：带重复规则 ---- */
            if (m == "todo.add")
            {
                var r = db.TodoAdd2(S(a, "title"), S(a, "due", ""), S(a, "dueTime", ""),
                                    I(a, "priority", 1), S(a, "note", ""), S(a, "listId", ""));
                var id = (string)r.GetType().GetProperty("id").GetValue(r);
                db.TodoSetRepeat(id, S(a, "repeat", ""));
                return r;
            }
            if (m == "todo.repeat") { db.TodoSetRepeat(S(a, "id"), S(a, "repeat")); return new { ok = true }; }
            if (m == "todo.movelist") { db.TodoSetList(S(a, "id"), S(a, "listId")); return new { ok = true }; }
            if (m == "todos.recycle") return db.TodosRecycle();
            if (m == "todo.restore") return db.TodoRestore(S(a, "id"));
            if (m == "todo.purge") return db.TodoPurge(S(a, "id"));
            if (m == "todo.purgeAll") return db.TodoPurgeAll();

            /* ---- 倒计时：带重复规则 ---- */
            if (m == "cd.add")
            {
                return db.CdAdd2(S(a, "title"), S(a, "date"), S(a, "repeat", ""), S(a, "color"), S(a, "note", ""));
            }
            if (m == "cd.repeat") { db.CdSetRepeat(S(a, "id"), S(a, "repeat")); return new { ok = true }; }

            /* ---- 音乐库 ---- */
            if (m == "music.import") return Host.MusicImport();
            if (m == "music.addUrl") return db.MediaAddUrl(S(a, "url"), S(a, "name"));
            if (m == "music.list") return db.MediaByKind("audio,video");
            /* 第 26/27 条：把网络链接真的下载到本地。之前只有开关没有下载代码。 */
            if (m == "media.cacheUrl") return db.MediaCacheUrl(S(a, "id"));
            if (m == "media.cacheAll") return db.MediaCacheAll();

            return null;
        }

        /* ===== 来自 MainFormV8.cs 的 V8Dispatch ===== */
        private static object V8Dispatch(string m, JsonElement a)
        {
            if (m == "hotkey.apply") return ApplyHotkeys();
            /*
             * 第 165 条：浮窗的落库口子。
             * 浮窗本身不经过 WebView2，但前端也需要一条「和浮窗完全同一套保存逻辑」的通道 ——
             * 免得快速面板和浮窗对同一句话的落库行为不一样（那是两个 bug）。
             */
            if (m == "quick.capture")
            {
                var r = db.QuickCaptureSave(S(a, "kind", "todo"), S(a, "text"));
                return new { ok = r.ok, err = r.err, n = r.n };
            }
            /* 浮窗的显示口子：前端也可以主动叫出来（比如按钮点一下） */
            if (m == "quick.popup") { Shell.QuickCapture(S(a, "kind", "todo")); return Host.QuickState(); }
            if (m == "quick.state") return Host.QuickState();
            /* 第 75 条：前端锁屏 / 解锁时把状态同步给宿主，托盘图标据此叠小锁角标 */
            if (m == "shell.lockState")
            {
                Host.SetTrayLocked(I(a, "locked", 0) == 1);
                return new { ok = true, locked = Host.TrayLocked, icon = Get(Settings(), "trayLockIcon", "1") };
            }
            if (m == "shell.apply") { Host.ApplyShell(); return new { ok = true, boss = Host.BossOn }; }
            /* 第 191 条：开机自启。默认不启动，用户点了才写注册表。 */
            if (m == "shell.autostart") return Host.AutostartSet(I(a, "on", 0));
            if (m == "shell.autostartGet") return new { ok = true, on = Host.AutostartGet() ? 1 : 0 };
            /* 第 90 条：用系统默认程序打开外链 / mailto。
               WebView2 里 <a href="mailto:"> 点了没反应，必须转到宿主这边用 ShellExecute。 */
            if (m == "shell.openUrl") return Host.OpenExternal(S(a, "url"));
            if (m == "shell.hotkeyState")
            {
                var s = Settings();
                return new
                {
                    enabled = Get(s, "hotkeyEnable", "1") == "1",
                    registered = Host.HotkeyCount,
                    boss = Host.BossOn,
                    orb = Host.OrbVisible,
                };
            }
            if (m == "boss.toggle") { Host.ToggleBoss("界面按钮"); return new { ok = true, on = Host.BossOn }; }
            if (m == "orb.toggle") { Host.ApplyOrb(I(a, "on", 1) == 1); return new { ok = true }; }

            /* ---- 分享 ---- */
            if (m == "share.image") return db.ShareSaveImage(S(a, "data"), S(a, "name"));
            if (m == "share.copyImage") return db.ShareCopyImage(S(a, "data"));
            if (m == "share.copyText") return db.ShareCopyText(S(a, "text"));
            if (m == "share.html") return db.ShareSaveHtml(S(a, "html"), S(a, "name"));

            /* ---- 总结 ---- */
            if (m == "summary.list") return db.Summaries();
            if (m == "summary.get") return db.SummaryGet(S(a, "id"));
            if (m == "summary.save") return db.SummarySave(S(a, "id"), S(a, "kind"), S(a, "from"), S(a, "to"),
                                                       S(a, "title"), S(a, "body"), S(a, "plain"));
            if (m == "summary.delete") return db.SummaryDelete(S(a, "id"));
            if (m == "summary.pin") return db.SummaryPin(S(a, "id"), I(a, "pinned", 0));
            if (m == "review.day") return db.ReviewDay(S(a, "date"));
            if (m == "review.range") return db.ReviewRange(S(a, "from"), S(a, "to"));

            /* ---- 密码提示与密保 ---- */
            if (m == "vault.hint") return db.VaultSetHint(S(a, "hint"));
            if (m == "vault.qa.list") return db.VaultQaList();
            if (m == "vault.qa.save") return db.VaultQaSave(a.TryGetProperty("list", out var ql) ? ql : default);
            if (m == "vault.qa.verify") return db.VaultQaVerify(a.TryGetProperty("answers", out var qa) ? qa : default);
            if (m == "vault.qa.reset") return db.VaultResetByQa(
                a.TryGetProperty("answers", out var ra) ? ra : default, S(a, "password", ""));

            return null;
        }

        /* ===== 来自 MainFormV9.cs 的 V9Dispatch ===== */
        private static object V9Dispatch(string m, JsonElement a)
        {
            if (m == "entry.publish") return db.EntryPublish(S(a, "date"), I(a, "published", 1));
            if (m == "entry.status") return db.EntryStatus(S(a, "date"));
            if (m == "entry.drafts") return db.EntryDrafts();
            if (m == "pomo.insight") return db.PomoInsight(I(a, "days", 30), SN(a, "from"), SN(a, "to"));
            if (m == "pomo.day") return db.PomoDay(S(a, "date"));
            if (m == "pomo.months") return db.PomoMonths();
            if (m == "stats.calMonths") return db.CalendarMonths();
            if (m == "feedback.save") return db.FeedbackSave(S(a, "text"), S(a, "contact"));
            if (m == "app.facts") return db.AppFacts();
            return null;
        }

        /* ===== 来自 MainFormV10.cs 的 V10Dispatch ===== */
        private static object V10Dispatch(string m, JsonElement a)
        {
            /* 打卡 */
            if (m == "habit.delete") return db.HabitSoftDelete(S(a, "id"));
            if (m == "habit.restore") return db.HabitUndoDelete(S(a, "id"));
            if (m == "habit.purge") return db.HabitHardPurge(S(a, "id"));
            if (m == "habit.trash") return db.HabitTrash();
            if (m == "habit.stats") return db.HabitStats(I(a, "days", 30));

            /* 笔记 */
            if (m == "note.purge") return db.NotePurge(S(a, "id"));
            if (m == "note.purgeAll") return db.NotePurgeAll();
            if (m == "notebook.add2") return db.NotebookAdd2(S(a, "name"), S(a, "color"), S(a, "parentId"));
            if (m == "notebook.parent") return db.NotebookSetParent(S(a, "id"), S(a, "parentId"));

            /* 媒体 */
            if (m == "media.list2") return db.MediaList2(S(a, "kind", "all"), S(a, "q", ""), S(a, "sort", "new"), S(a, "dir", "desc"), S(a, "folder", ""), S(a, "tag", ""));
            if (m == "media.alias") return db.MediaSetAlias(S(a, "id"), S(a, "alias"));
            if (m == "media.bulk") return db.MediaBulk(S(a, "ids"), S(a, "action"), S(a, "value"));
            if (m == "media.folders") return db.MediaFolders();
            /* 第 151 条：标签与文件夹改名 */
            if (m == "media.tags") return db.MediaTags();
            if (m == "media.setTags") return db.MediaSetTags(S(a, "id"), S(a, "tags"));
            if (m == "media.renameFolder") return db.MediaRenameFolder(S(a, "from"), S(a, "to"));
            if (m == "media.tone") return db.MediaSetTone(S(a, "id"), S(a, "tone"));

            /* 记账 */
            if (m == "ledger.add") return db.LedgerAdd(S(a, "date"), S(a, "kind", "out"), D(a, "amount"), S(a, "cat"), S(a, "note"), S(a, "accountId", ""));
            if (m == "ledger.delete") return db.LedgerDelete(S(a, "id"));
            if (m == "ledger.update") return db.LedgerUpdate(S(a, "id"), S(a, "date"), S(a, "kind"), D(a, "amount"), S(a, "cat"), S(a, "note"), S(a, "accountId"));
            // 第 161/162 条：筛选条件下推给 SQL，参数必须转发，否则前端筛了等于没筛
            if (m == "ledger.list") return db.LedgerList(S(a, "from"), S(a, "to"), S(a, "kind"), S(a, "cat"), S(a, "kw"));
            if (m == "ledger.catRename") return db.LedgerCatRename(S(a, "from"), S(a, "to"));
            if (m == "ledger.catDrop") return db.LedgerCatDrop(S(a, "cat"), S(a, "to", "其他"));

            /* 提醒 */
            if (m == "alarm.list") return db.AlarmList();
            // 第 143 条：mode / sound / advance 三个新参数必须转发，否则「界面选了、后端没收到」。
            // 默认值留 null / -1 是故意的：老调用点不传时 Db 会保留原值。
            if (m == "alarm.save") return db.AlarmSave(S(a, "id"), S(a, "kind", "habit"), S(a, "title"), S(a, "atTime"), S(a, "repeat", "daily"), I(a, "enabled", 1), I(a, "intervalMin", 0),
                S(a, "mode"), S(a, "sound"), I(a, "advance", -1));
            if (m == "alarm.delete") return db.AlarmDelete(S(a, "id"));
            if (m == "alarm.snooze") return db.AlarmSnooze(S(a, "id"), I(a, "minutes", 5));

            /* 打气话 */
            if (m == "encourage.list") return db.EncourageList();
            if (m == "encourage.save") return db.EncourageSave(S(a, "id"), S(a, "kind", "text"), S(a, "text"), S(a, "mediaId"), I(a, "enabled", 1));
            if (m == "encourage.delete") return db.EncourageDelete(S(a, "id"));

            /* 排行 / 版本去重 */
            if (m == "stats.rank") return db.RankStreaks(I(a, "top", 8));
            if (m == "stats.rankExtra") return db.RankExtra(I(a, "top", 5));

            // 记账：账户与周期账单（第 97 条）
            if (m == "ledger.accounts") return db.LedgerAccounts();
            if (m == "account.save") return db.AccountSave(S(a, "id"), S(a, "name"), S(a, "kind", "cash"), D(a, "init"),
                SN(a, "currency"), SN(a, "icon"), SN(a, "note"));
            if (m == "account.delete") return db.AccountDelete(S(a, "id"));
            if (m == "ledger.recur.list") return db.LedgerRecurList();
            if (m == "ledger.recur.save") return db.LedgerRecurSave(S(a, "id"), S(a, "kind", "out"), D(a, "amount"),
                S(a, "cat"), S(a, "note"), S(a, "accountId", ""), I(a, "day", 1), I(a, "enabled", 1));
            if (m == "ledger.recur.delete") return db.LedgerRecurDelete(S(a, "id"));
            if (m == "ledger.recur.run") return db.LedgerRecurRun(S(a, "month", ""));
            if (m == "rev.dedup") return db.RevisionsDedup(S(a, "date"));

            /* 第 195 / 164 条：窗口外壳与托盘菜单跟随主题 */
            if (m == "app.chrome")
            {
                SetUiChrome(S(a, "panel"), S(a, "ink"), S(a, "line"), S(a, "accent"), I(a, "dark", 0));
                return new { ok = true };
            }

            /* 第 188 条：大事时间轴 */
            if (m == "milestone.list") return db.MilestoneList();
            if (m == "milestone.save") return db.MilestoneSave(S(a, "id"), S(a, "date"), S(a, "title"), S(a, "note"), S(a, "kind"));
            if (m == "milestone.delete") return db.MilestoneDelete(S(a, "id"));

            /* #250：愿望单 */
            if (m == "wish.list") return db.WishList();
            if (m == "wish.save")
                return db.WishSave(S(a, "id"), S(a, "title"), L(a, "priceCents", 0),
                    S(a, "note"), S(a, "url"), I(a, "priority", 1), S(a, "targetDate"));
            if (m == "wish.done") return db.WishDone(S(a, "id"), I(a, "done", 0));
            if (m == "wish.delete") return db.WishDelete(S(a, "id"));
            if (m == "wish.stats") return db.WishStats();

            /* 第 117 条：跨模块搜索 */
            if (m == "search.all") return db.SearchAll(S(a, "q"), I(a, "per", 6));

            /* 第 140 条：打卡提醒（预览用，正式推送在定时器里） */
            if (m == "habit.remindPreview") return db.HabitRemindPreview();
            if (m == "habit.remindCheck") return db.HabitRemindCheck();
            /* 第 21 条：节日提醒预览（设置页用，看现在提醒会长什么样） */
            if (m == "festival.remindPreview") return db.FestivalRemindPreview();

            /* ================= 第 196-235 条 ================= */

            /* 笔记：手动排序（第 230 条）+ 笔记本无限层级（第 220 条） */
            if (m == "note.reorder") return db.NoteReorder(AA(a, "ids"));
            if (m == "notebook.reorder") return db.NotebookReorder(AA(a, "ids"));
            if (m == "notebook.tree") return db.NotebookTree();
            // 带防环校验的设父，顶掉老的那个（老的没有防环）
            if (m == "notebook.parent2") return db.NotebookSetParent2(S(a, "id"), S(a, "parentId"));

            /* 草稿箱回收站（第 227 条） */
            if (m == "draft.trash") return db.DraftTrash(S(a, "date"));
            if (m == "draft.restore") return db.DraftRestore(S(a, "date"));
            if (m == "draft.trashList") return db.DraftTrashList();
            if (m == "draft.purge") return db.DraftPurge(S(a, "date"));

            /* 学习模块：手动补录 / 计时器 / 改记录（第 228 条） */
            if (m == "pomodoro.manual") return db.PomodoroManual(S(a, "date"), S(a, "startHm"), I(a, "minutes", 25), S(a, "task"), S(a, "note"));
            if (m == "pomodoro.timer") return db.TimerLog(S(a, "date"), I(a, "minutes", 0), S(a, "task"), S(a, "note"), I(a, "up", 0));
            if (m == "pomodoro.edit") return db.PomodoroEdit(S(a, "id"), I(a, "minutes", 0), SN(a, "task"), SN(a, "note"));

            /* 待办清单描述（第 218 条） */
            if (m == "todo.list.note") return db.TodoListSetNote(S(a, "id"), S(a, "note"));
            /* 待办清单无限层级（第 220 条） */
            if (m == "todo.list.parent") return db.TodoListSetParent(S(a, "id"), S(a, "parentId"));

            /* 账户排序 / 启停（第 221 条） */
            if (m == "account.reorder") return db.AccountReorder(AA(a, "ids"));
            if (m == "account.toggle") return db.AccountToggle(S(a, "id"), I(a, "enabled", 1));

            /* 储蓄罐（第 97 条）*/
            if (m == "jar.list") return db.JarList();
            if (m == "jar.detail") return db.JarDetail(S(a, "id"));
            if (m == "jar.add") return db.JarAdd(S(a, "name"), D(a, "target"), S(a, "mode", "free"),
                S(a, "period", "week"), D(a, "baseAmount"), D(a, "stepAmount"),
                S(a, "color", ""), S(a, "icon", ""), S(a, "note", ""));
            if (m == "jar.update") return db.JarUpdate(S(a, "id"), S(a, "name"), D(a, "target"),
                S(a, "mode", "free"), S(a, "period", "week"), D(a, "baseAmount"), D(a, "stepAmount"),
                S(a, "color", ""), S(a, "icon", ""), S(a, "note", ""));
            if (m == "jar.deposit") return db.JarDeposit(S(a, "id"), S(a, "dir", "in"), D(a, "amount"),
                S(a, "date", ""), S(a, "note", ""), S(a, "accountId", ""));
            if (m == "jar.removeItem") return db.JarRemoveItem(S(a, "id"));
            if (m == "jar.delete") return db.JarDelete(S(a, "id"));
            if (m == "jar.archive") return db.JarArchive(S(a, "id"), I(a, "archived", 1));
            if (m == "jar.reorder") return db.JarReorder(AA(a, "ids"));
            if (m == "jar.presets") return db.JarPresets();

            /* 记账本图表数据（第 205 条） */
            if (m == "ledger.insight") return db.LedgerInsight(S(a, "ym"));

            /* 媒体库批量导入文件夹（第 233 条） */
            if (m == "media.importFolder") return db.MediaImportFolder(S(a, "dir"), I(a, "recursive", 1));
            if (m == "media.storage") return db.MediaStorageStats();   // 第 217 条

            /* 提醒：新建后别把今天错过的补响一遍（第 208 条） */
            if (m == "alarm.skipMissed") return db.AlarmsSkipMissed();

            /* 第 237 条：在「今天」里临时关掉的模块，只对那一篇日记生效。
             * 跟 modules.update(enabled:0) 是两回事 —— 那个是全局长期生效。 */
            if (m == "modules.hiddenOn") return new { ok = true, ids = db.ModuleHiddenOn(S(a, "date")) };
            if (m == "modules.hideOn") return db.ModuleHideOn(S(a, "date"), S(a, "id"), I(a, "hidden", 1));
            /* 第 237 条后半：这一篇里临时多显示一个全局关掉的模块（真正按日期生效） */
            if (m == "modules.shownOn") return new { ok = true, ids = db.ModuleShownOn(S(a, "date")) };
            if (m == "modules.showOn") return db.ModuleShowOn(S(a, "date"), S(a, "id"), I(a, "shown", 1));

            /* ================================================================
             * 诊断接口（本轮新增，给 AI 和自己排障用）
             *
             * 这几个是「自省」性质的：AI 不需要预先知道有什么方法，
             * 先问 diag.methods 就能拿到全量清单，再按需调用。
             * ================================================================ */

            // 日志：读最近 N 行 / 某一天 / 统计
            if (m == "diag.logs") return new
            {
                ok = true,
                text = Diag.Tail(I(a, "lines", 300), S(a, "day")),
                stats = Diag.Stats()
            };
            if (m == "diag.stats") return new { ok = true, stats = Diag.Stats(), env = Diag.Snapshot() };

            // 前端主动上报错误（window.onerror / React ErrorBoundary / 未捕获 Promise）
            if (m == "diag.frontend")
            {
                var lv = S(a, "level", "error");
                var src = S(a, "src", "web");
                var msg = S(a, "msg", "(无消息)");
                var stack = S(a, "stack", "");
                var detail = msg + (string.IsNullOrEmpty(stack) ? "" : "\n" + stack);
                if (lv == "warn") Diag.Warn("js." + src, detail);
                else if (lv == "info") Diag.Info("js." + src, detail);
                else Diag.Error("js." + src, detail);
                return new { ok = true };
            }

            // 前端把「用户干了什么」告诉我 —— 崩溃时靠这个还原现场
            if (m == "diag.action") { Diag.Info("action", S(a, "what", "")); return new { ok = true }; }

            // 改日志级别 / 保留天数（设置页和 AI 都能调）
            if (m == "diag.config")
            {
                var lvl = S(a, "level");
                if (!string.IsNullOrEmpty(lvl) && Enum.TryParse<LogLevel>(lvl, true, out var parsed)) Diag.MinLevel = parsed;
                var keep = I(a, "keepDays", -1);
                if (keep > 0) Diag.KeepDays = keep;
                Diag.Info("diag", "日志配置变更 → level=" + Diag.MinLevel + " keepDays=" + Diag.KeepDays);
                return new { ok = true, level = Diag.MinLevel.ToString(), keepDays = Diag.KeepDays };
            }

            // 手动打一行日志，测通道通不通
            if (m == "diag.ping")
            {
                Diag.Info("diag", "ping ← " + S(a, "msg", "手动测试"));
                return new { ok = true, dir = Diag.Dir, level = Diag.MinLevel.ToString() };
            }

            // 方法清单：让 AI 自己发现有哪些接口（详细版见 RpcCatalog）
            if (m == "diag.methods") return RpcCatalog.List(I(a, "limit", 0));
            if (m == "diag.method") return RpcCatalog.Describe(S(a, "name"));

            /* 手动让 WAL 落盘。诊断用，也给迁移前的自检用。
               WAL 模式下"已提交"和"进了主文件"是两件事，
               想知道某个时刻单拷主文件够不够，先跑一下这个看 -wal 归不归零。 */
            if (m == "diag.checkpoint") return db.ForceCheckpoint();

            // 打开日志目录。不能复用 app.openRoot —— 那是数据目录，日志在
            // %LOCALAPPDATA%\Riqian\logs，跟数据目录不同源（数据可以搬家，日志不搬）。
            if (m == "diag.openDir") { Shell.OpenPath(Diag.Dir); return new { ok = true, dir = Diag.Dir }; }

            /* AI 调试网关的开关 + 状态。
             * 设置页的开关和外部 AI 都走这一个口子。on 为空表示「只查状态」。 */
            if (m == "diag.api")
            {
                return Host.DebugApiApply(S(a, "on", ""), I(a, "port", 0));
            }

            // 网关的 info 文件内容（设置页想直接展示「怎么调」的说明书）
            if (m == "diag.apiInfo") return Host.DebugApiInfo();

            return null;
        }

        /* ===== 来自 MainFormV12.cs 的 V12Dispatch ===== */
        private static object V12Dispatch(string m, JsonElement a)
        {
            /* 第 107 / 170 条：字体库。命名 space 沿用 "font."，和上面的 "draw." 平级 */
            if (m != null && m.StartsWith("font."))
            {
                if (m == "font.list") return db.FontList();
                if (m == "font.import") return Host.FontImport();
                if (m == "font.delete") return db.FontDelete(S(a, "file"));
                if (m == "font.bytes") return db.FontBytes(S(a, "file"));
                return null;
            }

            if (m == null || !m.StartsWith("draw.")) return null;

            if (m == "draw.list") return db.DrawingList();
            if (m == "draw.get") return db.DrawingGet(S(a, "id"));
            if (m == "draw.save")
                return db.DrawingSave(
                    S(a, "id"), S(a, "title"), I(a, "w", 0), I(a, "h", 0),
                    S(a, "strokes"), S(a, "thumb"), S(a, "note"));
            if (m == "draw.delete") return db.DrawingDelete(S(a, "id"), I(a, "hard", 0));
            if (m == "draw.trash") return db.DrawingTrash();
            if (m == "draw.restore") return db.DrawingRestore(S(a, "id"));
            if (m == "draw.rename") return db.DrawingRename(S(a, "id"), S(a, "title"));
            if (m == "draw.toMedia") return db.DrawingToMedia(S(a, "id"), S(a, "data"), S(a, "name"));

            return null;
        }
    }
}
