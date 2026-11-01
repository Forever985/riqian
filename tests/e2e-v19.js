/* e2e-v19：145 倒计时 编辑 / 拖动排序 / 回收站 */
const { chromium } = require('playwright-core');

let pass = 0; const fails = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:57001');
  const p = b.contexts()[0].pages()[0];
  p.setDefaultTimeout(15000);
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const rpc = (m, a) => p.evaluate(([mm, aa]) => new Promise((res) => {
    const id = 63000 + Math.floor(Math.random() * 900);
    const h = (e) => { if (e.data && e.data.id === id) { window.chrome.webview.removeEventListener('message', h); res(e.data); } };
    window.chrome.webview.addEventListener('message', h);
    window.chrome.webview.postMessage({ id, m: mm, a: aa || {} });
  }), [m, a]);

  const go = async (k) => {
    await p.keyboard.press('Escape').catch(() => {});
    await p.evaluate((kk) => { const b2 = document.querySelector(`.nav button[data-nav="${kk}"]`); if (b2) b2.click(); }, k);
    await p.waitForTimeout(1300);
  };

  // 先清掉以前跑剩下的，避免按前缀选卡片选错（踩过一次）
  for (const x of ((await rpc('cd.list', {}))?.data || [])) {
    if ((x.title || '').startsWith('v19')) await rpc('cd.delete', { id: x.id });
  }
  for (const x of ((await rpc('cd.trash', {}))?.data || [])) {
    if ((x.title || '').startsWith('v19')) await rpc('cd.purge', { id: x.id });
  }

  const mk = 'v19' + Date.now().toString().slice(-4);
  // 造三条，日期错开，方便验证拖动后顺序不被日期重排
  for (const [i, d] of ['2026-12-01', '2026-11-20', '2026-11-05'].entries()) {
    await rpc('cd.add', { title: `${mk}-${i}`, date: d, repeat: '', color: '#b8623a', note: '' });
  }

  console.log('\n=== 145 倒计时 ===');
  /*
   * 必须先离开再回来：如果本来就停在这一页，点同一个导航不会重挂组件，
   * 列表还是改动前的旧数据（一开始就是这么把自己坑了）。
   */
  await go('today');
  await go('countdown');
  await p.waitForTimeout(600);

  const titles = () => p.evaluate(() => [...document.querySelectorAll('.cd-grid .cd')]
    .filter((x) => !x.classList.contains('past'))
    .map((x) => (x.querySelector('.t')?.textContent || '').trim()));

  const t0 = await titles();
  ok('145-1 新建的都在列表里', t0.filter((t) => t.startsWith(mk)).length === 3, t0.slice(0, 6).join('/'));

  // 编辑：把第一条改个名字 + 加备注
  const edited = await p.evaluate((target) => {
    const card = [...document.querySelectorAll('.cd-grid .cd')]
      .find((x) => (x.querySelector('.t')?.textContent || '').trim() === target);
    const btn = card?.querySelector('.cd-acts .x');
    if (btn) { btn.click(); return true; }
    return false;
  }, `${mk}-0`);
  await p.waitForTimeout(700);
  const dlgOpen = await p.evaluate(() => !!document.querySelector('.mask .dlg'));
  ok('145-2 点铅笔能打开编辑弹层', edited && dlgOpen);

  if (dlgOpen) {
    await p.evaluate(() => {
      const inp = document.querySelector('.dlg .field input.inp');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(inp, 'v19改过的名字');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const ta = document.querySelector('.dlg textarea');
      const ts = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      ts?.call(ta, '备注也改了');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('.dlg button')].find((x) => (x.innerText || '').includes('保存'));
      if (btn) btn.click();
    });
    await p.waitForTimeout(1400);
    const after = await titles();
    ok('145-3 改名保存生效', after.includes('v19改过的名字'), after.slice(0, 6).join('/'));
    const noteShown = await p.evaluate(() => [...document.querySelectorAll('.cd-note')].some((x) => (x.innerText || '').includes('备注也改了')));
    ok('145-4 备注显示在卡片上', noteShown);
  } else {
    ok('145-3 改名保存生效', false, '弹层没开');
    ok('145-4 备注显示在卡片上', false, '弹层没开');
  }

  // 拖动：把第一条拖到第三条位置，顺序应变化且刷新后保持
  const before = await titles();
  const moved = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.cd-grid')][0]?.querySelectorAll('.cd');
    if (!rows || rows.length < 3) return false;
    const dt = new DataTransfer();
    rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    rows[2].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    rows[2].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    rows[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
  });
  await p.waitForTimeout(1800);
  const afterDrag = await titles();
  ok('145-5 拖动换位置', moved && JSON.stringify(before) !== JSON.stringify(afterDrag),
    `${before.slice(0, 3).join('/')} → ${afterDrag.slice(0, 3).join('/')}`);

  // 刷新后顺序还在（说明存了 sort，而不是被日期重排）
  await go('today');
  await go('countdown');
  const afterReload = await titles();
  ok('145-6 刷新后顺序保持', JSON.stringify(afterReload) === JSON.stringify(afterDrag),
    afterReload.slice(0, 3).join('/'));

  // 删除 → 进回收站
  const delOne = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.cd-grid .cd')].find((x) => (x.querySelector('.t')?.textContent || '').trim() === 'v19改过的名字');
    const btn = card?.querySelectorAll('.cd-acts .x')[1];
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(1500);
  const trashInfo = await p.evaluate(() => ({
    hasTrash: !!document.querySelector('.cd-trash-h'),
    head: document.querySelector('.cd-trash-h')?.innerText.replace(/\s+/g, ' ') || '',
  }));
  ok('145-7 删除后出现在回收站', delOne && trashInfo.hasTrash, JSON.stringify(trashInfo));

  // 展开 → 恢复
  await p.evaluate(() => {
    if (!document.querySelector('.cd-trash-row')) document.querySelector('.cd-trash-h')?.click();
  });
  await p.waitForTimeout(600);
  const restored = await p.evaluate(() => {
    const row = document.querySelector('.cd-trash-row');
    if (!row) return false;
    const btn = [...row.querySelectorAll('button')].find((x) => (x.innerText || '').includes('恢复'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  await p.waitForTimeout(1500);
  const backInList = await p.evaluate(() => [...document.querySelectorAll('.cd-grid .cd .t')].some((x) => (x.textContent || '').includes('v19')));
  ok('145-8 从回收站能恢复回来', restored && backInList, `restored=${restored} back=${backInList}`);

  // 彻底删除
  await p.evaluate(() => {
    const card = [...document.querySelectorAll('.cd-grid .cd')].find((x) => (x.querySelector('.t')?.textContent || '').trim() === 'v19改过的名字');
    const btn = card?.querySelectorAll('.cd-acts .x')[1];
    if (btn) btn.click();
  });
  await p.waitForTimeout(1400);
  await p.evaluate(() => {
    // 已经展开的话再点一下会收起来
    if (!document.querySelector('.cd-trash-row')) document.querySelector('.cd-trash-h')?.click();
  });
  await p.waitForTimeout(600);
  const purgedTitle = await p.evaluate(() => {
    const row = document.querySelector('.cd-trash-row');
    const t = row?.querySelector('.n')?.textContent || '';
    const btn = row && [...row.querySelectorAll('button')].find((x) => (x.innerText || '').includes('彻底删除'));
    if (btn) { btn.click(); return t; }
    return '';
  });
  await p.waitForTimeout(1500);
  const purged = (await rpc('cd.trash', {}))?.data || [];
  ok('145-9 彻底删除后真的没了', !!purgedTitle && !purged.some((x) => (x.title || '') === purgedTitle),
    `删的是「${purgedTitle}」，回收站剩 ${purged.length} 条`);

  // 收尾：把测试数据清干净
  const rest = (await rpc('cd.list', {}))?.data || [];
  const trashNow = (await rpc('cd.trash', {}))?.data || [];
  for (const x of [...rest, ...trashNow]) {
    if ((x.title || '').includes('v19')) await rpc('cd.delete', { id: x.id });
  }
  for (const x of ((await rpc('cd.trash', {}))?.data || [])) {
    if ((x.title || '').includes('v19')) await rpc('cd.purge', { id: x.id });
  }

  console.log('\n页面错误: ' + (errs.length ? errs.slice(0, 3).join(' | ') : '无'));
  console.log(`\n套件结果：${pass} 通过 / ${fails.length} 失败`);
  await b.close().catch(() => {});
})();
