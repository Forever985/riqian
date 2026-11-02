import { useStore } from '../store';

/**
 * 多语言（第 56 条）。
 *
 * 做法：**拿中文原文当 key**，没有译文就退回中文。
 * 这样不用先给几百条文案起英文名，翻一条能用一条，永远不会出现「key 找不到」的白块。
 *
 * 覆盖范围：界面骨架（页面标题 / 导航 / 设置分组 / 常用按钮 / 状态词）。
 * 正文、长提示仍是中文 —— 半截翻译比不翻译更难看，先立骨架再铺量。
 *
 * ---------------------------------------------------------------------------
 * 为什么「拿中文当 key」而不是用 `nav.habits` 这种命名空间 key：
 *   1. 迁移成本为零。已经写在 JSX 里的 `t('打卡')` 一行都不用改。
 *   2. 漏翻时的降级是**可读的中文**，不是 `ns.missing` 亮点。
 *   3. 加语言只是往 LANGS 里塞一张表，不需要动任何调用点。
 *   代价：改中文原文等于改 key，必须同步改所有词典 —— 所以下面每张表的
 *   注释都强调「key 必须是中文原文，一个字都不能改」。
 * ---------------------------------------------------------------------------
 *
 * ## UI 适配（这次加日德时踩出来的，逐条对应下面的实现）
 *
 * 1. **德语长词**。`Einstellungen`（设置）、`Benachrichtigungen`（通知）比
 *    中文长两三倍，而左侧导航默认只有 218px、且标签是 `nowrap + ellipsis`。
 *    硬塞就是满屏「Einstellun…」。处理：`html[lang^=de]` 下把导航默认宽度
 *    和最小宽度调宽（见 styles.css 的 i18n 段），并且**只在用户没手动拖过
 *    宽度时**才生效 —— 用户拖过就尊重用户。
 * 2. **日语不分词**。日文没有空格，`writing-mode` 和 `word-break` 都要放行
 *    假名换行，否则一个长句会被当成一个"词"撑破容器。
 * 3. **`<html lang>` 必须跟着变**。浏览器的自动断行、字体回退、连字符
 *    （`hyphens:auto`）全靠这个属性；只改 React 里的字符串是不够的。
 * 4. **字体栈**。原栈是 `"PingFang SC","Microsoft YaHei"`，日文假名会用到
 *    微软雅黑的假名部分（字形偏中文化），德语的 ä ö ü ß 没问题但要保证
 *    不是从 CJK 字体里取变形。处理见 styles.css。
 */

/**
 * 已支持的语言。
 *
 * `note` 是设置页显示的那行小字，**不进翻译表** —— 它描述的就是这门语言本身，
 * 用该语言自述最合适（日语用户看到「日本語」比看到 "Japanese" 舒服）。
 */
export const LANGS = [
  { k: 'zh-Hans', n: '简体中文', note: '默认' },
  { k: 'en', n: 'English', note: 'UI skeleton translated' },
  { k: 'ja', n: '日本語', note: 'UI 骨格のみ翻訳' },
  { k: 'de', n: 'Deutsch', note: 'Nur die UI-Grundstruktur' },
] as const;

/** 后续要做的语言清单（先列出来，不假称已支持） */
export const PLANNED_LANGS = [
  '한국어', 'Français', 'Español', 'Português',
  'Русский', 'Italiano', 'العربية', 'ไทย', 'Tiếng Việt', 'Bahasa Indonesia',
];

/**
 * 骨架 = 导航项（23）+ 页面标题（29）+ 设置分组（10）。
 *
 * 这些是切换语言后用户**第一眼**看到的东西，也是本功能承诺覆盖的范围。
 * 不把「常用按钮」算进来，是为了让进度条的分子分母都只统计"承诺项"，
 * 而不是靠多翻几个按钮冲高百分比。
 */
