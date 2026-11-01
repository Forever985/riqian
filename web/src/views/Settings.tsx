import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, playChime } from '../store';
import { Topbar, Dialog, askText } from '../components/ui';
import { Icon, ICON_PATHS, type IconName } from '../components/Icons';
import { ICON_BODY, ICON_SETS, ICON_VIEWBOX, type IconSetKey } from '../components/iconData';
import { PasswordField } from '../components/Lock';
import { MediaManager } from '../features/media';
import { EncourageEditor } from '../features/EncourageEditor';
import { DiagPanel } from '../features/DiagPanel';
import { FontPicker, CustomFontRow } from '../features/FontPicker';
import { FEATURES, TYPE_NAME } from '../lib/const';
import {
  COLOR_SLOTS, THEME_DEFAULTS, THEMES, hex2rgb, normalizeTheme, parseCustom, parseFeatures, rgb2hex, type ThemeColors,
} from '../lib/theme';
import { Row, Chips, Switch, QCtx, fuzzy } from '../components/SetRow';
import { HotkeySection, NavOrderEditor, SecuritySection, ShareSection, TraySection } from './SettingsV8';
import { OrderEditor, normalize } from '../components/OrderEditor';
import { NAV } from '../components/Sidebar';
import { PROFILE_SECTIONS } from '../lib/const';
import { LANGS, PLANNED_LANGS, useT } from '../lib/i18n';
import { applyAppearance } from '../lib/theme';
import { CURSORS, applyCursor } from '../lib/cursor';
import { TZ_PRESETS } from '../lib/date';
import {
  BG_ONE, ToneSliders, bgJson, bgLayerStyle, parseBg, type BgFit, type BgOpts,
} from '../features/mediaTone';
import { parseRotate } from '../features/bgRotate';
import { checkPack, parseIconPack, readPackFile, svgToBody, withOneIcon } from '../lib/iconPack';
import { imgUrl } from '../lib/media';
import type { Diagnostics } from '../types';

/* ---------------- 分组定义 ---------------- */

type GroupKey =
  | 'appearance' | 'layout' | 'diary' | 'habits' | 'pomo' | 'notify'
  | 'hotkeys' | 'tray' | 'security' | 'share' | 'data' | 'about' | 'exp';

const GROUPS: { k: GroupKey; n: string; ic: IconName; kw: string }[] = [
  { k: 'appearance', n: '外观主题', ic: 'palette', kw: '颜色 配色 字号 行距 圆角 疏密 暗色 深色' },
  { k: 'layout', n: '界面布局', ic: 'sliders', kw: '侧边栏 导航 宽度 折叠 选项卡 标签 顺序 排序' },
  { k: 'diary', n: '日记与模块', ic: 'note', kw: '模块 排序 拖动 日界线 新的一天 编辑器' },
  { k: 'habits', n: '打卡', ic: 'check-circle', kw: '习惯 排序 类型 记录' },
  { k: 'pomo', n: '番茄钟', ic: 'timer', kw: '专注 休息 预设 长休息 自动' },
  { k: 'notify', n: '提醒与勿扰', ic: 'bell', kw: '通知 声音 弹窗 托盘 勿扰 免打扰 音量' },
  { k: 'hotkeys', n: '快捷键', ic: 'key', kw: '快捷键 热键 老板键 录制 组合键' },
  { k: 'tray', n: '托盘与窗口', ic: 'monitor', kw: '托盘 菜单 图标 任务栏 悬浮 老板键 伪装 隐藏' },
  { k: 'security', n: '安全与密码', ic: 'shield', kw: '密码 提示 密保 找回 忘记 加锁' },
  { k: 'share', n: '分享与总结', ic: 'share', kw: '分享 卡片 水印 总结 天数' },
  { k: 'data', n: '数据与缓存', ic: 'database', kw: '导出 导入 备份 缓存 路径 迁移 图片' },
  { k: 'about', n: '关于', ic: 'book', kw: '版本 设备 诊断 说明' },
  { k: 'exp', n: '实验性功能', ic: 'sparkle', kw: '实验 试验 开关 不稳定 beta' },
];

/**
 * 搜索结果里的一块分组。
 *
 * 难点在于「这个分组到底有没有命中」—— 设置项是各分组自己用 <Row> 渲染的，
 * 父组件在渲染之前不可能知道里面剩下几行。所以先照常渲染，挂载后数一下
 * `.set-row[data-hit]` 的个数：为零就把整块收起来。用 layout effect 数，
 * 浏览器还没画就已经收好了，看不到空壳闪一下。
 */
function SearchPane({
  gk, name, q, nameHit, report, onOpen, children,
}: {
  gk: string; name: string; q: string; nameHit: boolean;
  report: (k: string, n: number) => void; onOpen: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    const n = el ? el.querySelectorAll('.set-row[data-hit]').length : 0;
    setRows(n);
    report(gk, nameHit ? Math.max(n, 1) : n);
  }, [q, nameHit, report, gk, children]);

  /*
   * 注意：命中的时候才显示，但**不能**直接 return null ——
   * 一旦不渲染，里面的行就不存在了，数出来永远是 0，这块就再也出不来。
   * 用 display:none 藏，DOM 仍然在，下次数的时候才数得到。
   */
  const hide = !nameHit && rows === 0;

  return (
    <div className="setres-g" ref={ref} style={hide ? { display: 'none' } : undefined}>
      <button className="setres-t" onClick={onOpen} data-tip={`打开「${name}」分组`}>
        <span>{name}</span>
        <Icon name="right" size={12} />
      </button>
      {children}
    </div>
  );
}

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const root = useStore((s) => s.root);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const [q, setQ] = useState('');
  const [group, setGroup] = useState<GroupKey>('appearance');
  const [rgbOpen, setRgbOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [diag, setDiag] = useState<Diagnostics | null>(null);

  useEffect(() => { void api.diagnostics().then(setDiag).catch(() => null); }, []);

  const t = useT();
  const wantGroup = useStore((s) => s.settingsGroup);
  useEffect(() => {
    if (!wantGroup) return;
    const g = useStore.getState().takeSettingsGroup();
    if (g) setGroup(g as GroupKey);
  }, [wantGroup]);
  const query = q.trim().toLowerCase();

  /*
   * 第 148 条：搜索必须是「搜整个设置」。
   *
   * 原来是把查询限定在当前分组里，再顺手跳到第一个名字对得上号的分组 ——
   * 搜「字号」时你人被钉在「外观主题」里，别的分组里明明有「字号」相关项也看不见，
   * 这也就是用户说的「怎么按小模块来搜索」。
   *
   * 现在查询非空时直接把**所有分组**都铺出来，各分组自己只留命中的行，
   * 没有命中的整块藏掉。分组名/关键词命中的排在前面，靠模糊匹配兜后的排后面。
   */
  const [hits, setHits] = useState<Record<string, number>>({});
  const report = useCallback((k: string, n: number) => {
    setHits((h) => (h[k] === n ? h : { ...h, [k]: n }));
  }, []);
  const hitTotal = Object.values(hits).reduce((a, b) => a + b, 0);
  useEffect(() => { if (!query) setHits({}); }, [query]);

  /** 分组名自己命中（比如搜「托盘」直接要那个分组） */
  const nameHit = (g: { n: string; kw: string }) => (query ? fuzzy(`${g.n} ${g.kw}`, query) : 0);

  /** 设置分组的顺序也允许调整（第 54 条）：存 settingsOrder，缺项自动补在末尾 */
  const orderedKeys = normalize(settings.settingsOrder, GROUPS.map((g) => ({ k: g.k as string, n: g.n }))) as GroupKey[];
  const orderedGroups = orderedKeys
    .map((k) => GROUPS.find((g) => g.k === k))
    .filter(Boolean) as typeof GROUPS;

  /** 按 key 出内容：这样顺序变了也能对上，不用再写一长串 group===xxx */
  const bodyOf = (k: GroupKey) => {
    switch (k) {
      case 'appearance': return <AppearanceSection onRgb={() => setRgbOpen(true)} />;
      case 'layout': return <LayoutSection />;
      case 'diary': return <DiarySection />;
      case 'habits': return <HabitsSection />;
      case 'pomo': return <PomoSection />;
      case 'notify': return <NotifySection />;
      case 'hotkeys': return <HotkeySection />;
      case 'tray': return <TraySection />;
      case 'security': return <SecuritySection />;
      case 'share': return <ShareSection />;
      case 'data': return <DataSection onMedia={() => setMediaOpen(true)} diag={diag} />;
      case 'about': return <AboutSection diag={diag} />;
      case 'exp': return <ExpSection />;
      default: return null;
    }
  };

  return (
    <>
      <Topbar
        title="设置"
        right={
          <div className="searchbox" style={{ flex: '0 0 260px' }}>
            <Icon name="search" size={15} />
            <input
              placeholder="搜索设置项，如「字号」「勿扰」"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                const first = GROUPS.find((g) => `${g.n} ${g.kw}`.toLowerCase().includes(e.target.value.trim().toLowerCase()));
                if (e.target.value.trim() && first) setGroup(first.k);
              }}
            />
            {q ? <button className="sb-clear" onClick={() => setQ('')}>✕</button> : null}
          </div>
        }
      />
      <div className="wrap">
        <QCtx.Provider value={query}>
          <div className="settings">
            <div className="setnav">
              {orderedGroups.map((g) => (
                <button
                  key={g.k}
                  className={`snav ${group === g.k && !query ? 'on' : ''}`}
                  onClick={() => { setQ(''); setGroup(g.k); }}
                >
                  <Icon name={g.ic} size={14} />
                  <span>{t(g.n)}</span>
                  {query && (hits[g.k] || nameHit(g)) ? <span className="hit" /> : null}
                </button>
              ))}
              <div className="small muted" style={{ padding: '10px 8px', lineHeight: 1.7 }}>
                {root}
              </div>
            </div>

            <div className="setbody">
              {query ? (
                <>
                  <div className="setres-h">
                    {hitTotal > 0
                      ? <>在全部设置里找到 <b>{hitTotal}</b> 项 · 点分组名可以跳过去</>
                      : <span className="muted">没有匹配的设置项</span>}
                  </div>
                  {orderedGroups
                    .map((g) => ({ g, rank: nameHit(g) }))
                    .sort((a, b) => (b.rank ? 1 : 0) - (a.rank ? 1 : 0))
                    .map(({ g }) => (
                      <SearchPane
                        key={g.k}
                        gk={g.k}
                        name={g.n}
                        q={query}
                        nameHit={nameHit(g) > 0}
                        report={report}
                        onOpen={() => { setQ(''); setGroup(g.k); }}
                      >
                        {bodyOf(g.k)}
                      </SearchPane>
                    ))}
                  {hitTotal === 0 ? (
                    <div className="card">
                      <div className="empty">
                        没找到「{q}」。试试更短的关键词，比如「字号」「密码」「代理」「备份」。
                      </div>
                    </div>
                  ) : null}
                </>
              ) : bodyOf(group)}
            </div>
          </div>
        </QCtx.Provider>
      </div>

      {rgbOpen ? <RgbDialog onClose={() => setRgbOpen(false)} /> : null}
      {mediaOpen ? <MediaManager onClose={() => setMediaOpen(false)} /> : null}
    </>
  );
}

/* ---------------- 外观 ---------------- */

