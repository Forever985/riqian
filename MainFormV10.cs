using System;
using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// v10 宿主扩展：RPC 分发 + 到点提醒的定时器。
    /// 提醒的"响"交给前端（WebAudio 在页面里），宿主只负责到点喊一声。
    /// </summary>
    public partial class MainForm
    {
        private System.Windows.Forms.Timer _alarmTimer;

        private void StartV10()
        {
            if (_alarmTimer != null) return;
            _alarmTimer = new System.Windows.Forms.Timer { Interval = 30_000 };
            _alarmTimer.Tick += (s, e) =>
            {
                try
                {
                    var due = db.AlarmsDue();
                    if (due != null)
                    {
                        var json = JsonSerializer.Serialize(due);
                        if (json != "[]")
                            web.CoreWebView2?.ExecuteScriptAsync("window.__ALARMS__ && window.__ALARMS__(" + json + ")");
                    }
                }
                catch (Exception ex) { Diag.Error("dispatch.v10", "v10 分发失败", ex); }

                // 第 140 条：每天到点催一下还没打的卡。
                // 判断（该不该发、今天发过没有、是不是全打完了）都在 Db 里，宿主只负责喊。
                try
                {
                    var rem = db.HabitRemindTick();
                    if (rem != null)
                    {
                        var json = JsonSerializer.Serialize(rem);
                        web.CoreWebView2?.ExecuteScriptAsync("window.__HABIT_REMIND__ && window.__HABIT_REMIND__(" + json + ")");
                    }
                }
                catch (Exception ex) { Diag.Error("dispatch.v10", "v10 分发失败", ex); }

                // 第 21 条：节日提醒。节日前几天说一声，别等当天打开才知道。
                try
                {
                    var fes = db.FestivalRemindTick();
                    if (fes != null)
                    {
                        var json = JsonSerializer.Serialize(fes);
                        web.CoreWebView2?.ExecuteScriptAsync("window.__FESTIVAL_REMIND__ && window.__FESTIVAL_REMIND__(" + json + ")");
                    }
                }
                catch (Exception ex) { Diag.Error("dispatch.v10", "节日提醒失败", ex); }
            };
            _alarmTimer.Start();
        }

        private object V10Dispatch(string m, JsonElement a)
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

            /* 第 117 条：跨模块搜索 */
            if (m == "search.all") return db.SearchAll(S(a, "q"), I(a, "per", 6));

            /* 第 140 条：打卡提醒（预览用，正式推送在定时器里） */
            if (m == "habit.remindPreview") return db.HabitRemindPreview();
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

            // 打开日志目录。不能复用 app.openRoot —— 那是数据目录，日志在
            // %LOCALAPPDATA%\Riqian\logs，跟数据目录不同源（数据可以搬家，日志不搬）。
            if (m == "diag.openDir") { OpenPath(Diag.Dir); return new { ok = true, dir = Diag.Dir }; }

            /* AI 调试网关的开关 + 状态。
             * 设置页的开关和外部 AI 都走这一个口子。on 为空表示「只查状态」。 */
            if (m == "diag.api")
            {
                var want = S(a, "on", "");
                if (want == "1")
                {
                    var err = DebugApi.Start(I(a, "port", 0), this, Dispatch);
                    if (err != null) return new { ok = false, err };
                    db.SettingSet("debugApi", "1");   // 记住，下次启动自动开
                }
                else if (want == "0")
                {
                    DebugApi.Stop();
                    db.SettingSet("debugApi", "0");
                }
                if (!string.IsNullOrEmpty(want))
                    Diag.Info("diag", "调试网关 " + (want == "1" ? "开启" : "关闭") + " ← 设置页");

                return new
                {
                    ok = true,
                    running = DebugApi.IsRunning,
                    port = DebugApi.Port,
                    token = DebugApi.TokenForShow,
                    info = DebugApi.InfoFile,
                    url = DebugApi.IsRunning ? "http://127.0.0.1:" + DebugApi.Port + "/" : ""
                };
            }

            // 网关的 info 文件内容（设置页想直接展示「怎么调」的说明书）
            if (m == "diag.apiInfo")
            {
                string text = "";
                try { if (System.IO.File.Exists(DebugApi.InfoFile)) text = System.IO.File.ReadAllText(DebugApi.InfoFile); }
                catch (Exception ex) { Diag.Warn("diag", "读 debug-api.json 失败", ex); }
                return new { ok = true, path = DebugApi.InfoFile, text };
            }

            return null;
        }

        /// <summary>取字符串数组参数（第 230 条的批量顺序靠它）</summary>
        private static string[] AA(System.Text.Json.JsonElement a, string k)
        {
            if (!a.TryGetProperty(k, out var v) || v.ValueKind != System.Text.Json.JsonValueKind.Array)
                return new string[0];
            var list = new System.Collections.Generic.List<string>();
            foreach (var it in v.EnumerateArray())
                list.Add(it.ValueKind == System.Text.Json.JsonValueKind.String ? it.GetString() ?? "" : it.ToString());
            return list.ToArray();
        }

        /// <summary>取「可能没传」的字符串：没传返回 null，传了空串返回空串 —— 用来区分「不改」和「改成空」</summary>
        private static string SN(System.Text.Json.JsonElement a, string k)
        {
            if (!a.TryGetProperty(k, out var v)) return null;
            if (v.ValueKind == System.Text.Json.JsonValueKind.Null) return null;
            return v.GetString() ?? "";
        }
    }
}
