/**
 * #241 主题中心。
 *
 * 这页要回答三个问题，顺序就是用户心里的顺序：
 *   1. 现在有哪些主题能用（内置 7 套 + 装来的）
 *   2. 别人做的主题怎么弄进来
 *   3. 我自己调好的怎么给别人
 *
 * 为什么不做成"一个列表把内置和装来的混排"：内置主题是代码里的常量，
 * 装来的是 themeCustom 里的一组覆盖值，两者能做的事不一样
 * （内置的不能删，装来的能删能导）。混在一起长成一个样，用户会试图删内置主题。
 */
import { useCallback, useMemo, useState } from 'react';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { useStore } from '../store';
import { THEMES, COLOR_SLOTS, THEME_DEFAULTS, THEME_PACK_PREFIX, parseCustom } from '../lib/theme';
import {
  activateTheme, installTheme, readRegistry, type InstalledTheme,
} from '../lib/extensions';
import type { ThemePack } from '../lib/pack';
import { InstallDialog, InstalledList, MakePackDialog } from '../features/PackUI';

export function ThemeCenterView() {
  const settings = useStore((s) => s.settings) as Record<string, unknown>;
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const [installing, setInstalling] = useState(false);
  const [making, setMaking] = useState(false);
  const [tick, setTick] = useState(0);

  const reg = useMemo(() => readRegistry(settings), [settings, tick]);
  const themes = reg.items.filter((x): x is InstalledTheme => x.kind === 'theme');
  /*
   * 当前主题有两种可能：内置（paper/ink/…）或装来的（pack:xxx）。
   * 早先这里直接拿 settings.theme 比 `cur === t.k`，装来的主题永远不会高亮，
   * 用户会以为"装了没用"。现在同时看出"这是哪个内置"和"哪个装来的包在生效"。
   */
  const raw = String(settings.theme || 'paper');
  const curBuiltin = raw.startsWith(THEME_PACK_PREFIX) ? '' : raw;
  const curPack = raw.startsWith(THEME_PACK_PREFIX) ? raw.slice(THEME_PACK_PREFIX.length) : '';

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  /** 切内置主题 —— 和设置页写同一个键，两处不能各记一套 */
  const pickBuiltin = async (k: string) => {
    await setSetting('theme', k);
    // 切回内置就等于停用了所有装来的主题，清单也要跟着改
    if (themes.some((t) => t.enabled)) {
      const r = readRegistry(useStore.getState().settings as Record<string, unknown>);
      r.items = r.items.map((x) => (x.kind === 'theme' ? { ...x, enabled: false } : x));
      await setSetting('extRegistry', JSON.stringify(r));
    }
    refresh();
  };

  return (
    <div className="page">
      <Topbar
        title="主题中心"
        sub={`${THEMES.length} 套内置 · ${themes.length} 套装来的`}
        right={
          <>
            <button className="btn" onClick={() => setMaking(true)} data-act="theme-make">
              <Icon name="share" /> 做一个
            </button>
            <button className="btn primary" onClick={() => setInstalling(true)} data-act="theme-install-open">
              <Icon name="plus" /> 安装主题
            </button>
          </>
        }
      />

      <div className="hint" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        主题包就是一个 <code>.json</code> 文件 —— 别人把配色存成文件发给你，装进来就能用。
        想自己做一套发给别人，点右上角「做一个」。
      </div>

      <h3 style={{ fontSize: 14, margin: '4px 0 10px' }}>内置主题</h3>
      {/* 复用设置页的 .tcard 样式 —— 同一套主题在两个页面长得一样，才不会被当成两种东西 */}
      <div className="theme-grid">
        {THEMES.map((t) => {
          const on = curBuiltin === t.k;
          return (
            <div
              key={t.k}
              className={`tcard ${on ? 'on' : ''}`}
              onClick={() => void pickBuiltin(t.k)}
              data-act={`theme-builtin-${t.k}`}
            >
              <div className="sw">{t.c.map((c) => <i key={c} style={{ background: c }} />)}</div>
              <div className="nm">{on ? `${t.n} · 使用中` : t.n}</div>
            </div>
          );
        })}
      </div>

      <h3 style={{ fontSize: 14, margin: '22px 0 10px' }}>装来的主题</h3>
      {themes.length === 0 ? (
        <div className="card" style={{ padding: 18, textAlign: 'center' }}>
          <div style={{ marginBottom: 6 }}>还没有装过别人的主题</div>
          <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.7 }}>
            拿到一个 <code>.json</code> 主题包，点上面「安装主题」拖进去就行。
            <br />
            也可以先在左边调一套自己喜欢的配色，再用「做一个」导出。
          </div>
          <button className="btn" onClick={() => setInstalling(true)} data-act="theme-install-empty">
            安装一个
          </button>
        </div>
      ) : (
        <InstalledList
          kind="theme"
          emptyText="还没有装过别人的主题"
          onRefresh={refresh}
          slotExtra={(rec) => {
            const t = rec as InstalledTheme;
            const on = curPack === t.id;
            return (
              <button
                className={'btn sm' + (on ? '' : ' ghost')}
                disabled={on}
                onClick={async () => {
                  await activateTheme(
                    readRegistry(useStore.getState().settings as Record<string, unknown>),
                    t.id,
                  );
                  toast(`已切到「${t.name}」`);
                  refresh();
                }}
                data-act="theme-activate"
              >
                {on ? '使用中' : '启用'}
              </button>
            );
          }}
        />
      )}

      <h3 style={{ fontSize: 14, margin: '22px 0 10px' }}>主题包能改哪些颜色</h3>
      <div className="card" style={{ padding: 14 }}>
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
          一共 {COLOR_SLOTS.length} 个槽位，可以只给其中几个 —— 没给的会从它声明的
          {' '}<code>base</code> 主题（或你当前主题）继承，不会变成黑底黑字。
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COLOR_SLOTS.map((s) => (
            <span
              key={s.key}
              className="small"
              title={`--${s.key}（${s.label}）`}
              style={{
                padding: '3px 8px', borderRadius: 6,
                background: 'var(--panel2)', border: '1px solid var(--line)',
                fontFamily: 'ui-monospace,monospace', fontSize: 11.5,
              }}
            >
              {s.key}
            </span>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          颜色只接受 <code>#rrggbb</code> 这种写法。别的写法一律拒绝 ——
          这里直接写进 CSS 变量，收其它东西等于开了一个注入口子。
        </div>
      </div>

      {installing && (
        <InstallDialog
          kind="theme"
          title="安装主题"
          onClose={() => setInstalling(false)}
          onInstall={async (p) => {
            const r = await installTheme(p as ThemePack);
            if (!r.ok) throw new Error(r.err || '安装失败');
            refresh();
            return `已装上「${p.name}」，并切换过去了`;
          }}
        />
      )}
      {making && <MakePackDialog kind="theme" onClose={() => setMaking(false)} />}

      {/* 出厂值提示：改了颜色想还原时，得知道原来是什么 */}
      <div className="small muted" style={{ marginTop: 18, lineHeight: 1.7 }}>
        提示：{THEMES.map((t) => t.n).join(' / ')} 的出厂配色都记在程序里，
        在设置 →「外观」里随时能还原，不用怕调坏。
        {curPack
          ? `（当前用的是装来的「${themes.find((x) => x.id === curPack)?.name || curPack}」，
             它在 ${COLOR_SLOTS.length} 个槽里覆盖了 ${
               Object.keys(parseCustom(settings.themeCustom as string)[raw] || {}).length
             } 个）`
          : `（当前主题有 ${Object.keys(THEME_DEFAULTS[curBuiltin] || {}).length} 个槽）`}
      </div>
    </div>
  );
}