export const SKELETON_KEYS = [
  '今天', '流', '总结', '打卡', '番茄钟', '日历', '记录', '待办', '倒计时',
  '笔记', '草稿箱', '多媒体库', '音乐库', '统计', '我的', '使用说明书',
  '更新日志', '联系我们', '设置', '欢迎', '记账本', '时间轴', '提醒', '缓存',
  '画板', '主题', '插件', '工坊', '音乐',
  '外观主题', '界面布局', '日记与模块', '提醒与勿扰', '快捷键', '托盘与窗口',
  '安全与密码', '分享与总结', '数据与缓存', '关于',
] as const;

/* ========================================================================== */
/* 英文                                                                        */
/* ========================================================================== */

/** 英文对照表。**key 必须是中文原文，一个字都不能改** */
const EN: Record<string, string> = {
  /* —— 页面标题 —— */
  今天: 'Today', 流: 'Flow', 总结: 'Review', 打卡: 'Habits', 番茄钟: 'Focus',
  日历: 'Calendar', 记录: 'Records', 待办: 'Tasks', 倒计时: 'Countdown',
  笔记: 'Notes', 草稿箱: 'Drafts', 多媒体库: 'Media', 音乐库: 'Audio',
  统计: 'Stats', 我的: 'Me', 使用说明书: 'Manual', 更新日志: "What's New",
  联系我们: 'Contact', 设置: 'Settings', 欢迎: 'Home', 记账本: 'Ledger',
  时间轴: 'Timeline', 提醒: 'Alarms', 缓存: 'Cache', 画板: 'Canvas',
  主题: 'Themes', 插件: 'Plugins', 工坊: 'Workshop',
  主题中心: 'Themes', 创意工坊: 'Workshop', 插件中心: 'Plugins',
  音乐: 'Music', 数字花园: 'Garden', 储蓄罐: 'Jars', 储蓄: 'Savings',

  /* —— 设置分组 —— */
  外观主题: 'Appearance', 界面布局: 'Layout', 日记与模块: 'Journal',
  提醒与勿扰: 'Alerts', 快捷键: 'Shortcuts', 托盘与窗口: 'Tray & Window',
  安全与密码: 'Security', 分享与总结: 'Share', 数据与缓存: 'Data', 关于: 'About',

  /* —— 常用按钮 —— */
  保存: 'Save', 取消: 'Cancel', 关闭: 'Close', 删除: 'Delete', 确定: 'OK',
  分享: 'Share', 定稿: 'Finalise', 改回草稿: 'Back to draft',
  导入: 'Import', 导出: 'Export', 新建: 'New', 刷新: 'Refresh',
  搜索: 'Search', 恢复默认: 'Reset', 立即锁定: 'Lock now',
  保存并生效: 'Apply', 试试: 'Try', 打开: 'Open',
  新建习惯: 'New habit', 编辑: 'Edit', 重命名: 'Rename', 复制: 'Duplicate',
  置顶: 'Pin', 取消置顶: 'Unpin', 归档: 'Archive', 恢复: 'Restore',
  上移: 'Move up', 下移: 'Move down', 详情: 'Details', 更多: 'More',
  用模板: 'Use template', 去填写: 'Go to form',

  /* —— 状态 —— */
  已保存: 'Saved', 保存中: 'Saving…', 未保存: 'Unsaved', 保存失败: 'Save failed',
  加载中: 'Loading…', 空: 'Empty', 已完成: 'Done', 未完成: 'To do',

  /* —— 其它 —— */
  /* 番茄钟可以被用户改名（第 228 条），默认叫「学习」。
     这两个默认值都得能翻，否则英文界面下这一项永远是中文。
     用户自己改的名字（比如「专注」）没有译文，会原样显示 —— 这是对的，
     人名和自定义名不该被机器翻译。 */
  学习: 'Study', 专注: 'Focus', 番茄: 'Pomodoro',
  数据目录: 'Data folder', 取消收藏: 'Unstar', 收藏: 'Star',
  本月: 'This month', 上月: 'Last month', 账户: 'Accounts',
  预算: 'Budget', 管理: 'Manage', 新增账户: 'Add account',
  回顾: 'Looking back',

  /* —— 相对日期。不翻这三个词，日历和日签页签里会蹦出中文 —— */
  昨天: 'Yesterday', 前天: 'Two days ago', 明天: 'Tomorrow',
};

