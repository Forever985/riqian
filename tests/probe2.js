/* 探测：笔记页 .nbook 底色 + 记账页新图表是否渲染（#238 / #239） */
const { run } = require('./_probe');

run(async (P) => {
  /* ---------- 笔记页 ---------- */
  P.say('切到笔记页');
  if (!(await P.go('notes'))) return;

  P.say('.nbook 底色（#238）');
  const nb = await P.eval(() => {
    const root = getComputedStyle(document.documentElement);
    const list = [...document.querySelectorAll('.nbook')];
    return {
      数量: list.length,
      主题: document.documentElement.dataset.theme || '(默认)',
      panel: root.getPropertyValue('--panel').trim(),
      ink: root.getPropertyValue('--ink').trim(),
      前三个: list.slice(0, 3).map((x) => ({
        文字: x.innerText.trim().slice(0, 16),
        底色: getComputedStyle(x).backgroundColor,
      })),
    };
  }, null, '.nbook 采样');
  P.out(nb);

  /* ---------- 记账页 ---------- */
  P.say('切到记账页');
  if (!(await P.go('ledger'))) return;

  P.say('新图表渲染情况（#239）');
  const ch = await P.eval(() => {
    const wraps = [...document.querySelectorAll('.lgc-wrap')];
    return {
      svg总数: document.querySelectorAll('svg').length,
      lgc容器数: wraps.length,
      有图例: document.querySelectorAll('.lgc-legend').length,
      有堆叠图: document.querySelectorAll('.lgc-svg').length,
    };
  }, null, '图表采样');
  P.out(ch);

  P.say('展开「看更多图表」后再数一次');
  const more = await P.eval(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      /看更多图表|更多图表/.test(b.innerText || ''),
    );
    if (!btn) return '没有「看更多图表」按钮';
    btn.click();
    return '已点击';
  }, null, '展开按钮');
  P.out(more);

  await P.sleep(900);
  const after = await P.eval(() => ({
    lgc容器数: document.querySelectorAll('.lgc-wrap').length,
    svg总数: document.querySelectorAll('svg').length,
  }), null, '展开后再数');
  P.out(after);
});