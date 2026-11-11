; 日签 · 安装程序
;
; 产物：Riqian-Setup-x.y.z.exe
; 输入：..\publish\Riqian.exe（由 build-release.ps1 在跑这个脚本之前生成）
;
; 设计要点：
;   · 安装版**不放** portable.txt。程序启动时看到没有这个文件，
;     就会把数据放到 %APPDATA%\Riqian\config.json 里配的那个目录
;     （默认 E:\日签\，E 盘不在就落到「我的文档\日签日记」）。
;     这正是安装版该有的行为：数据归用户所有，卸载程序也不该删。
;   · 绿色版是同一个 exe + 一个空的 portable.txt，数据强制跟着 exe 走。
;     所以两个包只需要一个编译产物，差别只在一个空文件。
;   · 不绑 WebView2 Runtime 安装包（体积 +150 MB，而 Win11 自带）。
;     改成运行时检测：缺了就在安装完成页提示去下载，见 [Run] 段。

#define AppName        "日签"
#define AppNameEn      "Riqian"
; 版本号**由 build-release.ps1 通过 /DAppVersion= 传进来**，唯一来源是 Riqian.csproj 的 <Version>。
;
; 原来这里写死成 "12.9.5"，脚本又不传 —— 结果 v12.9.6 发布出来的安装包
; 文件名和「添加或删除程序」里都写着 12.9.5。这种错很难在打包日志里看出来：
; ISCC 会安静地按写死的值编译，产物名字看着也挺正常。
; 下面的 #ifndef 只是兜底，让单独手工编译时不至于直接失败。
#ifndef AppVersion
  #define AppVersion   "0.0.0-unknown"
#endif
#define AppPublisher   "Forever985"
#define AppURL         "https://github.com/Forever985/riqian4"
#define AppExeName     "Riqian.exe"

[Setup]
AppId={{8F3A2C71-4D9B-4E5A-9C1F-7B2E6D4A8F03}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={autopf}\{#AppNameEn}
DefaultGroupName={#AppName}
; 允许用户装到任意目录（绿色版习惯的人会想改成 D:\日签）
AllowNoIcons=yes
DisableProgramGroupPage=yes
; 输出到仓库根的 releases/，跟绿色版 zip 并排
OutputDir=..\releases
OutputBaseFilename=Riqian-Setup-{#AppVersion}
SetupIconFile=..\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 单文件 exe 是 68 MB，装完约 70 MB
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; 需要管理员权限才能写 Program Files
PrivilegesRequired=admin
; 卸载时保留用户数据 —— 日记软件删用户的日记是不可原谅的
UninstallDisplayName={#AppName} {#AppVersion}
UninstallDisplayIcon={app}\{#AppExeName}
; 支持从旧版本升级（同 AppId 即可）
UsePreviousAppDir=yes
; 关掉「重启计算机」提示，本程序不需要
ChangesAssociations=no

[Languages]
Name: "chinese"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: unchecked

[Files]
; 主程序。只打包 exe 本身 —— 它是单文件自包含的，
; 另外三个 Microsoft.Web.WebView2.*.xml 是 XML 文档注释，不是运行时依赖。
Source: "..\publish\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; 说明文档
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
; 注意：**故意不打包 portable.txt**，见文件头注释

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; 装完直接启动（勾选框可选）
Filename: "{app}\{#AppExeName}"; Description: "立即运行 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 一条规则都没有，这是故意的。
;
; 唯一想删的是「便携版误装到 Program Files 时，数据落在 {app}\日签数据」那种情况，
; 但那和「用户手动把数据目录改到 {app}\日签数据」在磁盘上长得一模一样 ——
; 卸载程序分辨不出来。分不清的后果是把人家几年的日记删掉。
;
; 权衡很清楚：留下一个空文件夹的代价是几十 KB 和"卸载不干净"的洁癖不适，
; 删错一次的代价是用户永远的日记。**保用户数据，不保安装目录干净。**
; 目录里如果有日签数据，卸载时由 Inno 默认行为处理（非空目录不会被自动删）。

[Code]
// 检测 WebView2 Runtime 是否已安装。
// 没装的话程序一启动就报错（CreateAsync 抛异常），而用户看不懂那个弹窗。
// 这里在安装前就说清楚，给出下载地址。
function WebView2Installed(): Boolean;
var
  Version: String;
begin
  // 官方推荐的检测方式：查这两个注册表键之一
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  // pv 为空字符串也算"装过但没版本号"，当作已安装
  if (not Result) then
    Result := RegValueExists(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv');
end;

procedure InitializeWizard();
begin
  // 没有做额外的自定义页面，保留默认向导流程
end;

function InitializeSetup(): Boolean;
var
  ErrCode: Integer;
begin
  Result := True;
  if not WebView2Installed() then
  begin
    if MsgBox('没有检测到 WebView2 运行时。' + #13#10 + #13#10 +
              '日签的界面靠它渲染，缺了会打不开。' + #13#10 +
              'Win11 自带；Win10 大多也装过。' + #13#10 + #13#10 +
              '现在去下载安装吗？（装完再运行本安装程序）',
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/',
                '', '', SW_SHOWNORMAL, ewNoWait, ErrCode);
    end;
    // 不强制阻止安装 —— 用户可能想先装程序、后补运行时
  end;
end;