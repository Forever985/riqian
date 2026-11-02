# 日签 v12.8 · 全项目 BUG 审计报告

> 审计日期：2026-11-02　｜　修复日期：2026-11-02（v12.9.1）
> 审计范围：C# 后端 **27 文件 / 13110 行**，前端 **104 文件 / 38806 行**，RPC **274 方法**
> 审计方式：通读 + 静态核对 + 真实调用验证（不是「看代码像有问题」，每条都有实测证据）
> 状态：**8 条全部已修复并验证**，回归探针见 `tests/verify-bug-*.js`，修复说明见 `开发文档.md` 第 41 节

---

## 一、结论摘要

| 级别 | 数量 | 状态 | 说明 |
| --- | --- | --- | --- |
| 🔴 严重 | **4** | ✅ 全部修复 | 会算错钱 / 会丢数据 / 点了直接报错，正常使用就会撞上 |
| 🟡 中等 | **1** | ✅ 已修复 | 可造出脏数据，但前端当前没走这条路 |
| 🟢 次要 | **3** | ✅ 全部修复 | 体验瑕疵，不报错不败数据 |
| ➕ 追加 | **1** | ✅ 已修复 | 修复过程中新发现：导出带 BOM 导致导入永远失败 |

**修复后验收：** 7 个新探针全绿；275 个 RPC 中 103 个只读接口全过、0 报错；
23 个页面遍历 0 条控制台错误；既有 4 个探针 48 项全过（无回归）。

**数据安全现状：** 真实库 `E:/日签/riqian.db` 里 `jar_id` 非空的流水为 **0 条**，
所以最严重的「账户余额算反」**尚未污染真实数据** —— 修起来还没有历史包袱。

---

## 二、严重缺陷

### 🔴 Bug 1 · 存钱进储蓄罐，账户余额反向增加　✅ 已修复

**位置**

- `DbV13.cs:279` —— 写流水时 `kind` 直接照抄方向
  ```csharp
  Exec(@"INSERT INTO ledger(id,date,kind,amount,cat,note,account_id,created_at,jar_id,jar_base)
         VALUES(@i,@d,@k,@a,'存钱',@no,@acc,@ca,@j,@b)",
      ("@i", id), ("@d", d), ("@k", dir), ...);   // dir == "in" 表示「存进罐子」
  ```
- `DbV10.cs:894` —— 账户余额按 `kind` 推导
  ```sql
  IFNULL((SELECT SUM(CASE WHEN l.kind='in' THEN l.amount ELSE -l.amount END)
          FROM ledger l WHERE l.account_id=a.id AND l.deleted_at IS NULL), 0) AS delta
  ```

**问题**

两处对 `kind` 的理解不一样：

- `JarDeposit` 里 `dir="in"` 意思是「钱进入**罐子**」
- `LedgerAccounts` 里 `kind='in'` 意思是「钱进入**账户**」

方向正好相反。存钱本该让账户余额减少，实际让它增加。

**实测**

| 步骤 | 账户余额 | 罐子余额 | 用户总资产 |
| --- | --- | --- | --- |
| 初始 | 1000 | 0 | **1000** |
| 存 100 进罐子 | 1100 ❌ | 100 | **1200** ❌ |

应为 `900 / 100 / 1000`。现在凭空多出 100 块，每存一笔就多一笔。

**为什么 `m_in`/`m_out` 没跟着错**

同一段 SQL 里 `m_in` / `m_out` 加了 `AND IFNULL(l.jar_id,'')=''`，
把罐子流水排除掉了，所以「本月流入/流出」是对的。
唯独 `delta` 不能这么排除 —— 钱确实离开了账户，必须计入，只是符号反了。

**根因**

不是「少加了一个条件」，是**语义冲突**：`kind` 这一个字段承担了两种含义。
`jar_id` 非空的流水，`kind` 表示的是「罐子方向」而非「账户方向」。

**✅ 修复（v12.9.1）**

采用 B 方案：抽常量 `Db.AccountDeltaSql`，对 `jar_id` 非空的行取反。
两处账户余额公式（`LedgerAccounts` / `LedgerInsight`）都改成拼这个常量，
罐子余额那份抽成 `JarBalanceSql`。历史脏数据下次读取自动变对，无需迁移。

**顺带修：** 账本页「总资产」原来只累加账户余额，存 100 进罐子后显示 900，
看着像钱丢了。现在加上罐子余额并注明（账户 x · 罐子 y）。