function AppearanceSection({ onRgb }: { onRgb: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const [bgOpen, setBgOpen] = useState(false);
  const custom = parseCustom(settings.themeCustom as string | undefined);
  const theme = normalizeTheme(settings.theme);
  const touched = Object.keys(custom[theme] || {}).length;

  /* 第 88 条：用户自己导入的图标组。存的是 JSON，这里只取名字和数量做展示 */
  const [packOpen, setPackOpen] = useState(false);
  const customPack = useMemo(() => {
    const raw = settings.iconCustom as string | undefined;
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as { name?: string; icons?: Record<string, string> };
      const n = Object.keys(o.icons || {}).length;
      if (!n) return null;
      return { name: o.name || '我的图标组', count: n };
    } catch { return null; }
  }, [settings.iconCustom]);
  const customName = customPack?.name || '';
  const customCount = customPack?.count || 0;

  return (
    <div className="card">
      <h3><Icon name="palette" size={14} />主题</h3>
      <Row label="配色" kw="主题 颜色 配色 皮肤" stack>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <div
              key={t.k}
              className={`tcard ${theme === t.k ? 'on' : ''}`}
              onClick={() => void setSetting('theme', t.k)}
            >
              <div className="sw">{t.c.map((c) => <i key={c} style={{ background: c }} />)}</div>
              <div className="nm">{t.n}</div>
            </div>
          ))}
        </div>
      </Row>

      <Row label="自定义颜色" sub="按 RGB 逐项调整，最多 16 个色槽" kw="RGB 自定义 调色 颜色 精细">
        <button className="btn" onClick={onRgb}>
          <Icon name="palette" size={13} />
          打开调色板{touched ? `（已改 ${touched} 项）` : ''}
        </button>
      </Row>

      <Row label="圆角" kw="圆角 直角 圆润">
        <Chips
          value={(settings.round as string) || 'soft'}
          items={[['sharp', '直角'], ['soft', '柔和'], ['round', '圆润']]}
          onPick={(v) => void setSetting('round', v)}
        />
      </Row>

      <Row label="疏密" kw="疏密 紧凑 宽松 间距">
        <Chips
          value={(settings.density as string) || 'normal'}
          items={[['compact', '紧凑'], ['normal', '标准'], ['loose', '宽松']]}
          onPick={(v) => void setSetting('density', v)}
        />
      </Row>

      <Row label="页面留白" sub="内容区四周留多少；0 = 跟随「疏密」" kw="留白 边距 空白 间距 padding">
        <input
          type="range" min={0} max={60} step={2} style={{ width: 140 }}
          value={Number(settings.viewPad) || 0}
          onChange={(e) => { void setSetting('viewPad', e.target.value); applyAppearance({ ...settings, viewPad: e.target.value } as never); }}
        />
        <span className="val">{Number(settings.viewPad) || 0}px</span>
      </Row>

      <Row label="模块间距" sub="日记里各模块之间的空隙" kw="模块 间距 空隙 gap 挤">
        <input
          type="range" min={0} max={40} step={2} style={{ width: 140 }}
          value={Number(settings.modGap) || 0}
          onChange={(e) => { void setSetting('modGap', e.target.value); applyAppearance({ ...settings, modGap: e.target.value } as never); }}
        />
        <span className="val">{Number(settings.modGap) || 0}px</span>
      </Row>

      <Row
        label="外观还原"
        sub="把宽度、字号、行距、留白、字体一次性恢复默认（只动外观，不碰内容）"
        kw="还原 恢复 默认 重置 一键"
      >
        <button
          className="btn"
          onClick={async () => {
            const keys = ['navWidth', 'pageWidth', 'fontSize', 'lineHeight', 'viewPad', 'modGap', 'fontFamily', 'density', 'round'];
            for (const k of keys) await setSetting(k, '');
            applyAppearance({
              ...settings,
              navWidth: '', pageWidth: '', fontSize: '', lineHeight: '', viewPad: '', modGap: '',
              fontFamily: '', density: 'normal', round: 'soft',
            } as never);
            toast('外观已恢复默认');
          }}
        >
          <Icon name="refresh" size={13} />恢复默认外观
        </button>
      </Row>

      <Row
        label="图标风格"
        sub="整套换掉界面里的图标；换的是画法，不是布局，所以位置和大小都不变"
        kw="图标 图标组 icon 风格 antd 蚂蚁 material lucide tabler"
        stack
      >
        <div className="iset-grid">
          {ICON_SETS.map((it) => (
            <IconSetCard
              key={it.k}
              set={it.k}
              name={it.n}
              note={it.note}
              active={String(settings.iconSet || 'riqian') === it.k}
              onPick={() => void setSetting('iconSet', it.k)}
            />
          ))}
          {/* 第 88 条：用户导入的那一套。没导入过就先不占位置，免得七格里空一格 */}
          {customName ? (
            <IconSetCard
              set="custom"
              name={customName}
              note={`自己导入的，${customCount} 枚`}
              active={String(settings.iconSet || 'riqian') === 'custom'}
              onPick={() => void setSetting('iconSet', 'custom')}
            />
          ) : null}
        </div>

        {/* 第 88 条：导入图标组 / 自定义单枚。用户原话「也要允许用户自由选择组件组，
            或者导入组件组，或者自定义某个 icon」——前一句已由上面六套覆盖，这两件在这里。 */}
        <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => setPackOpen(true)}>
            <Icon name="download" size={13} />
            {customName ? '管理自定义图标组' : '导入图标组'}
          </button>
          {customName ? (
            <button
              className="btn sm ghost"
              title="删掉导入的图标组，切换回内置那几套"
              onClick={() => {
                void setSetting('iconCustom', '');
                if (String(settings.iconSet || '') === 'custom') void setSetting('iconSet', 'riqian');
              }}
            >移除</button>
          ) : null}
          <span className="small muted">支持 JSON 图标包，也能一枚一枚改</span>
        </div>
      </Row>

      <Row
        label="软件背景"
        sub={String(settings.bgGlobal || '')
          ? '已设置。卡片不受影响，只有窗口底色/底层图会变'
          : '给整个窗口铺一张图或一层底色（第 113 条）'}
        kw="背景 壁纸 全局 软件 底色 背景图"
      >
        <button className="btn" onClick={() => setBgOpen(true)}>
          <Icon name="image" size={13} />
          {String(settings.bgGlobal || '') ? '调整背景' : '设置背景'}
        </button>
      </Row>

      {/* 第 222 条：鼠标指针也能换 */}
      <Row
        label="鼠标指针"
        sub="换的是箭头的样子，不影响点击行为；不满意随时切回「系统默认」"
        kw="鼠标 指针 光标 cursor mouse 箭头"
        stack
      >
        <div className="cur-grid">
          {CURSORS.map((it) => (
            <button
              key={it.k}
              type="button"
              className={`curcard ${String(settings.cursorStyle || '') === it.k ? 'on' : ''}`}
              data-cursor-skin={it.k}
              title={it.note}
              onClick={() => {
                void setSetting('cursorStyle', it.k);
                applyCursor(it.k);
              }}
            >
              <span className="curcard-prev">
                {it.cur ? (
                  <img src={it.cur.slice(5, -2)} alt="" />
                ) : (
                  <Icon name="left" size={18} />
                )}
              </span>
              <span className="curcard-n">{it.n}</span>
              <span className="curcard-note">{it.note}</span>
            </button>
          ))}
        </div>
      </Row>

      <Row label="正文字号" kw="字号 字体 大小 文字">
        <input
          type="range" min={14} max={21} step={1} style={{ width: 150 }}
          value={Number(settings.fontSize) || 16}
          onChange={(e) => void setSetting('fontSize', e.target.value)}
        />
        <span className="val">{Number(settings.fontSize) || 16}px</span>
      </Row>

      <Row label="行距" kw="行距 行高 密">
        <input
          type="range" min={150} max={230} step={5} style={{ width: 150 }}
          value={Math.round((Number(settings.lineHeight) || 1.85) * 100)}
          onChange={(e) => void setSetting('lineHeight', String(Number(e.target.value) / 100))}
        />
        <span className="val">{(Number(settings.lineHeight) || 1.85).toFixed(2)}</span>
      </Row>

      {bgOpen ? <GlobalBgDialog onClose={() => setBgOpen(false)} /> : null}
      {packOpen ? <IconPackDialog onClose={() => setPackOpen(false)} /> : null}
    </div>
  );
}

