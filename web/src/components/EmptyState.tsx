import type { CSSProperties, ReactNode } from 'react';

/**
 * 空态占位。
 *
 * 为什么要做成组件，而不是继续写 `<div className="empty">`：
 *
 * 全项目有一百多处「这里暂时没内容」，写出来都是一个无语义的 div。
 * 更麻烦的是其中八处用内联 style 各自打补丁 —— 有的要跨满网格、有的要居中变灰，
 * 于是同一个「空态」在不同页面上有四种长相。改一次样式要翻遍所有文件找那八处补丁。
 *
 * 收成一个组件后，这几种差异变成三个明确属性：
 *   - grid   ：放在 CSS Grid 里要跨满整行（否则空态只占第一格，看着像漏渲染）
 *   - center ：内容少、想让它居中变成一块"提示牌"（字体选择器、插件面板这类弹层里用）
 *   - small  ：卡片内部的小空态，内边距要收一点，否则卡片被撑得很空
 *
 * className 始终保持 `empty` / `empty small` 两个类名不变 —— 样式表里那些
 * `.card > .empty`、`.empty + .empty` 的选择器都还依赖它们，不能改。
 */
export function EmptyState({
  children, small, grid, center, style,
}: {
  children: ReactNode;
  /** 卡片内部的小空态：内边距收窄 */
  small?: boolean;
  /** 在 grid 容器里跨满整行 */
  grid?: boolean;
  /** 居中 + 变淡，用于弹层里那类"一句话提示牌" */
  center?: boolean;
  /** 极少数确实需要额外微调的地方。优先用上面三个属性，别默认走这个 */
  style?: CSSProperties;
}) {
  const merged: CSSProperties = {
    ...(grid ? { gridColumn: '1/-1' } : null),
    ...(center ? { padding: '24px 0', textAlign: 'center' as const, opacity: 0.7 } : null),
    ...style,
  };

  return (
    <div className={`empty${small ? ' small' : ''}`} style={Object.keys(merged).length ? merged : undefined}>
      {children}
    </div>
  );
}