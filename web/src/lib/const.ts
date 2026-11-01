export const MOODS = [
  { v: 1, e: '😣', t: '很差' },
  { v: 2, e: '😕', t: '低落' },
  { v: 3, e: '😐', t: '一般' },
  { v: 4, e: '🙂', t: '不错' },
  { v: 5, e: '😄', t: '很好' },
];

export const WEATHERS = ['☀️ 晴', '⛅ 多云', '☁️ 阴', '🌧️ 雨', '⛈️ 雷雨', '❄️ 雪', '🌫️ 雾', '💨 风'];

export const COLORS = ['#b8623a', '#5f8256', '#4a7396', '#8a6aa8', '#b8863a', '#a55a72', '#4f8a86', '#7a7469'];

export const TYPE_NAME: Record<string, string> = {
  richtext: '正文', mood: '心情', weather: '天气', tags: '标签', habits: '打卡', todo: '待办',
  sleep: '睡眠', energy: '精力', rating: '评分', images: '图片', quote: '引用', heading: '小标题', divider: '分割线',
};

export const HABIT_TYPE_NAME: Record<string, string> = {
  bool: '打卡', time: '时间', number: '数值', duration: '时长', choice: '多选', note: '备注',
};

export const FEATURES = [
  { k: 'navReview', n: '总结（一日 / 近几日）' },
  { k: 'navDrafts', n: '草稿箱' },
  { k: 'navTimeline', n: '时间轴' },
  { k: 'navLedger', n: '记账本' },
  { k: 'navAlarms', n: '提醒' },
  { k: 'navMedia', n: '多媒体库（图片 / 音频 / 视频）' },

  { k: 'navHabits', n: '打卡' },
  { k: 'navPomodoro', n: '番茄钟' },
  { k: 'navCalendar', n: '日历' },
  { k: 'navRecords', n: '记录搜索' },
  { k: 'navTodos', n: '待办' },
  { k: 'navCountdown', n: '倒计时' },
  { k: 'navNotes', n: '笔记 / 备忘录' },
  { k: 'navDraw', n: '画板' },
  { k: 'navStats', n: '统计' },
  { k: 'navProfile', n: '我的（账户、安全、缓存）' },
];

/** 「我的」页的模块（第 53 条）：顺序可在设置里调，key 必须和 Profile.tsx 里的块一致 */
export const PROFILE_SECTIONS = [
  { k: 'id', n: '身份与资料（头像 / 昵称 / 签名）' },
  { k: 'fields', n: '更多资料（地区 / 城市 / 职业 / 兴趣）' },
  { k: 'secure', n: '密码与隐私' },
  { k: 'cache', n: '存储与缓存' },
  { k: 'sound', n: '提醒音与试听' },
];

/** 地区清单（第 57 条）：港澳台按中国的一部分列出，不做国家化处理 */
export const REGIONS = [
  { k: 'CN-11', n: '中国 · 北京市' }, { k: 'CN-12', n: '中国 · 天津市' },
  { k: 'CN-13', n: '中国 · 河北省' }, { k: 'CN-14', n: '中国 · 山西省' },
  { k: 'CN-15', n: '中国 · 内蒙古自治区' }, { k: 'CN-21', n: '中国 · 辽宁省' },
  { k: 'CN-22', n: '中国 · 吉林省' }, { k: 'CN-23', n: '中国 · 黑龙江省' },
  { k: 'CN-31', n: '中国 · 上海市' }, { k: 'CN-32', n: '中国 · 江苏省' },
  { k: 'CN-33', n: '中国 · 浙江省' }, { k: 'CN-34', n: '中国 · 安徽省' },
  { k: 'CN-35', n: '中国 · 福建省' }, { k: 'CN-36', n: '中国 · 江西省' },
  { k: 'CN-37', n: '中国 · 山东省' }, { k: 'CN-41', n: '中国 · 河南省' },
  { k: 'CN-42', n: '中国 · 湖北省' }, { k: 'CN-43', n: '中国 · 湖南省' },
  { k: 'CN-44', n: '中国 · 广东省' }, { k: 'CN-45', n: '中国 · 广西壮族自治区' },
  { k: 'CN-46', n: '中国 · 海南省' }, { k: 'CN-50', n: '中国 · 重庆市' },
  { k: 'CN-51', n: '中国 · 四川省' }, { k: 'CN-52', n: '中国 · 贵州省' },
  { k: 'CN-53', n: '中国 · 云南省' }, { k: 'CN-54', n: '中国 · 西藏自治区' },
  { k: 'CN-61', n: '中国 · 陕西省' }, { k: 'CN-62', n: '中国 · 甘肃省' },
  { k: 'CN-63', n: '中国 · 青海省' }, { k: 'CN-64', n: '中国 · 宁夏回族自治区' },
  { k: 'CN-65', n: '中国 · 新疆维吾尔自治区' },
  { k: 'CN-71', n: '中国 · 台湾省' },
  { k: 'CN-91', n: '中国 · 香港特别行政区' },
  { k: 'CN-92', n: '中国 · 澳门特别行政区' },
  { k: 'OTHER', n: '其他 / 海外' },
];

/** 兴趣标签（第 58 条）：按国内社交平台资料页常见分类挑的，够用又好选 */
export const INTERESTS = [
  '阅读', '写作', '电影', '音乐', '摄影', '旅行', '健身', '跑步',
  '游泳', '骑行', '烹饪', '咖啡', '手作', '绘画', '书法', '围棋',
  '游戏', '编程', '设计', '理财', '养花', '宠物', '露营', '钓鱼',
];
