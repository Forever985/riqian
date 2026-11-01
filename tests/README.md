# 端到端验收脚本

前提：桌面程序以调试端口启动，且本目录能 `require('playwright-core')`
（`cd tests && npm i playwright-core`，只连 CDP，不需要下载浏览器）。

```bash
cd "C:/Users/18405/Apps/日签"
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=57001" ./日签.exe

cd ../../WorkBuddy/.../riqian4/tests
NO_PROXY=127.0.0.1,localhost node e2e-flow.js  57001   # 主流程 / 三态编辑器 / 各页面 / 主题   21 项
NO_PROXY=127.0.0.1,localhost node e2e-views.js 57001   # 日历 / 筛选条 / 流内联 / 弹层          13 项
NO_PROXY=127.0.0.1,localhost node e2e-deep.js  57001   # 丢字 / 串日期 / 习惯闭环 / 导出        23 项
NO_PROXY=127.0.0.1,localhost node e2e-v6.js    57001   # 折叠 / 导航排序 / 清单+垃圾桶          24 项
NO_PROXY=127.0.0.1,localhost node e2e-v7.js    57001   # 分组设置 / 选项卡 / 密码 / 笔记        32 项
NO_PROXY=127.0.0.1,localhost node e2e-v8.js    57001   # 首页 / 分享 / LaTeX / 总结 / 快捷键    37 项
NO_PROXY=127.0.0.1,localhost node e2e-v9.js    57001   # 标题 / 定稿 / 草稿箱 / 跨天 / 多语言    37 项
NO_PROXY=127.0.0.1,localhost node e2e-v10.js   57001   # 记账 / 提醒 / 时间轴 / 多媒体 / 日历右键  18 项
NO_PROXY=127.0.0.1,localhost node e2e-v11.js   57001   # 图片参数 / 软件背景 / 媒体合一 / 账户预算  54 项
NO_PROXY=127.0.0.1,localhost node e2e-v12.js   57001   # 拖动排序 / 托盘顺序 / 搜索历史              16 项
NO_PROXY=127.0.0.1,localhost node e2e-v13.js   57001   # 编辑器：切换不丢 / 语法互转 / 回车分段      12 项
NO_PROXY=127.0.0.1,localhost node e2e-editor.js 57001  # 输入即格式化：行内/行首/光标/撤销/粘贴/IME  30 项
NO_PROXY=127.0.0.1,localhost node e2e-v14.js   57001   # 跨模块搜索 / 打卡提醒 / 欢迎页拖动 / Semi 主题  23 项
NO_PROXY=127.0.0.1,localhost node e2e-v15.js   57001   # 应用锁自锁 / 媒体库重复导入 / 提示条 / 四象限  14 项
NO_PROXY=127.0.0.1,localhost node e2e-v16.js   57001   # 直接选象限 / 笔记富文本 / 大事时间轴 / 标签复合搜索  18 项
NO_PROXY=127.0.0.1,localhost node e2e-v17.js   57001   # 可读性审计：铺极端背景后逐页扫透明控件      15 项
NO_PROXY=127.0.0.1,localhost node e2e-v18.js   57001   # 悬浮提示 / 待办搜索位置 / 设置全局搜索        18 项
NO_PROXY=127.0.0.1,localhost node e2e-v19.js   57001   # 倒计时：编辑 / 拖动排序 / 回收站                9 项
NO_PROXY=127.0.0.1,localhost node e2e-v20.js   57001   # 记账：改一笔 / 筛选排序 / 分类改名删除         11 项
NO_PROXY=127.0.0.1,localhost node e2e-v21.js   57001   # 预算日均/预警 · 账户总览 · 汇总下推 SQL        12 项
NO_PROXY=127.0.0.1,localhost node e2e-v22.js   57001   # 媒体库：文件夹/别名 · 批量整理 · 排序方向      11 项
```

## 探测脚本：一律走 `_probe.js`

`probe*.js` 是查现场用的临时脚本，不是验收套件。**新写的必须用 `_probe.js` 外壳**：

```js
const { run } = require('./_probe');
run(async (P) => {
  P.say('切到笔记页');
  if (!(await P.go('notes'))) return;
  P.out(await P.eval(() => document.querySelectorAll('.nbook').length));
});
```

