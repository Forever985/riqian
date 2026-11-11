using System;
using System.Collections.Generic;
using System.Linq;

namespace Riqian
{
    /// <summary>
    /// RPC 方法目录。
    ///
    /// 解决一件具体的事：**AI（或新接手的人）不该靠读 5000 行分发代码来搞清楚有哪些接口**。
    /// 这里把 227 个方法整理成结构化清单，能通过 `diag.methods` / `diag.method` 自助查询，
    /// 也能导出 Markdown 给文档用。
    ///
    /// ⚠️ 这份清单是**手写维护**的，因为分发是 5 个文件里 227 条 if-else 拼的，
    /// 运行时反射扫不到那些字符串字面量。代价就是新增接口要记得回来补一行 ——
    /// 所以 <see cref="SelfCheck"/> 会拿清单和真实分发做交叉验证，漏了就在日志里 WARN。
    /// 真正的权威名单由 tools/gen-rpc-list.py 从源码抽（产物见 docs/接口清单.md）。
    /// </summary>
    public static class RpcCatalog
    {
        public class Method
        {
            public string name;
            public string group;
            public string desc;
            public string args;
            public bool write;
            public string note;
        }

        private static Method M(string n, string g, string d, string a, bool w = false, string note = null)
            => new Method { name = n, group = g, desc = d, args = a, write = w, note = note };

