import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from '../components/Icons';
import { Row, Chips, Switch } from '../components/SetRow';
import { NAV, navKeys } from '../components/Sidebar';
import { askProtect } from '../components/Lock';
import type { VaultQa, Notebook } from '../types';

/* ==================================================================
   设置页 v8 分组：安全与密码 / 快捷键 / 托盘与窗口 / 分享与总结
   另外把「导航顺序」编辑器也放这里（侧栏不再支持拖动）
   ================================================================== */

/* ---------------- 排序器（导航用；模块那边同理） ---------------- */

export function NavOrderEditor() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const [order, setOrder] = useState<string[]>(() => navKeys(settings.navOrder));

  useEffect(() => { setOrder(navKeys(settings.navOrder)); }, [settings.navOrder]);

  const nameOf = (k: string) => NAV.find((n) => n.k === k)?.t || k;

  const commit = async (next: string[]) => {
    setOrder(next);
    await setSetting('navOrder', JSON.stringify(next));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    void commit(next);
  };

  return (
    <div className="orderlist">
      {order.map((k, i) => (
        <div className="orow" key={k}>
          <span className="grip">≡</span>
          <span className="nm">{nameOf(k)}</span>
          <button className="btn sm ghost" data-act="up" onClick={() => move(i, -1)} disabled={i === 0} title="上移">↑</button>
          <button className="btn sm ghost" data-act="down" onClick={() => move(i, 1)} disabled={i === order.length - 1} title="下移">↓</button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn sm"
          onClick={async () => { await setSetting('navOrder', ''); setOrder(NAV.map((n) => n.k)); toast('已恢复默认顺序'); }}
        >
          <Icon name="reset" size={13} />恢复默认
        </button>
        <span className="small muted">侧栏里不再支持拖动，顺序只在这里改</span>
      </div>
    </div>
  );
}

/* ---------------- 快捷键 ---------------- */

const HOTKEYS: { k: string; n: string; hint: string }[] = [
  { k: 'hotkeyToggle', n: '唤出 / 收起窗口', hint: '在任意软件前面都能用，隐藏时不会退出' },
  { k: 'hotkeyBoss', n: '老板键（隐藏 / 伪装）', hint: '立刻藏起日签，换成一个人畜无害的记事本；再按一次回来' },
  { k: 'hotkeyDiary', n: '快速写日记', hint: '唤出后直接落在今天的正文上' },
  { k: 'hotkeyNote', n: '快速记笔记', hint: '写一行，回车即存进备忘录' },
  { k: 'hotkeyTodo', n: '快速加待办', hint: '可以连着敲好几条' },
  { k: 'hotkeyCd', n: '新建倒计时', hint: '记生日、纪念日、考试' },
  { k: 'hotkeyPomo', n: '开始番茄钟', hint: '按设置里的此刻专注时长直接开始' },
];

const KEY_NAME: Record<string, string> = {
  ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', '`': '`', '-': '-', '=': '=',
};

function keyName(e: React.KeyboardEvent): string {
  if (e.key === ' ') return 'Space';
  if (KEY_NAME[e.key]) return KEY_NAME[e.key];
  if (e.key.length === 1) return e.key.toUpperCase();
  return '';
}

/** 点一下开始录，按下组合键即写入。至少要带一个修饰键。 */
function KeyRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  return (
    <button
      className={`keyrec ${rec ? 'rec' : ''}`}
      onClick={() => setRec(true)}
      onBlur={() => setRec(false)}
      onKeyDown={(e) => {
        if (!rec) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { setRec(false); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { onChange(''); setRec(false); return; }
        const mods: string[] = [];
        if (e.ctrlKey) mods.push('Ctrl');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (e.metaKey) mods.push('Win');
        const k = keyName(e);
        if (!mods.length || !k) return;      // 单键会跟打字抢，直接忽略
        onChange([...mods, k].join('+'));
        setRec(false);
      }}
      title={rec ? '按下组合键，Esc 取消，Backspace 清除' : '点一下重新录制'}
    >
      {rec ? '按下组合键…' : (value || '未设置')}
    </button>
  );
}

export function HotkeySection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<{ name: string; reason: string; combo: string }[]>([]);

  const enabled = String(settings.hotkeyEnable ?? '1') === '1';

  useEffect(() => {
    const next: Record<string, string> = {};
    HOTKEYS.forEach((h) => { next[h.k] = String(settings[h.k] ?? ''); });
    setDraft(next);
  }, [settings]);

  const dup = useMemo(() => {
    const seen = new Map<string, string>();
    const bad = new Set<string>();
    HOTKEYS.forEach((h) => {
      const v = (draft[h.k] || '').trim().toLowerCase();
      if (!v) return;
      if (seen.has(v)) { bad.add(h.k); bad.add(seen.get(v) as string); }
      else seen.set(v, h.k);
    });
    return bad;
  }, [draft]);

  const save = async () => {
    setSaving(true);
    try {
      for (const h of HOTKEYS) {
        if (String(settings[h.k] ?? '') !== (draft[h.k] || '')) await setSetting(h.k, draft[h.k] || '');
      }
      const r = await api.shell.applyHotkeys();
      setFailed((r.failed || []).map((f) => ({ name: f.name, reason: f.reason, combo: f.combo })));
      if (r.failed?.length) toast(`${r.failed.length} 个快捷键没注册上，看看下面的原因`);
      else toast(r.disabled ? '快捷键已关闭' : `已生效：${r.registered.length} 个快捷键`);
    } finally { setSaving(false); }
  };

  return (
    <>
      <div className="card">
        <h3><Icon name="key" size={14} />全局快捷键</h3>
        <Row label="启用全局快捷键" sub="在任何软件里都能按；关掉只影响键盘，不影响托盘" kw="快捷键 全局 热键 开关">
          <Switch
            on={enabled}
            onClick={async () => { await setSetting('hotkeyEnable', enabled ? '0' : '1'); await api.shell.applyHotkeys(); }}
          />
        </Row>
        {HOTKEYS.map((h) => (
          <Row key={h.k} label={h.n} sub={h.hint} kw={`快捷键 热键 ${h.n}`}>
            {dup.has(h.k) ? <span className="small" style={{ color: 'var(--bad)' }}>重复</span> : null}
            <KeyRecorder value={draft[h.k] || ''} onChange={(v) => setDraft((d) => ({ ...d, [h.k]: v }))} />
          </Row>
        ))}
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary" disabled={saving || !!dup.size} onClick={() => void save()}>
            {saving ? '应用中…' : '保存并生效'}
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const d: Record<string, string> = {};
              HOTKEYS.forEach((h) => { d[h.k] = String(settings[h.k] ?? ''); });
              setDraft(d);
              setFailed([]);
            }}
          >撤销改动</button>
          <span className="small muted">至少带一个 Ctrl / Alt / Shift，避免和打字抢键</span>
        </div>
        {failed.length ? (
          <div className="hotkey-fail">
            {failed.map((f) => (
              <div key={f.name}><b>{f.name}</b> {f.combo} — {f.reason}</div>
            ))}
            <div className="small muted">被占用就换一个组合，或先关掉占用它的软件。</div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3>窗口内快捷键</h3>
        <div className="kv"><span>Ctrl + S</span><b>立刻保存当前日记</b></div>
        <div className="kv"><span>Ctrl + K</span><b>打开命令面板（跳页 / 快速记录）</b></div>
        <div className="kv"><span>Ctrl + Shift + D</span><b>写今天的日记</b></div>
        <div className="kv"><span>F1</span><b>看快捷键一览</b></div>
        <div className="kv"><span>Esc</span><b>关闭弹层 / 退出快速记录</b></div>
        <div className="small muted" style={{ marginTop: 8 }}>这些只在日签窗口有焦点时生效，不需要注册系统热键。</div>
      </div>
    </>
  );
}

/* ---------------- 托盘与窗口 ---------------- */

const TRAY_ITEMS: { k: string; n: string }[] = [
  { k: 'open', n: '打开日签' },
  { k: 'today', n: '今日总结' },
  { k: 'diary', n: '写今天的日记' },
  { k: 'note', n: '快速记笔记' },
  { k: 'todo', n: '快速加待办' },
  { k: 'cd', n: '新建倒计时' },
  { k: 'pomo', n: '开始番茄钟' },
  { k: 'boss', n: '隐形模式（老板键）' },
  { k: 'lock', n: '立即锁定' },
  { k: 'hide', n: '隐藏窗口' },
  { k: 'quit', n: '退出日签' },
];

/** 托盘菜单项 id → 中文名（顺序列表里要显示人话） */
function nameOfTray(k: string): string {
  return TRAY_ITEMS.find((t) => t.k === k)?.n || '';
}

export function TraySection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const menu = String(settings.trayMenu || '').split(',').map((x) => x.trim()).filter(Boolean);
  const has = (k: string) => menu.includes(k);

  const toggle = async (k: string) => {
    const next = has(k) ? menu.filter((x) => x !== k) : [...menu.filter((x) => x !== 'sep'), k];
    // 退出项永远保留，否则只剩托盘图标一个入口，用户会以为程序卡死
    const withQuit = next.includes('quit') ? next : [...next, 'quit'];
    await setSetting('trayMenu', withQuit.join(','));
    await api.shell.apply();
  };

  /** 顺序调整：只换位置，不改「有没有」—— 有没有是上面那些勾选框的事 */
  const moveTray = async (i: number, dir: -1 | 1) => {
    const body = menu.filter((k) => k !== 'quit');
    const j = i + dir;
    if (j < 0 || j >= body.length) return;
    const next = body.slice();
    [next[i], next[j]] = [next[j], next[i]];
    await setSetting('trayMenu', [...next, 'quit'].join(','));
    await api.shell.apply();
  };

  const iconMode = String(settings.trayIconMode || 'full');

  return (
    <>
      <div className="card">
        <h3><Icon name="monitor" size={14} />托盘图标</h3>
        <Row label="图标显示" sub="「不显示」之后就只剩快捷键能唤出来，谨慎选择" kw="托盘 图标 隐藏 缩小">
          <Chips
            value={iconMode}
            items={[['full', '完整'], ['mini', '精简（短提示）'], ['off', '不显示']]}
            onPick={async (v) => { await setSetting('trayIconMode', v); await api.shell.apply(); }}
          />
        </Row>
        <Row label="双击托盘图标" kw="托盘 双击 打开">
          <select
            className="inp" style={{ width: 180 }}
            value={String(settings.trayDoubleClick || 'open')}
            onChange={async (e) => { await setSetting('trayDoubleClick', e.target.value); await api.shell.apply(); }}
          >
            <option value="open">打开主窗口</option>
            <option value="diary">写今天的日记</option>
            <option value="note">快速记笔记</option>
          </select>
        </Row>
        <Row label="占任务栏" sub="关掉后只靠托盘 / 悬浮球 / 快捷键找回窗口" kw="任务栏 隐藏 显示">
          <Switch
            on={String(settings.taskbarShow ?? '1') === '1'}
            onClick={async () => {
              await setSetting('taskbarShow', String(settings.taskbarShow ?? '1') === '1' ? '0' : '1');
              await api.shell.apply();
            }}
          />
        </Row>
        {/* 第 75 条：锁上之后托盘图标要能看出来 */}
        <Row
          label="锁定后图标带小锁"
          sub="锁上时在托盘图标右下角叠一个红色小锁，解开就恢复；离开工位瞟一眼就知道状态"
          kw="托盘 小锁 锁定 图标 状态"
        >
          <Switch
            on={String(settings.trayLockIcon ?? '1') === '1'}
            onClick={async () => {
              const next = String(settings.trayLockIcon ?? '1') === '1' ? '0' : '1';
              await setSetting('trayLockIcon', next);
              await api.shell.lockState(useStore.getState().appLocked ? 1 : 0);
            }}
          />
        </Row>
      </div>

      <div className="card">
        <h3><Icon name="grid" size={14} />右键菜单里放哪些</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>勾上的才会出现在托盘右键菜单里；「退出」始终保留最后一项。</div>

        {/* 第 88b 条：托盘里的「开始番茄钟」点一下到底开多久，用户说了算。
            之前写死读 pomoPreset，既不能关掉预设也不能单独指定。 */}
        <Row
          label="托盘点「开始番茄钟」的时长"
          sub="0 表示不预设，按默认专注时长走；填 1-240 就按这个分钟数直接开"
          kw="托盘 番茄钟 时长 预设 分钟 pomodoro"
        >
          <div className="row" style={{ gap: 6 }}>
            <input
              type="number" className="inp" style={{ width: 90 }} min={0} max={240}
              value={String(settings.trayPomoPreset ?? '')}
              placeholder="不预设"
              onChange={(e) => void setSetting('trayPomoPreset', e.target.value)}
            />
            <span className="val">分钟</span>
            <button className="btn sm ghost" onClick={() => void setSetting('trayPomoPreset', '')}>清空</button>
          </div>
        </Row>
        <div className="tray-grid">
          {TRAY_ITEMS.map((t) => (
            <label className={`tray-item ${has(t.k) ? 'on' : ''}`} key={t.k}>
              <input type="checkbox" checked={has(t.k)} onChange={() => void toggle(t.k)} />
              <span>{t.n}</span>
            </label>
          ))}
        </div>

        {/* 第 89 条：顺序也要能自己定，不能只给勾选 —— 菜单项的顺序会直接影响肌肉记忆 */}
        <div className="set-row stack" style={{ marginTop: 10 }}>
          <div className="lbl">
            菜单顺序
            <small>右键菜单从上到下按这个排；「退出」永远在最后</small>
          </div>
          <div className="orderlist">
            {menu.filter((k) => k !== 'quit').map((k, i, arr) => (
              <div className="orow" key={`${k}-${i}`}>
                <span className="nm">{k === 'sep' ? '—— 分隔线 ——' : (nameOfTray(k) || k)}</span>
                <button
                  className="btn sm ghost" data-act="up" title="上移" disabled={i === 0}
                  onClick={() => void moveTray(i, -1)}
                >↑</button>
                <button
                  className="btn sm ghost" data-act="down" title="下移" disabled={i === arr.length - 1}
                  onClick={() => void moveTray(i, 1)}
                >↓</button>
                <button
                  className="btn sm ghost" title="从菜单里去掉"
                  onClick={() => void toggle(k)}
                >✕</button>
              </div>
            ))}
            {menu.filter((k) => k !== 'quit').length ? null : (
              <div className="empty small">菜单里一项都没有，至少勾一个。</div>
            )}
            <div className="orow" style={{ opacity: 0.7 }}>
              <span className="nm">退出</span>
              <span className="small muted">固定在最后</span>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn sm"
              onClick={async () => {
                await setSetting('trayMenu', 'open,today,diary,note,todo,pomo,sep,hide,boss,sep,quit');
                await api.shell.apply();
                toast('已恢复默认菜单');
              }}
            >
              <Icon name="refresh" size={13} />恢复默认顺序
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3><Icon name="eye-off" size={14} />隐藏与伪装</h3>
        <Row label="右下角悬浮小 logo" sub="窗口藏起来后，右下角留一个小「签」，点一下回来" kw="悬浮球 小logo 缩小 常驻">
          <Switch
            on={String(settings.orbEnabled ?? '0') === '1'}
            onClick={async () => {
              const on = String(settings.orbEnabled ?? '0') !== '1';
              await setSetting('orbEnabled', on ? '1' : '0');
              await api.shell.orb(on);
            }}
          />
        </Row>
        <Row label="老板键伪装成什么" sub="按老板键时主窗隐藏，弹出这个假窗口" kw="老板键 伪装 记事本 空白">
          <Chips
            value={String(settings.disguiseStyle || 'note')}
            items={[['note', '记事本 + 工作草稿'], ['blank', '一张空白文档']]}
            onPick={async (v) => { await setSetting('disguiseStyle', v); await api.shell.apply(); }}
          />
        </Row>
        <Row label="试一下老板键" sub="立刻藏起日签；再按一次快捷键（或双击假文档）回来" kw="老板键 测试 伪装">
          <button className="btn sm" onClick={async () => { await api.shell.boss(); toast('已进入隐形模式，按老板键回来'); }}>
            立即伪装
          </button>
        </Row>
      </div>
    </>
  );
}

