import { useStore } from '../store';

/**
 * 多语言（第 56 条）。
 *
 * 做法：**拿中文原文当 key**，没有译文就退回中文。
 * 这样不用先给 900 条文案起英文名，翻一条能用一条，永远不会出现「key 找不到」的白块。
 * 这一轮只翻「界面框架」——导航、设置分组、常用按钮；正文、提示长句仍然中文，
 * 因为半截翻译比不翻译更难看，先把骨架立稳再铺量。
 */

export const LANGS = [
  /* 「正体中文」是繁体（Traditional）的说法，这里写错了 —— 本项是简体。 */
  { k: 'zh-Hans', n: '简体中文', en: 'Chinese (Simplified)', note: '默认' },
  { k: 'en', n: 'English', en: 'English', note: '界面骨架已翻，正文仍为中文' },
] as const;

/** 后续要做的语言清单（先列出来，不假称已支持） */
export const PLANNED_LANGS = [
  '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Português',
  'Русский', 'Italiano', 'العربية', 'ไทย', 'Tiếng Việt', 'Bahasa Indonesia',
];

/** 英文对照表：key 是中文原文 */
const EN: Record<string, string> = {
  /* —— 页面标题（29 个页面全部从这里取，Topbar 内部统一翻） —— */
  今天: 'Today', 流: 'Flow', 总结: 'Review', 打卡: 'Habits', 番茄钟: 'Focus',
  日历: 'Calendar', 记录: 'Records', 待办: 'Tasks', 倒计时: 'Countdown',
  笔记: 'Notes', 草稿箱: 'Drafts', 多媒体库: 'Media', 音乐库: 'Audio',
  统计: 'Stats', 我的: 'Me', 使用说明书: 'Manual', 更新日志: "What's New",
  联系我们: 'Contact', 设置: 'Settings', 欢迎: 'Home', 记账本: 'Ledger',
  时间轴: 'Timeline', 提醒: 'Alarms', 缓存: 'Cache', 画板: 'Canvas',
  主题: 'Themes', 插件: 'Plugins', 工坊: 'Workshop',
  主题中心: 'Themes', 创意工坊: 'Workshop', 插件中心: 'Plugins',
  音乐: 'Music', 数字花园: 'Garden',

  /* 设置分组 */
  外观主题: 'Appearance', 界面布局: 'Layout', 日记与模块: 'Journal',
  提醒与勿扰: 'Alerts', 快捷键: 'Shortcuts', 托盘与窗口: 'Tray & Window',
  安全与密码: 'Security', 分享与总结: 'Share', 数据与缓存: 'Data', 关于: 'About',

  /* 常用按钮 */
  保存: 'Save', 取消: 'Cancel', 关闭: 'Close', 删除: 'Delete', 确定: 'OK',
  分享: 'Share', 定稿: 'Finalise', 改回草稿: 'Back to draft',
  导入: 'Import', 导出: 'Export', 新建: 'New', 刷新: 'Refresh',
  搜索: 'Search', 恢复默认: 'Reset', 立即锁定: 'Lock now',
  保存并生效: 'Apply', 试试: 'Try', 打开: 'Open',
  新建习惯: 'New habit', 编辑: 'Edit', 重命名: 'Rename', 复制: 'Duplicate',
  置顶: 'Pin', 取消置顶: 'Unpin', 归档: 'Archive', 恢复: 'Restore',
  上移: 'Move up', 下移: 'Move down', 详情: 'Details', 更多: 'More',

  /* 状态 */
  已保存: 'Saved', 保存中: 'Saving…', 未保存: 'Unsaved', 保存失败: 'Save failed',
  加载中: 'Loading…', 空: 'Empty', 已完成: 'Done', 未完成: 'To do',

  /* 其它 */
  /* 番茄钟可以被用户改名（第 228 条），默认叫「学习」。
     这两个默认值都得能翻，否则英文界面下这一项永远是中文。
     用户自己改的名字（比如「专注」）没有译文，会原样显示 —— 这是对的，
     人名和自定义名不该被机器翻译。 */
  学习: 'Study', 专注: 'Focus', 番茄: 'Pomodoro',
  数据目录: 'Data folder', 取消收藏: 'Unstar', 收藏: 'Star',
  本月: 'This month', 上月: 'Last month', 账户: 'Accounts',
  预算: 'Budget', 管理: 'Manage', 新增账户: 'Add account',
  回顾: 'Looking back',
};

export const isEN = (lang: string) => lang === 'en';

/** 非组件环境里用：直接查表 */
export function tr(zh: string, lang?: string): string {
  const l = lang ?? (useStore.getState().settings.language as string) ?? 'zh-Hans';
  return isEN(l) ? (EN[zh] || zh) : zh;
}

/** 组件里用：跟着设置变化重新渲染 */
export function useT() {
  const lang = (useStore((s) => s.settings.language) as string) || 'zh-Hans';
  return (zh: string) => (isEN(lang) ? (EN[zh] || zh) : zh);
}

/**
 * 某个语言翻了多少条。
 *
 * 这里的分母**必须是界面骨架的真实条数**，不能写 `Object.keys(EN).length` ——
 * 那样 done 和 total 永远相等，永远是 100%，等于自己骗自己。
 *
 * 骨架 = 导航项（23）+ 页面标题（29，含不在导航里的说明书 / 更新日志 / 联系我们等）
 *      + 设置分组（10）。这些是英文界面下用户最先看到的东西，
 * 也是本轮承诺覆盖的范围；正文、长提示仍然是中文，进度里如实反映。
 */
const SKELETON_TOTAL = 62;

export function coverage(lang: string) {
  if (!isEN(lang)) return null;
  /*
   * 只在骨架范围内数，避免拿"多翻了几个按钮"充数。
   * 这几个集合就是上面定义的骨架，字典里多出来的动词按钮不算进来。
   */
  const skeletonKeys = [
    '今天', '流', '总结', '打卡', '番茄钟', '日历', '记录', '待办', '倒计时',
    '笔记', '草稿箱', '多媒体库', '音乐库', '统计', '我的', '使用说明书',
    '更新日志', '联系我们', '设置', '欢迎', '记账本', '时间轴', '提醒', '缓存',
    '画板', '主题', '插件', '工坊', '音乐',
    '外观主题', '界面布局', '日记与模块', '提醒与勿扰', '快捷键', '托盘与窗口',
    '安全与密码', '分享与总结', '数据与缓存', '关于',
  ];
  const done = skeletonKeys.filter((k) => EN[k]).length;
  return { done, total: Math.max(SKELETON_TOTAL, skeletonKeys.length) };
}