原因（2026-11-01 的实际教训）：裸写 `p.evaluate(...)` 的探测脚本有四种死法，
每一种都表现为**终端一个字符都不输出、人干等到怀疑人生**：

| 死法 | 外壳怎么堵 |
|---|---|
| evaluate 里抛异常 | `P.eval()` 捕获后打印 `✗ ... 失败：原因` |
| `connectOverCDP` 连不上 | `run()` 顶层 catch，打印错误 + 退出码 1 |
| 页面被挂起（WebView2 窗口不可见时常见） | 每次 evaluate 带 8s 超时 |
| 多步塞进一个 evaluate，第一步挂了后面全哑 | `P.say()` 强制一步一件事，各自输出 |

**底线：任何探测脚本，无论成功失败，终端必须有输出。** 静默就是 bug。

---

## 生成类脚本

### `gen-pinyin.py` — 重建拼音搜索的汉字表

`web/src/lib/pinyinData.ts` 里那张「字→拼音」表供设置页搜索用。设置页文案改了之后跑：

```bash
python tests/gen-pinyin.py --check   # 只报缺哪些字，不写文件
python tests/gen-pinyin.py          # 补齐（只增不改，已有读音一律不动）
python tests/gen-pinyin.py --all    # 换扫描范围：整个文件（含注释），排查用
```

**默认只扫 `label` / `sub` / `kw` 三个属性**，不扫整个文件。这个默认值是被一次错误
结论换来的：第一版按全文扫，报「缺 126 字」，结果那 126 个字全部来自 JS 注释
（`// 避免把答案弄丢` 之类）—— 注释不渲染，永远搜不到，为它补表纯属白干。

读音优先级：pypinyin（装了就用）→ Windows 自带的
`C:\Windows\System32\chs_singlechar_pinyin.dat`（20955 条 × 8 字节，小端 uint16 码位
+ 6 字节 ASCII 拼音）。后者给的是**字库默认读音**，多音字常挑生僻那个（度→duo、
番→pan、且→ju、似→shi、弄→long、壳→qiao），所以脚本里有一张 `OVERRIDES` 手工校正表。

改完表**必须 `npm run build`** —— `pinyinData.ts` 是编译进产物的。

---

## 只跑受影响的（默认就该这么做）

全量 17 套要十几分钟，绝大多数改动只碰一两个页面，**没必要次次全跑**。
按改动的文件选套件：

| 动了什么 | 跑哪些 |
|---|---|
| `editors/`（caret/rules/engine/RichText） | `editor` + `v13` |
| `components/Sidebar` / 导航项 | `v9`（末尾 8 条停靠断言）+ `views` |
| `components/Marquee` / 媒体库框选 | `v22` + `probe-154` |
| `lib/pinyinData.ts` / `components/SetRow` | `probe-148d`（6 种搜法） |
| `lib/fonts.ts` / `features/FontPicker` / `DbFonts.cs` | `probe-170`（预设数 / RPC / 预览 / 导入链路） |
| `lib/smartDate.ts` / `Db.cs` 的 `Countdowns` | `unit-192`（41 项，先跑这个）+ `probe-192` |
| `views/CalendarView` 右键菜单 | `probe-207`（建待办 + 日期落点） |
| `views/Settings` 背景弹窗 / `features/mediaTone` | `probe-176`（`.tone-row` 5→11） |
| `components/Tooltip` / 任何 `title`→`data-tip` | `v18` |
| `views/Settings*` / `components/SetRow` | `flow`（主题卡数）+ `v14` + `v15` + `v18` |
| `lib/pack.ts` / `lib/extensions.ts` / `features/PackUI` | `probe-241`（三中心 + 装/卸主题与插件）+ `_reg241` |
| `views/ThemeCenter` / `PluginCenter` / `Workshop` | `probe-241` + `_layout241`（横向溢出 / 面板出界） |
| `lib/theme.ts` 的 `normalizeTheme` | `probe-241` 的 [4] [6] 两步（`--bg` 真变了才算过）+ `_reg241` |
| `features/colorPicker` / `features/draw` | `probe-241` 的 [10]–[13]（面板四件套 / 拖色相 / hex / 最近色） |
| `views/Todos` / `features/todos` | `v12`（排序）+ `v16`（象限）+ `v18` |
| `views/Notes` / `features/notes` | `v7` + `v16` |
| `features/media` / `views/Library` | `v11` + `v15` |
| `views/Ledger` / `DbV10` 记账部分 | `v20` + `v21` + `v11` |
| `features/media` / `DbV10` 媒体部分 | `v22` + `v10` |
| 任何全局 CSS（`styles.css`） | `v17` + `flow` |
| 后端 `Db*.cs` 建表/迁移 | `v10` + `v11`（各自守着新建列） |

