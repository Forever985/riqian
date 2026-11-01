# 日签 · 打卡日记本

一个**完全本地、单机、离线**的个人日记与生活记录桌面程序。数据只存在你自己电脑上的一个 SQLite 文件里，不联网、不要账号、不传云端。

围绕**「一天」这个单位**构建：

- **日记** — 富文本 / Markdown / BBCode 三种写法，模块化拼装（心情、天气、睡眠、图片、引用、LaTeX…）
- **打卡** — 不只是打勾，可以记几点起床、跑步多少分钟、读了几页
- **待办** — 输入「明天下午三点开会」自动识别日期时间；四象限、子清单、重复规则
- **番茄钟** — 专注计时、统计、按天/周图表
- **倒计时** — 纪念日、目标日，认得「每月最后一个周四 交房租」这种说法
- **回顾** — 日历热力图、那年今日、全文搜索、标签、收藏、跨天引用
- 还有记账本、笔记（无限嵌套）、画板、多媒体库、提醒、统计

技术上：**一个 WinForms 窗口 + 内嵌 WebView2 渲染界面 + SQLite 存数据 + 单文件 exe 分发**。

当前版本 **v12.6**。

---

## 自己编译

需要三样东西（都在 Windows 上）：

| 依赖 | 版本 | 说明 |
|---|---|---|
| .NET SDK | 8.0+ | [下载](https://dotnet.microsoft.com/download/dotnet/8.0) |
| Node.js | 18+ | 只用来构建前端 |
| WebView2 Runtime | 任意近代版本 | Win11 自带；Win10 可能需要[单独装](https://developer.microsoft.com/microsoft-edge/webview2/) |

```bash
git clone <你的仓库地址>
cd riqian4

# 1. 构建前端（产物是 wwwroot/index.html，会被嵌进 exe）
cd web
npm install
npm run build
cd ..

# 2. 构建 C#
dotnet build -c Release
```

产物在 `bin/Release/net8.0-windows/Riqian.exe`。

打包成单文件分发版：

```bash
dotnet publish -c Release -r win-x64
```

### ⚠️ 构建顺序不能反

**先 `npm run build`，再 `dotnet build`。**

`wwwroot/index.html` 在 `Riqian.csproj` 里是 `EmbeddedResource`，界面就靠它。顺序反了不会报错，但你会拿到**上一次构建的旧界面**，然后对着明明改过的代码怀疑人生。这是这个项目最常见的坑。

`wwwroot/index.html` 是提交进仓库的（约 1.7 MB），所以 clone 下来直接 `dotnet build` 也能出能跑的 exe —— 只是界面是仓库里那一版。要看到你改的前端，必须重新 `npm run build`。

### 开发时开着调试端口

```bash
# Windows
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=57001
.\bin\Debug\net8.0-windows\Riqian.exe
```

之后可以用 Chrome 打开 `chrome://inspect`，或者用 `tests/` 里的脚本连上去。

---

## 数据在哪

默认 `E:\日签\`（第一次启动会让你选）。可以在「设置 → 数据与缓存」里改到别处。

```
<数据根>/
├── riqian.db          全部数据（SQLite 单文件）
├── 图片库/            多媒体库（图片/音频/视频，按内容哈希命名）
│   ├── .thumb/        缩略图缓存
│   └── _导入/         投递区，把文件扔进来点「扫描」就入库
├── 字体/              导入的字体文件
├── 自动备份/          每天一个备份，默认留 30 天
├── 导出/              导出的 JSON / MD / CSV / HTML
└── 缓存/
```

**备份就是复制整个文件夹。** 换电脑把整个目录拷过去就行。

---

## 插件、主题、扩展

这个程序支持外部扩展：**别人做好的主题、插件、额外功能，可以直接装进来**。规范与做法见 [docs/扩展开发.md](docs/扩展开发.md)。

现有扩展入口：

- **主题中心** — 内置 7 套配色；也可以导入 `.json` 主题包
- **插件中心** — 模块级插件（把日记页的模块当插件管理），可开关、可装外部模块
- **创意工坊** — 画板作品、日记模板、主题的本地库，能导出成分享码给别人

---

## 目录结构

```
riqian4/
├── *.cs                    宿主：窗口、RPC 分发、数据库层
├── Riqian.csproj           工程定义
├── web/                    前端源码（React 18 + TS + Vite）
│   ├── src/
│   └── scripts/inline.mjs  把 dist 内联成单文件 index.html
├── wwwroot/index.html      前端产物，作为 EmbeddedResource 嵌进 exe
├── docs/                   开发文档、接口清单、扩展开发规范
├── tests/                  端到端探测脚本（Playwright 驱动 CDP）
├── tools/                  辅助脚本（RPC 清单生成等）
└── 开发文档.md              完整设计文档与决策记录
```

想看**为什么这样设计**、踩过哪些坑、每一项需求的落地方式，读 [`开发文档.md`](开发文档.md)。

---

## 许可证

<!--
  换成你实际想要的许可证。如果没有特别考虑，MIT 最省事：
  别人可以自由使用、修改、再分发，你也不用承担责任。
  商用了想保留版权声明就 MIT，想要求衍生作品也开源就 GPL-3.0。
-->
许可证待定。在正式确定之前，保留所有权利。