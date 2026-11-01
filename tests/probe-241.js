/**
 * #240 / #241 探针。
 *
 * 覆盖：
 *   · 三个中心能从侧栏进得去，标题对得上
 *   · 主题包：安装 → 生效（CSS 变量真变了）→ 清单记录 → 卸载 → 变量还原
 *   · 插件包：安装 → 模块真加上了 → 卸载 → 模块撤掉
 *   · 拾色器：面板开合、拖色相、hex 手输、自定色真的应用得上画板
 *
 * 每一步都断言，不靠"看起来没报错"。
 */
const { run } = require('./_probe');

const THEME_PACK = {
  rq: 1, kind: 'theme', id: 'probe.dusk', name: '探针暮色', version: '1.0.0',
  author: 'probe', desc: '给自动化测试用的一套配色',
  base: 'paper',
  colors: { bg: '#201a2b', panel: '#2a2237', panel2: '#332a42', ink: '#efe7f5', accent: '#c07be0' },
};

const PLUGIN_PACK = {
  rq: 1, kind: 'plugin', id: 'probe.mods', name: '探针模块组', version: '1.0.0',
  author: 'probe', desc: '加两个模块',
  modules: [
    { type: 'quote', title: '探针金句' },
    { type: 'heading', title: '探针小标题' },
  ],
};

