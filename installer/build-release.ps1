# 日签 · 发布包构建
#
# 一次产出三个交付物：
#   1. 源码包     Riqian-Source-12.9.5.zip       —— 不含 node_modules / bin / obj
#   2. 安装版     Riqian-Setup-12.9.5.exe        —— Inno Setup，装到 Program Files
#   3. 绿色版     Riqian-Portable-12.9.5.zip     —— exe + portable.txt，数据跟着走
#
# 为什么安装版和绿色版是同一个 exe：
#   程序启动时看 exe 旁边有没有 portable.txt。有 → 数据放 exe 旁边；
#   没有 → 数据放 %APPDATA%\Riqian\config.json 配的位置。
#   所以两个包只差一个空文件，不需要编译两次。
#
# 用法：
#   pwsh installer/build-release.ps1
#   pwsh installer/build-release.ps1 -SkipFrontend    # 前端没改时跳过 npm build
#
# 前置：dotnet SDK 8、Node 18+、Inno Setup 6（ISCC.exe）

param(
    [switch]$SkipFrontend,
    [string]$InnoCompiler = ""
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# ---------- 读版本号（只在 csproj 里定义一次）----------
$csproj = Get-Content (Join-Path $repo 'Riqian.csproj') -Raw
$m = [regex]::Match($csproj, '<Version>([^<]+)</Version>')
if (-not $m.Success) { throw "Riqian.csproj 里找不到 <Version>" }
$ver = $m.Groups[1].Value.Trim()
Write-Host "版本: $ver" -ForegroundColor Cyan

$relDir = Join-Path $repo 'releases'
New-Item -ItemType Directory -Force -Path $relDir | Out-Null

# 清掉上一轮的产物，免得新旧混在一起分不清
Get-ChildItem $relDir -Filter "Riqian-*" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# ---------- 1. 前端 ----------
if (-not $SkipFrontend) {
    Write-Host "`n[1/5] 构建前端" -ForegroundColor Yellow
    Push-Location (Join-Path $repo 'web')
    try {
        if (-not (Test-Path 'node_modules')) {
            Write-Host "  node_modules 不在，先 npm ci（可能要几分钟）"
            npm ci
            if ($LASTEXITCODE -ne 0) { throw "npm ci 失败" }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
    }
    finally { Pop-Location }
} else {
    Write-Host "`n[1/5] 跳过前端构建（-SkipFrontend）" -ForegroundColor DarkGray
}

$idx = Join-Path $repo 'wwwroot\index.html'
$kb = [math]::Round((Get-Item $idx).Length / 1KB, 1)
Write-Host "  wwwroot/index.html = $kb KB"
if ((Get-Item $idx).Length -gt 4MB) { throw "前端产物超过 4 MB，检查是不是误把大资源内联了" }

# ---------- 2. 发布 exe ----------
Write-Host "`n[2/5] 发布单文件 exe" -ForegroundColor Yellow
$pubDir = Join-Path $repo 'publish'
if (Test-Path $pubDir) { Remove-Item $pubDir -Recurse -Force }

# 不加 --no-restore：-r win-x64 的还原图和普通 restore 不是同一份，
# 干净环境加了会 NETSDK1047。
dotnet publish -c Release -r win-x64 --self-contained true -o $pubDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish 失败" }

$exe = Join-Path $pubDir 'Riqian.exe'
if (-not (Test-Path $exe)) { throw "没生成 $exe" }
$exeMb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "  Riqian.exe = $exeMb MB"

# 发布出来的三个 xml 是 WebView2 的文档注释，不是运行时依赖，别打进包里
Get-ChildItem $pubDir -Filter "*.xml" | Remove-Item -Force -ErrorAction SilentlyContinue

# ---------- 2.5 发布后自检 ----------
# 光"编译成功"不等于"能跑"。这里跑一遍全新装机的 schema 自检，
# 它抓的是"只打新用户"的那类 bug（详见 开发文档.md 第 48 节）。
Write-Host "`n[3/5] 全新装机自检" -ForegroundColor Yellow
& $exe --selfcheck
if ($LASTEXITCODE -ne 0) { throw "自检失败（退出码 $LASTEXITCODE），别往下打包了" }
Write-Host "  自检通过" -ForegroundColor Green

# ---------- 3. 绿色版 ----------
Write-Host "`n[4/5] 打绿色版" -ForegroundColor Yellow
$portableStage = Join-Path $env:TEMP ("riqian-portable-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $portableStage | Out-Null
try {
    Copy-Item $exe (Join-Path $portableStage 'Riqian.exe')
    # 这个空文件就是绿色版的开关，见 MainForm.ResolveRoot 的注释
    New-Item -ItemType File -Path (Join-Path $portableStage 'portable.txt') | Out-Null
    Copy-Item (Join-Path $repo 'README.md') $portableStage
    Copy-Item (Join-Path $repo 'LICENSE') $portableStage

    # 给绿色版单独写一份简短说明，省得用户不知道该干什么
    $readme = @"
日签 · 绿色免安装版 v$ver
====================================

双击 Riqian.exe 就能用，不需要安装。

数据放在哪
----------
和 exe 同级的「日签数据」文件夹里（第一次启动自动创建）。
整个文件夹拷走，日记就跟着走了 —— 换电脑、换 U 盘、放同步盘都行。

这个文件夹里是什么
------------------
  Riqian.exe     主程序
  portable.txt   便携模式标记（**别删**，删了就变成安装版的行为，
                 数据会跑到 %APPDATA% 去找配置）
  日签数据\      你的日记、图片、自动备份、导出

想卸载
------
直接删掉整个文件夹。没有任何注册表残留。

需要 WebView2 运行时
--------------------
Win11 自带，Win10 大部分也装过。真缺了程序会提示。
下载：https://developer.microsoft.com/microsoft-edge/webview2/

主页
----
https://github.com/Forever985/riqian4
"@
    # 用无 BOM 的 UTF-8 —— Windows 记事本认得，带 BOM 反而在某些工具里露出来
    # 文件名用 ASCII：压缩包里的中文名在老版 Windows 资源管理器里
    # 会按本地代码页解，有些机器上直接显示成乱码。内容还是中文，只是文件名避开这个坑。
    [IO.File]::WriteAllText((Join-Path $portableStage 'HOWTO.txt'), $readme,
        (New-Object System.Text.UTF8Encoding($false)))

    $zip = Join-Path $relDir "Riqian-Portable-$ver.zip"
    Compress-Archive -Path (Join-Path $portableStage '*') -DestinationPath $zip -CompressionLevel Optimal
    Write-Host "  $([IO.Path]::GetFileName($zip)) = $([math]::Round((Get-Item $zip).Length/1MB,1)) MB"
}
finally {
    # 自己造的一次性暂存目录，直接删，不留备份
    if (Test-Path $portableStage) { Remove-Item $portableStage -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------- 4. 安装版 ----------
Write-Host "`n[5/5] 打安装版" -ForegroundColor Yellow

# 找 ISCC。winget 装的是用户级路径，不在 Program Files。
if (-not $InnoCompiler) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
        'C:\Program Files\Inno Setup 6\ISCC.exe'
    )
    foreach ($c in $candidates) { if (Test-Path $c) { $InnoCompiler = $c; break } }
}
if (-not $InnoCompiler -or -not (Test-Path $InnoCompiler)) {
    Write-Warning "没找到 ISCC.exe（Inno Setup 6）。安装版没打出来。"
    Write-Warning "装一下： winget install JRSoftware.InnoSetup"
    Write-Warning "或者手动指定： -InnoCompiler 'C:\path\to\ISCC.exe'"
}
else {
    Write-Host "  用 $InnoCompiler"
    # 版本号必须传进去：iss 里那份只是兜底，唯一来源是 csproj 的 <Version>。
    # 不传的后果是安装包名字和「添加或删除程序」里永远停在上一个版本 ——
    # 而 ISCC 不会报错，产物名字看着也正常。2026-11-11 就这么出过一次：
    # 打的是 12.9.6 的内容，文件名却是 Riqian-Setup-12.9.5.exe。
    & $InnoCompiler "/DAppVersion=$ver" (Join-Path $repo 'installer\riqian.iss')
    if ($LASTEXITCODE -ne 0) { throw "ISCC 编译失败（退出码 $LASTEXITCODE）" }
}

# ---------- 5. 源码包 ----------
Write-Host "`n[+] 打源码包" -ForegroundColor Yellow
# 用 git archive 而不是 Compress-Archive 整个目录：
#   · 只有已提交的文件才会进去（.gitignore 自动生效，node_modules/bin/obj 不会漏进去）
#   · 顺带带上 git 的换行符规则
# 要求工作区干净，否则打出来的包和你看到的代码不一致。
$dirty = git status --porcelain
if ($dirty) {
    Write-Warning "工作区有未提交改动，源码包会缺这些改动："
    $dirty | Select-Object -First 10 | ForEach-Object { Write-Warning "  $_" }
    Write-Warning "先提交再打包，否则别人拿到的源码编译不出你测过的东西。"
}

$srcZip = Join-Path $relDir "Riqian-Source-$ver.zip"
git archive --format=zip --prefix="riqian4-$ver/" -o $srcZip HEAD
if ($LASTEXITCODE -ne 0) { throw "git archive 失败" }
Write-Host "  $([IO.Path]::GetFileName($srcZip)) = $([math]::Round((Get-Item $srcZip).Length/1MB,1)) MB"

# ---------- 汇总 ----------
Write-Host "`n========== 产物 ==========" -ForegroundColor Green
Get-ChildItem $relDir -Filter "Riqian-*" | Sort-Object Name | ForEach-Object {
    Write-Host ("  {0,-34} {1,7:N1} MB" -f $_.Name, ($_.Length / 1MB))
}
Write-Host ""
Write-Host "下一步：把 releases\ 里这三个文件上传到 GitHub Releases。"
Write-Host "（或者打 tag 让 .github/workflows/release.yml 自动跑，见开发文档第 49 节）"