改动横跨多个模块、或者要发版交付时，才跑全量。

`e2e-editor.js` 全部走真实键盘输入。它守的是**「打在编辑器里的字不能被吃掉」**：
转换完光标要停在标签外面、段中间转换不能动后面的字、Ctrl+Z 只能退一步。
改 `web/src/editors/` 下任何文件都要重跑。

`NO_PROXY` 必须加：本机代理会把 `127.0.0.1` 的 CDP 请求拦成 502。

建议在全新库上按 flow → views → deep → v6 → v7 → v8 → v9 → v10 → v11 → v12 → v13 顺序跑（先删掉 `E:/日签`）。
`e2e-v7.js` 末尾会调 `vault.clearMain` 自清理。

## 三条不能删的断言

`e2e-deep.js` 的前两条守住两个会**静默丢数据**的路径：

1. 打字后立刻点「收藏」→ 内容不能丢（`reloadEntry` 前必须 flush）
2. 打字后立刻切日期 → 内容不能串到另一天（`setDate` 改期前必须 flush）

改动 `store.ts` 的保存逻辑后，务必重跑。

## 改 UI 时要同步改的选择器（踩过的都在这）

| 变了什么 | 测试里要跟着改 |
|---|---|
| 导航按钮去掉了「(拖动可排序)」后缀 | 仍然用 `[title^="今天"]`，但**侧栏已不可拖动** |
| 右上角 LOGO 变成首页按钮 | `#brand-home`，点了回到欢迎页 |
| **设置从 8 组扩到 12 组** | 新增「快捷键 / 托盘与窗口 / 安全与密码 / 分享与总结」，点 `.snav` 按文字找组 |
| 「模块排序方式」设置项已删除 | 排序只在「日记与模块」的 `.modlist` 里（拖 + ↑↓） |
| 「今天」页模块头部不再有 ↑↓ | 只剩隐藏按钮；用 `.mod .mod-tools button[title="插入 LaTeX 公式"]` 找 ∑ |
| 日历单元格 `.cal2-cell` 的 title 带统计后缀 | 用 `startsWith(date)`，别用 `===` |
| 记录页搜索框包进 `.searchbox` | 填 `.searchbox input` |
| **设置页搜索框在 `.topbar` 里** | `.topbar .searchbox input`；命中行才带 `data-fs`（档位），不搜时**恒为 0**，别拿它当「页面有没有渲染」的证据 |
| 待办默认视图是「全部」 | 别假设新加的任务落在「今天」 |
| 倒计时页改智能输入 | 没有 `input[type=date]`，直接填「2027年1月1日 名称」 |
| 番茄钟区间改成 `.seg-b` | 不再是 `.topbar .chip:has-text("30 天")` |
| 模块格式按钮文案不再是「富文本」 | 用 `button[title*="切换输入方式"]` |
| 「恢复初始样式」的模块位置会变 | 用 `.moditem:has(.nm:text-is("正文"))`，别用 `.first()` |
| 打勾/归档按钮分成了两个 | 垃圾桶用 `[title*="垃圾桶"]`，回收站用 `[title*="回收站"]` |
| 新增快速记录浮层 / 命令面板 | `.qpanel` / `.qpalette`，两者都在 `.qmask` 里，Esc 或点空白可关 |
| 日记有标题了 | `.entrytitle`；记录页 `.rec-title`，流里 `.fw-title` |
| **字体行在「界面布局」组里**（不在「外观主题」） | 进设置后先点 `.snav` 里文字为「界面布局」的那个，否则 `data-act="font-*"` 全找不到 |
| 字体下拉的「楷体」选项现在文案就叫「楷体」 | 原来叫「楷体」但排在 6 项里的第 4 位；现在有 29 项 5 组，按 **optgroup label** 找组、按 option 文本找项 |
| 「高级参数」按钮在背景**弹窗**里，且要先选一张图 | 顺序必须是：点「设置背景」→ 点 `.dlg .imgpick` → 才有 `[data-act="bg-advanced"]`；`isImg` 为假时整块不渲染 |
| 数背景调色滑块不能数 `input[type=range]` | 工具栏那个「压暗」也是 range。按 **`.dlg .tone-row`** 数：基础 5 条、展开高级 11 条 |
| 定稿后正文只读 | `.ro` 里 `pointer-events:none`，先点 `.pubbar button:has-text("改回草稿")` 再写 |
| 「垃圾桶」改名「已放弃」 | 按钮 `[title*="放弃"]`，罗盘 `.rail-item:has-text("已放弃")`，恢复按钮文案是「捡回来」 |
| 记录页搜索框不在 topbar | 是 `.searchbox input`（在筛选区里） |
| 新增顺序编辑器 | `.orderlist`，第 1 个是导航、第 2 个个人中心、第 3 个设置分组 |
| 提示条改成有 ✕ | `#toast .tx-x`，`.toast.show` 才是可见状态 |
| 说明书/更新日志/联系我们移出侧栏 | 走「设置 → 关于」里三个按钮；侧栏只剩 16 项 |
| 导航可停靠四边 | `.app[data-dock]`；断言要看 `.side/.main/.topbar` 的 rect，不能只看有没有报错 |
| 日历双击改为「看总结」 | 进某天日记要走右键：`mouse.down/up({button:'right'})` → `.rowmenu button:has-text("写这天日记")` |
| 图片库改名「多媒体库」 | 断言用 `/图片库\|多媒体库/`，别写死 |
| 待办改名走编辑弹层 | `button[title="编辑"]` → `.dlg input` → `.dlg button:has-text("保存")` |
| 番茄中央多了手输框 | 选休息时长用 `input.inp[type=number]`，中央那个是 `.pomo-min` |
| 提醒表单要点「新建提醒」 | 否则页面上没有 `input[type=time]`；它是内联卡片，不是 `.dlg` |
| 媒体卡片要点内层 | `.imgpick` 只是容器，点击处理在里面的 `.imgc` |
| 图片参数在背景弹层里 | `.dlg .tone-row`；预设是 `.dlg .tone-presets .chip`；铺法是含「铺满/完整显示/平铺」的 chip |
| 背景拆了三层 | `.card.hasbg > .card-bg`（有 filter）/ `.card-bg-veil`（蒙层）/ `.card-inner`（文字，filter 必须是 none） |
| 软件背景 | 设置 → 外观主题 → 「软件背景」行；生效看 `--appbg` |
| 记账账户卡 | `.lg-accs` 的直接子元素；预算 / 固定支出区块按文案找 |
| 提醒重复方式 | `#view-root form .chip`（不是 `.dlg`） |
| 拖动排序不能靠 `dragTo` | Playwright 的 `dragTo` 驱动不了 HTML5 原生拖拽，要自己派发 `DragEvent('dragstart'/'dragover'/'drop')` |
| 待办可拖容器 | `.todo-sortable .todo-row`；打卡是 `.habit-sortable .hcard` + `.mod-grip` 手柄 |
| 搜索框换成组件了 | 外层仍是 `.searchbox`，历史下拉是 `.sb-hist`（`.sb-item` / `.linkbtn`） |
| 图标风格 | 设置 → 外观主题 → `.iset` 卡片；换套后 `.nav .ic svg` 的 viewBox 会变（antd 是 1024） |
| 编辑器切换 | `.mod-tools button[title^="切换输入方式"]`；正文是 `.rt[contenteditable="true"]`，源码是 `.md-src` |