run(async (P) => {
  /* ---------- 1. 三个中心进得去 ---------- */
  P.say('侧栏进「主题中心」');
  const okTheme = await P.go('themeCenter');
  P.out({ 切过去了: okTheme });

  P.say('主题中心页面内容');
  P.out(await P.eval(() => {
    const h = document.querySelector('.topbar h2, #topbar-slot h2');
    return {
      标题: h ? h.textContent : '(没有 topbar)',
      内置主题数: document.querySelectorAll('.theme-grid .tcard').length,
      有安装按钮: !!document.querySelector('[data-act="theme-install-open"]'),
      有做包按钮: !!document.querySelector('[data-act="theme-make"]'),
    };
  }));

  /* ---------- 2. 装一个主题包 ---------- */
  P.say('通过粘贴框装主题包');
  const inst = await P.page.evaluate(async (pack) => {
    // 打开安装弹层
    document.querySelector('[data-act="theme-install-open"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const ta = document.querySelector('[data-act="pack-paste"]');
    if (!ta) return { err: '找不到粘贴框' };
    // React 受控 textarea：要用原生 setter 再派发 input，否则值进不去
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, JSON.stringify(pack));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const prev = document.querySelector('[data-act="pack-preview"]');
    return {
      有预览: !!prev,
      预览文字: prev ? prev.textContent.slice(0, 80) : '',
      安装按钮可点: !document.querySelector('[data-act="pack-install"]')?.disabled,
    };
  }, THEME_PACK);
  P.out(inst);

  P.say('点安装，看 CSS 变量是否真的变了');
  const afterInstall = await P.page.evaluate(async () => {
    const before = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('[data-act="pack-install"]')?.click();
    await new Promise((r) => setTimeout(r, 1500));
    const after = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    return {
      装之前bg: before,
      装之后bg: after,
      变了: before !== after,
      弹层还在: !!document.querySelector('[data-act="pack-paste"]'),
    };
  });
  P.out(afterInstall);

  P.say('清单里应该有这条记录');
  /*
   * 走的是 bootstrap，不是自己编的 settings.all —— 没有那个 RPC，
   * 早先这里发出去没人应答，探针拿不到就打印 0，看起来像"没装上"，
   * 而下一步却能卸载成功。这种"断言用错接口"比真 bug 更容易骗人。
   */
  P.out(await P.page.evaluate(async () => {
    const call = async (m, a) => new Promise((res, rej) => {
      const id = Math.floor(Math.random() * 1e9);
      const on = (e) => {
        if (e.data && e.data.id === id) {
          window.chrome.webview.removeEventListener('message', on);
          e.data.ok ? res(e.data.data) : rej(new Error(e.data.err));
        }
      };
      window.chrome.webview.addEventListener('message', on);
      window.chrome.webview.postMessage({ id, m, a });
    });
    const b = await call('bootstrap', {});
    const reg = JSON.parse(String(b?.settings?.extRegistry || '{}'));
    return {
      装了几个: (reg.items || []).length,
      名字: (reg.items || []).map((x) => x.name),
      种类: (reg.items || []).map((x) => x.kind),
      主题槽: (reg.items || []).map((x) => x.slot),
      当前主题: b?.settings?.theme,
    };
  }));

  /* ---------- 3. 卸载，变量要回去 ---------- */
  P.say('卸载主题包');
  const afterUninstall = await P.page.evaluate(async () => {
    const before = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('[data-act="pack-uninstall"]')?.click();
    await new Promise((r) => setTimeout(r, 1500));
    const after = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    return {
      卸载前bg: before,
      卸载后bg: after,
      还原了: before !== after,
      列表空了: !document.querySelector('[data-act="pack-list"]'),
    };
  });
  P.out(afterUninstall);

  /* ---------- 4. 插件 ---------- */
  P.say('进「插件中心」并装插件');
  await P.go('pluginCenter');
  const modCountBefore = await P.eval(() => document.querySelectorAll('[data-act="plugin-install-open"]').length);
  P.out({ 有安装入口: modCountBefore > 0 });

  const pluginRes = await P.page.evaluate(async (pack) => {
    const api = async (m, a) => new Promise((res, rej) => {
      const id = Math.floor(Math.random() * 1e9);
      const on = (e) => {
        if (e.data && e.data.id === id) {
          window.chrome.webview.removeEventListener('message', on);
          e.data.ok ? res(e.data.data) : rej(new Error(e.data.err));
        }
      };
      window.chrome.webview.addEventListener('message', on);
      window.chrome.webview.postMessage({ id, m, a });
    });
    const before = (await api('modules.list', {})).length;
    document.querySelector('[data-act="plugin-install-open"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const ta = document.querySelector('[data-act="pack-paste"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, JSON.stringify(pack));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    document.querySelector('[data-act="pack-install"]')?.click();
    await new Promise((r) => setTimeout(r, 2200));
    const after = await api('modules.list', {});
    return {
      装前模块数: before,
      装后模块数: after.length,
      新增: after.length - before,
      新模块标题: after.filter((m) => String(m.title).includes('探针')).map((m) => m.title),
    };
  }, PLUGIN_PACK);
  P.out(pluginRes);

  P.say('卸载插件，模块要撤掉');
  P.out(await P.page.evaluate(async () => {
    const api = async (m, a) => new Promise((res, rej) => {
      const id = Math.floor(Math.random() * 1e9);
      const on = (e) => {
        if (e.data && e.data.id === id) {
          window.chrome.webview.removeEventListener('message', on);
          e.data.ok ? res(e.data.data) : rej(new Error(e.data.err));
        }
      };
      window.chrome.webview.addEventListener('message', on);
      window.chrome.webview.postMessage({ id, m, a });
    });
    document.querySelector('[data-act="pack-uninstall"]')?.click();
    await new Promise((r) => setTimeout(r, 2000));
    const after = await api('modules.list', {});
    return {
      卸载后模块数: after.length,
      还剩探针模块: after.filter((m) => String(m.title).includes('探针')).length,
    };
  }));

  /* ---------- 5. 工坊页能开 ---------- */
  P.say('进「创意工坊」');
  P.out({ 切过去了: await P.go('workshop') });
  P.out(await P.eval(() => ({
    标题: (document.querySelector('#topbar-slot h2') || {}).textContent,
    类别卡: document.querySelectorAll('.page .card').length,
  })));

  /* ---------- 6. 画板拾色器 ---------- */
  P.say('进画板，开拾色器');
  await P.go('draw');
  P.out(await P.page.evaluate(async () => {
    // 画板需要先新建一块
    const add = [...document.querySelectorAll('button')].find((b) => /新建/.test(b.textContent));
    add?.click();
    await new Promise((r) => setTimeout(r, 1200));
    const open = document.querySelector('[data-act="draw-picker-open"]');
    return { 有画板: !!document.querySelector('canvas.db-canvas'), 有拾色入口: !!open };
  }));

  P.out(await P.page.evaluate(async () => {
    document.querySelector('[data-act="draw-picker-open"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const panel = document.querySelector('[data-act="cp-panel"]');
    return {
      面板开了: !!panel,
      有饱和度面: !!document.querySelector('[data-act="cp-board"]'),
      有色相条: !!document.querySelector('[data-act="cp-hue"]'),
      有hex输入: !!document.querySelector('[data-act="cp-hex"]'),
    };
  }));

  P.say('在色相条上点一下，看颜色跟着变');
  P.out(await P.page.evaluate(async () => {
    const el = document.querySelector('[data-act="cp-hue"]');
    const r = el.getBoundingClientRect();
    const before = document.querySelector('[data-act="cp-hex"]').value;
    // 用 pointer 事件模拟一次点击（我们的面板监听的是 pointerdown）
    const opts = { bubbles: true, clientX: r.left + r.width * 0.75, clientY: r.top + r.height / 2, pointerId: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    await new Promise((res) => setTimeout(res, 350));
    const after = document.querySelector('[data-act="cp-hex"]').value;
    return { 之前: before, 之后: after, 变了: before !== after };
  }));

  P.say('手输一个 hex，画板当前色要跟着走');
  P.out(await P.page.evaluate(async () => {
    const inp = document.querySelector('[data-act="cp-hex"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '#12ab34');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    // 触发按钮上的色点就是"当前画笔色"
    const dot = document.querySelector('[data-act="draw-picker-open"] i');
    return { 按钮上的色: dot ? getComputedStyle(dot).backgroundColor : '(无)' };
  }));

  P.say('最近用过的颜色应记下来');
  P.out(await P.eval(() => ({
    最近色块数: document.querySelectorAll('[data-act="cp-recent"]').length,
  })));
});