        /// <summary>
        /// 全量清单。按域分组，顺着读下来就是一份完整的功能地图。
        /// 参数写 ? 表示可选；`ids: 数组` 表示字符串数组。
        /// </summary>
        public static readonly Method[] All =
        {
            /* ---------- 基础 ---------- */
            M("bootstrap",         "基础", "一次拿全启动数据：路径、设置、模块、标签、习惯、今天", "", false,
              "界面启动时唯一必须调的方法；返回体最大，别在高频路径上反复调"),
            M("setting.set",       "基础", "写一条设置", "k, v", true),
            M("user.get",          "基础", "读用户资料", ""),
            M("user.save",         "基础", "存用户资料", "name?, avatar?, bio?, region?", true),

            /* ---------- 模块 ---------- */
            M("modules.list",      "模块", "日记页的模块列表", ""),
            M("modules.add",       "模块", "新增模块", "type, title", true),
            M("modules.update",    "模块", "改模块标题/启用/配置", "id, title?, enabled?, config?", true),
            M("modules.delete",    "模块", "删模块", "id", true),
            M("modules.reorder",   "模块", "按 id 数组重排模块", "ids: 数组", true),

            /* ---------- 日记 ---------- */
            M("entry.get",         "日记", "取某天的日记全文", "date"),
            M("entry.save",        "日记", "保存某天的日记", "date, values, fav?, bg?, title?, bgTone?", true,
              "values 是 JSON 对象；字段传 null 表示不改"),
            M("entry.list",        "日记", "按条件查日记列表", "q?, from?, to?, mood?, tag?, fav?, hasImg?, limit?, offset?"),
            M("entry.fav",         "日记", "收藏/取消收藏某天", "date, fav", true),
            M("entry.bg",          "日记", "设置背景（色值或媒体 id）", "date, bg, tone?", true),
            M("entry.delete",      "日记", "删除某天的日记", "date", true),
            M("entry.publish",     "日记", "定稿发布", "date", true),
            M("entry.status",      "日记", "取某天的状态（定稿/草稿等）", "date"),
            M("entry.drafts",      "日记", "该日记关联的草稿", "date?"),

            /* ---------- 待办 ---------- */
            M("todos.list",        "待办", "取待办列表", "listId?, q?, done?, trashed?"),
            M("todo.add",          "待办", "新建待办", "text, date?, listId?, priority?", true),
            M("todo.update",       "待办", "改待办", "id, ...字段", true),
            M("todo.delete",       "待办", "彻底删除某条", "id", true, "不可恢复；调用前必须二次确认"),
            M("todo.trash",        "待办", "移入已放弃", "id", true),
            M("todo.restore",      "待办", "从回收站恢复", "id", true),
            M("todo.purge",        "待办", "清空回收站里的某条", "id", true),
            M("todo.purgeAll",     "待办", "清空整个回收站", "", true, "影响面最大，慎用"),
            M("todo.clearDone",    "待办", "清掉已完成", "listId?", true),
            M("todo.repeat",       "待办", "设置重复规则", "id, repeat", true),
            M("todo.movelist",     "待办", "把待办挪到另一个清单", "id, listId", true),
            M("todos.reorder",     "待办", "按 id 数组重排（手动模式）", "ids: 数组", true),
            M("todos.recycle",     "待办", "回收站列表", ""),
            M("todo.lists",        "待办", "清单列表（含 note / parentId）", ""),
            M("todo.list.add",     "待办", "新建清单", "name, color?", true),
            M("todo.list.update",  "待办", "改清单（名称/颜色/sort）", "id, name?, color?, sort?", true),
            M("todo.list.delete",  "待办", "删清单（里面任务退回收集箱）", "id", true),
            M("todo.list.note",    "待办", "写清单描述", "id, note", true),
            M("todo.list.parent",  "待办", "设置清单上级（无限层级）", "id, parentId", true,
              "64 层防环校验；成环返回 ok=false"),

            /* ---------- 打卡 ---------- */
            M("habits.list",       "打卡", "习惯列表", ""),
            M("habit.add",         "打卡", "新建习惯", "name, type?, goal?, unit?, color?", true),
            M("habit.update",      "打卡", "改习惯", "id, ...字段", true),
            M("habit.delete",      "打卡", "删习惯", "id", true),
            M("habit.log",         "打卡", "给某天打卡", "date, habitId, value", true),
            M("habit.logs",        "打卡", "某天全部打卡记录", "date"),
            M("habit.notes",       "打卡", "打卡备注", "date, habitId?"),
            M("habit.history",     "打卡", "习惯历史", "id, from?, to?"),
            M("habit.stats",       "打卡", "习惯统计", "id?"),
            M("habit.reorder",     "打卡", "习惯排序", "ids: 数组", true),
            M("habit.trash",       "打卡", "把习惯放进回收站", "id", true),
            M("habit.restore",     "打卡", "恢复习惯", "id", true),
            M("habit.purge",       "打卡", "彻底删除习惯", "id", true),
            M("habit.remindPreview", "打卡", "预览提醒文案（含提前量与响铃时刻）", "date?"),
            /* 这个判断原来是宿主定时器内部的私有逻辑，不对外。
               但定时器 30 秒才问一次、还得等真的到点，出问题时没法当场验证。
               注意这里暴露的是**只读**的检查版（remindCheck），
               不是真会记账的 remindTick —— 后者调用一次就会消耗一次提醒额度。 */
            M("habit.remindCheck", "打卡", "此刻该不该提醒（只读，不消耗额度）", ""),

            /* ---------- 笔记 ---------- */
            M("notes.list",        "笔记", "笔记列表", "q?, notebookId?"),
            M("notes.trash",       "笔记", "笔记回收站", ""),
            M("note.get",          "笔记", "取一篇笔记", "id"),
            M("note.save",         "笔记", "新建/保存笔记", "id?, title?, content?, notebookId?, color?, icon?", true,
              "第 128 条：color/icon 传 null 表示“这项不改”，传空串表示“清掉”"),
            M("note.delete",       "笔记", "删笔记（进回收站）", "id", true),
            M("note.restore",      "笔记", "从回收站恢复", "id", true),
            M("note.purge",        "笔记", "彻底删一篇", "id", true),
            M("note.purgeAll",     "笔记", "清空回收站", "", true),
            M("note.reorder",      "笔记", "笔记排序", "ids: 数组", true),
            M("notebooks.list",    "笔记", "笔记本列表（含 parentId）", ""),
            M("notebook.tree",     "笔记", "笔记本树形结构", ""),
            M("notebook.add",      "笔记", "新建笔记本", "name, parentId?", true),
            M("notebook.add2",     "笔记", "新建笔记本（带更多字段）", "name, parentId?, color?", true),
            M("notebook.update",   "笔记", "改笔记本", "id, name?, color?", true),
            M("notebook.delete",   "笔记", "删笔记本", "id", true),
            M("notebook.parent",   "笔记", "设置上级（旧版，两层）", "id, parentId", true),
            M("notebook.parent2",  "笔记", "设置上级（无限层级，推荐）", "id, parentId", true,
              "64 层防环；推荐优先用它"),
            M("notebook.reorder",  "笔记", "笔记本排序", "ids: 数组", true),

            /* ---------- 记账 ---------- */
            M("ledger.list",       "记账", "按月份/条件查流水", "ym, cat?, accountId?, q?"),
            M("ledger.add",        "记账", "记一笔", "date, kind, amount, cat, accountId?, note?", true),
            M("ledger.update",     "记账", "改一笔", "id, ...字段", true),
            M("ledger.delete",     "记账", "删一笔", "id", true),
            M("ledger.insight",    "记账", "九张图表要的全部聚合数据", "ym", false,
              "不吃筛选条件，永远整月全量口径；一次拿 8 组数据"),
            M("ledger.accounts",   "记账", "账户列表（含余额）", ""),
            M("ledger.catRename",  "记账", "分类改名/改色", "old, name, color?", true),
            M("ledger.catDrop",    "记账", "删分类（流水归到「其他」）", "name", true),
            M("ledger.recur.list", "记账", "周期记账规则列表", ""),
            M("ledger.recur.save", "记账", "存周期记账规则", "id?, ...字段", true),
            M("ledger.recur.delete", "记账", "删周期规则", "id", true),
            M("ledger.recur.run",  "记账", "执行到期的周期记账", "", true),
            M("account.save",      "记账", "新增/改账户", "id?, name, kind?, init?, currency?, note?", true),
            M("account.delete",    "记账", "删账户", "id", true),
            M("account.reorder",   "记账", "账户拖动排序", "ids: 数组", true),
            M("account.toggle",    "记账", "启用/停用账户", "id, enabled", true),

            /* ---------- 储蓄罐（第 97 条） ---------- */
            M("jar.list",          "储蓄罐", "罐子列表（含余额与完成百分比）", ""),
            M("jar.detail",        "储蓄罐", "一个罐子的明细与下一期金额", "id"),
            M("jar.add",           "储蓄罐", "新建罐子", "name, target, mode, period, baseAmount, stepAmount, color?, icon?, note?", true),
            M("jar.update",        "储蓄罐", "改罐子", "id, name, target, mode, period, baseAmount, stepAmount, color?, icon?, note?", true),
            M("jar.deposit",       "储蓄罐", "存钱 / 取钱（记进 ledger）", "id, dir: in|out, amount, date?, note?", true),
            M("jar.removeItem",    "储蓄罐", "删掉某一笔存钱记录", "id", true),
            M("jar.delete",        "储蓄罐", "删掉罐子（流水保留）", "id", true),
            M("jar.archive",       "储蓄罐", "归档 / 取消归档", "id, archived", true),
            M("jar.reorder",       "储蓄罐", "拖动排序", "ids: 数组", true),
            M("jar.presets",       "储蓄罐", "三种存钱模式的经典预设", ""),

            /* ---------- 日历 ---------- */
            M("stats.calendar",    "日历", "某月的日历格子数据", "ym"),
            M("stats.calMonths",   "日历", "有记录的月份列表", ""),
            M("festival.day",      "日历", "某天的节日", "date"),
            M("festival.month",    "日历", "某月的节日", "ym"),
            M("festival.lunar",    "日历", "农历信息", "date"),
            M("festival.upcoming", "日历", "即将到来的节日", "n?"),
            M("festival.add",      "日历", "自定义节日", "date, name", true),
            M("festival.delete",   "日历", "删自定义节日", "id", true),
            M("festival.remindPreview", "日历", "节日提醒的预览（不发通知，只看会提醒什么）", ""),

            /* ---------- 番茄钟 ---------- */
            M("pomodoro.add",      "番茄钟", "补记一颗番茄", "date, startHm, minutes, task?, note?", true),
            M("pomodoro.manual",   "番茄钟", "手工补记（同上，参数略异）", "date, startHm, minutes, task?, note?", true),
            M("pomodoro.timer",    "番茄钟", "计时结束落库", "date, minutes, task?, note?, up?", true),
            M("pomodoro.edit",     "番茄钟", "改一颗", "id, minutes?, task?, note?", true),
            M("pomodoro.delete",   "番茄钟", "删一颗（记错了要能撤）", "id", true),
            M("pomodoro.stats",    "番茄钟", "专注统计", "from?, to?"),
            M("pomo.insight",      "番茄钟", "专注聚合洞察（days 或 from/to 二选一）", "days?, from?, to?"),
            M("pomo.day",          "番茄钟", "某天的专注明细", "date"),
            M("pomo.months",       "番茄钟", "有专注记录的月份", ""),

            /* ---------- 多媒体 ---------- */
            M("media.list",        "多媒体", "媒体库列表", "folder?, kind?, q?"),
            M("media.list2",       "多媒体", "媒体库列表（第二版，字段更全）", "folder?, kind?, q?"),
            M("media.import",      "多媒体", "从文件导入", "paths: 数组", true),
            M("media.importFolder", "多媒体", "整目录导入（可递归）", "dir, recursive?", true),
            M("media.importFolderDlg", "多媒体", "弹目录选择框并导入", "recursive?", true,
              "会弹原生窗口，AI 调用会卡住等用户操作，不建议"),
            M("media.saveBase64",  "多媒体", "存一张 base64 图", "name, dataUrl", true),
            M("media.delete",      "多媒体", "删媒体", "id", true),
            M("media.alias",       "多媒体", "改显示别名（不动磁盘文件名）", "id, alias", true),
            M("media.rename",      "多媒体", "改磁盘文件名", "id, name", true, "会真的重命名文件"),
            M("media.bulk",        "多媒体", "批量操作（移动/删除）", "ids: 数组, op, folder?", true),
            M("media.folders",     "多媒体", "文件夹列表（含层级）", "", false,
              "第 220 条：folder 用 / 分层次；返回带 name/own/n/depth，中间层自动补齐"),
            M("media.tone",        "多媒体", "调色参数（亮度/对比度/饱和）", "id, tone", true),
            M("media.storage",     "多媒体", "占用统计", ""),
            M("media.scan",        "多媒体", "扫描目录补齐索引", "", true),
            M("media.rebuildThumbs", "多媒体", "重建所有缩略图", "", true, "耗时，别在启动路径上调"),
            M("media.resolve",     "多媒体", "按引用解析成真实路径", "ref"),
            M("media.openFolder",  "多媒体", "在资源管理器里打开媒体目录", ""),
            M("media.openImport",  "多媒体", "打开导入界面", ""),
            M("media.cacheUrl",    "多媒体", "把远程媒体下载到本地缓存", "id", true),
            M("media.cacheAll",    "多媒体", "把全部远程媒体缓存到本地", "", true, "会跑一阵，别随手点"),
            M("media.tags",        "多媒体", "标签清单（含每个标签的文件数）", ""),
            M("media.setTags",     "多媒体", "改一个文件的标签（逗号分隔）", "id, tags", true),
            M("media.renameFolder", "多媒体", "文件夹改名（连整棵子树）", "from, to", true,
              "第 220 条：改 a 会把 a/b、a/b/c 一起改成新前缀"),

            /* ---------- 提醒 / 倒计时 ---------- */
            M("alarm.list",        "提醒", "提醒列表", ""),
            M("alarm.save",        "提醒", "新建/改提醒", "id?, title, at, repeat?, sound?", true),
            M("alarm.delete",      "提醒", "删提醒", "id", true),
            M("alarm.snooze",      "提醒", "贪睡 5 分钟", "id", true),
            M("alarm.skipMissed",  "提醒", "跳过今天已错过的点", ""),
            M("cd.list",           "倒计时", "倒计时列表", ""),
            M("cd.add",            "倒计时", "新建倒计时", "title, date", true),
            M("cd.update",         "倒计时", "改倒计时", "id, ..., star?", true,
              "第 101 条：star 是四象限（1 紧急且重要 / 2 重要不紧急 / 3 紧急不重要 / 4 都不），-1 表示不改"),
            M("cd.delete",         "倒计时", "删倒计时（进回收站）", "id", true),
            M("cd.trash",          "倒计时", "回收站列表", ""),
            M("cd.restore",        "倒计时", "从回收站恢复", "id", true),
            M("cd.purge",          "倒计时", "彻底删", "id", true),
            M("cd.repeat",         "倒计时", "设置重复", "id, repeat", true),

            /* ---------- 搜索 / 统计 ---------- */
            M("search.all",        "搜索", "跨模块全文搜索", "q, limit?"),
            M("stats.overview",    "统计", "总览数据（12 条：可传区间）", "from?, to?", false,
              "传 from/to 只影响日记/心情/字数/标签/收藏/打卡/番茄/待办；连续天数与总数不跟区间"),
            M("stats.rank",        "统计", "连续写作排行", ""),
            M("stats.rankExtra",   "统计", "排行附加数据", ""),
            M("stats.reset",       "统计", "重置统计数据（番茄 / 打卡等）", "what?", true,
              "不可撤销，界面上必须先二次确认"),
            M("review.day",        "统计", "单日回顾", "date"),
            M("review.range",      "统计", "区间回顾", "from, to"),

            /* ---------- 总结 / 草稿 / 版本 ---------- */
            M("summary.list",      "总结", "总结列表", ""),
            M("summary.get",       "总结", "取一份总结", "id"),
            M("summary.save",      "总结", "存总结", "id?, from, to, content", true),
            M("summary.delete",    "总结", "删总结", "id", true),
            M("summary.pin",       "总结", "置顶/取消置顶", "id, pin", true),
            M("draft.trashList",   "草稿", "草稿箱列表", ""),
            M("draft.trash",       "草稿", "把草稿丢进箱子", "id", true),
            M("draft.restore",     "草稿", "恢复草稿", "id", true),
            M("draft.purge",       "草稿", "彻底删草稿", "id", true),
            M("rev.list",          "版本", "某天的历史版本列表", "date"),
            M("rev.get",           "版本", "取某个版本内容", "id"),
            M("rev.restore",       "版本", "回滚到某个版本", "id", true, "会覆盖当前内容"),
            M("rev.dedup",         "版本", "清理重复版本", "", true),

            /* ---------- 其它内容 ---------- */
            M("encourage.list",    "打气话", "首页「给自己的一句话」列表", ""),
            M("encourage.save",    "打气话", "新增/改一条", "id?, kind, text, mediaId?, enabled?", true),
            M("encourage.delete",  "打气话", "删一条", "id", true),
            M("tags.list",         "标签", "标签及计数", ""),
            M("tag.set",           "标签", "给某天设标签", "date, tags: 数组", true),
            M("templates.list",    "模板", "模板列表", ""),
            M("templates.save",    "模板", "存模板", "id?, name, content", true),
            M("templates.delete",  "模板", "删模板", "id", true),
            M("template.apply",    "模板", "把模板套到某天", "id, date", true),
            M("link.add",          "双链", "加一条笔记链接", "from, to", true),
            M("link.addMany",      "双链", "批量加链接", "from, tos: 数组", true),
            M("link.delete",       "双链", "删链接", "id", true),
            M("milestone.list",    "大事记", "里程碑列表", ""),
            M("milestone.save",    "大事记", "存里程碑", "id?, date, title, note?", true),
            M("milestone.delete",  "大事记", "删里程碑", "id", true),
            /* #250：愿望单。金额一律用「分」，不用元 —— 浮点在钱上会差几分 */
            M("wish.list",         "愿望单", "全部愿望（未实现在前）", ""),
            M("wish.save",         "愿望单", "新建或修改一条愿望", "id?, title, priceCents, note?, url?, priority?, targetDate?", true),
            M("wish.done",         "愿望单", "标记已实现 / 改回未实现", "id, done: 0|1", true),
            M("wish.delete",       "愿望单", "移出愿望单（软删除）", "id", true),
            M("wish.stats",        "愿望单", "汇总：件数与金额", ""),
            M("music.list",        "音乐", "音乐列表", ""),
            M("music.import",      "音乐", "导入本地音乐", "paths: 数组", true),
            M("music.addUrl",      "音乐", "加网络音乐", "url, name?", true),
            M("feedback.save",     "反馈", "存一条反馈", "text, contact?", true),

            /* ---------- 画板（第 12 条） ---------- */
            M("draw.list",         "画板", "画板列表", ""),
            M("draw.get",          "画板", "取一块画板（含笔迹）", "id"),
            M("draw.save",         "画板", "保存画板", "id?, title, w, h, strokes, thumb?, note?", true),
            M("draw.rename",       "画板", "改画板标题", "id, title", true),
            M("draw.delete",       "画板", "删除画板", "id, hard?: 0|1", true),
            M("draw.trash",        "画板", "画板回收站", ""),
            M("draw.restore",      "画板", "从回收站恢复", "id", true),
            M("draw.toMedia",      "画板", "导出成图片存进多媒体库", "id, data: base64, name?", true),

            /* ---------- 字体 ---------- */
            M("font.list",         "字体", "列出「字体」目录里导入的字体文件", "", false,
              "不扫系统字体：系统字体前端按名字引用即可，不需要读文件"),
            M("font.import",       "字体", "弹文件框导入字体文件", "", true, "会等用户操作，AI 别调"),
            M("font.delete",       "字体", "删一个导入的字体文件", "file", true),
            M("font.bytes",        "字体", "读字体文件的 base64 字节", "file", false,
              "前端用 FontFace 注册，避免跨 origin 的 @font-face CORS 问题；单文件上限 64 MB"),

            /* ---------- 导出 / 分享 ---------- */
            M("export.md",         "导出", "导出 Markdown", "from?, to?", true),
            M("export.html",       "导出", "导出 HTML", "from?, to?", true),
            M("export.json",       "导出", "全量 JSON 备份", "", true),
            M("export.csv",        "导出", "导出 CSV", "kind, from?, to?", true),
            M("export.note",       "导出", "导出单篇笔记", "id", true),
            M("settings.export",   "导出", "导出设置", "", true),
            M("settings.import",   "导出", "导入设置", "json", true),
            M("share.image",       "分享", "生成分享图", "date, opts?", true),
            M("share.copyImage",   "分享", "复制分享图到剪贴板", "dataUrl"),
            M("share.copyText",    "分享", "复制分享文字", "text"),
            M("share.html",        "分享", "生成分享用 HTML", "date"),

            /* ---------- 宿主 / 系统 ---------- */
            M("app.facts",         "宿主", "程序与环境事实（路径/版本/占用）", ""),
            M("app.diagnostics",   "宿主", "完整自诊断报告", "", false, "排障首选；比 app.facts 更全"),
            M("app.chrome",        "宿主", "窗口外观跟随主题（深色标题栏等）", "dark, accent?"),
            M("app.screen",        "宿主", "屏幕信息", ""),
            M("app.tray",          "宿主", "托盘状态", ""),
            M("app.hide",          "宿主", "隐藏窗口", ""),
            M("app.minimize",      "宿主", "最小化", ""),
            M("app.quit",          "宿主", "退出程序", "", true),
            M("app.openRoot",      "宿主", "打开数据目录", ""),
            M("app.openMedia",     "宿主", "打开媒体目录", ""),
            M("app.openExport",    "宿主", "打开导出目录", ""),
            M("app.pickFolder",    "宿主", "弹目录选择框", "", false, "会等用户操作，AI 别调"),
            M("app.changeRoot",    "宿主", "迁移数据目录", "dir", true, "危险：会让旧数据「消失」"),
            M("boss.toggle",       "宿主", "老板键切换", ""),
            M("orb.toggle",        "宿主", "悬浮球显隐", ""),
            M("shell.apply",       "宿主", "应用托盘/任务栏外观设置", ""),
            M("shell.hotkeyState", "宿主", "热键注册状态", ""),
            M("shell.autostart",   "宿主", "开机自启开关", "on: 0|1", true),
            M("shell.autostartGet", "宿主", "读开机自启状态", ""),
            M("shell.lockState",   "宿主", "同步应用锁状态（托盘图标叠小锁）", "locked: 0|1"),
            M("shell.openUrl",     "宿主", "用系统默认程序打开链接", "url"),

            /* ---------- 快捷捕获（165） ---------- */
            M("quick.capture",     "快捷", "不弹窗直接落库（待办按行拆、笔记进第一个本、日记追加到正文）", "kind: todo|note|diary, text", true,
              "和桌面浮窗共用同一套后端逻辑，别另写一份"),
            M("quick.popup",       "快捷", "弹桌面浮窗（不唤主窗口）", "kind: todo|note|diary"),
            M("quick.state",       "快捷", "浮窗当前状态（是否可见 / 哪个模式）", ""),
            M("hotkey.apply",      "宿主", "重新注册全局热键", ""),
            M("notify.push",       "宿主", "推一条桌面通知", "title, body"),
            M("notify.test",       "宿主", "测试通知通道", ""),
            M("cache.stats",       "缓存", "缓存统计", ""),
            M("cache.prune",       "缓存", "按策略清理", "", true),
            M("cache.clear",       "缓存", "清空缓存", "", true),
            M("cache.open",        "缓存", "打开缓存目录", ""),
            /* 第 42 条：桌面常驻便签（像 Simple Sticky Notes 那样钉在桌面上） */
            M("sticky.open",       "笔记", "把某篇笔记钉到桌面（常驻便签窗）", "id", true),
            M("sticky.close",      "笔记", "取消桌面便签", "id"),
            M("sticky.list",       "笔记", "当前钉着哪些便签", ""),

            /* ---------- 加解密 / 安全 ---------- */
            M("vault.status",      "安全", "加密库状态", ""),
            M("vault.unlock",      "安全", "解锁", "password", true),
            M("vault.lock",        "安全", "锁定", "", true),
            M("vault.check",       "安全", "校验密码", "password"),
            M("vault.add",         "安全", "加一条密文", "title, content", true),
            M("vault.remove",      "安全", "删一条", "id", true),
            M("vault.setMain",     "安全", "设主密码", "password", true),
            M("vault.clearMain",   "安全", "清主密码", "", true),
            M("vault.hint",        "安全", "密保提示", ""),
            M("vault.qa.list",     "安全", "密保问题列表", ""),
            M("vault.qa.save",     "安全", "存密保问题", "q, a", true),
            M("vault.qa.verify",   "安全", "校验密保答案", "q, a"),
            M("vault.qa.reset",    "安全", "重置密保", "", true),

            /* ---------- 诊断（本轮新增） ---------- */
            M("diag.logs",         "诊断", "读最近的日志文本", "lines?, day?", false,
              "AI 排障第一站；不传 day 就是今天"),
            M("diag.stats",        "诊断", "日志统计 + 环境快照", ""),
            M("diag.frontend",     "诊断", "前端上报错误（内部用）", "level, src, msg, stack"),
            M("diag.action",       "诊断", "记录用户操作，崩溃时还原现场", "what"),
            M("diag.config",       "诊断", "调整日志级别与保留天数", "level?, keepDays?", true),
            M("diag.ping",         "诊断", "打一行测试日志，验通道", "msg?"),
            M("diag.methods",      "诊断", "列出全部 RPC 方法（AI 自助发现入口）", "limit?"),
            M("diag.method",       "诊断", "查单个方法的详细说明", "name"),
            M("diag.checkpoint",   "诊断", "把 WAL 并回主库，返回前后字节数（迁移前自检用）", ""),
            M("diag.openDir",      "诊断", "打开日志所在文件夹", ""),
            M("diag.api",          "诊断", "AI 调试网关开关与状态", "on? (\"1\"/\"0\"), port?",
              true, "开了就在本机开一个 HTTP 口；防火墙外连不进来，但仍是安全敏感项"),
            M("diag.apiInfo",      "诊断", "读网关的连接说明文件内容", ""),

            /* ---------- 第 237 条：按日期临时隐藏模块 ---------- */
            M("modules.hiddenOn",  "模块", "查某一天临时关掉了哪些模块", "date"),
            M("modules.shownOn",   "模块", "查某一天额外显示出来的模块", "date"),
            M("modules.showOn",    "模块", "在某一天里额外显示一个模块", "date, id, shown? (1 显示 / 0 撤掉)", true),
            M("modules.hideOn",    "模块", "在某一天里隐藏/恢复一个模块", "date, id, hidden? (1 隐藏 / 0 恢复)",
              true, "只影响那一篇日记；要长期生效请改 modules.update(enabled:0)"),
        };