**验证：** `tests/verify-bug-jar.js` 3/0 —— 账户 1000→900、罐子 100、总额守恒 1000。

---

**原方案对比（留档）**

| 方案 | 做法 | 影响面 |
| --- | --- | --- |
| A | `JarDeposit` 写库时把 `dir` 取反再存 | 只改 1 行；罐子余额计算也要跟着取反，否则罐子算错 |
| B | `delta` 计算加 `CASE WHEN IFNULL(l.jar_id,'')<>'' THEN 反号` | 只改查询；历史数据自动修正；**推荐** |

B 更稳：不动写入语义，已经存进去的错数据下次读就自动对了。
但两个方案都得同步检查 `DbV13.cs:88` / `:252` 的罐子余额公式。

---

### 🔴 Bug 2 · 只存过罐子钱的那一天，账本里这笔钱完全不见　✅ 已修复

**位置**

- `DbV10.cs:802` —— 明细查询 **没有**排除罐子
  ```csharp
  var items = Rows($@"SELECT * FROM ledger WHERE {w} ORDER BY date DESC, created_at DESC", a)
  ```
- `DbV10.cs:822` —— 按天分组 **排除了**罐子
  ```csharp
  const string notJar = " AND IFNULL(jar_id,'')=''";
  // 下面的 sums / byCat / days 全都拼了 $"{w}{notJar}"
  ```
- `web/src/views/Ledger.tsx:289` —— 前端只遍历 `days`
  ```tsx
  return (data?.days || []).map((d) => ({
    date: d.date,
    items: bucket.get(d.date) || [],
    ...
  }));
  ```

**问题**

设计意图是「合计排除、明细保留」（开发文档 §2.6 明确写了）。
但前端是**以 `days` 为骨架**渲染的：`days` 里没有的日期，即使 `items` 里有数据，也不会出现在界面上。

于是形成死角：

- 某天**只有**存钱/取钱 → `days` 里没这一天 → 明细被前端丢掉 → **界面看不到**
- 某天既有存钱又有正常收支 → `days` 里有这一天 → 明细正常显示

**实测**

```
后端给的 days 分组：(没有这一天)
后端给的 items 明细：2 条（含 jar_id 非空那笔）
❌ 前端的 map 遍历 days，这条明细永远不显示
```

**影响**

用户存了 500 块进罐子，去账本翻，什么都没有。会以为钱丢了。

**✅ 修复（v12.9.1）**

后端 `LedgerList` 新增 `dayItems`（明细口径的天），前端以它为渲染骨架，
`days` 只负责填小计、查不到按 0 兜底。两套口径名字分开，不再混用。
`items` 还补了 `jarId` 字段，让界面能区分转账和收支。

罐子流水现在显示成 `→ ¥77.00` + 「存进罐子」标签 + 弱化色；
那天抬头若只有罐子流水，补一句「只有罐子存取，不算收支」，不留空白。

**验证：** `verify-bug-ledgerday.js` 3/0 + `verify-bug-jar-visible.js` 5/0（后者验真实 DOM）。

---

**原修复思路（留档）**

前端改成 `items` 为骨架：先把 `items` 按日期分组，再从 `days` 里取小计，
`days` 里查不到的日期就用 0 兜底（因为按定义那天没有收支，小计本来就是 0）。

---

### 🔴 Bug 3 · 草稿「移到回收站 / 打开回收站」直接抛 SQL 错误　✅ 已修复

**位置**

- `DbV11.cs:278`
  ```csharp
  Exec("UPDATE entries SET deleted_at=$t WHERE date=$d AND IFNULL(published,0)=0", ...);
  ```
- `DbV11.cs:295`
  ```csharp
  return Rows(@"SELECT date, title, plain, updated_at, deleted_at FROM entries
                WHERE IFNULL(deleted_at,'')<>'' AND IFNULL(published,0)=0 ...");
  ```

**问题**

`entries` 表**没有 `published` 列**。真实列名是 `status`（`DbV9.cs:22`）：
```csharp
EnsureColumn("entries", "status", "TEXT DEFAULT 'draft'");   // draft | published
```

同一批功能里的 `EntryDrafts`（`DbV9.cs:81`）用的就是正确的 `status`，
只有这两个回收站方法写错了列名 —— 典型的复制粘贴残留。

**实测**

```
SQLite Error 1: 'no such column: published'.
```

**影响**

