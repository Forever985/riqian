const { run } = require('./_probe');

/** 宿主 RPC 的 id 必须是数字 —— 之前用字符串 id 写探测脚本，回包永远匹配不上，
 *  表现成「0 条数据」，白折腾一轮。这里统一走数字自增。 */
const CALL = `
  window.__probeCall = (() => {
    let seq = 0;
    const pending = new Map();
    window.chrome.webview.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || typeof d.id !== 'number') return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      d.ok ? p.res(d.data) : p.rej(new Error(d.err || 'err'));
    });
    return (m, a) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      window.chrome.webview.postMessage({ id, m, a: a || {} });
      setTimeout(() => { if (pending.delete(id)) rej(new Error('timeout ' + m)); }, 8000);
    });
  })();
`;

run(async (P) => {
  P.say('装一个数字 id 的 RPC helper');
  P.out(await P.eval(CALL));

  P.say('塞两张最小 PNG');
  P.out(await P.eval(async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const a = await window.__probeCall('media.saveBase64', { name: 'probe-red.png', data: 'data:image/png;base64,' + png });
    const b = await window.__probeCall('media.saveBase64', { name: 'probe-blue.png', data: 'data:image/png;base64,' + png });
    return { a, b };
  }));

  P.say('第 151 条：打标签（含重复与空格，应被规整）');
  P.out(await P.eval(async () => {
    const list = await window.__probeCall('media.list2', { kind: 'all', q: 'probe-', sort: 'new', dir: 'desc', folder: '', tag: '' });
    const items = list || [];
    if (!items.length) return 'no items';
    const first = items[0];
    const set = await window.__probeCall('media.setTags', { id: first.id, tags: '旅行, 素材 ,旅行' });
    const tagList = await window.__probeCall('media.tags', {});
    const byTag = await window.__probeCall('media.list2', { kind: 'all', q: '', sort: 'new', dir: 'desc', folder: '', tag: '旅行' });
    return {
      id: first.id,
      afterSet: set,
      tagList,
      byTagCount: (byTag || []).length,
      hasTagsField: 'tags' in first,
    };
  }));

  P.say('第 151 条：文件夹改名');
  P.out(await P.eval(async () => {
    const list = await window.__probeCall('media.list2', { kind: 'all', q: 'probe-', sort: 'new', dir: 'desc', folder: '', tag: '' });
    const id = (list || [])[0]?.id;
    if (!id) return 'no items';
    await window.__probeCall('media.bulk', { ids: id, action: 'folder', value: '旅行照片' });
    const r = await window.__probeCall('media.renameFolder', { from: '旅行照片', to: '旅行' });
    const folders = await window.__probeCall('media.folders', {});
    return { rename: r, folders };
  }));

  P.say('清理：删掉探针文件');
  P.out(await P.eval(async () => {
    const list = await window.__probeCall('media.list2', { kind: 'all', q: 'probe-', sort: 'new', dir: 'desc', folder: '', tag: '' });
    const ids = (list || []).map((x) => x.id);
    if (!ids.length) return 'nothing';
    await window.__probeCall('media.bulk', { ids: ids.join(','), action: 'delete' });
    return { removed: ids.length };
  }));
});