        /* ---------------- 查询 ---------------- */

        public static object List(int limit = 0)
        {
            var items = All.Select(x => new
            {
                name = x.name, group = x.group, desc = x.desc, args = x.args, write = x.write,
            }).ToList();

            if (limit > 0) items = items.Take(limit).ToList();

            return new
            {
                ok = true,
                catalogued = All.Length,
                returned = items.Count,
                groups = All.Select(x => x.group).Distinct().ToArray(),
                // 写操作单独标出来 —— AI 动手改数据前应该先看这个
                writes = All.Where(x => x.write).Select(x => x.name).ToArray(),
                methods = items,
            };
        }

        public static object Describe(string name)
        {
            var m = All.FirstOrDefault(x => string.Equals(x.name, name, StringComparison.OrdinalIgnoreCase));
            if (m == null)
                return new
                {
                    ok = false,
                    err = "清单里没有这个方法",
                    hint = "可能是新加的还没登记；用 diag.methods 拿全量，或者查 docs/接口清单.md",
                    nearby = All.Where(x => x.name.IndexOf(name ?? "", StringComparison.OrdinalIgnoreCase) >= 0
                                         || x.name.StartsWith((name ?? "").Split('.').FirstOrDefault() + "."))
                                .Select(x => x.name).Take(12).ToArray(),
                };

