/**
 * 圆形色板选择器。
 *
 * 原来这段 `<span>` 在 6 个地方各写了一遍（笔记本颜色、笔记标记色、分类色、
 * 清单色、习惯色……），每处 8 行内联样式。问题是它们已经开始各自漂移了：
 * 有的带 `title`、有的不带；有的写了 `boxSizing: 'border-box'`、有的漏了；
 * 尺寸有 24 也有 20。漂移本身说明"这不是同一个东西被复制"，而是
 * "同一个东西被反复重新发明"。
 *
 * 抽出来时**保留每个变体**，不做统一 —— 统一会改变现有视觉，
 * 那是改设计，不是精简。
 */
import type { CSSProperties } from 'react';

export function ColorDots({
  colors, value, onPick, size = 24, title, boxSizing,
}: {
  colors: readonly string[];
  value: string;
  onPick: (c: string) => void;
  /** 直径，默认 24。分类色板用过 20 */
  size?: number;
  /** 传 true 时鼠标悬停显示色值；有些位置不需要（比如弹窗里空间紧张） */
  title?: boolean;
  /** 少数位置需要 border-box，保持与原来一致 */
  boxSizing?: boolean;
}) {
  const styleOf = (c: string): CSSProperties => ({
    width: size,
    height: size,
    borderRadius: '50%',
    background: c,
    cursor: 'pointer',
    // 选中态用 ink 描边而不是加粗 —— 加粗会让色块挤动
    border: `2px solid ${value === c ? 'var(--ink)' : 'transparent'}`,
    ...(boxSizing ? { boxSizing: 'border-box' as const } : null),
  });

  return (
    <div className="row" style={{ gap: 7 }}>
      {colors.map((c) => (
        <span
          key={c}
          onClick={() => onPick(c)}
          title={title ? c : undefined}
          style={styleOf(c)}
        />
      ))}
    </div>
  );
}