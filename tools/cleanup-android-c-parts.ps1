# =====================================================================
# 清理 2026-11-03 凌晨误装到 C 盘的 .NET Android 构建组件。
#
# 背景：这堆东西原本是为了编译日签安卓版，用 `dotnet workload install android`
# 装进来的。因为那个安装类型是 msi，必须写 HKLM 才生效，而当时没有管理员
# 权限 —— 结果是包全下载完、注册没写成功，白占 1.3 GB，且编译照样不能用。
#
# 本脚本只删「时间戳在 2026-11-02 之后」的 Android 专属目录。
# 桌面版 .NET 8 的原有组件时间戳是 2026-08-05，不在清单里，绝不触碰。
#
# 清理后影响：本机无法再编译 .NET 安卓项目。
# 要重新开启，参见 E 盘独立 SDK 方案（不在 C 盘留东西）。
# =====================================================================

$ErrorActionPreference = 'Stop'
$packsDir = 'C:\Program Files\dotnet\packs'

# 精确清单：全部是 android workload 专属，桌面 .NET 8 一个都不用
$targets = @(
    'Microsoft.Android.Ref.34'
    'Microsoft.Android.Runtime.34.android-arm'
    'Microsoft.Android.Runtime.34.android-arm64'
    'Microsoft.Android.Runtime.34.android-x64'
    'Microsoft.Android.Runtime.34.android-x86'
    'Microsoft.Android.Sdk.Windows'
    'Microsoft.NET.Runtime.MonoAOTCompiler.Task'
    'Microsoft.NET.Runtime.MonoTargets.Sdk'
    'Microsoft.NETCore.App.Runtime.Mono.android-arm'
    'Microsoft.NETCore.App.Runtime.Mono.android-arm64'
    'Microsoft.NETCore.App.Runtime.Mono.android-x64'
    'Microsoft.NETCore.App.Runtime.Mono.android-x86'
    'Microsoft.NETCore.App.Runtime.AOT.win-x64.Cross.android-arm'
    'Microsoft.NETCore.App.Runtime.AOT.win-x64.Cross.android-x64'
    'Microsoft.NETCore.App.Runtime.AOT.win-x64.Cross.android-x86'
)

# 守护清单：绝对不能删的（桌面版命根子），用于二次校验
$forbidden = @(
    'Microsoft.NETCore.App.Ref'
    'Microsoft.NETCore.App.Host.win-x64'
    'Microsoft.WindowsDesktop.App.Ref'
    'Microsoft.AspNetCore.App.Ref'
)

Write-Host ''
Write-Host '  C 盘 Android 构建组件清理' -ForegroundColor Cyan
Write-Host '  ================================' -ForegroundColor DarkGray
Write-Host ''

# ---- 0. 权限自检 ----
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host '  [X] 需要管理员权限。' -ForegroundColor Red
    Write-Host '      请右键本文件 -> 以管理员身份运行，或双击同目录的 .cmd。' -ForegroundColor Yellow
    Write-Host ''
    Read-Host '按回车退出'
    exit 1
}
Write-Host '  [OK] 管理员权限' -ForegroundColor Green

# ---- 1. 先停掉可能占用文件的 dotnet 后台进程 ----
Write-Host '  [..] 关闭 dotnet 构建服务'
& dotnet build-server shutdown 2>&1 | Out-Null
Start-Sleep -Milliseconds 800