            return new
            {
                ok = true,
                name = m.name,
                group = m.group,
                desc = m.desc,
                args = m.args,
                write = m.write,
                note = m.note,
                callExample = "{\"m\":\"" + m.name + "\",\"a\":{ /* " + m.args + " */ }}",
            };
        }

        /// <summary>
        /// 清单和真实分发对不对得上。
        /// 分发是 5 段 if-else 拼的，反射扫不到字符串字面量，只能人工维护清单；
        /// 那就得有个地方在漏更新时喊一声，否则清单迟早变成过期文档。
        /// </summary>
        public static void SelfCheck(IEnumerable<string> actualMethods)
        {
            try
            {
                var declared = new HashSet<string>(All.Select(x => x.name), StringComparer.OrdinalIgnoreCase);
                var actual = new HashSet<string>(actualMethods ?? Enumerable.Empty<string>(), StringComparer.OrdinalIgnoreCase);
                if (actual.Count == 0) return;

                var missing = actual.Where(x => !declared.Contains(x)).OrderBy(x => x).ToList();
                if (missing.Count > 0)
                    Diag.Warn("diag.catalog",
                        "有 " + missing.Count + " 个 RPC 没登记（AI 发现不了）: " + string.Join(", ", missing.Take(25)));

                var ghost = declared.Where(x => !actual.Contains(x)).OrderBy(x => x).ToList();
                if (ghost.Count > 0)
                    Diag.Warn("diag.catalog",
                        "清单里有 " + ghost.Count + " 个方法实际不存在（清单过期）: " + string.Join(", ", ghost.Take(25)));

                Diag.Info("diag.catalog", "清单 " + declared.Count + " 个 / 实际 " + actual.Count +
                           " 个 · 漏登记 " + missing.Count + " · 过期 " + ghost.Count);
            }
            catch (Exception ex) { Diag.Warn("diag.catalog", "自检本身失败", ex); }
        }

        /// <summary>导出 Markdown 表格（tools/gen-rpc-list.py 会读它写文档）</summary>
        public static string ToMarkdown()
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("| 方法 | 分组 | 说明 | 参数 | 写操作 |");
            sb.AppendLine("|---|---|---|---|---|");
            foreach (var m in All.OrderBy(x => x.group).ThenBy(x => x.name))
                sb.AppendLine($"| `{m.name}` | {m.group} | {m.desc} | `{m.args}` | {(m.write ? "**是**" : "")} |");
            return sb.ToString();
        }
    }
}