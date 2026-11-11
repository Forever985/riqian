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

        /* V9Dispatch 已搬到 RpcDispatcher.cs（桌面与安卓共用同一份实现），见该文件。 */
    }
}
