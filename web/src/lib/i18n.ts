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
  { k: 'zh-Hans', n: '正体中文', en: 'Chinese (Simplified)', note: '默认' },
  { k: 'en', n: 'English', en: 'English', note: '试验版：仅界面框架' },
] as const;

/** 后续要做的语言清单（先列出来，不假称已支持） */
export const PLANNED_LANGS = [
  '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Português',
  'Русский', 'Italiano', 'العربية', 'ไทย', 'Tiếng Việt', 'Bahasa Indonesia',
];

/** 英文对照表：key 是中文原文 */
const EN: Record<string, string> = {
  /* 导航 */
  今天: 'Today', 流: 'Flow', 总结: 'Review', 打卡: 'Habits', 番茄钟: 'Focus',
  日历: 'Calendar', 记录: 'Records', 待办: 'Tasks', 倒计时: 'Countdown',
  笔记: 'Notes', 草稿箱: 'Drafts', 多媒体库: 'Media', 音乐库: 'Audio',
  统计: 'Stats', 我的: 'Me', 说明书: 'Manual', 更新日志: "What's New",
  联系我们: 'Contact', 设置: 'Settings', 欢迎: 'Home',

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

  /* 状态 */
  已保存: 'Saved', 保存中: 'Saving…', 未保存: 'Unsaved', 保存失败: 'Save failed',

  /* 其它 */
  数据目录: 'Data folder', 取消收藏: 'Unstar', 收藏: 'Star',
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

/** 某个语言翻了多少条（给设置页显示进度，别夸大） */
export function coverage(lang: string) {
  return isEN(lang) ? { done: Object.keys(EN).length, total: Object.keys(EN).length } : null;
}
