# 安卓编译环境 · 装 E 盘（自己动手版）

> 目标：编译出日签的 APK，**C 盘一字节不留**。
> 全部用「解压即用」的方式，不跑安装程序、不改注册表、不要管理员权限。

---

## 第 0 步：先清理 C 盘

双击 `tools\cleanup-android-c-parts.cmd`，会弹 UAC，点「是」。

它会删掉今天凌晨误装的 15 个目录，**1.23 GB**。脚本自带两道保险：

- 只删创建时间晚于 2026-11-02 的（桌面版组件是 8 月 5 日，不会碰）
- 删完自动核对桌面版组件是否健在

删之前会列出清单让你敲 `y` 确认。

---

## 第 1 步：下载三样东西

新建目录 `E:\AndroidDev\`，把下面三个文件都放进去。

| # | 东西 | 链接 | 大小 | 放哪 |
|---|---|---|---|---|
| 1 | .NET 8 SDK | `https://dotnetcli.azureedge.net/dotnet/Sdk/8.0.423/dotnet-sdk-8.0.423-win-x64.zip` | ~290 MB | `E:\AndroidDev\dotnet-sdk8-win-x64.zip` |
| 2 | Android 命令行工具 | `https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip` | 156 MB | `E:\AndroidDev\cmdline-tools.zip` |
| 3 | JDK 17 | 见下方说明 | ~180 MB | `E:\AndroidDev\jdk17.zip` |

**关于链接 1**：这是 .NET 8.0.423 的官方 zip。用 zip 不用 exe 安装包，就是因为
exe 会写 `C:\Program Files`，zip 解压到哪就在哪。备用域名：
`https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.423/dotnet-sdk-8.0.423-win-x64.zip`

**关于链接 2**：这是 Google 的官方源，国内**直连可下**（不用代理，我实测过）。
如果浏览器慢，换腾讯云镜像：
`https://mirrors.cloud.tencent.com/AndroidSDK/commandlinetools-win-15859902_latest.zip`

**关于链接 3 JDK**：你机器上已经有 `C:\Program Files\Java\jdk-17` 了（17.0.14），
**这一项可以先跳过**，第 3 步会直接指向它。只有当它被误删时才需要下：
到 https://adoptium.net/zh-CN/temurin/releases/?version=17 选 Windows x64 的 `.zip`。

---

## 第 2 步：解压到位

在 `E:\AndroidDev\` 里解压，最终长成这样：

```
E:\AndroidDev\
├── dotnet\                    <- 把 dotnet-sdk8-win-x64.zip 解压到这里
│   └── dotnet.exe
├── android-sdk\
│   └── cmdline-tools\         <- 注意！多套一层
│       └── latest\            <-     多套这一层
│           └── bin\sdkmanager.bat
└── jdk17\                     <- 可选，能不装就不装
```

⚠️ **`cmdline-tools` 的目录结构特别容易错**。Google 的 zip 解压出来是 `cmdline-tools\bin\...`，
但 sdkmanager 要求的是 `cmdline-tools\latest\bin\...`。
少了 `latest` 这一层，后面 `sdkmanager` 会报 `Could not determine SDK root`。

修正方法（PowerShell 一行）：

```powershell
cd E:\AndroidDev\android-sdk
New-Item -ItemType Directory -Path cmdline-tools\latest -Force
Move-Item cmdline-tools\bin,cmdline-tools\lib,cmdline-tools\NOTICE.txt cmdline-tools\latest\
```

---

## 第 3 步：拧螺丝（PowerShell，逐条粘）

```powershell
# --- 环境变量，只对当前窗口生效，不改系统 ---
$env:DOTNET_ROOT       = 'E:\AndroidDev\dotnet'
$env:PATH              = "$env:DOTNET_ROOT;$env:PATH"
$env:JAVA_HOME         = 'C:\Program Files\Java\jdk-17'
$env:ANDROID_HOME      = 'E:\AndroidDev\android-sdk'
$env:ANDROID_SDK_ROOT  = 'E:\AndroidDev\android-sdk'

# --- 验证 ---
dotnet --version          # 要看到 8.0.423
java -version             # 要看到 17.x
```

然后装 android workload：

```powershell
dotnet workload install android
```

**这一步是关键**。因为用的是 zip 版 SDK（installertype 是 file 而不是 msi），
它会把整个 Android 构建栈直接铺进 `E:\AndroidDev\dotnet\packs\`，
**不需要管理员权限，也不写 C 盘**。约 1.3 GB，装完 `dotnet workload list` 里能看到 android。

国内网速慢的话，先配 NuGet 镜像（可选）：

```powershell
dotnet nuget add source https://repo.huaweicloud.com/repository/nuget/v3/index.json -n huaweicloud
```

---

## 第 4 步：装 Android SDK 平台包

```powershell
cd E:\AndroidDev\android-sdk\cmdline-tools\latest\bin

# 先接受许可（会连续问几次，全部输 y）
.\sdkmanager.bat --licenses

# 装编译需要的最小集（约 250 MB）
.\sdkmanager.bat "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

国内慢就加镜像前缀：

```powershell
.\sdkmanager.bat --no_https --proxy=http --proxy_host=mirrors.cloud.tencent.com --proxy_port=80 "platform-tools"
```

如果镜像不好使，直接裸跑通常也行（`dl.google.com` 在国内是通的）。

---

## 第 5 步：编译

