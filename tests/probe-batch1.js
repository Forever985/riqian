/**
 * 验证本轮已做批次：#5 折叠悬停、#8/#130 番茄自定义区间、#83 待办左栏拖动、
 * #86b 计时器预设、#21 节日提醒设置项。
 * 一步一件事，每步都打印。
 */
const { run } = require('./_probe');

run(async (P) => {
  // ---------- #86b 计时器预设 ----------
  P.say('#86b 去番茄页找计时器预设');
  if (!(await P.go('pomodoro'))) return;
  P.say('切到倒计时，看预设按钮');
  P.out(await P.eval(() => {
    const btns = [...document.querySelectorAll('[data-timer]')];
    const down = btns.find((b) => b.getAttribute('data-timer') === 'down');
    if (!down) return { err: '没找到倒计时按钮' };
    down.click();
    return { clicked: true };
  }));
  await P.sleep(600);
  P.out(await P.eval(() => {
    const ps = [...document.querySelectorAll('[data-timer-preset]')].map((b) => b.textContent.trim());
    return { 预设按钮: ps };
  }));

  // ---------- #8/#130 自定义区间 ----------
  P.say('#8/#130 统计区间的「自定义」按钮在不在');
  P.out(await P.eval(() => {
    const segs = [...document.querySelectorAll('.seg-b')].map((b) => b.textContent.trim());
    return { 区间按钮: segs };
  }));

  P.say('点「自定义」，看是否有两个日期框');
  P.out(await P.eval(() => {
    const b = [...document.querySelectorAll('.seg-b')].find((x) => x.textContent.includes('自定义'));
    if (!b) return { err: '没有自定义按钮' };
    b.click();
    return { clicked: true };
  }));
  await P.sleep(700);
  P.out(await P.eval(() => {
    const ds = [...document.querySelectorAll('input[type="date"]')].map((i) => i.value);
    return { 日期框数量: ds.length, 值: ds };
  }));

  // ---------- #83 待办左栏拖动 ----------
  P.say('#83 去待办页看左栏拖拽把手');
  if (!(await P.go('todos'))) return;
  P.out(await P.eval(() => {
    const g = document.querySelector('.todo-rail-grip');
    const rail = document.querySelector('.todo-stack .rail');
    return {
      有把手: !!g,
      左栏宽度: rail ? getComputedStyle(rail).width : null,
      '--railw': getComputedStyle(document.documentElement).getPropertyValue('--railw').trim(),
    };
  }));

  // ---------- #5 折叠悬停 ----------
  P.say('#5 检查 app 上的 data-hover-expand');
  P.out(await P.eval(() => {
    const app = document.getElementById('app');
    return {
      'data-hover-expand': app?.getAttribute('data-hover-expand'),
      'data-rail-drag': app?.getAttribute('data-rail-drag'),
      折叠中: app?.classList.contains('nav-collapsed'),
    };
  }));
});