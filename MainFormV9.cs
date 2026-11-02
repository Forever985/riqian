using System;
using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;

namespace Riqian
{
    /// <summary>
    /// v9 宿主扩展：只补「关闭 / 最小化行为」这一块 Window 逻辑，其余能力都走 V9Dispatch。
    /// </summary>
    public partial class MainForm
    {
        /// <summary>第 61 条：最小化时按设置决定「收进托盘」还是「留在任务栏」。</summary>
        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            try
            {
                if (WindowState != FormWindowState.Minimized) return;
                var s = Settings();
                if (Get(s, "minTray", "0") != "1") return;
                // 收起前先让界面把草稿写掉，否则「最小化」会把最后一段吞掉
                _ = HideToTray();
            }
            catch (Exception ex) { Diag.Error("dispatch.v9", "v9 分发失败", ex); }
        }

        private object V9Dispatch(string m, JsonElement a)
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
    }
}