/** RGB 调色板：每个色槽给拾色器 + 三个数字框，改完立刻生效 */
function RgbDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const theme = normalizeTheme(settings.theme);
  const themeName = THEMES.find((t) => t.k === theme)?.n || theme;

  const [draft, setDraft] = useState<ThemeColors>(() => {
    const custom = parseCustom(settings.themeCustom as string | undefined)[theme] || {};
    return { ...(THEME_DEFAULTS[theme] || {}), ...custom };
  });

  const save = async (next: ThemeColors) => {
    setDraft(next);
    const custom = parseCustom(settings.themeCustom as string | undefined);
    custom[theme] = next;
    await setSetting('themeCustom', JSON.stringify(custom));
  };

  const groups = [...new Set(COLOR_SLOTS.map((s) => s.group))];

  return (
    <Dialog
      title={`调色板 · ${themeName}`}
      wide
      onClose={onClose}
      footer={<>
        <button
          className="btn"
          onClick={async () => {
            const custom = parseCustom(settings.themeCustom as string | undefined);
            delete custom[theme];
            await setSetting('themeCustom', JSON.stringify(custom));
            setDraft({ ...(THEME_DEFAULTS[theme] || {}) });
            toast('已恢复该主题的出厂颜色');
          }}
        >恢复本主题默认</button>
        <span className="sp" />
        <button className="btn primary" onClick={onClose}>完成</button>
      </>}
    >
      <div className="small muted" style={{ marginBottom: 12 }}>
        改了立刻生效。色槽按「背景 → 文字 → 线条 → 强调 → 语义」排列，
        数值是 0–255 的 RGB，也可以直接填十六进制。
      </div>
      {groups.map((g) => (
        <div className="rgbgroup" key={g}>
          <div className="rgbgroup-t">{g}</div>
          {COLOR_SLOTS.filter((s) => s.group === g).map((s) => {
            const val = draft[s.key] || '#000000';
            const { r, g: gg, b } = hex2rgb(val);
            const set = (nr: number, ng: number, nb: number) => {
              void save({ ...draft, [s.key]: rgb2hex(nr, ng, nb) });
            };
            return (
              <div className="rgbrow" key={s.key}>
                <span className="rgbl">{s.label}</span>
                <input
                  type="color"
                  value={val}
                  onChange={(e) => void save({ ...draft, [s.key]: e.target.value })}
                />
                {([['R', r, (n: number) => set(n, gg, b)],
                   ['G', gg, (n: number) => set(r, n, b)],
                   ['B', b, (n: number) => set(r, gg, n)]] as [string, number, (n: number) => void][]).map(([lab, n, fn]) => (
                  <label className="rgbn" key={lab}>
                    <span>{lab}</span>
                    <input type="number" min={0} max={255} value={n} onChange={(e) => fn(Number(e.target.value) || 0)} />
                  </label>
                ))}
                <input
                  className="inp rgbtxt"
                  value={val}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) void save({ ...draft, [s.key]: v.toLowerCase() });
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </Dialog>
  );
}

/* ---------------- 布局 ---------------- */

function LayoutSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  /* 第 191 条：开机自启的真实状态要问系统，不能只信设置值 ——
     用户可能在任务管理器里手动删掉了启动项。 */
  const [autostartOn, setAutostartOn] = useState(false);
  useEffect(() => {
    void api.shell.autostartGet().then((r) => setAutostartOn(!!r.on)).catch(() => {});
  }, []);
  const tabMode = String(settings.tabMode ?? '0') === '1';
  const feat = parseFeatures(settings.features as string | undefined);

  const toggleFeature = async (k: string) => {
    const next = { ...feat, [k]: feat[k] === '0' ? '1' : '0' };
    await setSetting('features', JSON.stringify(next));
  };

  return (
    <>
    <div className="card">
      <h3><Icon name="sliders" size={14} />布局</h3>
      <Row label="导航栏位置" sub="上下左右都能放" kw="侧边栏 导航 位置 左 右 上 下">
        <Chips
          value={(settings.navDock as string) || 'left'}
          items={[['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下']]}
          onPick={(v) => void setSetting('navDock', v)}
        />
      </Row>
      <Row label="导航宽度" sub="也可以直接拖侧边栏边缘" kw="宽度 拖 宽度 侧边栏">
        <input
          type="range" min={140} max={380} step={2} style={{ width: 160 }}
          value={Number(settings.navWidth) || 218}
          onChange={(e) => void setSetting('navWidth', e.target.value)}
        />
        <span className="val">{Number(settings.navWidth) || 218}px</span>
      </Row>
      <Row label="折叠为图标" kw="折叠 图标 收起 窄">
        <Switch
          on={String(settings.navCollapsed) === '1'}
          onClick={() => void setSetting('navCollapsed', String(settings.navCollapsed) === '1' ? '0' : '1')}
        />
      </Row>
      <Row
        label="导航顺序"
        sub="侧栏里不再拖动排序，顺序统一在这里调；关掉的页面在下面「导航里显示哪些」"
        kw="顺序 排序 拖动 导航 侧边栏 上下移"
        stack
      >
        <NavOrderEditor />
      </Row>
      <Row
        label="个人中心顺序"
        sub="「我的」页从上到下按这个排"
        kw="我的 个人中心 顺序 排序"
        stack
      >
        <OrderEditor items={PROFILE_SECTIONS} settingKey="profileOrder" hint="改完回「我的」页就能看到" />
      </Row>
      <Row
        label="设置页顺序"
        sub="左边这列分组也能重排"
        kw="设置 分组 顺序 排序 目录"
        stack
      >
        <OrderEditor items={GROUPS.map((g) => ({ k: g.k as string, n: g.n }))} settingKey="settingsOrder" hint="搜索不受影响" />
      </Row>
      <Row
        label="内容宽度"
        sub="默认铺满，最大化后中间不会再有写死的空白；嫌行太长就切「可读宽度」或自己填像素"
        kw="宽度 页面 内容 行宽 布局 最大化 空白 全宽 铺满"
      >
        <div className="row" style={{ gap: 5 }}>
          <button
            className={`chip ${!settings.pageWidth || settings.pageWidth === 'full' ? 'on' : ''}`}
            data-ww="full"
            onClick={() => { void setSetting('pageWidth', 'full'); applyAppearance({ ...settings, pageWidth: 'full' } as never); }}
          >铺满</button>
          <button
            className={`chip ${String(settings.pageWidth) === 'auto' ? 'on' : ''}`}
            data-ww="auto"
            title="跟随窗口，但收在 1600px —— 宽屏写长文时行不至于拉太长"
            onClick={() => { void setSetting('pageWidth', 'auto'); applyAppearance({ ...settings, pageWidth: 'auto' } as never); }}
          >可读宽度</button>
          {(() => {
            const v = String(settings.pageWidth ?? '');
            const fixed = v && v !== 'auto' && v !== 'full';
            return (
              <>
                <input
                  type="range" min={720} max={2200} step={20} style={{ width: 130 }}
                  value={fixed ? Number(v) || 1080 : 1080}
                  onChange={(e) => { void setSetting('pageWidth', e.target.value); applyAppearance({ ...settings, pageWidth: e.target.value } as never); }}
                />
                <span className="val">{fixed ? `${Number(v) || 1080}px` : '自定义'}</span>
              </>
            );
          })()}
        </div>
      </Row>
      {/* 第 83 条：待办左栏（清单导航）和清单之间的空隙，用户说「空的过多」。
          宽度能拖，也能在这里直接给个数值；不想要拖动就关掉。 */}
      <Row label="待办左栏宽度" sub="左边那一列清单导航占多宽；页面上也能直接拖动边界调整" kw="待办 清单 左栏 宽度 空隙 布局 拖动 todo">
        <input
          type="range" min={140} max={420} step={4} style={{ width: 160 }}
          value={Math.max(140, Math.min(420, Number(settings.todoRailW) || 196))}
          onChange={(e) => {
            void setSetting('todoRailW', e.target.value);
            document.documentElement.style.setProperty('--railw', `${e.target.value}px`);
          }}
        />
        <span className="val">{Math.max(140, Math.min(420, Number(settings.todoRailW) || 196))}px</span>
      </Row>
      <Row label="允许拖动待办左栏" sub="关掉之后宽度只能在上面调，页面上拖不动" kw="拖动 锁定 待办 左栏 布局">
        <Switch
          on={String(settings.todoRailDrag ?? '1') !== '0'}
          onClick={() => void setSetting('todoRailDrag', String(settings.todoRailDrag ?? '1') !== '0' ? '0' : '1')}
        />
      </Row>
      {/* 第 107 / 170 条：原来是 6 项硬编码 <option>，现在换成 FontPicker（预设分组 + 导入 + 预览） */}
      <Row
        label="字体"
        sub="整站换一套字，选完立刻生效；装了小众字体也可以导入文件"
        kw="字体 font 宋体 黑体 楷体 等宽 导入 自定义 family"
      >
        <div style={{ minWidth: 0 }}>
          <FontPicker
            value={String(settings.fontFamily || '')}
            onChange={(v) => {
              void setSetting('fontFamily', v);
              applyAppearance({ ...settings, fontFamily: v } as never);
            }}
          />
          <div style={{ marginTop: 8 }}>
            <CustomFontRow
              value={String(settings.fontFamily || '')}
              onChange={(v) => {
                void setSetting('fontFamily', v);
                applyAppearance({ ...settings, fontFamily: v } as never);
              }}
            />
          </div>
        </div>
      </Row>
      <Row label="时间格式" sub="12 小时制会显示上午/下午；时区只影响显示，不改存储" kw="时间 格式 12 24 小时 时区">
        <Chips
          value={String(settings.timeFormat || '24')}
          items={[['24', '24 小时'], ['12', '12 小时']]}
          onPick={(v) => { void setSetting('timeFormat', v); applyAppearance({ ...settings, timeFormat: v } as never); }}
        />
      </Row>
      {/* 第 106 条：年月日谁在前也得能改。空串 = 按语言习惯（中文年月日、英文月日年） */}
      <Row label="年月日顺序" sub="留空则跟随界面语言：中文按年-月-日，英文按月/日/年" kw="日期 格式 年月日 year month day">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Chips
            value={String(settings.dateFormat || '')}
            items={[['', '跟随语言'], ['ymd', '2026年10月26日'], ['dmy', '26/10/2026'], ['mdy', '10/26/2026']] as [string, string][]}
            onPick={(v) => { void setSetting('dateFormat', v); applyAppearance({ ...settings, dateFormat: v } as never); }}
          />
        </div>
      </Row>
      {/* 第 171 条：时区要给预设，不能只有个空输入框让人猜格式 */}
      <Row label="时区" sub="只影响「现在几点」「今天是哪天」的显示，不改已存数据；非预设值可直接手填" kw="时区 时间 timezone UTC 偏移">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select
            className="inp" style={{ width: 230 }}
            value={TZ_PRESETS.some(([v]) => v === String(settings.timezone || 'local')) ? String(settings.timezone || 'local') : '__custom'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom') return;   // 选「自定义」不去改值，让用户自己在右边输入
              void setSetting('timezone', v);
              applyAppearance({ ...settings, timezone: v } as never);
            }}
          >
            {TZ_PRESETS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            <option value="__custom">自定义偏移…</option>
          </select>
          <input
            className="inp" style={{ width: 110 }} placeholder="+08:00"
            value={String(settings.timezone || 'local') === 'local' ? '' : String(settings.timezone || '')}
            onChange={(e) => void setSetting('timezone', e.target.value || 'local')}
            onBlur={(e) => applyAppearance({ ...settings, timezone: e.target.value || 'local' } as never)}
            title="留空 = 跟随本机。格式 +08:00 / -05:30，也可以只写 8"
          />
        </div>
      </Row>
      <Row label="导航角标" sub="待办数量怎么显示：数字 / 小红点 / 不显示" kw="角标 徽标 红点 数字 badge 待办">
        <Chips
          value={String(settings.badgeStyle ?? 'num')}
          items={[['num', '数字'], ['dot', '小红点'], ['off', '不显示']]}
          onPick={(v) => void setSetting('badgeStyle', v)}
        />
      </Row>
      <Row label="选项卡模式" sub="像浏览器那样把打开过的页面堆在顶部" kw="选项卡 标签 tab 多页">
        <Switch on={tabMode} onClick={() => void setSetting('tabMode', tabMode ? '0' : '1')} />
      </Row>
      <Row label="启动时显示欢迎页" kw="欢迎 首页 启动 概览">
        <Switch
          on={String(settings.welcomeOnStart ?? '1') === '1'}
          onClick={() => void setSetting('welcomeOnStart', String(settings.welcomeOnStart ?? '1') === '1' ? '0' : '1')}
        />
      </Row>
      <Row label="点 X 的时候" sub="收进托盘的话番茄钟还会继续跑；退出就全停" kw="关闭 退出 托盘 后台 最小化 X">
        <Chips
          value={String(settings.closeAction || 'tray')}
          items={[['tray', '收进托盘'], ['quit', '直接退出']]}
          onPick={(v) => void setSetting('closeAction', v)}
        />
      </Row>
      <Row label="最小化的时候" sub="选「收进托盘」就不会在任务栏留按钮" kw="最小化 任务栏 托盘 隐藏">
        <Chips
          value={String(settings.minTray ?? '0')}
          items={[['0', '留在任务栏'], ['1', '收进托盘']]}
          onPick={(v) => void setSetting('minTray', v)}
        />
      </Row>

      <Row
        label="最小化时提示「还在运行」"
        sub="收进托盘时右下角会冒一个气泡说明程序没关；嫌烦就关掉"
        kw="最小化 气泡 提示 还在运行 托盘 烦"
      >
        <Switch
          on={String(settings.minimizeTip ?? '1') === '1'}
          onClick={() => void setSetting('minimizeTip', String(settings.minimizeTip ?? '1') === '1' ? '0' : '1')}
        />
      </Row>

      {/* 第 191 条：开机自启。默认不启动 —— 用户没说就绝不偷偷驻留开机项。 */}
      <Row
        label="开机自动启动"
        sub="默认关闭。开启后会在当前用户的启动项里登记，不需要管理员权限"
        kw="开机 自启动 启动项 开机启动 startup"
      >
        <Switch
          on={autostartOn}
          onClick={async () => {
            const next = autostartOn ? 0 : 1;
            const r = await api.shell.setAutostart(next);
            if (!r.ok) { toast('设置失败：' + (r.err || '未知原因')); return; }
            setAutostartOn(next === 1);
            toast(next === 1 ? '已设为开机自启' : '已关闭开机自启');
          }}
        />
      </Row>

      <Row label="语言" sub="简体中文标注为「正体中文」，不提供繁体" kw="语言 多语言 英文 中文 language">
        <Chips
          value={String(settings.language || 'zh-Hans')}
          items={LANGS.map((l) => [l.k, l.n] as [string, string])}
          onPick={(v) => void setSetting('language', v)}
        />
      </Row>
      <Row label="地区" sub="在「我的 → 更多资料」里填；港澳台均为中国的一部分" kw="地区 城市 国家 区域 region">
        <button className="btn sm" onClick={() => void useStore.getState().go('profile')}>去填写 →</button>
      </Row>
      <div className="small muted" style={{ marginTop: 6, lineHeight: 1.9 }}>
        英文目前只覆盖界面框架（导航 / 设置分组 / 常用按钮），正文和长句仍是中文 ——
        半截翻译比不翻译更难看，所以先立骨架再铺量。后续计划：
        {PLANNED_LANGS.join(' · ')}。
      </div>
    </div>

    <div className="card">
      <h3>导航里显示哪些</h3>
      <div className="small muted" style={{ marginBottom: 8 }}>关掉的会从侧边栏消失，但数据仍在。</div>
      {FEATURES.map((f) => (
        <Row label={f.n} key={f.k} kw={`导航 显示 隐藏 ${f.n}`}>
          <Switch
            on={feat[f.k] !== '0'}
            onClick={() => void toggleFeature(f.k)}
          />
        </Row>
      ))}
    </div>
    </>
  );
}

/* ---------------- 日记与模块 ---------------- */

function DiarySection() {
  const settings = useStore((s) => s.settings);
  const modules = useStore((s) => s.modules);
  const setSetting = useStore((s) => s.setSetting);
  const reloadModules = useStore((s) => s.reloadModules);
  const toast = useStore((s) => s.toast);

  const [newType, setNewType] = useState('mood');
  /** 标签预设：逗号分隔。本地 state 编辑，失焦才落库，避免每敲一个字存一次 */
  const [tagP, setTagP] = useState(String(settings.tagPresets || ''));
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const onDrop = async (targetId: string) => {
    setOverId(null);
    if (!dragId || dragId === targetId) return;
    const ids = modules.map((m) => m.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await api.modules.reorder(ids);
    await reloadModules();
    setDragId(null);
  };

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= modules.length) return;
    const ids = modules.map((m) => m.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api.modules.reorder(ids);
    await reloadModules();
  };

  return (
    <>
      <div className="card">
        <h3><Icon name="note" size={14} />日记</h3>
        <Row
          label="新的一天从几点开始"
          sub="设成 4 点，凌晨 2 点写的仍算前一天"
          kw="日界线 新的一天 凌晨 算哪天 归到前一天"
        >
          <select
            className="inp" style={{ width: 130 }}
            value={String(settings.dayStart ?? '0')}
            onChange={(e) => void setSetting('dayStart', e.target.value)}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((h) => (
              <option key={h} value={h}>{h === 0 ? '0 点（自然日）' : `${h} 点`}</option>
            ))}
          </select>
        </Row>
        <Row
          label="输入即格式化"
          sub="打字时 **粗体** / [b]粗[/b] / $x^2$ / # 标题 当场变成样式；关了就是普通文本"
          kw="markdown bbcode latex 语法 即时 转换 输入 格式化 快速"
        >
          <Chips
            value={String(settings.liveMarkup ?? '1')}
            items={[['1', '开启'], ['0', '关闭']]}
            onPick={(v) => void setSetting('liveMarkup', v)}
          />
        </Row>
        <Row
          label="标签预设"
          sub="写日记时一键加这些标签；逗号分隔，留空则不显示"
          kw="标签 预设 tags 常用标签"
        >
          <input
            className="inp"
            style={{ width: 240 }}
            value={tagP}
            placeholder="工作, 生活, 灵感"
            onChange={(e) => setTagP(e.target.value)}
            onBlur={() => { if (tagP !== String(settings.tagPresets || '')) void setSetting('tagPresets', tagP); }}
          />
        </Row>

        <Row label="模块工具按钮" sub="关掉后模块头部只留标题，界面更干净" kw="模块 按钮 上移 下移 隐藏 干净">
          <Chips
            value={String(settings.moduleTools ?? '1')}
            items={[['1', '显示'], ['0', '隐藏（悬停才出现）']]}
            onPick={(v) => void setSetting('moduleTools', v)}
          />
        </Row>

        {/* 第 211 条：首页「给自己的一句话」之前只有展示、没有编辑入口 */}
        <Row
          label="给自己的一句话"
          sub="首页顶部那句话的内容。可以写文字、选一张图、或选一段音频；每天轮换一条"
          kw="打气 鼓励 一句话 首页 欢迎 文字 图片 音频 鸡汤 激励 encourage"
          stack
        >
          <EncourageEditor />
        </Row>
        <div className="small muted" style={{ marginTop: 6, lineHeight: 1.8 }}>
          「今天」页里的模块只负责写，不再放排序按钮 —— 顺序、改名、增删都在下面这张表里。
        </div>
      </div>

      <div className="card">
        <h3>日记模块 <span className="muted">拖动或点箭头调顺序 · 开关控制显示</span></h3>
        <div className="small muted" style={{ marginBottom: 8 }}>
          这里的顺序就是「今天」页里从上到下的顺序。隐藏的模块也留着位置，重新打开时回到原处。
        </div>
        {/* 第 14 条：排序方式要能选。之前只有默认值 moduleSortMode，前端从不读取。 */}
        <Row label="排序方式" sub="下面的列表按哪种方式调顺序" kw="排序 拖动 上下移 模块顺序">
          <Chips
            value={String(settings.moduleSortMode || 'both')}
            items={[
              ['both', '拖动 + 箭头'],
              ['drag', '只能拖动'],
              ['buttons', '只能点箭头'],
              ['off', '锁定不动'],
            ]}
            onPick={(v) => void setSetting('moduleSortMode', v)}
          />
        </Row>
        <div className="modlist">
          {modules.map((m, i) => {
            // 第 14 条：排序方式设成「只能点箭头 / 锁定」时，拖动手柄和 draggable 都要失效，
            // 否则用户选了什么却还能拖，等于开关没作用。
            const sortMode = String(settings.moduleSortMode || 'both');
            const canDrag = sortMode === 'both' || sortMode === 'drag';
            const canBtn = sortMode === 'both' || sortMode === 'buttons';
            return (
            <div
              key={m.id}
              className={`moditem ${dragId === m.id ? 'drag' : ''} ${overId === m.id ? 'over' : ''}`}
              draggable={canDrag}
              onDragStart={() => { if (canDrag) setDragId(m.id); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => { if (!canDrag) return; e.preventDefault(); if (m.id !== dragId) setOverId(m.id); }}
              onDragLeave={() => setOverId((x) => (x === m.id ? null : x))}
              onDrop={(e) => { if (!canDrag) return; e.preventDefault(); void onDrop(m.id); }}
            >
              <span className="grip" style={{ opacity: canDrag ? 1 : 0.25 }}>≡</span>
              <span className="nm" style={{ opacity: m.enabled ? 1 : 0.5 }}>{m.title}</span>
              <span className="ty">{TYPE_NAME[m.type] || m.type}</span>
              <button className="btn sm ghost" data-act="up" disabled={!canBtn || i === 0} onClick={() => void move(i, -1)} title="上移">↑</button>
              <button className="btn sm ghost" data-act="down" disabled={!canBtn || i === modules.length - 1} onClick={() => void move(i, 1)} title="下移">↓</button>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  const v = await askText('模块名称', m.title);
                  if (v && v.trim()) {
                    await api.modules.update({ id: m.id, title: v.trim() });
                    await reloadModules();
                  }
                }}
              >改名</button>
              <button
                className="btn sm ghost reset"
                title="恢复初始样式：标题、输入方式、评分上限全部回到默认"
                onClick={async () => {
                  await api.modules.update({ id: m.id, title: TYPE_NAME[m.type] || m.title, config: {} });
                  await reloadModules();
                  toast('已恢复「' + (TYPE_NAME[m.type] || m.title) + '」的默认样式');
                }}
              ><Icon name="reset" size={13} /></button>
              <Switch
                on={m.enabled === 1}
                onClick={async () => {
                  await api.modules.update({ id: m.id, enabled: m.enabled ? 0 : 1 });
                  await reloadModules();
                }}
              />
              <button
                className="btn sm ghost"
                onClick={async () => {
                  if (!confirm('删除这个模块？它里面的内容会一起删掉。')) return;
                  await api.modules.remove(m.id);
                  await reloadModules();
                }}
              >✕</button>
            </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <select
            className="inp" style={{ width: 180, flex: '0 0 auto' }}
            value={newType} onChange={(e) => setNewType(e.target.value)}
          >
            {Object.keys(TYPE_NAME).map((t) => <option key={t} value={t}>{TYPE_NAME[t]}</option>)}
          </select>
          <button
            className="btn"
            onClick={async () => {
              await api.modules.add(newType, TYPE_NAME[newType] || newType);
              await reloadModules();
            }}
          >添加模块</button>
          <span className="small muted">同一个模块可以加多个，比如两个「小标题」</span>
        </div>
      </div>
    </>
  );
}

/* ---------------- 打卡 ---------------- */

function HabitsSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const habits = useStore((s) => s.habits);
  const reloadHabits = useStore((s) => s.reloadHabits);
  const toast = useStore((s) => s.toast);

  return (
    <div className="card">
      <h3><Icon name="check-circle" size={14} />打卡</h3>
      <Row
        label="习惯排序方式"
        sub="打卡页里怎么调习惯的顺序；和日记模块的排序是分开的"
        kw="习惯 排序 拖动 上下移 打卡 顺序"
      >
        <Chips
          value={(settings.habitSortMode as string) || 'drag'}
          items={[['buttons', '只用上移下移'], ['drag', '只能拖动'], ['both', '两种都行'], ['off', '固定不排序']]}
          onPick={(v) => void setSetting('habitSortMode', v)}
        />
      </Row>
      <Row label="今日打卡显示备注框" sub="每个习惯下面那行小字输入" kw="备注 记录 说明 打卡">
        <Switch
          on={String(settings.habitNote ?? '1') === '1'}
          onClick={() => void setSetting('habitNote', String(settings.habitNote ?? '1') === '1' ? '0' : '1')}
        />
      </Row>
      <Row
        label="每天提醒打卡"
        sub="到点还有没打的卡就提醒你一下；当天已经打完就不打扰"
        kw="打卡 提醒 催 定时 别忘了 到点"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            className="inp"
            type="time"
            style={{ width: 108 }}
            value={String(settings.habitRemindAt || '21:00')}
            onChange={(e) => void setSetting('habitRemindAt', e.target.value || '21:00')}
          />
          <Switch
            on={String(settings.habitRemindOn ?? '0') === '1'}
            onClick={() => void setSetting('habitRemindOn', String(settings.habitRemindOn ?? '0') === '1' ? '0' : '1')}
          />
        </div>
      </Row>
      <div className="small muted" style={{ marginTop: -4, marginBottom: 8 }}>
        提醒只在软件开着（或缩在托盘）时响。点一下看看现在还剩哪些：
        <button
          className="linkbtn"
          style={{ marginLeft: 6 }}
          onClick={() => {
            void (async () => {
              try {
                const r = await api.habitRemind.preview();
                toast(r.count ? `还有 ${r.count} 项没打卡：${r.names.join('、')}` : '今天的卡都打完了，提醒不会响');
              } catch { toast('查不到，稍后再试'); }
            })();
          }}
        >
          试算一次
        </button>
      </div>

      {/* 第 21 条：节日提醒。以前节日只在日历里躺着，不主动说一声 */}
      <Row
        label="节日前提醒"
        sub="快到节日时说一声；选「当天」就只在节日当天提醒"
        kw="节日 节假日 提醒 中秋 春节 提前 预告 festival"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select
            className="inp" style={{ width: 120 }}
            value={String(settings.festivalRemindLead ?? '1')}
            onChange={(e) => void setSetting('festivalRemindLead', e.target.value)}
          >
            <option value="0">当天</option>
            <option value="1">提前 1 天</option>
            <option value="3">提前 3 天</option>
            <option value="7">提前 7 天</option>
            <option value="14">提前 14 天</option>
          </select>
          <input
            className="inp"
            type="time"
            style={{ width: 108 }}
            value={String(settings.festivalRemindAt || '08:00')}
            onChange={(e) => void setSetting('festivalRemindAt', e.target.value || '08:00')}
            title="每天几点之后才提醒，免得深夜弹"
          />
          <Switch
            on={String(settings.festivalRemindOn ?? '1') === '1'}
            onClick={() => void setSetting('festivalRemindOn', String(settings.festivalRemindOn ?? '1') === '1' ? '0' : '1')}
          />
        </div>
      </Row>
      <div className="small muted" style={{ marginTop: -4, marginBottom: 8 }}>
        节日当天会响一声，提前预告只出一条提示不打扰。点一下看看接下来会提醒什么：
        <button
          className="linkbtn"
          style={{ marginLeft: 6 }}
          onClick={() => {
            void (async () => {
              try {
                const r = await api.festival.remindPreview();
                if (!r.count) { toast('这段时间没有节日'); return; }
                const parts = r.names.map((n: string, i: number) => r.days[i] === 0 ? `今天 ${n}` : `${r.days[i]} 天后 ${n}`);
                toast(parts.join('、'));
              } catch { toast('查不到，稍后再试'); }
            })();
          }}
        >
          试算一次
        </button>
      </div>

      <div className="small muted" style={{ margin: '14px 0 6px' }}>现有习惯</div>
      {habits.length ? habits.map((h) => (
        <div className="hrow" key={h.id}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: h.color }} />
          <span className="nm" style={{ opacity: h.archived ? 0.45 : 1, textDecoration: h.archived ? 'line-through' : 'none' }}>
            {h.name}
          </span>
          <span className="num">{h.type} · 连续 {h.streak} · 共 {h.total}</span>
          <button
            className="btn sm ghost"
            onClick={async () => {
              const v = await askText('习惯名称', h.name);
              if (v && v.trim()) { await api.habits.update({ id: h.id, name: v.trim() }); await reloadHabits(); }
            }}
          >改名</button>
          <button
            className="btn sm ghost"
            onClick={async () => { await api.habits.update({ id: h.id, archived: h.archived ? 0 : 1 }); await reloadHabits(); }}
          >{h.archived ? '恢复' : '归档'}</button>
        </div>
      )) : <div className="empty small">还没有习惯，去「打卡」页添加。</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm" onClick={() => void useStore.getState().go('habits')}>去打卡页管理 →</button>
        <span className="small muted">新增、类型、单位、目标都在那边，那里才是高频入口</span>
      </div>
    </div>
  );
}

/* ---------------- 番茄钟 ---------------- */

function PomoSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const pomo = useStore((s) => s.pomo);
  const savePresets = useStore((s) => s.pomoSavePresets);

  const editList = async (kind: 'focus' | 'break') => {
    const cur = (kind === 'focus' ? pomo.presets : pomo.breakPresets).join(',');
    const v = await askText(
      kind === 'focus' ? '自定义专注时长预设' : '自定义休息时长预设',
      cur,
      '用逗号分隔，单位分钟，如 20,30,50',
    );
    if (v == null) return;
    const list = v.split(/[,，\s]+/).map(Number).filter((n) => n > 0);
    if (!list.length) return;
    await savePresets(kind, list);
  };

  return (
    <div className="card">
      <h3><Icon name="timer" size={14} />学习 / 番茄钟</h3>
      {/* 第 228 条：模块可以改名。有人叫「学习」，有人叫「专注」，有人就想叫「番茄钟」 */}
      <Row label="模块叫什么" sub="导航里显示的名字。改成「学习」「专注」都行" kw="模块 名字 改名 番茄钟 学习">
        <input
          className="inp" style={{ width: 160 }} maxLength={10}
          placeholder="学习"
          value={String(settings.pomoModuleName || '学习')}
          onChange={(e) => void setSetting('pomoModuleName', e.target.value || '学习')}
        />
        <span className="val">导航上显示的字</span>
      </Row>
      {/*
        第 226 条：番茄钟默认不是非得 25 分钟。之前只有「当前专注时长」跟着上一次选择走，
        关掉软件再开还是 25。这里给一个明确的「默认时长」，冷启动就按它来。
      */}
      <Row label="默认专注时长" sub="打开软件时的初始专注分钟数" kw="默认 时长 25 分钟 番茄">
        <input
          type="number" className="inp" style={{ width: 90 }} min={1} max={180}
          value={Number(settings.pomoFocus) || 25}
          onChange={(e) => void setSetting('pomoFocus', e.target.value)}
        />
        <span className="val">分钟</span>
      </Row>
      <Row label="默认休息时长" sub="打开软件时的初始休息分钟数" kw="默认 休息 时长 分钟">
        <input
          type="number" className="inp" style={{ width: 90 }} min={1} max={120}
          value={Number(settings.pomoBreak) || 5}
          onChange={(e) => void setSetting('pomoBreak', e.target.value)}
        />
        <span className="val">分钟</span>
      </Row>
      <Row label="专注预设" sub={pomo.presets.map((n) => `${n}分`).join(' · ')} kw="预设 时长 专注 番茄 自定义">
        <button className="btn sm" onClick={() => void editList('focus')}>编辑预设</button>
        <span className="val">{pomo.presets.length} 个</span>
      </Row>
      <Row label="休息预设" sub={pomo.breakPresets.map((n) => `${n}分`).join(' · ')} kw="休息 时长 预设 自定义">
        <button className="btn sm" onClick={() => void editList('break')}>编辑预设</button>
        <span className="val">{pomo.breakPresets.length} 个</span>
      </Row>
      <Row label="当前休息时长" kw="休息 时长 分钟">
        <input
          type="number" className="inp" style={{ width: 90 }} min={1} max={120}
          value={pomo.breakMin}
          onChange={(e) => void useStore.getState().pomoSetBreak(Math.max(1, Number(e.target.value) || 5))}
        />
        <span className="val">分钟</span>
      </Row>
      <Row label="每几颗进入长休息" kw="长休息 循环 每几颗">
        <input
          type="number" className="inp" style={{ width: 90 }} min={0} max={12}
          value={Number(settings.pomoLongBreakEvery) || 4}
          onChange={(e) => void setSetting('pomoLongBreakEvery', e.target.value)}
        />
        <span className="val">颗（0 = 不用长休息）</span>
      </Row>
      <Row label="长休息时长" kw="长休息 时长">
        <input
          type="number" className="inp" style={{ width: 90 }} min={1} max={120}
          value={Number(settings.pomoLongBreak) || 20}
          onChange={(e) => void setSetting('pomoLongBreak', e.target.value)}
        />
        <span className="val">分钟</span>
      </Row>
      <Row label="自动进入下一段" sub="一颗结束自动开始休息，休息完自动开始下一颗" kw="自动 连续 下一段">
        <Switch
          on={String(settings.pomoAutoNext ?? '1') === '1'}
          onClick={() => void setSetting('pomoAutoNext', String(settings.pomoAutoNext ?? '1') === '1' ? '0' : '1')}
        />
      </Row>
    </div>
  );
}

/* ---------------- 提醒 ---------------- */

function NotifySection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [list, setList] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => { void api.music.list().then((m) => setList(m.map((x) => ({ id: x.id, name: x.name })))).catch(() => null); }, []);

  return (
    <div className="card">
      <h3><Icon name="bell" size={14} />到点提醒</h3>
      <Row label="桌面右下角弹窗" sub="自绘窗口，不抢焦点，点击回到主界面" kw="弹窗 桌面 右下角 提醒">
        <Switch on={String(settings.notifyDesktop ?? '1') === '1'} onClick={() => void setSetting('notifyDesktop', String(settings.notifyDesktop ?? '1') === '1' ? '0' : '1')} />
      </Row>
      <Row label="系统通知（托盘气泡）" sub="走 Windows 通知中心，勿扰模式下会被系统静音" kw="系统通知 托盘 气泡 通知中心">
        <Switch on={String(settings.notifyTray ?? '0') === '1'} onClick={() => void setSetting('notifyTray', String(settings.notifyTray ?? '0') === '1' ? '0' : '1')} />
      </Row>
      <Row label="播放提示音" kw="声音 提示音 音乐 响铃">
        <Switch on={String(settings.notifySound ?? '1') === '1'} onClick={() => void setSetting('notifySound', String(settings.notifySound ?? '1') === '1' ? '0' : '1')} />
      </Row>
      <Row label="提示音来源" sub="内置是合成的风铃音，也可以选音乐库里的音频" kw="提示音 音乐 选择 音频 内置">
        <select
          className="inp" style={{ width: 220 }}
          value={String(settings.notifySoundId ?? '')}
          onChange={(e) => void setSetting('notifySoundId', e.target.value)}
        >
          <option value="">内置风铃音</option>
          {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button
          className="btn sm"
          onClick={() => {
            // 第 147 条：之前只弹一个预览窗，选「内置风铃音」的人听不到声音，以为坏了。
            // 试听就该真的响 —— force 绕过「播放提示音」开关，跟设置页预览的语义一致。
            playChime(1, true);
            void api.notify.test();
          }}
        >
          试听
        </button>
      </Row>
      <Row
        label="界面提示条停留"
        sub="右下角那种小提示。选「不自动消失」就要自己点 ✕"
        kw="提示 toast 消失 时间 停留 关闭"
      >
        <Chips
          value={String(settings.toastMs ?? '2600')}
          items={[['1500', '1.5 秒'], ['2600', '2.6 秒'], ['4000', '4 秒'], ['0', '不自动消失']]}
          onPick={(v) => void setSetting('toastMs', v)}
        />
      </Row>

      <Row label="音量" kw="音量 声音 大小">
        <input
          type="range" min={0} max={100} step={5} style={{ width: 150 }}
          value={Number(settings.notifyVolume ?? 70)}
          onChange={(e) => void setSetting('notifyVolume', e.target.value)}
        />
        <span className="val">{Number(settings.notifyVolume ?? 70)}%</span>
      </Row>
      <Row label="弹窗停留时间" sub="到点弹出的提醒窗自己关掉用多久（应用内那条小提示在上面的「界面提示条停留」）" kw="弹窗 时长 秒 停留 popup">
        <input
          type="number" className="inp" style={{ width: 90 }} min={2} max={60}
          value={Number(settings.notifyDuration) || 8}
          onChange={(e) => void setSetting('notifyDuration', e.target.value)}
        />
        <span className="val">秒</span>
      </Row>

      <div className="sep-line" />
      <h3 style={{ marginTop: 4 }}><Icon name="mute" size={14} />勿扰</h3>
      <Row label="开启勿扰时段" sub="这段时间里只写库、不弹窗不响铃" kw="勿扰 免打扰 免噪音 夜间">
        <Switch on={String(settings.dndEnabled ?? '0') === '1'} onClick={() => void setSetting('dndEnabled', String(settings.dndEnabled ?? '0') === '1' ? '0' : '1')} />
      </Row>
      <Row label="勿扰时间" kw="勿扰 时间 时段 夜里">
        <input type="time" className="inp" style={{ width: 110 }} value={String(settings.dndFrom || '22:00')} onChange={(e) => void setSetting('dndFrom', e.target.value)} />
        <span className="muted">至</span>
        <input type="time" className="inp" style={{ width: 110 }} value={String(settings.dndTo || '07:00')} onChange={(e) => void setSetting('dndTo', e.target.value)} />
      </Row>
      <Row label="专注时不打扰休息提醒以外的一切" sub="目前番茄钟只在段落结束时提醒，此项保留给后续的待办提醒" kw="专注 不打扰 番茄">
        <Switch on={String(settings.dndDuringPomo ?? '1') === '1'} onClick={() => void setSetting('dndDuringPomo', String(settings.dndDuringPomo ?? '1') === '1' ? '0' : '1')} />
      </Row>
      <div className="small muted" style={{ marginTop: 8 }}>
        弹窗与提示音都在本机，不联网。窗口收进托盘后仍然有效。
      </div>
    </div>
  );
}

/* ---------------- 数据 ---------------- */

function DataSection({ onMedia, diag }: { onMedia: () => void; diag: Diagnostics | null }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const dbPath = useStore((s) => s.dbPath);
  const mediaList = useStore((s) => s.mediaList);
  const reloadMedia = useStore((s) => s.reloadMedia);
  const toast = useStore((s) => s.toast);
  const [importOpen, setImportOpen] = useState(false);
  const [json, setJson] = useState('');

  return (
    <>
      <div className="card">
        <h3><Icon name="grid" size={14} />多媒体库 <span className="muted">{mediaList.length} 项</span></h3>
        <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.9 }}>
          图片、音频、视频都在这一个库里，导航栏「多媒体库」也是它。每项以<b>内容哈希</b>为唯一 id：
          同名不同文件不会覆盖、不会串；同一个文件重复导入自动去重。日记里存的是 id，改显示名不影响已引用的地方。
        </div>
        <div className="row">
          <button className="btn primary" onClick={onMedia}>浏览 / 管理</button>
          <button
            className="btn"
            onClick={async () => {
              const r = await api.media.importFiles();
              if (r?.items?.length) {
                const ok = r.items.filter((x) => x.ok).length;
                const dup = r.items.filter((x) => x.ok && x.dup).length;
                if (ok) toast(`导入 ${ok} 个${dup ? `，${dup} 个内容重复已去重` : ''}`);
              }
              await reloadMedia();
            }}
          >从电脑导入</button>
          <button
            className="btn"
            onClick={async () => {
              const r = await api.media.scan();
              toast(r?.count ? `扫描到 ${r.count} 个文件` : '投递区是空的（多媒体库_导入）');
              await reloadMedia();
            }}
          >扫描投递区</button>
          <button
            className="btn"
            onClick={async () => {
              const r = await api.media.rebuildThumbs();
              toast(r?.count ? `重建了 ${r.count} 张缩略图` : '没有需要重建的');
              await reloadMedia();
            }}
          >重建缩略图</button>
        </div>
      </div>

      <div className="card">
        <h3><Icon name="database" size={14} />数据位置</h3>
        <Row label="数据库文件" kw="路径 数据库 位置 sqlite">
          <div className="pathbox" style={{ flex: 1 }}>{dbPath}</div>
        </Row>
        <div className="row">
          <button className="btn" onClick={() => void api.app.openRoot()}>打开数据文件夹</button>
          <button className="btn" onClick={() => void api.app.openMedia()}>打开媒体文件夹</button>
          <button
            className="btn"
            onClick={async () => {
              const r = await api.app.changeRoot();
              if (r?.ok) { await useStore.getState().init(); toast(`已迁移到 ${r.root}`); }
              else if (r?.err) toast(r.err);
            }}
          >迁移到别的目录…</button>
        </div>
      </div>

      <div className="card">
        <h3><Icon name="external" size={14} />导出</h3>
        <div className="small muted" style={{ marginBottom: 10 }}>都写到数据目录的「导出」文件夹，不经过网络。</div>
        <div className="row">
          {(['json', 'md', 'csv', 'html'] as const).map((k) => (
            <button
              key={k} className="btn"
              onClick={async () => {
                const r = await api.exportAs(k);
                if (r?.ok) toast(`已导出 ${r.path.split(/[\\/]/).pop()}`);
              }}
            >日记 {k.toUpperCase()}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={async () => {
              const r = await api.settingsIO.exportFile();
              if (r.ok) toast(`设置已导出（${r.count} 项）`);
            }}
          >导出设置</button>
          <button className="btn" onClick={() => setImportOpen(true)}>导入设置…</button>
          <span className="small muted">只含偏好项，不含密码与设备标识</span>
        </div>
      </div>

      <div className="card">
        <h3><Icon name="database" size={14} />缓存策略</h3>
        <Row label="缓存保留天数" sub="超过就允许被清理" kw="缓存 保留 天数 自动清理">
          <input
            type="number" className="inp" style={{ width: 90 }} min={1} max={3650}
            value={Number(settings.cacheDays) || 30}
            onChange={(e) => void setSetting('cacheDays', e.target.value)}
          />
          <span className="val">天</span>
        </Row>
        <Row label="总大小上限" kw="缓存 大小 上限 容量">
          <input
            type="number" className="inp" style={{ width: 100 }} min={64} max={10240}
            value={Number(settings.cacheMaxMB) || 512}
            onChange={(e) => void setSetting('cacheMaxMB', e.target.value)}
          />
          <span className="val">MB</span>
        </Row>
        <Row label="超过多少提醒" kw="缓存 提醒 阈值 警告">
          <input
            type="number" className="inp" style={{ width: 100 }} min={32} max={10240}
            value={Number(settings.cacheWarnMB) || 400}
            onChange={(e) => void setSetting('cacheWarnMB', e.target.value)}
          />
          <span className="val">MB</span>
        </Row>
        <Row label="缓存音频" sub="网络音频是否存到本机，关掉则每次联网取" kw="缓存 音频 音乐 离线">
          <Switch
            on={String(settings.cacheAudio ?? '1') === '1'}
            onClick={() => void setSetting('cacheAudio', String(settings.cacheAudio ?? '1') === '1' ? '0' : '1')}
          />
        </Row>
        <Row label="允许缓存的文件后缀" sub="逗号分隔，不在名单里的不会下载" kw="后缀 扩展名 类型 格式">
          <input
            className="inp" style={{ flex: 1 }}
            value={String(settings.cacheSuffix || '')}
            onChange={(e) => void setSetting('cacheSuffix', e.target.value)}
            placeholder="jpg,png,mp3,m4a,wav,mp4"
          />
        </Row>
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          {/* 第 26 条：以前勾了「缓存到本地」也不会真的下载 —— 没有下载代码。
              现在补了后端 media.cacheAll，这个按钮才是真的在干活。 */}
          <button
            className="btn sm"
            onClick={async () => {
              const r = await api.music.cacheAll();
              if (r.total === 0) toast('没有需要缓存的网络音频');
              else if (r.failed) toast(`缓存完成：成功 ${r.done}，失败 ${r.failed}${r.err ? '（' + r.err + '）' : ''}`);
              else toast(`已缓存 ${r.done} 个音频到本机`);
            }}
          >立即缓存全部网络音频</button>
          <button className="btn sm ghost" onClick={() => void useStore.getState().go('profile')}>查看占用 / 立即清理 →</button>
        </div>
        <div className="small muted" style={{ marginTop: 6, lineHeight: 1.7 }}>
          关掉「缓存音频」或不改上面的后缀，都会直接影响上面这个按钮 —— 它会被拦下来并告诉你原因。
        </div>
      </div>

      {diag ? (
        <div className="card">
          <h3>数据体检</h3>
          <div className="pathbox" style={{ lineHeight: 1.9 }}>
            设备标识 {diag.device}<br />
            条目 {diag.entries} · 图片 {diag.media} · 待办 {diag.todos} · 习惯 {diag.habits} · 关联 {diag.links} · 番茄 {diag.pomodoro}<br />
            变更日志 {diag.changes} 条（序号至 {diag.lastSeq}）· 主键类型 {diag.idTypes?.todos}
          </div>
        </div>
      ) : null}

      {/*
        诊断日志放「数据」页而不是「关于」页：用户报错时该往「数据」里找，
        「关于」是看版本号的地方，没人会去那儿翻日志。
        折叠起来是因为它平时没用 —— 展开后是一屏 340px 的等宽日志，
        常驻会让整个设置页重心跑偏。
      */}
      <div className="card">
        <h3><Icon name="database" size={14} />诊断日志</h3>
        <details>
          <summary className="small muted" style={{ cursor: 'pointer', padding: '2px 0 8px' }}>
            出问题时先来这里 —— 错误都写在本机文件里，点开能一键复制发给我
          </summary>
          <DiagPanel />
        </details>
      </div>

      {importOpen ? (
        <Dialog
          title="导入设置"
          onClose={() => setImportOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setImportOpen(false)}>取消</button>
            <button
              className="btn primary"
              onClick={async () => {
                const r = await api.settingsIO.importFile(json);
                if (!r.ok) { toast(r.err || '导入失败'); return; }
                setImportOpen(false);
                await useStore.getState().init();
                toast(`已导入 ${r.count} 项设置`);
              }}
            >导入</button>
          </>}
        >
          <div className="small muted" style={{ marginBottom: 8 }}>
            把之前导出的「日签设置-*.json」内容粘进来。也可以在「数据与缓存」页先导出。
          </div>
          <textarea
            className="inp" style={{ width: '100%', minHeight: 180, fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 12 }}
            value={json} onChange={(e) => setJson(e.target.value)}
            placeholder='{"_type":"riqian-settings", ...}'
          />
        </Dialog>
      ) : null}
    </>
  );
}

/* ---------------- 关于 ---------------- */

function AboutSection({ diag }: { diag: Diagnostics | null }) {
  return (
    <div className="card">
      <h3><Icon name="shield" size={14} />关于日签</h3>
      <div className="about">
        <div className="about-mark">签</div>
        <div>
          <div className="about-t">日签 · 打卡日记本</div>
          <div className="small muted">v9 · 本地单机 · 无服务器 · 无网络请求</div>
        </div>
      </div>
      <div className="kv"><span>数据存储</span><b>SQLite 单文件，在本机磁盘</b></div>
      <div className="kv"><span>网络</span><b>零请求（音频链接除外，由你主动添加）</b></div>
      <div className="kv"><span>隐私</span><b>不登录、不上传、不埋点</b></div>
      <div className="kv"><span>密码</span><b>本地校验，数据文件未加密</b></div>
      {diag ? <div className="kv"><span>设备标识</span><b>{diag.device}</b></div> : null}

      {/* 说明书 / 更新日志 / 联系我们：查阅型内容放这儿，不占侧栏 */}
      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => void useStore.getState().go('manual')}>
          <Icon name="book" size={13} />使用说明书
        </button>
        <button className="btn sm" onClick={() => void useStore.getState().go('changelog')}>
          <Icon name="clock" size={13} />更新日志
        </button>
        <button className="btn sm" onClick={() => void useStore.getState().go('contact')}>
          <Icon name="question" size={13} />联系我们
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 12, lineHeight: 1.9 }}>
        快捷键：Ctrl+S 保存 · Ctrl+K 命令面板 · Ctrl+Shift+D 写日记 · F1 全部快捷键<br />
        全局热键（唤出 / 老板键 / 快速记录）在「快捷键」页里改。<br />
        数据目录可以整个拷走，换电脑直接放回去。
      </div>
    </div>
  );
}


