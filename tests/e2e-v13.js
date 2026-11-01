/**
 * v10.4 验收：73 编辑器（切换不丢内容 / 三种语法互转 / 回车分段）
 *
 *   NO_PROXY=127.0.0.1,localhost node e2e-v13.js 57001
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '57001';

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(12000);

  const ok = (n, v, extra = '') => console.log(`${v ? '✅' : '❌'} ${n}${extra ? `（${extra}）` : ''}`);
  const errs = [];
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('CON ' + m.text().slice(0, 150)); });

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 58000 + Math.floor(Math.random() * 9000);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  // 复位：今天改回草稿，且把正文模块切成富文本
  await p.click('.nav button[data-nav="today"]');
  await p.waitForTimeout(900);
  await rpc('entry.publish', { date: today(), published: 0 });
  const mods = await rpc('modules.list', {});
  const rtMod = (mods?.data || []).find((m) => m.type === 'richtext');
  if (rtMod) {
    await rpc('modules.update', { id: rtMod.id, config: { ...(rtMod.config || {}), format: 'rich' } });
  }
  await p.click('.nav button[data-nav="today"]');
  await p.waitForTimeout(1200);

  const rt = p.locator('.rt[contenteditable="true"]').first();
  await rt.click();
  // 清空这一天的正文，避免上一轮残留
  await p.evaluate(() => {
    const el = document.querySelector('.rt[contenteditable="true"]');
    if (el) el.innerHTML = '<p><br></p>';
  });
  await p.keyboard.type('第一行内容', { delay: 40 });
  await p.keyboard.press('Enter');
  await p.keyboard.type('第二行内容', { delay: 40 });
  await p.waitForTimeout(700);

  /* ============ 1. 回车真的分段（不能吞键） ============ */
  const blocks = await p.evaluate(() => document.querySelectorAll('.rt[contenteditable="true"] p').length);
  ok('回车能分段', blocks >= 2, `${blocks} 段`);

  /* ============ 2. 切 Markdown：内容带过去且分段 ============ */
  const fmtBtn = p.locator('.mod-tools button[data-act="toggle-source"]').first();
  await fmtBtn.click();
  await p.waitForTimeout(1600);
  const md = await p.evaluate(() => ((document.querySelector('.md-src') || {}).value || ''));
  ok('切到 Markdown 内容还在', md.includes('第一行内容') && md.includes('第二行内容'), JSON.stringify(md.slice(0, 60)));
  ok('Markdown 里段落用空行分开', /\n\s*\n/.test(md));

  /* ============ 3. 在 Markdown 里补一句，切 BBCode 要带上 ============ */
  const ta = p.locator('textarea.md-src').first();
  await ta.click();
  await p.keyboard.press('End');
  await p.keyboard.type('\n\nMarkdown 补充', { delay: 40 });
  await p.waitForTimeout(1200);

  await fmtBtn.click();
  await p.waitForTimeout(1600);
  const bb = await p.evaluate(() => {
    const t = [...document.querySelectorAll('textarea')].find((x) => (x.value || '').length > 5);
    return t ? t.value : '';
  });
  ok('切到 BBCode 前后内容都在', bb.includes('第一行内容') && bb.includes('Markdown 补充'), JSON.stringify(bb.slice(0, 60)));

  /* ============ 4. 切回富文本：段落、文字都不丢 ============ */
  await fmtBtn.click();
  await p.waitForTimeout(1800);
  const back = await p.evaluate(() => document.querySelector('.rt[contenteditable="true"]')?.innerHTML || '');
  ok('切回富文本内容齐全', /第一行内容/.test(back) && /第二行内容/.test(back) && /Markdown 补充/.test(back));
  const backP = await p.evaluate(() => document.querySelectorAll('.rt[contenteditable="true"] p').length);
  ok('切回后仍然是多段', backP >= 2, `${backP} 段`);

  /* ============ 5. 格式要跟着走一圈：粗体 → ** → [b] → 粗体 ============ */
  // 选中第一段，点工具栏加粗
  await p.evaluate(() => {
    const el = document.querySelector('.rt[contenteditable="true"]');
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el.querySelector('p') || el);
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await p.locator('.mod .toolbar button[data-act="fmt-bold"]').first().click();
  await p.waitForTimeout(600);
  const boldHtml = await p.evaluate(() => document.querySelector('.rt[contenteditable="true"]')?.innerHTML || '');
  ok('工具栏加粗生效', /<b>|<strong>/.test(boldHtml));

  await fmtBtn.click();
  await p.waitForTimeout(1600);
  const md2 = await p.evaluate(() => ((document.querySelector('.md-src') || {}).value || ''));
  ok('加粗在 Markdown 里是 ** 语法', md2.includes('**第一行内容**'), JSON.stringify(md2.slice(0, 60)));

  await fmtBtn.click();
  await p.waitForTimeout(1600);
  const bb2 = await p.evaluate(() => {
    const t = [...document.querySelectorAll('textarea')].find((x) => (x.value || '').length > 5);
    return t ? t.value : '';
  });
  ok('加粗在 BBCode 里是 [b] 语法', bb2.includes('[b]第一行内容[/b]'), JSON.stringify(bb2.slice(0, 60)));

  await fmtBtn.click();
  await p.waitForTimeout(1800);
  const back2 = await p.evaluate(() => document.querySelector('.rt[contenteditable="true"]')?.innerHTML || '');
  ok('转一圈回来加粗还在', /<b>|<strong>/.test(back2) && /第一行内容/.test(back2));

  /* ============ 6. 内容落库（不是只在界面上好看） ============ */
  await p.waitForTimeout(1200);
  const saved = await rpc('entry.get', { date: today() });
  const plain = String(saved?.data?.plain || '');
  ok('正文已落库', plain.includes('第一行内容') && plain.includes('Markdown 补充'), plain.slice(0, 50));

  /* ============ 7. 行内标记当场转换，且不吞掉两边的字 ============ */
  await p.locator('.mod-tools button[data-act="toggle-source"]').first().click();
  await p.waitForTimeout(1500);
  await p.locator('.mod-tools button[data-act="toggle-source"]').first().click();
  await p.waitForTimeout(1500);
  await p.locator('.mod-tools button[data-act="toggle-source"]').first().click();
  await p.waitForTimeout(1600);
  await p.locator('.rt[contenteditable="true"]').first().click();
  await p.keyboard.press('End');
  await p.keyboard.type('\n\n原样 **星号** 保留', { delay: 40 });
  await p.waitForTimeout(700);
  const plainAfter = await p.evaluate(() => (document.querySelector('.rt[contenteditable="true"]')?.innerHTML || '').replace(/\u200b/g, ''));
  ok('行内标记当场转换', /<strong>星号<\/strong>/.test(plainAfter), plainAfter.slice(0, 160));
  ok('转换不吃掉前后的字', /原样/.test(plainAfter) && /保留/.test(plainAfter), plainAfter.slice(0, 160));

  console.log('页面错误:', errs.length ? errs.slice(0, 6) : '无');
  await b.close().catch(() => {});
})().catch((e) => { console.log('FATAL', e.message); process.exit(1); });