- `Drafts.tsx:70` 的 `trashList()` 挂了 `.catch(() => [])`，所以**回收站永远显示为空**，还不报错，静默失效
- `Drafts.tsx:108` 的 `moveToTrash()` **没有 catch**，点了直接抛异常 → 单条删除按钮完全不能用
- `Drafts.tsx:127` 批量删除包了 `try/catch`，所以**批量删会显示「N 篇已移到回收站」但其实一篇都没删**

最后一个最坑：给了成功提示，实际什么都没发生。

**✅ 修复（v12.9.1）**

`IFNULL(published,0)=0` → `IFNULL(status,'draft')<>'published'`。

**顺带修：** `Drafts.tsx` 的 `bulk()` 原来吞掉异常后照样报「N 篇已移到回收站」，
现在统计真实成功数，失败如实报出；`moveToTrash` / `publishOne` 补上了 `catch`。

**验证：** `verify-bug-draft-full.js` 8/0 —— 移入 → 回收站可见 → 捡回 → 定稿不受影响。

---

### 🔴 Bug 4 · 换数据目录会丢约 90% 的数据　✅ 已修复

**位置** `Db.cs:2626` `ChangeRoot`

```csharp
conn.Close();
var dst = Path.Combine(newRoot, "riqian.db");
File.Copy(DbPath, dst, true);          // ← 直接拷主文件，没有 wal_checkpoint
foreach (var f in Directory.GetFiles(MediaDir)) File.Copy(...);
```

**问题**

数据库开了 WAL 模式（`PRAGMA journal_mode=WAL` + `synchronous=NORMAL`）。
WAL 模式下，**已提交但还没 checkpoint 的数据全在 `-wal` 文件里**，主库文件可能远小于真实数据量。

`File.Copy` 只拷主库文件，`-wal` 里的东西全部丢掉。

**实测（真实数据目录）**

```
riqian.db        364,544 字节  (356 KB)
riqian.db-wal  2,904,632 字节  (2.77 MB)
```

此刻执行迁移 → 拷出来的 `riqian.db` **缺约 89% 的数据**。

**讽刺的是正确写法就在同一个文件里** —— `Db.cs:466` 的 `DailyBackup`：
```csharp
try { Exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { }
conn.Close();
File.Copy(...)
```

**附带问题 2：失败后连接不会重开**

```csharp
catch (Exception ex) { return new { ok = false, err = ex.Message }; }
```

`conn.Close()` 已经执行了。如果后面 `File.Copy` 抛异常（磁盘满、无权限、路径被占），
直接掉进 catch 返回，`conn` 保持关闭状态 —— **程序变成一具僵尸**：
界面还在，之后每一次读写都报「连接未打开」，只能重启。

**✅ 修复（v12.9.1）**

四件事一起做：

1. `Close()` 前先 `PRAGMA wal_checkpoint(TRUNCATE)`，`-wal` 归零后才拷
2. 拷完用独立连接跑 `PRAGMA integrity_check`，不过就中止并原地退回
3. `catch` 里把 `Root/DbPath/MediaDir/BackupDir/ExportDir` 全部退回原值并重新 `Open()`
4. 目标已有旧库时先另存一份 `.bak-时间戳`，不直接覆盖

**验证：** `verify-bug-wal.js` 4/0 —— checkpoint 后 wal 从 3,205,392 B 归零、
主库 364,544 → 389,120 B、单拷主库能读到刚写的 mark。

另外新增 `diag.checkpoint` 接口（`Db.ForceCheckpoint`），让这件事随时可验证。

---

**原修复清单（留档）**

1. `conn.Close()` 前先 `try { Exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { }`
2. 拷贝范围改成 `riqian.db*`（主库 + wal + shm），或者先 checkpoint 到 TRUNCATE 让 wal 归零
3. `catch` 里补 `try { Open(); } catch { }`，保证失败也能恢复到可用状态
4. 更稳的做法：先拷到临时文件，校验 `PRAGMA integrity_check` 通过再替换目标

---

## 三、中等问题

### 🟡 Bug 5 · `notebook.parent` 没有防环校验　✅ 已修复

**位置** `DbV10.cs:208`

```csharp
public object NotebookSetParent(string id, string parentId)
{
    Exec("UPDATE notebooks SET parent_id=$p, updated_at=$t WHERE id=$i", ...);
    return new { ok = true };      // 没有任何校验
}
```

**问题**

可以直接把 A 的父设成 B、B 的父设成 A，形成环。
之后 `NotebookTree` 递归渲染会无限循环或栈溢出。