/** 实验性功能（第 104/105 条）：默认全关，开关集中在这里 */
function ExpSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const on = String(settings.experimental ?? '0') === '1';
  return (
    <div className="card">
      <h3><Icon name="sparkle" size={14} />实验性功能</h3>
      <div className="small muted" style={{ lineHeight: 1.9, marginBottom: 10 }}>
        这里的东西默认关闭，可能不完整、可能以后改掉。打开前不用备份，但别把重要流程只建在它们身上。
      </div>
      <Row label="启用实验性功能" sub="总开关。关掉后下面的项一律不生效" kw="实验 beta 开关">
        <Switch on={on} onClick={() => void setSetting('experimental', on ? '0' : '1')} />
      </Row>
      {on ? (
        <>
          <Row label="设置项逐条排序" sub="给每个分组里的条目加 ↑↓，按你自己的顺序排" kw="设置 条目 排序 顺序 实验">
            <span className="chip">开发中</span>
          </Row>
          <Row label="流的方向" sub="往哪边长、往哪个方向翻到更早的一天；流页面顶栏也能切" kw="流 方向 横向 纵向 上下 左右 实验">
            <Chips
              value={String(settings.flowDir || 'v')}
              items={[['v', '向下'], ['vr', '向上'], ['h', '向右'], ['hl', '向左']]}
              onPick={(v) => void setSetting('flowDir', v)}
            />
          </Row>
          <Row label="全局背景" sub="填色值（#f5f1e8）或多媒体的 id" kw="背景 全局 壁纸 实验">
            <input
              className="inp" style={{ width: 200 }} placeholder="#f5f1e8 或 媒体 id"
              value={String(settings.bgGlobal || '')}
              onChange={(e) => void setSetting('bgGlobal', e.target.value)}
            />
          </Row>
        </>
      ) : (
        <div className="empty small">打开总开关后，这里会出现实验项。</div>
      )}
    </div>
  );
}


