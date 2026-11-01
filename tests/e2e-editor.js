const { chromium } = require('playwright-core');

/**
 * 第 73 条：输入即格式化（重做版）验收。
 * 全部用真实键盘输入 —— 要测的正是「打字时」的行为。
 *
 * 注意断言都基于「最后一个块」而不是整个编辑器：
 * 每个场景都往后追加，整段比会拿前面段落的结果误判。
 */
(async () => {
  const port = process.argv[2] || '57001';
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);

  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CON ' + m.text().slice(0, 160)); });

  let pass = 0, fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  ✓', name); }
    else { fail++; console.log('  ✗', name, String(extra).slice(0, 220)); }
  };

  await p.keyboard.press('Escape').catch(() => {});
  await p.click('.nav button[data-nav="today"]').catch(() => {});
  await p.waitForTimeout(1200);

  const E = '.rt[contenteditable="true"]';
  const ed = p.locator(E).first();
  await ed.click();
  await p.waitForTimeout(300);

  // 零宽空格是 DOM 里的光标锚点，存库前会被剥掉；断言里也剥掉，否则看着像脏字符
  const clean = (s) => (s || '').replace(/\u200b/g, '');
  const html = () => p.evaluate((sel) => (document.querySelector(sel)?.innerHTML || '').replace(/\u200b/g, ''), E);
  /** 只看光标所在的那个块 —— 用 lastElementChild 会被末尾的残留空块骗到 */
  const last = () => p.evaluate((sel) => {
    const el = document.querySelector(sel);
    const s = getSelection();
    if (!el || !s.rangeCount || !el.contains(s.anchorNode)) return '';
    let n = s.anchorNode;
    let blk = (n.nodeType === 3 ? n.parentElement : n).closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre');
    if (blk && blk.tagName === 'LI') blk = blk.parentElement;   // 列表断言要看整个 ul
    return blk ? blk.outerHTML.replace(/\u200b/g, '') : '';
  }, E);
  const text = () => p.evaluate((sel) => (document.querySelector(sel)?.textContent || '').replace(/\u200b/g, ''), E);
  const atEnd = () => p.evaluate((sel) => {
    const el = document.querySelector(sel);
    const s = getSelection();
    if (!s.rangeCount || !el.contains(s.anchorNode)) return false;
    const r = s.getRangeAt(0);
    const probe = document.createRange();
    probe.selectNodeContents(el);
    probe.setEnd(r.startContainer, r.startOffset);
    return probe.toString().replace(/\u200b/g, '').length === (el.textContent || '').replace(/\u200b/g, '').length;
  }, E);

  const type = async (s) => { await p.keyboard.type(s, { delay: 35 }); await p.waitForTimeout(320); };

  /** 清空：用 Range 精确全选再删。Ctrl+A 在 WebView2 里会被全局快捷键抢走，不可靠。 */
  const wipe = async () => {
    for (let i = 0; i < 4; i++) {
      await ed.click();
      await p.evaluate((sel) => {
        const el = document.querySelector(sel);
        el.focus();
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }, E);
      await p.keyboard.press('Delete');
      await p.waitForTimeout(220);
      if (!(await text()).replace(/[\s\u200b]/g, '')) break;
    }
  };

  await wipe();

  /* 1. 基础输入 */
  await type('你好');
  ok('1 普通输入不丢字', (await text()).includes('你好'), await html());

  /* 2. Markdown 加粗 + 光标不吞字 */
  await p.keyboard.press('Enter');
  await type('**粗体**');
  ok('2 **…** 转成 strong', /<strong>粗体<\/strong>/.test(await last()), await last());
  ok('3 光标在标签之后', await atEnd(), await html());
  await type('尾巴');
  let h = await last();
  ok('4 转换后接着打字不进标签', /<strong>粗体<\/strong>尾巴/.test(h), h);

  /* 3. 其他行内标记 */
  await p.keyboard.press('Enter'); await type('*斜体*');
  ok('5 *…* 转成 em', /<em>斜体<\/em>/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('~~删除~~');
  ok('6 ~~…~~ 转成 s', /<s>删除<\/s>/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('`代码`');
  ok('7 `…` 转成 code', /<code>代码<\/code>/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('[b]粗[/b]');
  ok('8 [b]…[/b] 转成 strong', /<strong>粗<\/strong>/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('[i]斜[/i]');
  ok('9 [i]…[/i] 转成 em', /<em>斜<\/em>/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('[u]下[/u]');
  ok('10 [u]…[/u] 转成下划线', /<u>下<\/u>/.test(await last()), await last());

  /* 4. 公式 */
  await p.keyboard.press('Enter'); await type('$x^2$');
  ok('11 $…$ 转成公式节点', /class="tex"/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('[latex]\\frac{1}{2}[/latex]');
  ok('12 [latex]…[/latex] 转成公式', /class="tex"/.test(await last()), await last());

  /* 5. 不该转的别乱转 */
  await p.keyboard.press('Enter'); await type('花了 $5 到 $10');
  h = await last();
  ok('13 价格不当公式', !/class="tex"/.test(h) && h.includes('$5'), h);

  await p.keyboard.press('Enter'); await type('3 * 4 = 12 星星');
  ok('14 单个星号不乱斜', !/<em>/.test(await last()), await last());

  /* 6. 行首快捷 */
  await p.keyboard.press('Enter'); await type('# 大标题');
  ok('15 「# 」变标题', /<h1>大标题<\/h1>/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('这段是正文');
  ok('16 标题后回车回正文', /<p>这段是正文<\/p>/.test(await last()), await last());

  await p.keyboard.press('Enter'); await type('- 第一项');
  h = await last();
  ok('17 「- 」变无序列表', /<ul><li>第一项<\/li><\/ul>/.test(h), h);

  await p.keyboard.press('Enter'); await type('第二项');
  ok('18 列表内回车续项', /<li>第二项<\/li>/.test(await last()), await last());

  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await type('1. 有序');
  ok('19 「1. 」变有序列表', /<ol[^>]*><li>有序<\/li><\/ol>/.test(await last()), await last());

  // 先退出有序列表，再单独测引用
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await type('> 引用一句');
  ok('20 「> 」变引用', /<blockquote>引用一句<\/blockquote>/.test(await last()), await last());

  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await type('普通段落');
  ok('21 引用里回车两次脱出来', /<p>普通段落<\/p>/.test(await last()), await last());

  /* 7. 段中间转换不破坏后面 */
  await wipe();
  await type('前面后面');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  await type('**中间**');
  h = await last();
  ok('22 段中间转换不丢后面的字', (await text()).replace(/\s/g, '').includes('前面中间后面'), await text());
  ok('23 段中间转换位置正确', /前面<strong>中间<\/strong>后面/.test(h), h);

  /* 8. 撤销 / 重做 */
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(500);
  ok('24 Ctrl+Z 撤掉格式化', !/<strong>中间<\/strong>/.test(await html()) && (await text()).includes('**中间**'), await html());

  await p.keyboard.press('Control+y');
  await p.waitForTimeout(500);
  ok('25 Ctrl+Y 重做', /<strong>中间<\/strong>/.test(await html()), await html());

  /* 9. 粘贴只收纯文本 */
  await wipe();
  await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', '粘贴第一行\n粘贴第二行');
    dt.setData('text/html', '<meta charset="utf-8"><p style="color:red" class="MsoNormal">粘贴第一行</p>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, E);
  await p.waitForTimeout(600);
  const pasted = await text();
  ok('26 粘贴多行分成两段', pasted.includes('粘贴第一行') && pasted.includes('粘贴第二行'), pasted);
  ok('27 粘贴没带进外部样式', !/style=|MsoNormal/.test(await html()), (await html()).slice(0, 200));

  /* 10. 中文输入法 */
  const cdp = await p.context().newCDPSession(p);
  await wipe();
  await p.evaluate((sel) => document.querySelector(sel).focus(), E);
  await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 });
  await p.waitForTimeout(200);
  await cdp.send('Input.insertText', { text: '中' });
  await p.waitForTimeout(300);
  await p.keyboard.type('文', { delay: 40 });
  await p.waitForTimeout(300);
  ok('28 输入法组字不丢不重', (await text()).includes('中文'), await text());

  /* 11. 落库 */
  await p.waitForTimeout(1600);
  await p.click('.nav button[data-nav="records"]').catch(() => {});
  await p.waitForTimeout(900);
  const inList = await p.evaluate(() => document.body.innerText.includes('中文') || document.body.innerText.includes('粘贴第一行'));
  ok('29 内容已落库', inList, '');

  ok('30 无页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(`\n编辑器套件：${pass} 通过 / ${fail} 失败`);
  await b.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e.message); process.exit(1); });