/* ---------------- 分享与总结 ---------------- */

export function ShareSection() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const invite = `我在用「日签」记日记：数据全部存在自己电脑上，不登录、不联网、没有广告。\n`
    + `写日记、打卡、待办、番茄钟、倒计时、备忘录都在一个窗口里，还能把某一天做成一张卡片分享。\n`
    + `单文件绿色版，拷走就能用。如果你也想要一个安静的日记本，可以试试。`;

  return (
    <>
      <div className="card">
        <h3><Icon name="share" size={14} />分享卡片</h3>
        <Row label="默认版式" kw="分享 版式 主题 卡片">
          <Chips
            value={String(settings.shareStyle || 'paper')}
            items={[['paper', '宣纸'], ['ink', '墨色'], ['night', '夜色'], ['plain', '素白']]}
            onPick={(v) => void setSetting('shareStyle', v)}
          />
        </Row>
        <Row label="默认尺寸" kw="分享 尺寸 竖版 方图 横版">
          <Chips
            value={String(settings.shareSize || 'story')}
            items={[['story', '竖版 3:4'], ['square', '方图 1:1'], ['wide', '横版 16:9']]}
            onPick={(v) => void setSetting('shareSize', v)}
          />
        </Row>
        <Row label="带品牌水印" sub="右下角一行小字，别人存图也能看到出处" kw="分享 水印 品牌">
          <Switch
            on={String(settings.shareWatermark ?? '1') === '1'}
            onClick={() => void setSetting('shareWatermark', String(settings.shareWatermark ?? '1') === '1' ? '0' : '1')}
          />
        </Row>
        <Row label="品牌名" kw="分享 品牌 名字 署名">
          <input
            className="inp" style={{ width: 240 }}
            value={String(settings.shareBrand || '')}
            onChange={(e) => void setSetting('shareBrand', e.target.value)}
            placeholder="日签 · 打卡日记本"
          />
        </Row>
        <Row label="卡片页脚" sub="卡片左下角那句小字，留空就不显示" kw="分享 页脚 文案">
          <input
            className="inp" style={{ width: 300 }}
            value={String(settings.shareFooter || '')}
            onChange={(e) => void setSetting('shareFooter', e.target.value)}
            placeholder="把每一天过成值得回看的样子"
          />
        </Row>
      </div>

      <div className="card">
        <h3><Icon name="sparkle" size={14} />总结</h3>
        <Row label="近几日总结默认跨度" sub="打开总结页时默认看最近几天" kw="总结 跨度 天数 最近">
          <input
            type="number" className="inp" style={{ width: 90 }} min={1} max={365}
            value={Number(settings.reviewDays) || 7}
            onChange={(e) => void setSetting('reviewDays', e.target.value)}
          />
          <span className="val">天</span>
        </Row>
        <div className="small muted" style={{ lineHeight: 1.9, marginTop: 6 }}>
          总结是按你自己的数据算的（字数、打卡、专注、待办、心情、标签），不联网、不调用任何模型，
          所以每个数字都能在别处对上。觉得总结太「干」的话，写日记时多留一句今天就够了。
        </div>
      </div>

      <div className="card">
        <h3><Icon name="user" size={14} />推荐给朋友</h3>
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
          复制下面这段话，发给可能需要的朋友。没有任何推广链接和统计代码，纯文本。
        </div>
        <div className="invite-box">{invite}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={async () => { await api.share.copyText(invite); toast('推荐语已复制'); }}>
            复制推荐语
          </button>
          <button className="btn" onClick={() => void api.app.openExport()}>打开导出目录</button>
          <span className="small muted">分享卡片也保存在「导出 / 分享」里</span>
        </div>
      </div>
    </>
  );
}