# ---- 2. 逐项校验并统计体积 ----
$plan = @()
$totalBytes = 0
foreach ($name in $targets) {
    $full = Join-Path $packsDir $name

    # 守护校验：名字里出现守护项就拒绝（防止清单被手改坏）
    foreach ($f in $forbidden) {
        if ($name -eq $f) { throw "安全拦截：$name 在守护清单里，拒绝删除" }
    }

    if (-not (Test-Path $full)) {
        Write-Host "  [--] $name （不存在，跳过）" -ForegroundColor DarkGray
        continue
    }

    # 时间戳校验：早于 2026-11-02 的一律不动
    $ct = (Get-Item $full).CreationTime
    if ($ct -lt [datetime]'2026-11-02') {
        Write-Host "  [!!] $name （创建于 $($ct.ToString('yyyy-MM-dd'))，不是这次装的，跳过）" -ForegroundColor Yellow
        continue
    }

    $sz = (Get-ChildItem $full -Recurse -File -ErrorAction SilentlyContinue |
           Measure-Object Length -Sum).Sum
    if (-not $sz) { $sz = 0 }
    $totalBytes += $sz
    $plan += [pscustomobject]@{ Name = $name; Path = $full; Bytes = $sz }
    Write-Host ("  [OK] {0,-58} {1,8:N1} MB" -f $name, ($sz / 1MB)) -ForegroundColor Gray
}

if ($plan.Count -eq 0) {
    Write-Host ''
    Write-Host '  没有需要清理的项（可能已经删过了）。' -ForegroundColor Yellow
    Write-Host ''
    Read-Host '按回车退出'
    exit 0
}

# ---- 3. 确认 ----
Write-Host ''
Write-Host ("  合计可释放：{0:N2} GB，共 {1} 项" -f ($totalBytes / 1GB), $plan.Count) -ForegroundColor Cyan
Write-Host ''
Write-Host '  删除后本机将无法编译 .NET 安卓项目（可随时重新安装恢复）。' -ForegroundColor Yellow
Write-Host '  桌面版日签不受任何影响。' -ForegroundColor Green
Write-Host ''
$ans = Read-Host '  确认删除？输入 y 继续，其他任意键取消'
if ($ans -notmatch '^[yY]$') {
    Write-Host '  已取消，什么都没动。' -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    exit 0
}

# ---- 4. 删除 ----
Write-Host ''
$fail = 0
foreach ($item in $plan) {
    try {
        Remove-Item $item.Path -Recurse -Force -ErrorAction Stop
        Write-Host ("  [删] {0}" -f $item.Name) -ForegroundColor Green
    } catch {
        $fail++
        Write-Host ("  [败] {0}  -> {1}" -f $item.Name, $_.Exception.Message) -ForegroundColor Red
    }
}

# ---- 5. 验收 ----
Write-Host ''
Write-Host '  验收' -ForegroundColor Cyan
Write-Host '  ----' -ForegroundColor DarkGray

$left = 0
foreach ($item in $plan) {
    if (Test-Path $item.Path) { $left++; Write-Host "  [残留] $($item.Name)" -ForegroundColor Red }
}
if ($left -eq 0) { Write-Host '  [OK] 清单内目录全部清除' -ForegroundColor Green }

# 桌面版组件必须还在
$desktopOk = $true
foreach ($f in $forbidden) {
    $p = Join-Path $packsDir $f
    if (-not (Test-Path $p)) { $desktopOk = $false; Write-Host "  [!!!] 桌面组件缺失：$f" -ForegroundColor Red }
}
if ($desktopOk) { Write-Host '  [OK] 桌面 .NET 8 组件完好' -ForegroundColor Green }

# workload 应为空
$wl = (& dotnet workload list 2>&1) -join "`n"
if ($wl -notmatch 'android') { Write-Host '  [OK] 无残留 android workload' -ForegroundColor Green }
else { Write-Host '  [!!] 仍列有 android workload' -ForegroundColor Yellow }

# 报告剩余体积
$after = (Get-ChildItem $packsDir -Recurse -File -ErrorAction SilentlyContinue |
          Measure-Object Length -Sum).Sum / 1GB
Write-Host ("  packs 目录现在：{0:N2} GB" -f $after) -ForegroundColor Gray

Write-Host ''
if ($fail -eq 0 -and $left -eq 0) {
    Write-Host '  完成。' -ForegroundColor Green
} else {
    Write-Host '  部分项没删掉 —— 可能是文件被占用。关掉 Visual Studio / 资源管理器后重跑本脚本。' -ForegroundColor Yellow
}
Write-Host ''
Read-Host '按回车退出'