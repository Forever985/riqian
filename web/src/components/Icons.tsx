/** 统一的线性图标集（16px 视口，stroke 跟随文字色，不引第三方图标库） */
import { useMemo, type ReactElement } from 'react';
import { useStore } from '../store';
import { ICON_BODY, ICON_VIEWBOX, type IconSetKey } from './iconData';

type IconName =
  | 'pen' | 'flow' | 'check-circle' | 'timer' | 'calendar' | 'search'
  | 'todo' | 'hourglass' | 'chart' | 'sliders' | 'plus' | 'x' | 'trash'
  | 'star' | 'star-on' | 'image' | 'folder' | 'refresh' | 'grip' | 'play'
  | 'pause' | 'reset' | 'left' | 'right' | 'note' | 'inbox' | 'archive'
  | 'list' | 'sparkle' | 'clock' | 'moon' | 'tag'
  | 'user' | 'lock' | 'unlock' | 'music' | 'database' | 'bell' | 'palette'
  | 'shield' | 'book' | 'pin' | 'link' | 'volume' | 'mute' | 'external' | 'filter'
  | 'download' | 'share' | 'key' | 'monitor' | 'eye-off' | 'question' | 'grid'
  | 'up' | 'down' | 'expand' | 'shrink';

export const ICON_PATHS: Record<IconName, ReactElement> = {
  pen: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" /></>,
  flow: <><path d="M4 7h16" /><path d="M4 12h11" /><path d="M4 17h7" /></>,
  'check-circle': <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.4 2.4 4.6-5" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.4 1.6" /><path d="M9 2.5h6" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17" /><path d="M8 3v4M16 3v4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  todo: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 5.5l1.4 1.4L7.8 4.5" /><path d="M4 11.5l1.4 1.4L7.8 10.5" /><path d="M4 17.5l1.4 1.4L7.8 16.5" /></>,
  hourglass: <><path d="M7 3h10" /><path d="M7 21h10" /><path d="M8 3c0 4 8 5 8 9s-8 5-8 9" /><path d="M16 3c0 4-8 5-8 9s8 5 8 9" /></>,
  chart: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  sliders: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="7" cy="17" r="2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  star: <><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" /></>,
  'star-on': <><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" fill="currentColor" /></>,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="M4.5 17l4.6-4.4 3.2 3 2.6-2.3 4.1 3.9" /></>,
  folder: <><path d="M3.5 7.5A2 2 0 015.5 5.5h3.6l1.8 2h7.6a2 2 0 012 2v7a2 2 0 01-2 2h-13a2 2 0 01-2-2z" /></>,
  refresh: <><path d="M20 11a8 8 0 10-2.6 6" /><path d="M20 5v6h-6" /></>,
  grip: <><circle cx="9" cy="6" r="1.2" fill="currentColor" /><circle cx="15" cy="6" r="1.2" fill="currentColor" /><circle cx="9" cy="12" r="1.2" fill="currentColor" /><circle cx="15" cy="12" r="1.2" fill="currentColor" /><circle cx="9" cy="18" r="1.2" fill="currentColor" /><circle cx="15" cy="18" r="1.2" fill="currentColor" /></>,
  play: <><path d="M8 5.5l11 6.5-11 6.5z" /></>,
  pause: <><path d="M9 5v14M15 5v14" strokeWidth={2.6} /></>,
  reset: <><path d="M4 12a8 8 0 108-8" /><path d="M4 4v5h5" /></>,
  left: <><path d="M14 6l-6 6 6 6" /></>,
  up: <><path d="M6 14l6-6 6 6" /></>,
  down: <><path d="M6 10l6 6 6-6" /></>,
  /* 专注写：中间一条竖线，两侧箭头往外张 —— 把编辑区铺满的意思 */
  expand: <><path d="M4 5v14" /><path d="M20 5v14" /><path d="M10 8l-3 4 3 4" /><path d="M14 8l3 4-3 4" /></>,
  /* 退出专注：箭头朝内收拢 */
  shrink: <><path d="M4 5v14" /><path d="M20 5v14" /><path d="M7 8l3 4-3 4" /><path d="M17 8l-3 4 3 4" /></>,
  right: <><path d="M10 6l6 6-6 6" /></>,
  note: <><path d="M5 4.5h11l3 3v12H5z" /><path d="M8.5 10h7M8.5 14h5" /></>,
  inbox: <><path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" /><path d="M5.5 5h13l1 8.5v5a1.5 1.5 0 01-1.5 1.5h-12A1.5 1.5 0 014.5 18v-5z" /></>,
  archive: <><rect x="3.5" y="5" width="17" height="4" rx="1.2" /><path d="M5 9v9.5h14V9" /><path d="M10 13h4" /></>,
  list: <><rect x="4" y="4.5" width="16" height="15" rx="2.5" /><path d="M8 9.5h8M8 14h5" /></>,
  sparkle: <><path d="M12 4l1.8 4.6L18.5 10l-4.7 1.4L12 16l-1.8-4.6L5.5 10l4.7-1.4z" /><path d="M18 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></>,
  moon: <><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" /></>,
  tag: <><path d="M11 3.5H5.5A2 2 0 003.5 5.5V11l9.5 9.5 7.5-7.5z" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20c.9-3.9 3.8-6 7.2-6s6.3 2.1 7.2 6" /></>,
  lock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2.2" /><path d="M8 10V7.8a4 4 0 018 0V10" /><circle cx="12" cy="15.2" r="1.3" fill="currentColor" /></>,
  unlock: <><rect x="4.5" y="10" width="15" height="10.5" rx="2.2" /><path d="M8 10V7.8a4 4 0 017.5-1.9" /><circle cx="12" cy="15.2" r="1.3" fill="currentColor" /></>,
  music: <><path d="M9 18V6.5l10-2V16" /><circle cx="6.5" cy="18" r="2.6" /><circle cx="16.5" cy="16" r="2.6" /></>,
  database: <><ellipse cx="12" cy="6" rx="7.5" ry="3" /><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" /><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" /></>,
  bell: <><path d="M6.5 10a5.5 5.5 0 0111 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z" /><path d="M10 19a2 2 0 004 0" /></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 000 17c1.5 0 2-1 2-2s-.8-1.6-.8-2.4c0-1 .8-1.6 1.9-1.6H17a4 4 0 004-4c0-3.9-4-7-9-7z" /><circle cx="8" cy="9" r="1.2" fill="currentColor" /><circle cx="12" cy="7" r="1.2" fill="currentColor" /><circle cx="7" cy="13.5" r="1.2" fill="currentColor" /></>,
  shield: <><path d="M12 3l7 2.6v5.6c0 4.4-3 7.9-7 9.8-4-1.9-7-5.4-7-9.8V5.6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>,
  book: <><path d="M4.5 5.5A1.5 1.5 0 016 4h13v15.5H6A1.5 1.5 0 004.5 21z" /><path d="M4.5 18.5A1.5 1.5 0 016 17h13" /><path d="M8 8h7M8 11.5h5" /></>,
  pin: <><path d="M9 4h6l-.8 5.2 3 3.3H6.8l3-3.3z" /><path d="M12 12.5V20" /></>,
  link: <><path d="M10 13.5a3.5 3.5 0 010-5l2-2a3.5 3.5 0 015 5l-1 1" /><path d="M14 10.5a3.5 3.5 0 010 5l-2 2a3.5 3.5 0 01-5-5l1-1" /></>,
  volume: <><path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" /><path d="M15 9a4 4 0 010 6" /><path d="M17.5 6.5a7.5 7.5 0 010 11" /></>,
  mute: <><path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" /><path d="M15 10l4 4M19 10l-4 4" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4l-8.5 8.5" /><path d="M18 14v4.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" /></>,
  filter: <><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></>,
  download: <><path d="M12 4v10" /><path d="M8 10.5l4 4 4-4" /><path d="M4.5 19.5h15" /></>,
  share: <><circle cx="17.5" cy="6" r="2.6" /><circle cx="6.5" cy="12" r="2.6" /><circle cx="17.5" cy="18" r="2.6" /><path d="M8.8 10.7l6.4-3.4" /><path d="M8.8 13.3l6.4 3.4" /></>,
  key: <><circle cx="8" cy="12" r="3.6" /><path d="M11.6 12H21" /><path d="M17.5 12v3.2" /><path d="M20 12v2.2" /></>,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6" /><path d="M12 16.5V20" /></>,
  'eye-off': <><path d="M4 4l16 16" /><path d="M9.9 5.2A9.6 9.6 0 0112 5c5 0 9 4.4 9 7 0 1-.7 2.3-1.9 3.5" /><path d="M6.3 7.4C4.9 8.6 3.6 10.2 3 12c0 2.6 4 7 9 7 1.3 0 2.5-.3 3.6-.8" /></>,
  question: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 114 2.3c-.9.6-1.6 1.1-1.6 2.3" /><circle cx="12" cy="17" r="1" fill="currentColor" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.6" /><rect x="13" y="4" width="7" height="7" rx="1.6" /><rect x="4" y="13" width="7" height="7" rx="1.6" /><rect x="13" y="13" width="7" height="7" rx="1.6" /></>,
};

