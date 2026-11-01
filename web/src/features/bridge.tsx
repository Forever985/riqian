/**
 * 第 102 条：三个板块的融合。
 *
 * 原话是「感觉有点多且累赘了，功能有重复，进行商议是否需要融合到一起」。
 *
 * 结论：**不合并页面**。倒计时是「数日子」、待办是「要做的事」、番茄钟是
 * 「此刻在干什么」，三件事的读法完全不同 —— 硬塞进一页只会更难用。
 * 真正重复的是**同一条事项被抄了三遍**：想在今天做完一件事，得在待办里写一遍，
 * 到番茄钟里再打一遍任务名，如果它还有个期限，倒计时里再建一条。
 *
 * 所以这里做的是「一份数据，三处引用」：
 *   · 待办 → 开一颗番茄（任务名直接带过去，不用再打一遍）
 *   · 待办 → 建成倒数日（期限已经写在 due 上了，别再手抄）
 *   · 倒计时 → 反过来生成待办（快到期了才想起来要动手）
 *   · 番茄钟 → 直接从待办里挑一条当任务
 *
 * 全是单向的一次性动作，不引入新的关联表 —— 关联表要处理同步、要处理删一边留一边，
 * 维护成本远大于收益。用户想要的是「少打一遍字」，不是「数据模型统一」。
 */
import { api } from '../api';
import { useStore } from '../store';
import { todayKey } from '../lib/date';
import type { Countdown, Todo } from '../types';

/** 把一条待办的标题塞进番茄钟的任务框，然后跳过去。 */
export function startPomoFor(title: string): void {
  const st = useStore.getState();
  st.pomoSetTask(title);
  void st.go('pomodoro');
}

/**
 * 待办 → 倒数日。
 *
 * 日期取 due；没有 due 的给今天（用户点这个动作时心里想的多半就是「就今天」），
 * 这样至少不会生出一条没有日期的坏数据。
 */
export async function todoToCountdown(t: Todo, color = '#b8623a'): Promise<string> {
  const date = t.due || todayKey();
  const r = await api.cd.add({ title: t.title, date, repeat: '', color, note: '' });
  return r.ok ? date : '';
}

/**
 * 倒数日 → 待办。
 *
 * 用 nextDate 而不是原始 date：一条「每年3月6日」的生日，建成待办时
 * 应该是「下一次 3 月 6 日」，不是 1998 年那一次。
 */
export async function countdownToTodo(c: Countdown): Promise<boolean> {
  const due = c.nextDate || c.date || todayKey();
  const r = await api.todos.add({
    title: c.title,
    due,
    priority: 1,
    note: c.note || '',
  });
  return !!r.ok;
}

/* ---------------- 挑一条待办：番茄钟用 ---------------- */

/** 没做完、没放弃、没进回收站的，才值得拿来当「现在要做的事」 */
export function pickableTodos(list: Todo[]): Todo[] {
  const today = todayKey();
  return list
    .filter((t) => !t.done && !t.trashed)
    /* 今天到期的排前面 —— 挑任务的人十有八九是在挑今天的 */
    .sort((a, b) => {
      const ad = a.due === today ? 0 : a.due ? 1 : 2;
      const bd = b.due === today ? 0 : b.due ? 1 : 2;
      if (ad !== bd) return ad - bd;
      return (b.priority || 0) - (a.priority || 0);
    })
    .slice(0, 40);
}