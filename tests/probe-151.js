const { run } = require('./_probe');

run(async (P, page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await P.sleep(400);

  P.say('第 151 / 154 条：后端 RPC 直测');
  P.out(await P.eval(async () => {
    const call = (m, a) => new Promise((res) => {
      const id = 'p' + Math.random().toString(36).slice(2);
      const on = (e) => {
        const d = e.data;
        if (d && d.id === id) { window.removeEventListener('message', on); res(d); }
      };
      window.addEventListener('message', on);
      window.chrome.webview.postMessage({ id, m, a });
      setTimeout(() => res({ timeout: true }), 6000);
    });
    const out = {};
    const list = await call('media.list2', { kind: 'all', q: '', sort: 'new', dir: 'desc', folder: '', tag: '' });
    const items = (list && list.data) || [];
    out.count = items.length;
    out.hasTagsField = items.length ? ('tags' in items[0]) : 'no-items';
    const first = items[0];
    if (first) {
      out.set = await call('media.setTags', { id: first.id, tags: '旅行, 素材 ,旅行' });
      out.tagsList = await call('media.tags', {});
      out.byTag = await call('media.list2', { kind: 'all', q: '', sort: 'new', dir: 'desc', folder: '', tag: '旅行' });
      out.byTagN = ((out.byTag && out.byTag.data) || []).length;
      // 清理
      await call('media.setTags', { id: first.id, tags: '' });
    }
    return out;
  }));

  P.say('第 151 条：进多媒体库看新按钮');
  await P.go('media');
  await P.sleep(900);
  P.out(await P.eval(() => {
    const txt = (s) => Array.from(document.querySelectorAll(s)).map((b) => (b.textContent || '').trim()).filter(Boolean);
    return {
      hasNewFolder: txt('button[data-act="new-folder"]'),
      hasBulkTag: !!document.querySelector('button[data-act="bulk-tag"]'),
      tagChips: Array.from(document.querySelectorAll('[data-tag]')).map((b) => b.getAttribute('data-tag')),
      folderChips: Array.from(document.querySelectorAll('[data-folder]')).map((b) => b.getAttribute('data-folder')).slice(0, 6),
    };
  }));

  await cdp.send('Emulation.clearDeviceMetricsOverride');
});