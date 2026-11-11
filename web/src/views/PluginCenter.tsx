/**
 * #241 插件中心。
 *
 * 定位：插件 = 往日记里加东西的那一类扩展（加模块、加标签、加待办清单、改一组设置）。
 * 和主题的区别是「主题只改长相，插件改内容结构」，所以这里必须把
 * **它会加什么、会改什么设置** 摆在最显眼的位置，装完能一条条对上。
 *
 * 不做「在线插件市场」：这个程序是离线的本地日记本，
 * 没有服务端就没有可信的来源列表。与其做一个假市场，不如把
 * 「装一个包」这件事做得足够稳、足够透明。
 */
import { useCallback, useMemo, useState } from 'react';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { useStore } from '../store';
import { readRegistry, installPlugin, type InstalledPlugin } from '../lib/extensions';
import { PLUGIN_MODULE_TYPES, type PluginPack } from '../lib/pack';
import { TYPE_NAME } from '../lib/const';
import { InstallDialog, InstalledList, MakePackDialog } from '../features/PackUI';

/** #245：`embedded` = 被「扩展」页内嵌，不自己渲染顶栏，见 ThemeCenter 开头的说明 */
export function PluginCenterView({ embedded = false }: { embedded?: boolean } = {}) {
  const settings = useStore((s) => s.settings) as Record<string, unknown>;
  const modules = useStore((s) => s.modules);
  const toast = useStore((s) => s.toast);

  const [installing, setInstalling] = useState(false);
  const [making, setMaking] = useState(false);
  const [tick, setTick] = useState(0);

  const reg = useMemo(() => readRegistry(settings), [settings, tick]);
  const plugins = reg.items.filter((x): x is InstalledPlugin => x.kind === 'plugin');

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  /** 这个插件加出来的模块，现在还在不在（用户可能自己去设置里删了） */
  const aliveOf = (p: InstalledPlugin) => {
    const ids = new Set((modules || []).map((m) => m.id));
    return p.moduleIds.filter((id) => ids.has(id)).length;
  };

  const actions = (
    <>
      <button className="btn" onClick={() => setMaking(true)} data-act="plugin-make">
        <Icon name="share" /> 打包我的配置
      </button>
      <button className="btn primary" onClick={() => setInstalling(true)} data-act="plugin-install-open">
        <Icon name="plus" /> 安装插件
      </button>
    </>
  );

  return (
    <div className={embedded ? '' : 'page'}>
      {embedded ? (
        <div className="row" style={{ marginBottom: 12 }}>{actions}</div>
      ) : (
        <Topbar
          title="插件中心"
          sub={`${plugins.length} 个插件 · 当前共 ${(modules || []).length} 个模块`}
          right={actions}
        />
      )}

      <div className="hint" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        插件会在你的日记里<b>新增模块</b>（比如「今日三件好事」「喝水记录」），
        或者加一组标签、一张待办清单。它不会删你已有的东西，卸载时也会把它自己加的那些撤掉。
      </div>

      <h3 style={{ fontSize: 14, margin: '4px 0 10px' }}>已装的插件</h3>
      {plugins.length === 0 ? (
        <div className="card" style={{ padding: 18, textAlign: 'center' }}>
          <div style={{ marginBottom: 6 }}>还没有装过插件</div>
          <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.7 }}>
            插件包是一个 <code>.json</code> 文件，别人做好的发给你，拖进来就装上了。
            <br />
            你也可以把现在这套模块配置打成包，发给别人直接用。
          </div>
          <button className="btn" onClick={() => setInstalling(true)} data-act="plugin-install-empty">
            安装一个
          </button>
        </div>
      ) : (
        <InstalledList
          kind="plugin"
          emptyText="还没有装过插件"
          onRefresh={refresh}
          slotExtra={(rec) => {
            const p = rec as InstalledPlugin;
            const alive = aliveOf(p);
            const total = p.moduleIds.length;
            if (!total) return null;
            /*
             * 模块被用户手动删掉是很正常的事（装完发现不好用）。
             * 所以这里显示「还剩几个」，而不是假装它们都还在 ——
             * 否则用户看到"装了 3 个模块"，去日记里只找到 1 个，会以为坏了。
             */
            const gone = total - alive;
            return (
              <span
                className="small muted"
                title={gone > 0 ? '有模块被手动删掉了，卸载时会跳过已经不存在的' : '加出来的模块都还在'}
                style={{ whiteSpace: 'nowrap' }}
              >
                {gone > 0 ? `模块 ${alive}/${total}` : `${total} 个模块`}
              </span>
            );
          }}
        />
      )}

      <h3 style={{ fontSize: 14, margin: '22px 0 10px' }}>插件能加什么</h3>
      <div className="card" style={{ padding: 14 }}>
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
          能加的模块类型就是日记里已有的这 {PLUGIN_MODULE_TYPES.length} 种 ——
          插件不执行任何代码，只是替你把这些模块摆进当天页面。
          这是刻意的：能被 JSON 描述的东西才装得安全。
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PLUGIN_MODULE_TYPES.map((t) => (
            <span
              key={t}
              className="small"
              style={{
                padding: '3px 8px', borderRadius: 6,
                background: 'var(--panel2)', border: '1px solid var(--line)',
              }}
            >
              {TYPE_NAME[t] || t}
            </span>
          ))}
        </div>

        <div className="small muted" style={{ marginTop: 12, lineHeight: 1.8 }}>
          <b>两条硬规矩：</b>
          <br />
          · 插件要写的设置项必须带 <code>plugin.</code> 前缀 ——
          否则一个插件就能改掉你的主题、数据目录、密码策略。
          <br />
          · 标签在库里没有独立的表，所以插件只能往你**已经写过**的日记上挂标签；
          全新空库会跳过并告诉你跳过了几个，不会为了建标签凭空造一篇日记。
        </div>
      </div>

      <h3 style={{ fontSize: 14, margin: '22px 0 10px' }}>装错了怎么办</h3>
      <div className="card" style={{ padding: 14 }}>
        <div className="small" style={{ lineHeight: 1.9 }}>
          直接在上面点「卸载」。插件卸载时会撤掉它自己加的东西：
          <br />
          · 它加的模块 —— 删掉
          <br />
          · 它加的待办清单 —— 删掉
          <br />
          · 它加的标签 —— 从各天日记上摘掉
          <br />
          · 它写的 <code>plugin.*</code> 设置 —— 清掉
          <br />
          <span className="muted">
            你后来自己改过的模块标题、自己写的标签同名内容，卸载时不会被误删 ——
            只按它当初记录下来的 id 和名字精确匹配。
          </span>
        </div>
      </div>

      {installing && (
        <InstallDialog
          kind="plugin"
          title="安装插件"
          onClose={() => setInstalling(false)}
          onInstall={async (p) => {
            const r = await installPlugin(p as PluginPack);
            if (!r.ok) throw new Error(r.err || '安装失败');
            refresh();
            const n = p.kind === 'plugin' ? (p.modules || []).length : 0;
            toast(`已装上「${p.name}」`);
            return `已装上「${p.name}」${n ? `，新增 ${n} 个模块` : ''}${r.warn ? '。' + r.warn : ''}`;
          }}
        />
      )}
      {making && <MakePackDialog kind="plugin" onClose={() => setMaking(false)} />}
    </div>
  );
}