export function Icon({
  name, size = 16, className = '', strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  /**
   * 第 88 条：图标集可换。四套图标都由 iconData 内联提供（蚂蚁 / Tabler / Material / Lucide），
   * body 里自带 fill/stroke，所以这里只负责给 viewBox 和尺寸。
   * 取不到就回落到手绘那套 —— 换风格不该让某个图标变成空白。
   */
  const set = useStore((s) => (s.settings.iconSet || 'riqian') as IconSetKey);
  /**
   * 第 88 条：用户导入的自定义图标组。
   *
   * 存的形状：settings.iconCustom = JSON { name, viewBox, icons: { 语义名: 'path d 或整段 svg 内层' } }
   * 用 settings 而不是新建表 —— 一份图标组就是一小段 JSON，
   * 为它单开一张表、加一套增删改 RPC，收益不抵复杂度。
   *
   * 优先级最高：用户导入了就是想要它生效，不该被内置风格压住。
   * 某个图标没在自定义组里，回落到内置那套，不会出现空白。
   */
  const custom = useStore((s) => s.settings.iconCustom as string | undefined);
  const customSet = useMemo(() => {
    // 不管当前选的是哪一套都解析 —— 用户明确改过的那几枚就该一直生效，
    // 否则「自定义某个 icon」会变成「必须先切到 custom 才有效」，等于白改
    if (!custom) return null;
    try {
      const o = JSON.parse(custom) as { viewBox?: string; icons?: Record<string, string> };
      return { viewBox: o.viewBox || '0 0 24 24', icons: o.icons || {} };
    } catch { return null; }
  }, [custom]);

  const ext = set === 'riqian' ? null : set;
  // 自定义组先查，查不到再回落到内置
  const customBody = customSet?.icons?.[name] || '';
  const body = customBody || (ext && ext !== 'custom' ? ICON_BODY[ext as Exclude<IconSetKey, 'riqian' | 'custom'>]?.[name] : '');

  if (customBody && customSet) {
    return (
      <svg
        className={`ico-svg ${className}`}
        width={size}
        height={size}
        viewBox={customSet.viewBox}
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: customBody }}
      />
    );
  }

  if (ext && ext !== 'custom' && body) {
    return (
      <svg
        className={`ico-svg ${className}`}
        width={size}
        height={size}
        viewBox={ICON_VIEWBOX[ext as Exclude<IconSetKey, 'riqian' | 'custom'>]}
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: body }}
      />
    );
  }

  return (
    <svg
      className={`ico-svg ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export type { IconName };
