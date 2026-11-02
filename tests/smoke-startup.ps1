# 启动后冒烟：起进程 → 等 /health → 调几个只读 RPC → 查日志有没有炸 → 关掉。
#
# 为什么需要这个（`--selfcheck` 管不了的那一层）：
#   --selfcheck 只验「库能不能建对」，它不启动界面、不跑 RPC 分发。
#   而 2026-11-02 那两个 bug 的现形方式都是「点开某一页才报错」——
#   库建对了，接口一调照样 500。所以必须有一步真的把程序跑起来。
#
# 关于数据目录：用 `--data-root=` 启动参数，**绝不碰 %APPDATA%\Riqian\config.json**。
#   早期版本是"备份配置→改写→还原"，结果 ConvertTo-Json 把中文路径转义坏了
#   （E:\日签-abtest → E:\鏃ョ-abtest），而且探针被强杀时 finally 不执行，
#   用户的配置会永久停在临时目录上。测试不该有权限动用户配置。
#
# 用法： pwsh tests/smoke-startup.ps1 -Exe ./publish/Riqian.exe
param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [int]$TimeoutSec = 90
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:failed = 0
function Fail($msg) {
    Write-Host "  x $msg" -ForegroundColor Red
    $script:failed++
}
function Pass($msg) { Write-Host "  . $msg" -ForegroundColor Green }