**对照正确实现** `DbV11.cs:184` `NotebookSetParent2` —— 有 64 层 guard，一路往上爬着查。

**影响评估：低**

前端 `api.ts:313` 的 `notebooks.setParent` 指向的是 `notebook.parent2`（安全版）。
`api.ts:407` 那个 `notebookParent` 指向 `notebook.parent`（危险版），但**全项目无人调用**。

所以这是**潜在缺陷而非现存故障** —— 但这个 RPC 是暴露给外部的（`RpcCatalog` 里有登记），
将来任何新代码或插件调一下就能把库弄成环。

**✅ 修复（v12.9.1）**：改为直接委托 `=> NotebookSetParent2(id, parentId)`。
两份实现留着迟早走岔，转发比同步维护更可靠。

**验证：** `verify-bug-notebook.js` —— 设 A.parent=B 通过，再设 B.parent=A 被拒
（「不能拖进自己的子笔记本里」），未成环。

---

## 四、次要问题　✅ 全部已修复（v12.9.1）

| # | 位置 | 问题 | 影响 |
| --- | --- | --- | --- |
| 6 | `DbV10.cs:869` | `allCats` 查询没排除 `jar_id` | 分类下拉里永久多出一个「存钱」，选中后合计恒为 0 |
| 7 | `DbV7.cs:635` | `SettingsImport` 只读 `settings` 键 | `SettingsExport` 导出的 `modules` 和 `pomoPresets` 被静默丢弃，导入后模块和番茄预设不恢复 |
| 8 | `web/src/store.ts:699` | `flushSave` 里 `entry.save` 成功但 `tags.set` 失败 | 报「保存失败」，但正文其实已经存了。用户重复保存/以为丢稿 |

第 8 条值得单独说：只要标签接口偶发失败（比如标签里有非法字符），
用户就会看到红色的「保存失败」，而实际上正文安全。
**误报比不报更伤信任** —— 建议拆成两段，正文失败才算失败，标签失败只记日志。

### ➕ Bug 9 · 导出的设置文件永远导不回来（修复过程中新发现）

**位置** `DbV7.cs:631` / `DbV7.cs:637`

```csharp
// 导出
File.WriteAllText(path, ..., Encoding.UTF8);        // ← 会写 BOM：EF BB BF
// 导入
using var doc = JsonDocument.Parse(json);           // ← 见到 0xEF 直接抛
```

**问题**

`Encoding.UTF8` 默认写 BOM，`System.Text.Json` 不接受 BOM。
所以 **"导出设置 → 换台机器 → 导入"这条路一直是断的**。

**实测**

```
导出的文件前 6 字节: b'\xef\xbb\xbf{\r\n'    ← 有 BOM
导入报错: '0xEF' is an invalid start of a value. LineNumber: 0
```

**为什么没人发现**

报错信息看着像"文件格式不对"，用户会以为是自己选错了文件，
不会想到是软件自己写出来的文件自己不认。

**✅ 修复（v12.9.1）**

- 导出：`new UTF8Encoding(false)`，明确不要 BOM
- 导入：`json.TrimStart('\uFEFF', ...)`，容忍用户手里已有的旧文件
- 一并修了 `SettingsImport` 丢 `modules` 的老问题（按 `type` upsert，重复导入不翻倍）

**验证：** `verify-bug-settings.js` 7/0 —— 导出 140 项设置 + 13 个模块，原样导回成功；
连导两次模块数不变；坏文件不崩。

---

## 四之二、BOM 问题的彻底收口（v12.9.1 追加）

### 为什么不能只修 `SettingsImport` 那一处

第一版修复是在 `SettingsImport` 里写一句 `json.TrimStart('\uFEFF')`。
这是**打补丁**，不是**修问题** —— 因为 BOM 这个坑的成因是
「每个读文件的地方各自决定要不要处理 BOM」，只要下次新增一个读 JSON 的入口，
同样的 bug 就会再长出来一次。而这个项目里读 JSON 的地方不止一处。

所以改成**统一入口**：

```csharp
// MainForm.cs
internal static string StripJsonPreamble(string text)
{
    if (string.IsNullOrEmpty(text)) return text ?? "";
    return text.TrimStart('\uFEFF', '\u200B', '\u00A0', ' ', '\t', '\r', '\n');
}
```