/* ========================================================================== */
/* 日本語                                                                      */
/* ========================================================================== */

/**
 * 日语对照表。
 *
 * 用词口径（统一过一遍，避免同一概念三种说法）：
 *   - 打卡 → 「習慣」而不是「チェックイン」。这一页记的是长期习惯，
 *     不是"签到"，用「習慣」才对得上里面的连续天数、目标值。
 *   - 待办 → 「タスク」而不是「ToDo」。混用半角英文会跟界面上别处的中文风格打架。
 *   - 笔记 → 「ノート」；笔记本 → 「ノートブック」（两者在左栏同时出现，必须区分）。
 *   - 设置 → 「設定」；分组 → 「セクション」。
 *   - 「保存する」这类动词用**辞书形 + する**，不用「保存」，因为按钮上要能看出是动作。
 *
 * 注意：日语里汉字和中文同形的很多（保存 / 取消 / 削除），但**不要**因此
 * 直接复用中文 —— 「取消」在日语里是「キャンセル」，「恢复默认」是
 * 「初期値に戻す」。同形不同义的地方全是坑。
 */
const JA: Record<string, string> = {
  /* —— ページタイトル —— */
  今天: '今日', 流: 'フロー', 总结: '振り返り', 打卡: '習慣', 番茄钟: 'フォーカス',
  日历: 'カレンダー', 记录: '記録', 待办: 'タスク', 倒计时: 'カウントダウン',
  笔记: 'ノート', 草稿箱: '下書き', 多媒体库: 'メディア', 音乐库: 'オーディオ',
  统计: '統計', 我的: 'マイページ', 使用说明书: 'マニュアル', 更新日志: '更新履歴',
  联系我们: 'お問い合わせ', 设置: '設定', 欢迎: 'ホーム', 记账本: '家計簿',
  时间轴: 'タイムライン', 提醒: 'リマインダー', 缓存: 'キャッシュ', 画板: 'キャンバス',
  主题: 'テーマ', 插件: 'プラグイン', 工坊: 'ワークショップ',
  主题中心: 'テーマ', 创意工坊: 'ワークショップ', 插件中心: 'プラグイン',
  音乐: '音楽', 数字花园: 'デジタルガーデン', 储蓄罐: '貯金箱', 储蓄: '貯蓄',

  /* —— 設定セクション —— */
  外观主题: '外観', 界面布局: 'レイアウト', 日记与模块: '日記とモジュール',
  提醒与勿扰: '通知', 快捷键: 'ショートカット', 托盘与窗口: 'トレイとウィンドウ',
  安全与密码: 'セキュリティ', 分享与总结: '共有', 数据与缓存: 'データ', 关于: 'このアプリについて',

  /* —— よく使うボタン —— */
  保存: '保存', 取消: 'キャンセル', 关闭: '閉じる', 删除: '削除', 确定: 'OK',
  分享: '共有', 定稿: '確定', 改回草稿: '下書きに戻す',
  导入: 'インポート', 导出: 'エクスポート', 新建: '新規', 刷新: '更新',
  搜索: '検索', 恢复默认: '初期値に戻す', 立即锁定: '今すぐロック',
  保存并生效: '適用', 试试: '試す', 打开: '開く',
  新建习惯: '習慣を追加', 编辑: '編集', 重命名: '名前を変更', 复制: '複製',
  置顶: 'ピン留め', 取消置顶: 'ピン留めを解除', 归档: 'アーカイブ', 恢复: '復元',
  上移: '上へ', 下移: '下へ', 详情: '詳細', 更多: 'その他',
  用模板: 'テンプレートを使う', 去填写: '入力する',

  /* —— 状態 —— */
  已保存: '保存済み', 保存中: '保存中…', 未保存: '未保存', 保存失败: '保存に失敗',
  加载中: '読み込み中…', 空: 'なし', 已完成: '完了', 未完成: '未完了',

  /* —— その他 —— */
  学习: '学習', 专注: '集中', 番茄: 'ポモドーロ',
  数据目录: 'データフォルダ', 取消收藏: 'お気に入り解除', 收藏: 'お気に入り',
  本月: '今月', 上月: '先月', 账户: '口座',
  预算: '予算', 管理: '管理', 新增账户: '口座を追加',
  回顾: '振り返る',

  /* —— 相対日付 —— */
  昨天: '昨日', 前天: '一昨日', 明天: '明日',
};

