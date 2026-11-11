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
                /*
                 * db 为 null 说明启动没走完（比如打不开数据库）。
                 * 这时候定时器还在跳，每一跳都会 NRE —— 2026-11-11 的日志里
                 * 就留了这么一串：启动失败之后每 30 秒一条
                 * `NullReferenceException at StartV10.b__43_0`，
                 * 把真正的失败原因淹掉了。
                 *
                 * 一道判空就能让它闭嘴。定时器停了也无所谓：这个进程马上要退。
                 */
                if (db == null) return;

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

        /* V10Dispatch 已搬到 RpcDispatcher.cs（桌面与安卓共用同一份实现），见该文件。 */

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
        private static string SN(System.Text.Json.JsonElement a, string k) => RpcArgs.SN(a, k);
    }
}
