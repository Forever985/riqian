// #148 实测：拼音搜索确实能用。
//
// 关于「新补的 126 字」：那批字只出现在 Settings.tsx 的 JS 注释里，不在可搜文案中
// （cover 核算：全文 787 汉字 / 可搜文案仅 507 汉字）。所以本脚本测的是**真实 label 的拼音**，
// 而不是那批永远不会被搜到的注释字。
const { run } = require('./_probe.js');

const SEL = '.topbar .searchbox input';

run(async (P) => {
  P.say('进设置页');
  if (!(await P.go('settings'))) return;
  await P.sleep(700);

  const ready = await P.eval((sel) => !!document.querySelector(sel), SEL, '确认搜索框');
  if (!ready) { console.log('  ✗ 没有搜索框'); process.exitCode = 1; return; }

  async function search(q) {
    return P.eval(({ sel, q }) => {
      const inp = document.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, q);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise((res) => setTimeout(() => {
        const rows = [...document.querySelectorAll('.set-row[data-fs]')];
        const vis = rows.filter((e) => e.offsetParent !== null);
        res({
          n: vis.length,
          best: vis.filter((e) => e.getAttribute('data-fs') === '1').length,
          top: vis.slice(0, 3).map((e) => ({
            fs: e.getAttribute('data-fs'),
            t: ((e.querySelector('.lbl')?.firstChild?.textContent) || '').trim().slice(0, 14),
          })),
        });
      }, 340));
    }, { sel: SEL, q }, `搜 ${q}`);
  }

  // 先把搜索框清空，确认基线
  const idle = await P.eval(() => ({
    rows: document.querySelectorAll('.set-row').length,
    tagged: document.querySelectorAll('.set-row[data-fs]').length,
  }), null, '基线');
  console.log('  基线：' + JSON.stringify(idle) + '（tagged 应为 0，证明只有搜索时才打标）');

  P.say('逐条搜：前 4 条是拼音/首字母，后 2 条是中文原字对照');
  const cases = [
    ['zihao', '全拼 → 字号'],
    ['zhuti', '全拼 → 主题/配色'],
    ['dhkd', '首字母 → 导航宽度'],
    ['nianyueri', '全拼 → 年月日顺序'],
    ['字号', '中文原字（回归）'],
    ['宽度', '中文部分匹配（回归）'],
  ];

  const rows = [];
  for (const [q, why] of cases) {
    const r = await search(q);
    rows.push({
      搜: q, 说明: why, 可见行: r.n, 完全匹配: r.best,
      首条: r.top[0] ? `${r.top[0].t}(fs=${r.top[0].fs})` : '',
    });
  }
  await search('');

  console.log('\n=== 结果 ===');
  console.table(rows);

  const bad = rows.filter((r) => !r.可见行);
  if (bad.length) {
    console.log('\n✗ FAIL：' + bad.map((r) => r.搜).join('、') + ' 无命中');
    process.exitCode = 1;
  } else {
    console.log('\n✓ PASS：' + rows.length + ' 种搜法全部有命中');
  }
});