```powershell
cd C:\Users\18405\WorkBuddy\2026-10-28-10-51-20\riqian4\android
dotnet build -c Debug -f net8.0-android
```

产物在：

```
android\bin\Debug\net8.0-android\com.riqian.journal-Signed.apk
```

Debug 版用自动生成的调试签名，能直接装到手机上。

---

## 第 6 步：装到手机

**方式 A（推荐，USB 最快）**：

```powershell
# 手机开「开发者选项 -> USB 调试」，插线
E:\AndroidDev\android-sdk\platform-tools\adb.exe devices
E:\AndroidDev\android-sdk\platform-tools\adb.exe install -r 上面那个 apk 的完整路径
```

**方式 B（不插线）**：把 apk 拷到手机（微信传文件 / 数据线 / 网盘），
在手机上点开安装。第一次会提示「允许安装未知来源应用」，允许即可。

---

## 环境变量想永久生效（可选）

第 3 步的 `$env:` 只活一个窗口。想以后开窗口就有，用这个
（**只写用户级，不写系统级，不需要管理员**）：

```powershell
[Environment]::SetEnvironmentVariable('DOTNET_ROOT',      'E:\AndroidDev\dotnet',        'User')
[Environment]::SetEnvironmentVariable('JAVA_HOME',        'C:\Program Files\Java\jdk-17','User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME',     'E:\AndroidDev\android-sdk',   'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', 'E:\AndroidDev\android-sdk',   'User')

# PATH 追加（先读出来再拼，别直接覆盖）
$p = [Environment]::GetEnvironmentVariable('PATH','User')
if ($p -notlike '*AndroidDev\dotnet*') {
  [Environment]::SetEnvironmentVariable('PATH', "E:\AndroidDev\dotnet;$p", 'User')
}
```

想撤销就把值设成 `$null`。

---

## 踩坑备忘

| 现象 | 原因 | 解法 |
|---|---|---|
| `Could not determine SDK root` | `cmdline-tools` 少了 `latest` 那层 | 见第 2 步的修正命令 |
| `XA0141` 或真机加载 .so 失败 | SQLite 原生库没按 16KB 页对齐 | csproj 里已指定 `SQLitePCLRaw.bundle_e_sqlite3` 3.x，别改回 `bundle_green` |
| `dotnet workload install` 零输出静默退出 | 权限不足（msi 类型要写 HKLM） | 用 zip 版 SDK，installertype=file，不碰注册表 |
| 桌面版项目报「找不到 Android 命名空间」 | `android\` 被编进桌面项目了 | `Riqian.csproj` 里已有 `<Compile Remove="android\**" />` |
| `sdkmanager` 报 Java 版本不对 | JAVA_HOME 指向 jre1.8 | 现在这个变量的值是 `jre1.8.0_441`，必须改成 `jdk-17` |

---

## 为什么不建议装 Android Studio

Studio 的 `.exe` 下载会重定向到 `googlevideo.com`，你现在的网络环境被代理拦了，
（实测 `CONNECT tunnel failed, response 502`）。硬要装还得处理代理。
而且 Studio 本身 1.5 GB，装完必定往 `C:\Users\...\AppData` 和
`C:\Program Files\Android` 写东西 —— 跟「不占 C 盘」的目标正相反。

上面这套 zip 方案够用了：我们要的只是编译出 APK，不需要 IDE。

---

## 第 7 步（2026-11-10 实测补充）：手册漏了一个关键点

按第 5 步那样直接编译，**一定会报 `error XA5300: 找不到 Android SDK 目录`** ——
即使 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 都设对了。

原因：.NET 安卓工具链在 Windows 上会优先读注册表里的 SDK 路径，
而我们的 SDK 是自己解压的、从没注册过，光靠环境变量不够。

**必须显式传两个 MSBuild 属性**：`AndroidSdkDirectory` 和 `JavaSdkDirectory`。
完整命令已经写进 `tools\build-android.cmd`，直接跑那个就行：

```
tools\build-android.cmd          出 Release 包（可直接装手机）
tools\build-android.cmd debug    只编 Debug（快，但要 adb 才能跑）
```

### 为什么一定要 Release + 关裁剪

- **Debug 默认「快速部署」**：程序集不进 APK，靠 adb 推。
  把 Debug 的 APK 拷到手机上装，一打开就崩（找不到程序集）。
- **Release 默认开 IL 裁剪**：本项目大量用 `System.Text.Json` 反射
  序列化匿名对象，裁掉私有成员的风险很高。
  关掉之后包从 8.9 MB 涨到 28.7 MB，换来「一定能跑」。

### 签名密钥别丢

`E:\AndroidDev\riqian-release.keystore`（口令 `riqian2026`）。
**丢了就没法给已装的手机覆盖升级**，只能卸载重装。
数据在 `Android/data/com.riqian.journal/files/日签`，卸载会连数据一起删 ——
升级前先想想要不要备份。

### 2026-11-10 实际产出

| 项 | 值 |
|---|---|
| APK | `releases\日签-安卓-12.9.6.apk`，28.7 MB |
| 包名 | `com.riqian.journal` |
| 支持系统 | Android 7.0 起（minSdk 24），targetSdk 34 |
| 架构 | arm64-v8a（手机）+ x86_64（模拟器） |
| 权限 | 联网 / 通知 / 震动 / 唤醒；**不要任何存储权限**（导入走系统选择器） |
| 环境占用 | E 盘 3.9 GB（dotnet 3.4G + SDK 444M），C 盘零占用 |