/* ---------------- 安全与密码 ---------------- */

const SCOPE_NAME: Record<string, string> = {
  app: '整个软件', todos: '待办', countdown: '倒计时',
  diary: '某篇日记', diaryRange: '一段日期', notebook: '某个笔记本', note: '某篇笔记',
  /* 第 168 条：导航右键能加的锁，这里必须有名字，否则规则列里显示成英文键名 */
  flow: '流', habits: '打卡', pomodoro: '番茄钟', calendar: '日历',
  records: '记录搜索', drafts: '草稿箱', media: '多媒体库', ledger: '记账本',
  timeline: '时间轴', stats: '统计',
};

export function SecuritySection() {
  const vault = useStore((s) => s.vault);
  const reloadVault = useStore((s) => s.reloadVault);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);

  const [hint, setHint] = useState('');
  /* 第 31 / 32 条：日期段加锁、笔记本整本加锁 */
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [lockBook, setLockBook] = useState('');
  const [books, setBooks] = useState<Notebook[]>([]);
  useEffect(() => { void api.notebooks.list().then(setBooks).catch(() => setBooks([])); }, []);
  const [qa, setQa] = useState<VaultQa[]>([]);
  const [qaDraft, setQaDraft] = useState<{ question: string; answer: string }[]>([]);
  const [savingQa, setSavingQa] = useState(false);

  useEffect(() => { setHint(vault?.hint || ''); }, [vault?.hint]);
  useEffect(() => {
    void api.vault.qaList().then((list) => {
      setQa(list);
      const rows = list.map((x) => ({ question: x.question, answer: '' }));
      while (rows.length < 3) rows.push({ question: '', answer: '' });
      setQaDraft(rows.slice(0, 3));
    }).catch(() => null);
  }, [vault?.qaCount]);

  const saveQa = async () => {
    const list = qaDraft.filter((x) => x.question.trim());
    if (!list.length) { toast('至少填一个问题'); return; }
    // 答案不回显，所以改密保时必须把答案重填一遍，避免「只改问题却把答案弄丢」
    if (list.some((x) => !x.answer.trim())) { toast('每个问题都要填答案（原来的答案不会再显示）'); return; }
    setSavingQa(true);
    const r = await api.vault.qaSave(list).catch((e) => ({ ok: false, err: (e as Error).message }));
    setSavingQa(false);
    if (!r.ok) { toast(r.err || '保存失败'); return; }
    await reloadVault();
    toast(`已保存 ${list.length} 个密保问题`);
  };

  if (!vault?.hasMain) {
    return (
      <div className="card">
        <h3><Icon name="shield" size={14} />安全与密码</h3>
        <div className="empty">
          还没有设置主密码。先在「我的」页设一个，再回来配提示和密保问题。
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button className="btn" onClick={() => void useStore.getState().go('profile')}>去「我的」设置主密码 →</button>
          </div>
        </div>
      </div>
    );
  }

  const appRule = (vault?.rules || []).find((r) => r.scope === 'app');

  return (
    <>
      <div className="card">
        <h3><Icon name="lock" size={14} />应用锁 <span className="muted">启动 / 手动</span></h3>
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
          打开这一项后，每次启动都会先要求输入主密码。关掉它<b>不会删除密码</b>，
          下次想用再打开就行，不用重设。
        </div>
        <Row label="启动时锁定整个软件" kw="应用锁 启动 密码 锁定 app">
          <Switch
            on={!!appRule}
            onClick={async () => {
              if (appRule) {
                await api.vault.remove(appRule.id);
                toast('已关闭应用锁（密码仍保留）');
              } else {
                await api.vault.add({ scope: 'app', target: '', label: '整个软件', password: '' });
                toast('已开启：下次启动需要密码');
              }
              await reloadVault();
            }}
          />
        </Row>
        <Row label="立即锁定" kw="锁定 现在 立马 lock">
          <button
            className="btn sm"
            onClick={async () => {
              await api.vault.lock();
              await reloadVault();
              useStore.getState().lockApp();
              toast('已锁定');
            }}
          >
            <Icon name="lock" size={13} />锁上
          </button>
        </Row>
        {!appRule ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            当前未开启：启动会直接进首页。
          </div>
        ) : null}
      </div>

      <div className="card">
        <h3><Icon name="lock" size={14} />局部加密 <span className="muted">只锁住某一范围</span></h3>
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
          上面那个是「整个软件上锁」，这里是<b>只锁住一部分</b>：某一天、某一段日期、某个笔记本。
          打开被锁的范围才要输密码，其他照常用。
          <br />
          单独给某一天加锁更快的方式：在「今天」页右上角点「🔒 加锁」；给单篇笔记加锁在笔记页里点锁图标。
        </div>

        {/* 第 31 条：一段日期加锁。后端一开始就支持 diaryRange，只是从来没给过入口。 */}
        <Row label="锁住一段日期的日记" sub="这段时间里的每一天打开都要输密码" kw="日期段 范围 加锁 日记 密码">
          <div className="row" style={{ gap: 6 }}>
            <input className="inp" type="date" style={{ width: 150 }} value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)} />
            <span className="val">至</span>
            <input className="inp" type="date" style={{ width: 150 }} value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)} />
            <button
              className="btn sm"
              onClick={async () => {
                if (!rangeFrom || !rangeTo) { toast('两个日期都要选'); return; }
                if (rangeFrom > rangeTo) { toast('开始日期不能晚于结束'); return; }
                // 后端约定的格式就是 from~to，VaultCheck 里按字符串比较
                await askProtect('diaryRange', `${rangeFrom}~${rangeTo}`, `${rangeFrom} 至 ${rangeTo} 的日记`);
                toast('这段日期已加锁');
              }}
            >加锁</button>
          </div>
        </Row>

        {/* 第 32 条：笔记本整体加锁 */}
        <Row label="锁住一个笔记本" sub="里面所有笔记打开都要输密码" kw="笔记本 整本 加锁 密码 备忘">
          <div className="row" style={{ gap: 6 }}>
            <select className="inp" style={{ width: 190 }} value={lockBook}
              onChange={(e) => setLockBook(e.target.value)}>
              <option value="">选一个笔记本…</option>
              {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button
              className="btn sm"
              disabled={!lockBook}
              onClick={async () => {
                const b = books.find((x) => x.id === lockBook);
                await askProtect('notebook', lockBook, b?.name || '这个笔记本');
                toast('已在整本上加锁');
              }}
            >加锁</button>
          </div>
        </Row>
      </div>

      <div className="card">
        <h3><Icon name="question" size={14} />密码提示</h3>
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
          提示是<b>明文</b>存在本机的，任何能打开这个软件的人都能看到。写能让你想起密码、
          但别人猜不到用的东西，比如「老家的门牌号 + 生日月份」，别直接写密码本身。
        </div>
        <div className="row">
          <input
            className="inp" style={{ flex: 1 }}
            value={hint}
            maxLength={80}
            placeholder="例如：常用的那串 + 生日月份"
            onChange={(e) => setHint(e.target.value)}
          />
          <button
            className="btn"
            onClick={async () => { await api.vault.setHint(hint.trim()); await reloadVault(); toast('提示已保存'); }}
          >保存提示</button>
        </div>
      </div>

      <div className="card">
        <h3><Icon name="key" size={14} />密保问题 <span className="muted">{qa.length} / 3</span></h3>
        <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
          忘了密码时，答对<b>全部</b>问题才能重设主密码。答案只存哈希，不会回显；
          已经设过的问题可以只改问题、答案留空表示沿用原来的。
        </div>
        {qaDraft.map((row, i) => (
          <div className="qa-row" key={i}>
            <input
              className="inp"
              style={{ flex: '1 1 240px' }}
              value={row.question}
              maxLength={60}
              placeholder={`问题 ${i + 1}，例如：我小学班主任姓什么`}
              onChange={(e) => setQaDraft((d) => d.map((x, k) => (k === i ? { ...x, question: e.target.value } : x)))}
            />
            <input
              className="inp"
              style={{ flex: '0 0 200px' }}
              type="password"
              value={row.answer}
              placeholder={qa[i] ? '答案（留空 = 不改）' : '答案'}
              onChange={(e) => setQaDraft((d) => d.map((x, k) => (k === i ? { ...x, answer: e.target.value } : x)))}
            />
          </div>
        ))}
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary" disabled={savingQa} onClick={() => void saveQa()}>
            {savingQa ? '保存中…' : '保存密保问题'}
          </button>
          <span className="small muted">答案不区分前后空格，但区分大小写</span>
        </div>
      </div>

      <div className="card">
        <h3><Icon name="lock" size={14} />当前加锁范围</h3>
        {vault.rules.length ? vault.rules.map((r) => (
          <div className="sec-rule" key={r.id}>
            <Icon name="lock" size={13} />
            <span className="sc">{SCOPE_NAME[r.scope] || r.scope}</span>
            <span className="lb">{r.label || r.target || '—'}</span>
            <span className="small muted">{r.own ? '独立密码（密保管不到）' : '主密码'}</span>
            <button
              className="btn sm ghost"
              onClick={async () => { await api.vault.remove(r.id); await reloadVault(); toast('已解锁该范围'); }}
            >取消</button>
          </div>
        )) : <div className="empty small">还没有单独加锁的范围。</div>}

        <div className="row" style={{ marginTop: 10 }}>
          <span className="small muted">解锁后 {settings.vaultTimeout || 30} 分钟内不再询问</span>
          <span className="sp" />
          <button className="btn sm" onClick={async () => { await api.vault.lock(); await reloadVault(); toast('已全部重新上锁'); }}>
            立即锁定
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 10, lineHeight: 1.9 }}>
          说明白边界：密码只做本地校验，<b>数据文件本身没有加密</b>。能直接拿走 E 盘文件的人，
          用别的软件打开 SQLite 就能看到内容。要真正保密，得靠系统账户 / BitLocker 这类磁盘加密。
        </div>
      </div>
    </>
  );
}