$proc = $null
# $base / $token 必须在脚本级声明：finally 里调 app.quit 要用，
# 声明在 try 内部的话 finally 看到的是另一个作用域里的空值。
$base = $null
$token = $null
$tmpRoot = Join-Path ([IO.Path]::GetTempPath()) ("riqian-smoke-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))

try {
    # 端口挑一个不常用的，避免和用户本机跑着的调试网关撞车
    $port = Get-Random -Minimum 58200 -Maximum 58900
    New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null

    Write-Host "启动 $Exe --debug-api=$port --data-root=$tmpRoot"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Resolve-Path $Exe).Path
    $psi.Arguments = "--debug-api=$port --data-root=`"$tmpRoot`""
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $proc = [System.Diagnostics.Process]::Start($psi)

    # ---------- 等 /health ----------
    $base = "http://127.0.0.1:$port"
    $ok = $false
    $h = $null
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            Fail "进程提前退出了（退出码 $($proc.ExitCode)）"
            break
        }
        try {
            $h = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 3 -ErrorAction Stop
            if ($h.ok -and $h.pid -eq $proc.Id) { $ok = $true; break }
        }
        catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ok) {
        Fail "等 $TimeoutSec 秒没等到本进程的 /health"
        # 拿不到 /health 时最可能的原因是"进程起不来"，而不是"网关没开"。
        # 程序在启动失败时会写一份 %TEMP%\riqian-boot-error.log ——
        # 不打出来就只剩一句"超时"，在 CI 上根本没法排查。
        $bootLog = Join-Path ([IO.Path]::GetTempPath()) 'riqian-boot-error.log'
        if (Test-Path $bootLog) {
            Write-Host "  --- boot-error.log 前 30 行 ---" -ForegroundColor DarkYellow
            try {
                [IO.File]::ReadAllText($bootLog, [Text.Encoding]::UTF8) -split "`r?`n" |
                    Select-Object -First 30 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkYellow }
            }
            catch { }
            Write-Host "  --- 结束 ---" -ForegroundColor DarkYellow
        }
        else {
            Write-Host "  没有 boot-error.log。检查是不是 CI 环境缺 WebView2 运行时。" -ForegroundColor DarkYellow
        }
    }
    else {
        Pass "/health 通了（版本 $($h.version)，pid $($h.pid)）"
    }

    if ($ok) {
        # ---------- 读 token ----------
        # token 每次启动随机，写在 %APPDATA%\Riqian\debug-api.json。
        # 这个文件是**全局唯一**的，同一台机器上多次启动会互相覆盖 ——
        # 所以必须核对 baseUrl 里的端口和 pid，否则可能拿到上一次运行残留的 token。
        $infoPath = Join-Path (Join-Path $env:APPDATA 'Riqian') 'debug-api.json'
        $token = $null
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline) {
            if (Test-Path $infoPath) {
                try {
                    $info = [IO.File]::ReadAllText($infoPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
                    if ($info.port -eq $port -and $info.pid -eq $proc.Id) { $token = $info.token; break }
                }
                catch { }
            }
            Start-Sleep -Milliseconds 300
        }
        if (-not $token) {
            Fail "读不到本次进程的 token（debug-api.json 里的 port/pid 对不上，可能是残留文件）"
        }
        else {
            Pass "拿到 token"

            # ---------- 调只读 RPC ----------
            # 挑的都是「页面一打开就会调」的接口 —— 正是那两个 bug 的现形处。
            # 只看 ok，不比对内容：这一步的目的是"别 500"，不是验业务正确性。
            $probes = @(
                @{ m = 'bootstrap'; a = @{} },
                @{ m = 'cd.list'; a = @{} },
                @{ m = 'todos.list'; a = @{} },
                @{ m = 'todo.lists'; a = @{} },
                @{ m = 'notes.list'; a = @{ limit = 50 } },
                @{ m = 'notebooks.list'; a = @{} },
                @{ m = 'ledger.accounts'; a = @{} },
                @{ m = 'habits.list'; a = @{} },
                @{ m = 'pomodoro.stats'; a = @{} },
                @{ m = 'modules.list'; a = @{} }
            )
            foreach ($p in $probes) {
                $body = @{ m = $p.m; a = $p.a } | ConvertTo-Json -Compress -Depth 6
                try {
                    $r = Invoke-RestMethod -Uri "$base/rpc" -Method Post -Body $body `
                        -ContentType 'application/json' -Headers @{ 'X-Token' = $token } `
                        -TimeoutSec 15 -ErrorAction Stop
                    if ($r.ok) { Pass "rpc $($p.m)" }
                    else { Fail "rpc $($p.m) -> ok=false: $($r.err)" }
                }
                catch {
                    Fail "rpc $($p.m) -> 抛异常: $($_.Exception.Message)"
                }
            }

            # ---------- 查日志有没有 Error ----------
            # 即使 RPC 全过，后台也可能在报错（渲染失败、迁移告警）。
            try {
                $lg = Invoke-RestMethod -Uri "$base/logs?lines=500" -Headers @{ 'X-Token' = $token } `
                    -TimeoutSec 10 -ErrorAction Stop
                $errLines = @($lg.text -split "`n" | Where-Object { $_ -match '\[ERROR\]|\[FATAL\]' })
                if ($errLines.Count -eq 0) {
                    Pass "日志无 ERROR/FATAL"
                }
                else {
                    Fail "日志里有 $($errLines.Count) 条 ERROR/FATAL，前 3 条："
                    $errLines | Select-Object -First 3 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkYellow }
                }
            }
            catch {
                Fail "拉日志失败: $($_.Exception.Message)"
            }
        }
    }
}
finally {
    # ---------- 收尾：先优雅退出，再兜底强杀 ----------
    #
    # 为什么不一上来就 Kill：强杀等于跳过 MainForm.OnClosing，
    # 于是 Db.Dispose() 不执行 → WAL 不 checkpoint → 文件句柄靠内核异步回收，
    # 紧接着删临时目录必定撞"riqian.db 正由另一进程使用"（实测要等十几秒）。
    # 走 app.quit 才是用户点 X 的那条路径，也顺带验了"正常退出会不会崩"。
    if ($proc -and -not $proc.HasExited -and $token) {
        try {
            $body = @{ m = 'app.quit'; a = @{} } | ConvertTo-Json -Compress
            Invoke-RestMethod -Uri "$base/rpc" -Method Post -Body $body `
                -ContentType 'application/json' -Headers @{ 'X-Token' = $token } `
                -TimeoutSec 10 -ErrorAction SilentlyContinue | Out-Null
        }
        catch { }
        # 给 OnClosing 里的 flush + Dispose 留时间（那边有 await Task.Delay(250)）
        try { $proc.WaitForExit(15000) | Out-Null } catch { }
        if (-not $proc.HasExited) {
            Write-Host "  ! app.quit 后 15 秒没退出，强杀" -ForegroundColor Yellow
        }
    }
    if ($proc -and -not $proc.HasExited) {
        try { $proc.Kill($true); $proc.WaitForExit(10000) | Out-Null } catch { }
    }
    if ($proc) { $proc.Dispose() }

    # 临时数据目录（自己造的一次性产物，不留备份）。
    #
    # 即使走了优雅退出也要重试：WebView2 的渲染子进程不是本进程的句柄，
    # 主进程退出到子进程回收之间有个窗口期。删不掉也不判失败 ——
    # 这是清理动作，不是被测对象；CI 上整个虚拟机会被销毁。
    if (Test-Path $tmpRoot) {
        $removed = $false
        for ($i = 0; $i -lt 25 -and -not $removed; $i++) {
            try {
                Remove-Item $tmpRoot -Recurse -Force -ErrorAction Stop
                $removed = $true
            }
            catch { Start-Sleep -Milliseconds 400 }
        }
        if (-not $removed) {
            Write-Host "  ! 临时目录重试 25 次仍没删掉（不影响结论，CI 上会被整个虚拟机回收）: $tmpRoot" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
if ($script:failed -gt 0) {
    Write-Host "========== 启动冒烟失败，$($script:failed) 项 ==========" -ForegroundColor Red
    exit 1
}
Write-Host "========== 启动冒烟通过 ==========" -ForegroundColor Green
exit 0