## 五条经验（v8 补了三条）

- **不能 `location.reload()`**。界面是 `NavigateToString` 的 data URL，reload 会变成 `about:blank`，
  之后所有点击都在等一个永远不完成的导航。
- **不能「赋 value + dispatch input」模拟输入**。React 的 value tracker 会认为值没变，`onChange` 不触发。
  用 `locator.fill()` / `keyboard.type()`。v8 才发现旧版设置页搜索那条断言一直没真正生效。
- **每个套件开头要清场**：`Esc` + 点空白收掉 `.qmask/.mask`，再「点今天 → 回到今天」。
  否则上一套留下的日期或弹层会让这一套从头假失败。
- **弹窗按钮可能是 disabled 的**（如 LaTeX 插入按钮在 TeX 非法时）。点了等于没点，
  弹窗留在那里挡住后面的点击 —— 先 `waitForFunction(!btn.disabled)` 再点，并断言 `.mask` 已消失。
- **定稿的日子是只读的**，点正文会被 `.ro` 挡住（应用的正确行为）。套件开头统一先「改回草稿」。
- **右键菜单要用 mouse.down/up**：`click({button:'right'})` 在 WebView2 里不一定会走到 React 的 onContextMenu。
- **反复跑要防"上一轮留下的只读状态"**：日记定稿后标题/正文都是 readonly，套件开头用
  `rpc('entry.publish', {date, published:0})` 复位，别指望点 `.pubbar` 的按钮 ——
  停在别的页面时那个按钮根本不存在。