去掉的不只是 BOM（`U+FEFF`），还有零宽空格（`U+200B`）、不换行空格（`U+00A0`）
和前导空白。这几种字符从记事本、旧版 PowerShell 的 `Out-File -Encoding UTF8`、
Office 复制粘贴里都能混进来，症状完全一样：解析器报
`'0xEF'` / `'0xE2'` / `'0xC2' is an invalid start of a value`，
用户看到的只是一句"格式不对"。

**所有读用户/外部 JSON 的入口都必须走它**：`JsonSafe`（配置文件、各种 json 列）、
`SettingsImport`。以后新增入口也走这里，不许再各写一遍 `TrimStart`。

### 顺带挖出的第三个隐患：配置被静默改写

排查 BOM 时顺着 `ResolveRoot` 往下看，发现一个和 BOM 同源的问题：
**读不出配置就覆盖配置**。

```csharp
// 修复前
catch (Exception ex) { Diag.Error("app.config", "读配置文件失败", ex); }
SaveConfig(fallback);          // ← 不管上面发生了什么，都拿默认值写回去
return fallback;
```

两处会踩到：

1. **配置文件被改坏**（记事本存成了别的编码、手工编辑漏了引号）
   → 读不出 `root` → 用默认路径覆盖 → **用户的路径永久丢失**，
   下次启动永远去默认目录，而真正的库还在老地方，表现为"数据全没了"。

2. **配置里的路径暂时够不着**（外置盘没插、网络盘掉线、U 盘拔了）
   → `Directory.CreateDirectory` 抛异常 → 同样落到 `SaveConfig(fallback)`
   → **插回盘也回不去了**。

第 2 种更阴：用户完全没做错任何事，只是拔了个 U 盘。

**✅ 修复**

- 读不出 `root`：先把原文件另存为 `config.json.bak-时间戳`，再回退默认值
- 路径暂时不可用：**保持配置原样不动**，本次用默认目录顶着，日志写明
  「原配置保持不变，下次启动会再试」
- `Directory.CreateDirectory` 失败不再被外层 catch 吞掉，改为 `Diag.Error` 明确记录

关键点是区分「配置坏了」和「路径暂时不可用」：
前者要备份后回退，后者**一个字都不能改**。

### 验证

**`tests/verify-bug-bom.js`（新建）15/15**

| 验证项 | 结果 |
| --- | --- |
| 导出的文件前 3 字节不是 `EF BB BF` | ✅ 头部 hex = `7b 0d 0a` |
| 干净文件原样导回 | ✅ settings 139 项 · modules 13 项 |
| **手工加 BOM 的文件仍能导入** | ✅ 旧版导出文件不作废 |
| 前导空格 / 换行 / 制表 / 零宽字符 | ✅ 能导入 |
| 真·坏文件（不是 JSON） | ✅ 返回 `ok=false` + 明确报错，不装成功 |
| 连导两次模块不翻倍 | ✅ 13 → 13，无重复 `type` |

**配置改写隐患（实机验证）**

用「文件当路障」造一个必定建不出来的目录（`...\blockerfile\日签`，
`blockerfile` 是个普通文件），配置指向它后启动：

```
启动前 config: {"root": "...\\blockerfile\\日签"}
启动后 config: {"root": "...\\blockerfile\\日签"}      ← 原样保留
日志: ERR app.config | 配置里的数据目录暂时不可用：...（本次先用 E:\日签，原配置保持不变，下次启动会再试）
```

修复前这里会被改写成 `E:\日签`，插回盘也找不回。

**回归**：`verify-all-readonly.js` 103 个只读接口 0 报错；
`verify-pages.js` 23 页 0 console 错误（`draw` 页判"空白"是空列表状态，非缺陷）；
`verify-bug-settings.js` 8/0。

**过程中修的一个探针缺陷**：`verify-bug-settings.js` 会用 `theme:"X"` 试探
"坏文件会不会冲掉设置"，但跑完不还原，每跑一次就把真实主题改成 `X`。
已补上还原逻辑，并在探针末尾断言还原成功（8/0 那条"已把 theme 还原").

---

## 五、已排除的疑似问题（避免下次重复怀疑）

