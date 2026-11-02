/*
 * 第 56 条验收：切到英文之后，界面骨架真的变英文了吗？
 *
 * 不走内部 API（浏览器里访问不到 zustand 的 setSetting），而是**真的点设置页**：
 * 设置 → 找到「语言」那一行 → 点 English。和用户手动操作同一条路径。
 *
 * 分三段看：
 *   1) 侧栏导航名：英文下应该一个汉字都没有
 *   2) 顶栏标题：英文下不应残留中文
 *   3) 切回中文：应该完全复原（项数一致、全是中文）
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '57010';
const CJK = /[\u4e00-\u9fa5]/;

async function goSettings(p) {
  await p.evaluate(() => {
    const btn = document.querySelector('.nav button[data-nav="settings"]');
    if (btn) btn.click();
  });
  await p.waitForTimeout(900);
}

/**
 * 设置页是分组的，一次只渲染一组。
 * 「语言」这一行在「界面布局」组里 —— 这一步是按名字猜不出来两次之后
 *（先猜「关于」、再猜「托盘与窗口」，实测 rowCount 都对不上），
 * 最后翻 Settings.tsx 源码才确认它属于 LayoutSection。
 */
async function openLangGroup(p) {
  const ok = await p.evaluate(() => {
    const hit = [...document.querySelectorAll('.snav')].find((e) => (e.textContent || '').includes('界面布局'));
    if (!hit) return false;
    hit.click();
    return true;
  });
  await p.waitForTimeout(800);
  return ok;
}

/** 点「语言」那一行里的某个 chip，按可见文字匹配 */
async function pickLang(p, label) {
  const ok = await p.evaluate((lb) => {
    const rows = [...document.querySelectorAll('.set-row')];
    const row = rows.find((r) => (r.querySelector('.lbl')?.textContent || '').trim().startsWith('语言'));
    if (!row) return false;
    const chip = [...row.querySelectorAll('.chip')].find((c) => (c.textContent || '').trim() === lb);
    if (!chip) return false;
    chip.click();
    return true;
  }, label);
  await p.waitForTimeout(900);
  return ok;
}

const snap = (p) => p.evaluate(() => ({
  nav: [...document.querySelectorAll('.nav button .lb')].map((e) => e.textContent.trim()).filter(Boolean),
  title: document.querySelector('#topbar-slot h2')?.textContent?.trim() || '',
  chips: [...document.querySelectorAll('.set-row .chip')].map((e) => e.textContent.trim()).filter(Boolean),
}));

(async () => {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const p = b.contexts()[0].pages()[0];

  await goSettings(p);
  await openLangGroup(p);
  const zh0 = await snap(p);

  const toEn = await pickLang(p, 'English');
  const en = await snap(p);

  /* 切回中文：语言设置本身也被翻译了，所以要用英文名去找回来 —— 
     但 chip 的显示文字来自 LANGS.n，是固定中文「简体中文」，切到英文也不变 */
  await openLangGroup(p);
  const backZh = await pickLang(p, '简体中文');
  const zh = await snap(p);

  const enNavCJK = en.nav.filter((x) => CJK.test(x));
  const enTitleCJK = CJK.test(en.title);

  console.log(JSON.stringify({
    clickedEnglish: toEn,
    clickedChinese: backZh,
    英文导航: en.nav,
    英文标题: en.title,
    英文里仍是中文的导航项: enNavCJK,
    英文标题有中文: enTitleCJK,
    切回后导航: zh.nav.slice(0, 4),
    pass:
      toEn && backZh &&
      en.nav.length > 0 && en.nav.length === zh0.nav.length &&
      enNavCJK.length === 0 && !enTitleCJK &&
      zh.nav.length === zh0.nav.length && zh.nav.every((x) => CJK.test(x)),
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(2); });