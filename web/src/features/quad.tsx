/**
 * 第 101 条：四象限（艾森豪威尔矩阵）的公共部件。
 *
 * 用户原话：「给倒计时、滴答清单、番茄钟增加：紧急且重要，紧急但不重要，
 * 重要但不紧急，既不重要也不紧急」。
 *
 * 为什么抽出来而不是各写一份：
 *   三个模块「重要」和「紧急」的**算法各不相同** ——
 *   · 待办：重要 = 优先级高，紧急 = 今天/明天到期
 *   · 倒计时：重要 = 用户自己标的星，紧急 = 只剩几天
 *   · 番茄钟：没有自己的条目，条目是「接下来做哪件待办」
 *   但**四格的语义、顺序、配色必须完全一致**，否则用户在三个页面看到
 *   两种排法会以为功能不一样。所以这里只抽「怎么画」和「四格是什么」，
 *   算法由各模块自己传进来。
 */

export type QuadKey = 'ui' | 'un' | 'in' | 'nn';

export interface QuadMeta {
  key: QuadKey;
  title: string;
  hint: string;
  color: string;
}

/**
 * 顺序固定成「先做 → 再做 → 安排 → 有空」，不是随意的：
 * 这是艾森豪威尔的经典顺序，也是几乎所有待办软件的顺序。
 * 换顺序会让"记得住第一格是什么"的老用户找不到东西。
 */
export const QUADRANTS: QuadMeta[] = [
  { key: 'ui', title: '紧急且重要', hint: '马上做', color: 'var(--bad)' },
  { key: 'un', title: '紧急不重要', hint: '尽快处理或转交', color: 'var(--warn)' },
  { key: 'in', title: '重要不紧急', hint: '安排时间做', color: 'var(--accent)' },
  { key: 'nn', title: '都不', hint: '有空再说', color: 'var(--ink3)' },
];

/** 两个布尔 → 格子。三个模块都用这一条，保证判定不会各算一套 */
export function quadOf(important: boolean, urgent: boolean): QuadKey {
  if (urgent && important) return 'ui';
  if (urgent) return 'un';
  if (important) return 'in';
  return 'nn';
}

export function quadMeta(key: QuadKey): QuadMeta {
  return QUADRANTS.find((q) => q.key === key) || QUADRANTS[3];
}

/** 待办那边用的说明块（原来是 QuadHint，行为不变，只是挪过来共用一份文案） */
export function QuadHint({ children }: { children?: React.ReactNode }) {
  return (
    <div className="small muted" style={{ lineHeight: 1.8, marginBottom: 10 }}>
      {children || (
        <>
          两个维度都是自动算的：<b>重要</b> = 优先级「高 / 紧急」，<b>紧急</b> = 今天或明天到期。
          <br />
          想换格子不用改优先级 —— 直接把待办<b>拖到</b>那个格子里就行，日期和优先级会跟着调好。
        </>
      )}
    </div>
  );
}