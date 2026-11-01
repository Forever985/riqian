const { run } = require('./_probe');

run(async (P) => {
  P.say('先导入两张最小 PNG 到媒体库，才能验标签');
  P.out(await P.eval(async () => {
    const call = (m, a) => new Promise((res) => {
      const id = 'p' + Math.random().toString(36).slice(2);
      const on = (e) => {
        const d = e.data;
        if (d && d.id === id) { window.removeEventListener('message', on); res(d); }
      };
      window.addEventListener('message', on);
      window.chrome.webview.postMessage({ id, m, a });
      setTimeout(() => res({ timeout: true }), 8000);
    });
    // 1x1 红点 / 蓝点
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const a = await call('media.saveBase64', { name: 'probe-red.png', data: 'data:image/png;base64,' + png });
    const b = await call('media.saveBase64', { name: 'probe-blue.png', data: 'data:image/png;base64,' + png });
    const list = await call('media.list2', { kind: 'all', q: 'probe-', sort: 'new', dir: 'desc', folder: '', tag: '' });
    const items = (list && list.data) || [];
    return { a: a && a.data, b: b && b.data, n: items.length, ids: items.map((x) => x.id) };
  }));
});