/** 软件背景（第 113 条）：色值或媒体库里的图，图可以调色、设铺法与压暗程度 */
function GlobalBgDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const mediaList = useStore((s) => s.mediaList);
  const toast = useStore((s) => s.toast);

  const [sel, setSel] = useState(String(settings.bgGlobal || ''));
  const [opts, setOpts] = useState<BgOpts>(() => parseBg(String(settings.bgGlobalTone || '')));
  /* 第 176 条：高级参数（模糊 / 锐化 / 色温…）默认收起 —— 它们不常用，
     全摊开会把「铺法 / 压暗」这两个真正常调的挤到看不见。 */
  const [adv, setAdv] = useState(false);
  /* 第 179 条：轮换配置。初值从 settings 读，改完点「应用」才一起落库 ——
     否则每点一下「30 秒」都写一次库，一次配置要写七八次盘。 */
  const [rotSec, setRotSec] = useState(() => parseRotate(settings.bgRotate, settings.bgRotateList).sec);
  const [rotIds, setRotIds] = useState<string[]>(() => parseRotate(settings.bgRotate, settings.bgRotateList).ids);

  const images = mediaList.filter((m) => (m.kind || 'image') === 'image');
  const isImg = !!sel && !sel.startsWith('#');
  const src = isImg ? imgUrl(sel) : '';

  const apply = async (next: string, o: BgOpts) => {
    const tone = next && !next.startsWith('#') ? bgJson(o) : '';
    await setSetting('bgGlobal', next);
    await setSetting('bgGlobalTone', tone);
    /* 第 179 条：轮换配置跟着一起落库，别让用户以为只有单选的那张生效了 */
    await setSetting('bgRotate', String(rotSec));
    await setSetting('bgRotateList', JSON.stringify(rotIds));
    // 立刻重算 CSS 变量：设置项是异步落库的，不主动刷会"点了没反应"
    applyAppearance({ ...settings, bgGlobal: next, bgGlobalTone: tone } as never);
    toast(rotSec > 0 && rotIds.length > 1
      ? `背景已更新，每 ${rotSec} 秒换一张（共 ${rotIds.length} 张）`
      : (next ? '背景已更新' : '已恢复默认背景'));
    onClose();
  };

  return (
    <Dialog
      title="软件背景"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={() => void apply('', BG_ONE)}>恢复默认</button>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => void apply(sel, opts)}>应用</button>
      </>}
    >
      <div style={{ position: 'relative', height: 150, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', marginBottom: 14, background: 'var(--panel2)' }}>
        {isImg ? (
          <>
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, ...bgLayerStyle(src, opts) }} />
            {opts.veil > 0.01 ? <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'var(--panel)', opacity: opts.veil }} /> : null}
          </>
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: sel || 'var(--panel2)' }} />
        )}
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'grid', gridTemplateColumns: 'var(--navw) 1fr' }}>
          <div style={{ background: 'var(--side)', opacity: 0.94 }} />
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <div style={{ height: 26, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--line)' }} />
            <div style={{ height: 46, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }} />
            <div className="small muted">卡片是实心的，图只铺在墙面上 —— 所以不会影响读字</div>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <span className="small muted">底色</span>
        {['#f5f1e8', '#eff2f6', '#f3eee9', '#eaf0ea', '#f0ecf5', '#1e1c18', '#101214'].map((c) => (
          <div
            key={c}
            onClick={() => setSel(c)}
            style={{
              width: 28, height: 28, borderRadius: 8, cursor: 'pointer', background: c,
              border: `2px solid ${sel === c ? 'var(--accent)' : 'var(--line)'}`,
            }}
          />
        ))}
      </div>

      {/* 第 209 条：这里原来写「图片库」—— 应用里明明叫「多媒体库」，同一个东西两个名字。
          现在统一成「多媒体库」，并且说清楚这里只列图片（背景只有图片能当）。 */}
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small muted">从多媒体库选图（{images.length} 张）</span>
        <span style={{ flex: 1 }} />
        {/* 第 197 条：设置里的背景要能直接导入，不该逼用户先跑去多媒体库页再回来 */}
        <button
          className="btn sm"
          title="从电脑导入文件到多媒体库，导完就在下面出现"
          onClick={async () => {
            const r = await api.media.importFiles().catch(() => ({ ok: false, items: [] }));
            const goods = (r.items || []).filter((x) => x.ok).length;
            if (goods) {
              await useStore.getState().reloadMedia();
              toast(`已导入 ${goods} 个文件`);
            }
          }}
        ><Icon name="plus" size={12} />从电脑导入</button>
        <button className="btn sm ghost" onClick={() => setSel('')}>不用图</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(84px,1fr))', gap: 8, maxHeight: '26vh', overflow: 'auto', marginBottom: 12 }}>
        {images.length ? images.slice(0, 120).map((m) => (
          <div key={m.id} className="imgpick" onClick={() => setSel(m.id)} style={{ cursor: 'pointer' }}>
            <div className="imgc" style={{ borderColor: sel === m.id ? 'var(--accent)' : 'var(--line)' }}>
              {/* 第 209 条：以前这里直接拼 imgUrl(m.id)，没缩略图的项会退成一段文字。
                  现在优先用缩略图地址，取不到就渲染一个色块占位，绝不让文件名冒充图片。 */}
              <BgThumb item={m} />
            </div>
          </div>
        )) : <div className="empty" style={{ gridColumn: '1/-1' }}>多媒体库里还没有图片。点上面的「从电脑导入」，或者去「多媒体库」页批量导入。</div>}
      </div>

      {isImg ? (
        <div className="card" style={{ padding: 14, background: 'var(--panel2)' }}>
          <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span className="small muted">铺法</span>
            {([['cover', '铺满'], ['contain', '完整显示'], ['tile', '平铺']] as [BgFit, string][]).map(([k, n]) => (
              <button key={k} className={`chip ${opts.fit === k ? 'on' : ''}`} onClick={() => setOpts({ ...opts, fit: k })}>{n}</button>
            ))}
            <span className="small muted" style={{ marginLeft: 10 }}>压暗</span>
            <input
              type="range" min={0} max={0.85} step={0.05} value={opts.veil}
              style={{ width: 110, accentColor: 'var(--accent)' }}
              onChange={(e) => setOpts({ ...opts, veil: Number(e.target.value) })}
            />
            <span className="small muted">{Math.round(opts.veil * 100)}%</span>
            {/*
              第 176 条：用户原话「软件背景图片放进去之后应该允许修改诸如模糊什么的。
              我看了一下，功能基本都有，就是没露出来」。
              确实是这样 —— Tone 里 blur 一直有、toneFilter 也一直在算，
              只是这里固定传 groups="basic" 把它挡住了。加个开关，不新增任何参数。
              第 176 条备注：模块背景（dialogs.tsx）早就有这个开关了，两边对齐。
            */}
            <button
              className="btn sm ghost"
              style={{ marginLeft: 'auto' }}
              data-act="bg-advanced"
              onClick={() => setAdv((v) => !v)}
            >
              {adv ? '收起高级' : '高级参数'}
            </button>
          </div>
          <ToneSliders tone={opts.t} onChange={(t) => setOpts({ ...opts, t })} groups={adv ? 'all' : 'basic'} />
        </div>
      ) : null}

      {/* 第 179 条：轮换。挑一组图，隔一会儿换一张。
          「当前显示第几张」故意不落库 —— 那是运行时状态，写进去只会让设置页数字乱跳。 */}
      <div className="card" style={{ padding: 14, background: 'var(--panel2)', marginTop: 12 }}>
        <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13 }}>背景轮换</b>
          <span className="small muted">挑两张以上的图，隔一段时间自动换一张</span>
        </div>

        <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <span className="small muted">每隔</span>
          {([0, 30, 60, 300, 900, 1800] as number[]).map((n) => (
            <button
              key={n}
              className={`chip ${rotSec === n ? 'on' : ''}`}
              onClick={() => setRotSec(n)}
            >{n === 0 ? '不轮换' : n < 60 ? `${n} 秒` : `${n / 60} 分钟`}</button>
          ))}
          <span className="small muted" style={{ marginLeft: 6 }}>自定义</span>
          <input
            type="number" min={0} max={3600} step={10}
            className="inp" style={{ width: 76 }}
            value={rotSec}
            onChange={(e) => setRotSec(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))}
          />
          <span className="small muted">秒</span>
        </div>

        <div className="row" style={{ marginBottom: 6 }}>
          <span className="small muted">轮换用的图（点一下加/去掉，{rotIds.length} 张已选）</span>
          <span className="sp" />
          <button className="btn sm ghost" onClick={() => setRotIds([])}>清空图池</button>
          <button
            className="btn sm ghost"
            title="把多媒体库里所有图片都加进图池"
            onClick={() => setRotIds(images.map((m) => m.id))}
          >全选</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(60px,1fr))', gap: 6, maxHeight: '20vh', overflow: 'auto' }}>
          {images.length ? images.map((m) => {
            const on = rotIds.includes(m.id);
            return (
              <div
                key={m.id}
                onClick={() => setRotIds((prev) => (on ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                title={on ? '已加入轮换，点一下去掉' : '点一下加入轮换'}
                style={{
                  position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden',
                  border: `2px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                  opacity: on ? 1 : 0.62,
                }}
              >
                <div style={{ aspectRatio: '1/1' }}><BgThumb item={m} /></div>
                {on ? (
                  <span style={{
                    position: 'absolute', right: 2, top: 2, width: 15, height: 15, borderRadius: '50%',
                    background: 'var(--accent)', color: '#fff', fontSize: 10, lineHeight: '15px', textAlign: 'center',
                  }}>{rotIds.indexOf(m.id) + 1}</span>
                ) : null}
              </div>
            );
          }) : <div className="empty small" style={{ gridColumn: '1/-1' }}>多媒体库里还没有图片</div>}
        </div>

        <div className="small muted" style={{ marginTop: 8, lineHeight: 1.8 }}>
          轮换只在软件运行期间发生，<b>不写数据库</b>；关掉软件再开，从第一张重新开始。
          图池少于两张时不会轮换。
        </div>
      </div>
    </Dialog>
  );
}


/** 一套图标的预览卡片：直接画 4 个真实图标，比只写名字有用得多 */
function IconSetCard({
  set, name, note, active, onPick,
}: {
  set: IconSetKey; name: string; note: string; active: boolean; onPick: () => void;
}) {
  const demo = ['pen', 'calendar', 'bell', 'user'];
  /**
   * 第 88 条：'custom' 这一套的数据不在 ICON_BODY 里，存在 settings.iconCustom，
   * 所以类型上要先把它摘掉，否则索引内置表越界。
   * 单独解析一次，预览就画用户真正导入的那几个图标。
   */
  const rawCustom = useStore((s) => s.settings.iconCustom as string | undefined);
  const customSet = useMemo(() => {
    if (set !== 'custom' || !rawCustom) return null;
    try {
      const o = JSON.parse(rawCustom) as { viewBox?: string; icons?: Record<string, string> };
      return { viewBox: o.viewBox || '0 0 24 24', icons: o.icons || {} };
    } catch { return null; }
  }, [rawCustom, set]);

  const ext: Exclude<IconSetKey, 'riqian' | 'custom'> | null =
    set === 'riqian' || set === 'custom' ? null : set;
  return (
    <div className={`iset ${active ? 'on' : ''}`} onClick={onPick} title={note}>
      <div className="iset-ico">
        {customSet ? demo.map((nm) => (
          <svg
            key={nm}
            width={17}
            height={17}
            viewBox={customSet.viewBox}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: customSet.icons[nm] || '' }}
          />
        )) : demo.map((nm) => (ext ? (
          <svg
            key={nm}
            width={17}
            height={17}
            viewBox={ICON_VIEWBOX[ext]}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: ICON_BODY[ext][nm] || '' }}
          />
        ) : (
          <svg
            key={nm}
            width={17}
            height={17}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {ICON_PATHS[nm as keyof typeof ICON_PATHS]}
          </svg>
        )))}
      </div>
      <div className="iset-n">{name}</div>
      <div className="iset-note">{note}</div>
    </div>
  );
}

/**
 * 第 88 条：导入图标组 / 自定义单枚。
 *
 * 用户原话：「也要允许用户自由选择组件组，或者导入组件组，或者自定义某个 icon，
 * 提供更多选择。」——
 *   自由选择 → 上面六张卡片
 *   导入整组 → 这个对话框左边那半
 *   自定义某个 → 这个对话框右边那半
 *
 * 关键一点：导入的图标是按「语义名」对上的（pen / calendar / bell …），
 * 所以导入完要立刻告诉用户「你这份包里有几枚真能用上」——
 * 否则导了 300 个图标以为生效了，实际一枚都没匹配上，那才叫坑人。
 */
function IconPackDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [oneName, setOneName] = useState<IconName>('pen');
  const [oneText, setOneText] = useState('');

  /** 现在存着的那一份（可能没有） */
  const current = useMemo(() => {
    const raw = settings.iconCustom as string | undefined;
    if (!raw) return null;
    try { return parseIconPack(raw); } catch { return null; }
  }, [settings.iconCustom]);

  /** 内置的语义名，用来判断导入的包能对上几枚 */
  const names = useMemo(() => Object.keys(ICON_PATHS) as IconName[], []);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try { return parseIconPack(text); } catch (e) { return { __err: (e as Error).message } as const; }
  }, [text]);
  const preview = parsed && !('__err' in parsed) ? parsed : null;
  const hitNames = preview ? names.filter((n) => preview.icons[n]) : [];

  const savePack = async (pack: { name: string; viewBox: string; icons: Record<string, string> }) => {
    const bad = checkPack(pack);
    if (bad) { setErr(bad); return; }
    await setSetting('iconCustom', JSON.stringify(pack));
    await setSetting('iconSet', 'custom');
    toast(`已启用「${pack.name}」，${Object.keys(pack.icons).length} 枚图标`);
    onClose();
  };

  return (
    <Dialog
      title="自定义图标组"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>关闭</button>
        <span className="sp" />
        <button
          className="btn primary"
          disabled={!preview}
          onClick={() => { if (preview) void savePack(preview); }}
        >{current ? '替换成这一份' : '导入并启用'}</button>
      </>}
    >
      <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.85 }}>
        图标按<b>名字</b>对应（pen、calendar、bell…），所以一份包不需要凑齐，
        有哪几枚就用哪几枚，缺的自动沿用内置那套。
        格式是 JSON：<code>{'{ "name": "我的图标组", "viewBox": "0 0 24 24", "icons": { "pen": "<path d=… />" } }'}</code>，
        值里直接放整段 <code>&lt;svg&gt;</code> 也认。
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn sm" onClick={() => fileRef.current?.click()}>
          <Icon name="folder" size={13} />选文件（.json / .svg）
        </button>
        <button className="btn sm ghost" onClick={() => { setText(''); setErr(''); }}>清空</button>
        <span className="sp" />
        {current ? <span className="small muted">当前：{current.name}（{Object.keys(current.icons).length} 枚）</span> : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.svg,.txt,application/json,image/svg+xml"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const raw = await readPackFile(f);
            // 单个 svg 文件没有图标名，用文件名当名字 —— 这是「自定义某一枚」最常见的入口
            if (/\.svg$/i.test(f.name)) {
              const base = f.name.replace(/\.svg$/i, '');
              setOneName((names.find((n) => n === base) || oneName) as IconName);
              setOneText(raw);
              setErr('');
              toast(`已读入 ${f.name}，下面的「单枚替换」里点应用`);
            } else {
              setText(raw);
              setErr('');
            }
          } catch (ex) { setErr((ex as Error).message); }
        }}
      />

      <textarea
        className="inp"
        style={{ width: '100%', minHeight: 120, fontFamily: 'ui-monospace,monospace', fontSize: 11.5 }}
        placeholder="把图标组 JSON 粘在这里（也可以选文件）"
        value={text}
        onChange={(e) => { setText(e.target.value); setErr(''); }}
      />

      {parsed && '__err' in parsed ? (
        <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>解析失败：{parsed.__err}</div>
      ) : null}
      {err ? <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</div> : null}

      {preview ? (
        <div className="card" style={{ marginTop: 10, padding: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <b>{preview.name}</b>
            <span className="small muted">viewBox {preview.viewBox}</span>
            <span className="sp" />
            <span className="small">共 {Object.keys(preview.icons).length} 枚，能对上 {hitNames.length} 枚</span>
          </div>
          <div className="iset-ico" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
            {names.filter((n) => preview.icons[n]).slice(0, 28).map((n) => (
              <svg
                key={n} width={18} height={18} viewBox={preview.viewBox} aria-hidden
                dangerouslySetInnerHTML={{ __html: preview.icons[n] }}
              />
            ))}
          </div>
          {hitNames.length === 0 ? (
            <div className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
              一枚都没对上 —— 键名得是 pen / calendar / bell / user 这类语义名，
              不是文件名也不是中文名。看看下面那份名单。
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 8, lineHeight: 1.75 }}>
              对上：{hitNames.join(' · ')}
            </div>
          )}
          <details style={{ marginTop: 8 }}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>全部可用名字（{names.length} 个）</summary>
            <div className="small muted" style={{ marginTop: 6, lineHeight: 1.8 }}>{names.join(' · ')}</div>
          </details>
        </div>
      ) : null}

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '14px 0' }} />

      {/* 「自定义某个 icon」：只换一枚，其余不动 */}
      <div className="row" style={{ marginBottom: 6 }}>
        <b>只换其中一枚</b>
        <span className="small muted">粘一段 svg 源码，或者上面选一个 .svg 文件</span>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <select
          className="inp" style={{ width: 150 }}
          value={oneName}
          onChange={(e) => setOneName(e.target.value as IconName)}
        >
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button
          className="btn sm"
          disabled={!oneText.trim()}
          onClick={() => {
            try {
              const merged = withOneIcon(current, oneName, oneText);
              void savePack(merged);
            } catch (e) { setErr((e as Error).message); }
          }}
        >应用到「{oneName}」</button>
        {oneText.trim() ? (
          <svg
            width={20} height={20} viewBox="0 0 24 24" aria-hidden
            dangerouslySetInnerHTML={{ __html: (() => { try { return svgToBody(oneText).body; } catch { return ''; } })() }}
          />
        ) : null}
      </div>
      <textarea
        className="inp"
        style={{ width: '100%', minHeight: 76, fontFamily: 'ui-monospace,monospace', fontSize: 11.5 }}
        placeholder='<svg viewBox="0 0 24 24"><path d="…" /></svg>'
        value={oneText}
        onChange={(e) => { setOneText(e.target.value); setErr(''); }}
      />
    </Dialog>
  );
}

/**
 * 背景选择器里的一格缩略图（第 209 条）。
 *
 * 原来的 bug：这里直接 `<img src={imgUrl(m.id, true)} />`。
 * thumbUrl 在后端生成失败、或者这条记录压根没有 file 时返回空串，
 * <img src=""> 在 WebView2 里会退化成「显示 alt / 或者把 URL 当文字画出来」，
 * 于是用户看到的是一串乱码似的文字 —— 这就是「缩略图显示的是一串文字」。
 *
 * 现在的做法：
 *   - 有图就画图
 *   - 没图但有文件 → 画原图
 *   - 都没有 / 加载失败 → 画一个带类型标记的色块，绝不把文件名当图片渲染
 */
function BgThumb({ item }: { item: { id: string; thumb?: string; file?: string; name?: string; kind?: string } }) {
  const [broken, setBroken] = useState(false);
  const src = imgUrl(item.id, true);
  const showImg = !!src && !broken;
  return (
    <>
      {showImg ? (
        <img
          src={src}
          loading="lazy"
          alt={item.name || ''}
          draggable={false}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span className="bgph" title={item.name || '这张图读不出来'}>
          <Icon name="image" size={15} />
        </span>
      )}
    </>
  );
}