/* ========================================================================== */
/* Deutsch                                                                     */
/* ========================================================================== */

/**
 * 德语对照表。
 *
 * 德语是这次三种语言里**唯一有 UI 适配成本**的：复合词极长。
 *   Einstellungen(13) / Benachrichtigungen(19) / Datensicherung / Tastenkürzel
 * 而左侧导航默认 218px、标签 `nowrap + ellipsis` —— 直接塞会写成
 * 「Benachrichtigu…」，比不翻译更糟。
 *
 * 三条对策（缺一不可）：
 *   1. 优先选**短的同义词**。能写「Meldungen」就不写「Benachrichtigungen」，
 *      能写「Daten」就不写「Datensicherung」。语义不变的前提下，短就是好。
 *   2. 真压不下去的（Einstellungen / Erscheinungsbild），靠 styles.css 里
 *      `html[lang^=de]` 那一段把导航默认宽度从 218 → 248。
 *   3. 名词大写的规则要守住 —— 德语所有名词首字母大写，这是语法不是风格。
 *      写小写不至于看不懂，但一眼就不像德语。
 *
 * 用词口径：
 *   - 打卡 → 「Gewohnheiten」（习惯），同日语理由。
 *   - 待办 → 「Aufgaben」。
 *   - 笔记 → 「Notizen」；笔记本 → 「Notizbücher」（左栏同时出现，必须区分）。
 *   - 设置 → 「Einstellungen」（这是最长的那个词，已按上面第 2 条处理）。
 */