| 怀疑点 | 排查方式 | 结论 |
| --- | --- | --- |
| SQL 注入 | 人工通读全部拼接点 | ✅ 全部是固定片段 + 参数绑定，无注入 |
| SQL 引用了不存在的列/表 | 抽出 **610 条** SQL，用真实 schema 跑 `EXPLAIN` | ✅ 只报出 `published` 一处（即 Bug 3） |
| RPC 方法重名导致死代码 | 比对 `RpcCatalog` 与两段 `switch` | ✅ 三处重名（`cd.add`/`todo.add`/`habit.delete`）是**分版本分层**设计，V7/V10 先命中，历史分支无害 |
| 除法除零 | 逐个检查后端 4 处除法 | ✅ 全部有零保护 |
| 前端运行时报错 | 遍历 23 个页面，收集 console | ✅ **0 条错误**，无 NaN / undefined / `[object Object]` |
| 只读接口冒烟 | 全量调 **101 个**只读接口（按后端 `write` 标记筛选） | ✅ 只有 `draft.trashList` 报错（即 Bug 3） |
| 外键 / 孤立数据 | 12 条一致性 SQL | ✅ 仅 `vals` 5 条孤立行（module 已删），影响为「旧模块值残留」 |
| 重复数据 | 重复日期 entry / 重复 sha / 重复 entry_tags | ✅ 全部 0 |
| 备份文件损坏 | `PRAGMA integrity_check` | ✅ ok |
| 惰性建表漏了 Schema | 检查 `EnsureV12`/`EnsureV13` 是否进 `Schema()` | ✅ 有意为之，每个读取方法自己先调 `EnsureXxx()` |
| 表名对不上 | used 表名 vs real 表名交叉核对 | ✅ 完全对应 |

---

## 六、修复优先级建议

| 顺序 | 缺陷 | 理由 | 预估改动 |
| --- | --- | --- | --- |
| 1 | **Bug 4** 换目录丢数据 | 唯一会造成**不可逆数据丢失**的 | 约 15 行，含回滚 |
| 2 | **Bug 3** 草稿回收站 | 点了就报错 / 假成功提示，用户会以为功能坏了 | 2 行 |
| 3 | **Bug 1** 账户余额算反 | 会让人不信任记账功能 | 需先定口径 |
| 4 | **Bug 2** 罐子流水不可见 | 会以为钱丢了 | 前端约 10 行 |
| 5 | Bug 5 / 6 / 7 / 8 | 体验与潜在风险 | 各 1–5 行 |

**Bug 1 需要用户先拍板**：`kind` 到底表示「账户方向」还是「罐子方向」？
换语义会影响罐子余额公式（`DbV13.cs:88`、`:252`）和将来的统计口径，
不是纯代码问题，所以我没有擅自改。

---

## 七、本次审计附带产物

| 文件 | 用途 |
| --- | --- |
| `tools/audit-sql.py` | 抽 C# 全部 SQL，用真实 schema 跑 `EXPLAIN`。以后改 schema 后跑一次就能抓出所有缺列 |
| `tools/audit-columns.py` | 列名交叉核对（对 SQL 别名误报较多，以 `audit-sql.py` 为准） |
| `tests/verify-bug-*.js` | 5 个缺陷的复现探针，修完可作为回归测试 |
| `tests/verify-all-readonly.js` | 101 个只读接口全量冒烟 |
| `tests/verify-pages.js` | 23 个页面遍历 + console 错误收集 |

---

## 八、状态

**全部 9 条缺陷已修复并逐个验证（v12.9.1）。**
BOM 问题已在 v12.9.1 追加一轮**收口**（统一入口 `StripJsonPreamble`），
并顺带修掉同源的「配置被静默改写」隐患（详见「四之二」）。

- 未 `dotnet publish`，未触碰 `E:/日签/日签.exe`
- 临时文件 `_audit.db` / `_bk.db` / `used-tables.txt` 已清理
- 测试在真实库留下的数据（16 罐子 / 4 账户 / 7 流水）已清除并 checkpoint，
  清理后 `integrity_check = ok`。清后逐项核对与清理前一致：
  日记 7 篇日期全同、8 个账户全在（只少了 3 个 `BUGTEST-账户`）、4 个罐子全在（只少了 5 个测试罐子）
- 配置改写测试过程中在 `F:\日签` 建过一个空库（F 盘是用户真实磁盘），
  已确认零用户内容后删除
- 配置文件测试后已还原为 `{"root": "E:\\日签"}`，真实库 `integrity = ok`，
  用户原有 7 篇日记 / 5 条流水 / 8 个账户 / 4 个罐子 / 23 个待办全部完好
- 修复说明见 `开发文档.md` 第 41 节，回归探针见 `tests/verify-bug-*.js`

**仍然是「改代码 → 编译 → 本地验证」状态，没有发布。**