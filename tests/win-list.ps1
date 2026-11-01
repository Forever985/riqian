# 枚举 Riqian 进程的所有顶层可见窗口，用来确认第 165 条的浮窗真的弹出来了。
# 浮窗是 ShowInTaskbar=false 的无边框 Form，MainWindowTitle 抓不到，只能 EnumWindows。
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win {
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    public struct RECT { public int L, T, R, B; }
    delegate bool EnumProc(IntPtr h, IntPtr p);

    public static List<string> List(uint want) {
        var list = new List<string>();
        var fg = GetForegroundWindow();
        EnumWindows((h, p) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != want) return true;
            if (!IsWindowVisible(h)) return true;
            var t = new StringBuilder(256); GetWindowText(h, t, 256);
            var c = new StringBuilder(256); GetClassName(h, c, 256);
            RECT r; GetWindowRect(h, out r);
            list.Add(string.Format("{0}|{1}|{2}x{3}@{4},{5}|fg={6}",
                t.ToString(), c.ToString(), r.R - r.L, r.B - r.T, r.L, r.T, h == fg));
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@
$p = Get-Process Riqian -ErrorAction SilentlyContinue
if (-not $p) { "NO PROCESS"; exit }
[Win]::List([uint32]$p.Id)