const DE: Record<string, string> = {
  /* —— Seitentitel —— */
  今天: 'Heute', 流: 'Flow', 总结: 'Rückblick', 打卡: 'Gewohnheiten', 番茄钟: 'Fokus',
  日历: 'Kalender', 记录: 'Einträge', 待办: 'Aufgaben', 倒计时: 'Countdown',
  笔记: 'Notizen', 草稿箱: 'Entwürfe', 多媒体库: 'Medien', 音乐库: 'Audio',
  统计: 'Statistik', 我的: 'Profil', 使用说明书: 'Anleitung', 更新日志: 'Neuerungen',
  联系我们: 'Kontakt', 设置: 'Einstellungen', 欢迎: 'Start', 记账本: 'Haushalt',
  时间轴: 'Zeitstrahl', 提醒: 'Erinnerungen', 缓存: 'Cache', 画板: 'Zeichenfläche',
  主题: 'Designs', 插件: 'Plugins', 工坊: 'Werkstatt',
  主题中心: 'Designs', 创意工坊: 'Werkstatt', 插件中心: 'Plugins',
  音乐: 'Musik', 数字花园: 'Digitaler Garten', 储蓄罐: 'Spartöpfe', 储蓄: 'Sparen',

  /* —— Einstellungsbereiche —— */
  外观主题: 'Aussehen', 界面布局: 'Layout', 日记与模块: 'Tagebuch',
  提醒与勿扰: 'Meldungen', 快捷键: 'Tastenkürzel', 托盘与窗口: 'Tray & Fenster',
  安全与密码: 'Sicherheit', 分享与总结: 'Teilen', 数据与缓存: 'Daten', 关于: 'Über',

  /* —— Häufige Schaltflächen —— */
  保存: 'Speichern', 取消: 'Abbrechen', 关闭: 'Schließen', 删除: 'Löschen', 确定: 'OK',
  分享: 'Teilen', 定稿: 'Festlegen', 改回草稿: 'Zurück zu Entwurf',
  导入: 'Importieren', 导出: 'Exportieren', 新建: 'Neu', 刷新: 'Aktualisieren',
  搜索: 'Suchen', 恢复默认: 'Zurücksetzen', 立即锁定: 'Jetzt sperren',
  保存并生效: 'Anwenden', 试试: 'Testen', 打开: 'Öffnen',
  新建习惯: 'Neue Gewohnheit', 编辑: 'Bearbeiten', 重命名: 'Umbenennen',
  复制: 'Duplizieren', 置顶: 'Anheften', 取消置顶: 'Lösen', 归档: 'Archivieren',
  恢复: 'Wiederherstellen', 上移: 'Nach oben', 下移: 'Nach unten',
  详情: 'Details', 更多: 'Mehr', 用模板: 'Vorlage nutzen', 去填写: 'Ausfüllen',

  /* —— Zustand —— */
  已保存: 'Gespeichert', 保存中: 'Speichern…', 未保存: 'Nicht gespeichert',
  保存失败: 'Speichern fehlgeschlagen',
  加载中: 'Laden…', 空: 'Leer', 已完成: 'Fertig', 未完成: 'Offen',

  /* —— Sonstiges —— */
  学习: 'Lernen', 专注: 'Fokus', 番茄: 'Pomodoro',
  数据目录: 'Datenordner', 取消收藏: 'Nicht mehr merken', 收藏: 'Merken',
  本月: 'Dieser Monat', 上月: 'Letzter Monat', 账户: 'Konten',
  预算: 'Budget', 管理: 'Verwalten', 新增账户: 'Konto hinzufügen',
  回顾: 'Rückblick',

  /* —— Relative Datumsangaben —— */
  昨天: 'Gestern', 前天: 'Vorgestern', 明天: 'Morgen',
};

/* ========================================================================== */

/** 语言 → 词典。`zh-Hans` 不放进来：中文是原文，查不到就是中文本身 */
const DICTS: Record<string, Record<string, string>> = { en: EN, ja: JA, de: DE };

/** 所有非中文语言 */
export const isTranslated = (lang: string) => lang in DICTS;

/**
 * 该语言是「用空格分词」还是「不用」。
 *
 * 只影响 CSS 断行策略（见 styles.css 的 i18n 段）：
 * 中日文允许任意位置断行，西文必须按词断。
 * 德语尤其重要 —— 一个 19 字符的复合词，如果容器只有 200px，
 * 按词断就是直接溢出，`word-break: break-word` 才能救回来。
 */
export const isCJK = (lang: string) => lang === 'zh-Hans' || lang === 'ja';

/** 非组件环境里用：直接查表 */
export function tr(zh: string, lang?: string): string {
  const l = lang ?? (useStore.getState().settings.language as string) ?? 'zh-Hans';
  return DICTS[l]?.[zh] ?? zh;
}

/** 组件里用：跟着设置变化重新渲染 */
export function useT() {
  const lang = (useStore((s) => s.settings.language) as string) || 'zh-Hans';
  return (zh: string) => DICTS[lang]?.[zh] ?? zh;
}

/**
 * 某个语言翻了多少条。
 *
 * 分母是 **SKELETON_KEYS 的长度**，不是 `Object.keys(dict).length` ——
 * 那样 done 和 total 永远相等、永远 100%，等于自己骗自己。
 * 只在骨架范围内数，也不让「多翻了几个按钮」把百分比冲高。
 */
export function coverage(lang: string) {
  const d = DICTS[lang];
  if (!d) return null;
  const done = SKELETON_KEYS.filter((k) => d[k]).length;
  return { done, total: SKELETON_KEYS.length };
}