- **断言别依赖"账户余额从 0 开始"**：账户名加随机后缀，否则第二轮会拿到上一轮那个（余额已被扣过）。
- **编辑器套件要先复位**：`entry.publish(0)` 取消定稿 + 把正文模块的 `config.format` 设回 `rich`，
  否则上一轮可能停在 Markdown 模式，`.rt[contenteditable]` 根本不存在。
- **打字给点延迟**：`keyboard.type(text, { delay: 40 })`。瞬间灌入的一长串字符和真人输入时序不同，
  某些依赖输入的逻辑会表现不一样。
- **导航栏有四种停靠位置**，换位置等于换一套 flex 布局。改布局或加减导航项后，
  必须跑 `e2e-v9.js` 末尾那 8 条停靠断言——「设置点不开」就是这么漏出去的。
- **v12.6 补的四条**：
  - **`P.eval()` 里不能 await RPC**。它底层是 `page.evaluate`，返回 Promise 时不等，
    表现是 8s 超时「页面可能被挂起」。要等就用 `P.page.evaluate()`。
  - **手写 RPC 请监听 `window.chrome.webview`**，不是 `window`。WebView2 的回包走前者，
    挂错地方就是永远收不到、只能等到超时 —— 这个坑排查了很久。
  - **设置页是按组渲染的**，只渲染当前 `group`。找 `data-act` 之前先点对应的 `.snav`，
    否则断言「元素不存在」其实是「没切到那一组」。
  - **`font.import` 会弹系统文件框**，无人值守跑不了。`probe-170` 里这段默认跳过，
    要验就在 `<数据根>/字体/` 放一个 `_probe-*.ttf` 再跑，跑完删掉。
- **断言尽量用增量**（`count === before - 1`）而不是绝对值；截图统一 `.catch(()=>{})`，
  Playwright 在 WebView2 上偶尔会卡在 `page.screenshot` 的字体等待，截图不该让验收失败。
- **v12.7 补的四条**：
  - **主题生效要断言 `--bg` 的实际值变了**，不能只看「安装成功」的 toast。
    `normalizeTheme` 吃前缀那个 bug 就是这样漏过去的：清单写了、弹层关了、
    提示也弹了，但页面一点没变。
  - **`P.eval()` 里的 RPC 名要对**。早先 `probe-241` 拿 `settings.all`（不存在，实际是
    `bootstrap`）去读清单，永远拿不到，打印「装了 0 个」—— 而下一步却能卸载成功。
    断言用错接口比真 bug 更容易骗人，看到矛盾结果先怀疑断言。
  - **React 受控组件要绕过合成事件**：给 `textarea` / `input` 赋值必须用
    `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set`
    再用原生 setter，然后 `dispatchEvent(new Event('input',{bubbles:true}))`。
    直接 `el.value = x` 不会触发重渲染，`data-act` 按钮一直是 disabled。
  - **拾色器面板断言别只看"开了没"**，要量 `getBoundingClientRect()` 有没有出窗口 ——
    它的定位是 `absolute` 挂在工具栏上，工具栏换行或窗口窄了就会跑出去。
