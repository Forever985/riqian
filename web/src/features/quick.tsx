import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SearchHit } from '../api';
import { useStore, VIEW_TITLE } from '../store';
import { Dialog } from '../components/ui';
import { Icon, type IconName } from '../components/Icons';
import { todayKey } from '../lib/date';
import type { QuickMode, ViewKey } from '../types';

const MODE_META: Record<QuickMode, { t: string; ph: string; ic: IconName; hint: string }> = {
  diary: { t: '快速写日记', ph: '今天想记一句什么？', ic: 'pen', hint: '写完直接追到今天的正文末尾，Ctrl+Enter 保存' },
  note: { t: '快速记笔记', ph: '记一笔，回车就存', ic: 'book', hint: '会存进备忘录的第一个笔记本' },
  todo: { t: '快速加待办', ph: '要做什么？回车加一条，可以连着加', ic: 'todo', hint: '默认今天到期，Esc 结束' },
  cd: { t: '新建倒计时', ph: '倒计时名称，比如「妈妈生日」', ic: 'hourglass', hint: '选个日期，回车保存' },
  pomo: { t: '开始番茄钟', ph: '', ic: 'timer', hint: '选一个时长，立刻开始专注' },
};

/**
 * 快速捕获窗。
 *
 * 参考 EcoPaste / Simple Sticky Notes 的做法：不是一个新页面，而是一个居中的小浮层，
 * 出来就聚焦输入框，回车存、Esc 收，存完不打断你手上的事。
 * 也正因为不做成整页，才能真正当「随手记」用。
 */
export function QuickPanel() {
  const mode = useStore((s) => s.quick);
  const setQuick = useStore((s) => s.setQuick);
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const pomo = useStore((s) => s.pomo);

  const [text, setText] = useState('');
  const [day, setDay] = useState(todayKey());
  const [minutes, setMinutes] = useState(Number(pomo.preset) || 25);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!mode) return;
    setText('');
    setAdded([]);
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && mode) setQuick(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setQuick]);

  const close = () => setQuick(null);

  if (!mode) return null;
  const meta = MODE_META[mode];
  const v = text.trim();

  const saveDiary = async () => {
    if (!v) return;
    setBusy(true);
    try {
      const today = todayKey();
      const st = useStore.getState();
      const [entry, modules] = await Promise.all([api.entry.get(today), api.modules.list()]);
      /*
       * #244 衍生：今天如果加了密码，entry.get 返回的是**空内容**。
       * 拿这份空内容去拼接再 save，就是把整篇日记覆盖成「只有刚打的这句」。
       * 宁可拒绝，也不能悄悄吃掉用户原来的字。
       */
      if ((entry as { locked?: boolean }).locked) {
        toast('今天设了密码，先在软件里解锁再记');
        return;
      }
      const mod = modules.filter((m) => m.enabled === 1).find((m) => m.type === 'richtext');
      const values = { ...(entry.values || {}) } as Record<string, unknown>;
      const safe = v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      const para = `<p>${safe.replace(/\n/g, '<br>')}</p>`;
      if (mod) {
        const cur = typeof values[mod.id] === 'string' ? (values[mod.id] as string) : '';
        values[mod.id] = cur + para;
      } else {
        toast('还没有正文模块，先去设置里加一个');
        return;
      }
      await api.entry.save({ date: today, values: values as never, fav: entry.fav || 0, bg: entry.bg || '' });
      await st.setDate(today);
      toast('已写进今天');
      close();
    } finally { setBusy(false); }
  };

  const saveNote = async () => {
    if (!v) return;
    setBusy(true);
    try {
      const books = await api.notebooks.list();
      const book = books[0]?.id || '';
      const body = `<p>${v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)).replace(/\n/g, '<br>')}</p>`;
      const r = await api.notes.save({
        id: '', notebookId: book,
        title: v.split('\n')[0].slice(0, 24) || '随手记',
        body, pinned: 0,
      });
      if (r.ok) { toast('已存进备忘录'); close(); }
      else toast('保存失败');
    } finally { setBusy(false); }
  };

  const saveTodo = async () => {
    if (!v) return;
    setBusy(true);
    try {
      /*
       * 第 165 条：改走宿主的 quick.capture —— 和浮窗是同一个方法。
       * 原来这里自己拼 api.todos.add，浮窗那边是 C# 落库，
       * 两套代码对「一行一条待办」的处理迟早会走偏（浮窗支持多行，这里只会存一大段）。
       */
      const r = await api.quickCapture('todo', v);
      if (!r?.ok) { toast(r?.err || '添加失败'); return; }
      setAdded((a) => [...v.split(/\n/).map((x) => x.trim()).filter(Boolean), ...a].slice(0, 5));
      setText('');
      await useStore.getState().reloadTodos();
      inputRef.current?.focus();
    } finally { setBusy(false); }
  };

  const saveCd = async () => {
    if (!v) return;
    setBusy(true);
    try {
      await api.cd.add({ title: v, date: day, repeat: 'yearly', color: '#b8623a', note: '' });
      toast('倒计时已建好');
      close();
    } finally { setBusy(false); }
  };

  const startPomo = () => {
    const st = useStore.getState();
    const total = Math.max(1, minutes) * 60;
    useStore.setState({ pomo: { ...st.pomo, kind: 'focus', preset: minutes, total, left: total, running: true } });
    void go('pomodoro');
    close();
  };

  const submit = () => {
    if (mode === 'diary') void saveDiary();
    else if (mode === 'note') void saveNote();
    else if (mode === 'todo') void saveTodo();
    else if (mode === 'cd') void saveCd();
    else startPomo();
  };

  return (
    <div className="qmask" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="qpanel">
        <div className="qhead">
          <Icon name={meta.ic} size={16} />
          <b>{meta.t}</b>
          <span className="sp" />
          <button className="qclose" onClick={close} title="Esc">✕</button>
        </div>

        {mode === 'pomo' ? (
          <div className="qbody">
            <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              {(pomo.presets.length ? pomo.presets : [15, 25, 35, 45]).map((m) => (
                <button key={m} className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{m} 分钟</button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
              <input
                type="number" className="inp" style={{ width: 90 }} min={1} max={240}
                value={minutes}
                onChange={(e) => setMinutes(Math.max(1, Math.min(240, Number(e.target.value) || 25)))}
              />
              <span className="small muted">分钟</span>
            </div>
          </div>
        ) : (
          <>
            <textarea
              ref={inputRef}
              className="qinput"
              value={text}
              placeholder={meta.ph}
              rows={mode === 'diary' ? 5 : 3}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (mode === 'todo' && !e.ctrlKey) { e.preventDefault(); void saveTodo(); return; }
                if (e.ctrlKey || e.metaKey) { e.preventDefault(); submit(); }
                else if (mode !== 'diary') { e.preventDefault(); submit(); }
              }}
            />
            {mode === 'cd' ? (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="small muted">日期</span>
                <input type="date" className="inp" style={{ width: 160 }} value={day} onChange={(e) => setDay(e.target.value)} />
                <span className="small muted">每年重复；要更细的规则去倒计时页改</span>
              </div>
            ) : null}
          </>
        )}

        {added.length ? (
          <div className="qadded">
            刚加的 {added.length} 条：
            {added.map((a, i) => <div key={i}>· {a}</div>)}
          </div>
        ) : null}

        <div className="qfoot">
          <span className="small muted">{meta.hint}</span>
          <span className="sp" />
          <button className="btn sm" onClick={close}>关闭</button>
          {/*
            第 165 条：一键换成宿主的独立浮窗。
            场景很具体：面板开着时想继续在别的软件里干活 —— 换成浮窗就不会挡住整屏。
          */}
          {mode !== 'pomo' && mode !== 'cd' ? (
            <button
              className="btn sm"
              data-act="to-float"
              title="换成桌面上的小浮窗，不挡操作、失焦自动收起"
              onClick={async () => {
                await api.quickPopup(mode as 'todo' | 'note' | 'diary');
                close();
              }}
            >用小浮窗</button>
          ) : null}
          <button className="btn sm primary" disabled={busy || (mode !== 'pomo' && !v)} onClick={submit}>
            {mode === 'pomo' ? '开始' : (busy ? '保存中…' : '保存')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 命令面板 ---------------- */

/** 搜索结果里各类内容怎么显示、点了去哪（第 117 条） */
const HIT_META: Record<SearchHit['kind'], { label: string; ic: IconName; view: ViewKey }> = {
  entry: { label: '日记', ic: 'pen', view: 'today' },
  note: { label: '笔记', ic: 'book', view: 'notes' },
  todo: { label: '待办', ic: 'todo', view: 'todos' },
  summary: { label: '总结', ic: 'sparkle', view: 'review' },
  habit: { label: '打卡', ic: 'check-circle', view: 'habits' },
  ledger: { label: '记账', ic: 'chart', view: 'ledger' },
  alarm: { label: '提醒', ic: 'bell', view: 'alarms' },
  countdown: { label: '倒数日', ic: 'hourglass', view: 'countdown' },
};

interface Row {
  k: string;
  n: string;
  hint: string;
  ic: IconName;
  group: 'cmd' | 'hit';
  snippet?: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useStore((s) => s.palette);
  const setOpen = useStore((s) => s.setPalette);
  const go = useStore((s) => s.go);
  const setDate = useStore((s) => s.setDate);
  const setQuick = useStore((s) => s.setQuick);

  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  /** 命令：跳页 / 快速记录。有搜索词时作为兜底仍然参与匹配 */
  const cmds = useMemo<Row[]>(() => [
    ...(Object.keys(VIEW_TITLE) as ViewKey[]).map((v) => ({
      k: `nav:${v}`, n: VIEW_TITLE[v], hint: '打开页面', ic: 'right' as IconName, group: 'cmd' as const,
      run: () => void go(v),
    })),
    { k: 'quick:diary', n: '快速写日记', hint: 'Ctrl+Alt+D', ic: 'pen' as IconName, group: 'cmd' as const, run: () => setQuick('diary') },
    { k: 'quick:note', n: '快速记笔记', hint: 'Ctrl+Alt+N', ic: 'book' as IconName, group: 'cmd' as const, run: () => setQuick('note') },
    { k: 'quick:todo', n: '快速加待办', hint: 'Ctrl+Alt+T', ic: 'todo' as IconName, group: 'cmd' as const, run: () => setQuick('todo') },
    { k: 'quick:cd', n: '新建倒计时', hint: 'Ctrl+Alt+C', ic: 'hourglass' as IconName, group: 'cmd' as const, run: () => setQuick('cd') },
    { k: 'quick:pomo', n: '开始番茄钟', hint: 'Ctrl+Alt+P', ic: 'timer' as IconName, group: 'cmd' as const, run: () => setQuick('pomo') },
    { k: 'help', n: '看快捷键一览', hint: 'F1', ic: 'key' as IconName, group: 'cmd' as const, run: () => useStore.getState().setHelp(true) },
  ], [go, setQuick, setDate]);

  /* 搜索：停顿 200ms 再查，别一边打一边把每个字都发一趟 */
  useEffect(() => {
    if (!open) return;
    const k = q.trim();
    if (k.length === 0) { setHits([]); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await api.search.all(k, 5);
          if (alive) setHits(r);
        } catch {
          if (alive) setHits([]);
        } finally {
          if (alive) setSearching(false);
        }
      })();
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);

  const openHit = (h: SearchHit) => {
    setOpen(false);
    if (h.kind === 'entry') {
      // 日记直接翻到那一天，比「跳到记录页让用户自己找」省事得多
      void setDate(h.id);
      return;
    }
    void go(HIT_META[h.kind].view);
  };

  const rows = useMemo<Row[]>(() => {
    const k = q.trim().toLowerCase();
    const matchedCmds = k ? cmds.filter((x) => (x.n + x.hint).toLowerCase().includes(k)) : cmds;
    const hitRows: Row[] = hits.map((h) => {
      const meta = HIT_META[h.kind];
      return {
        k: `hit:${h.kind}:${h.id}`,
        n: h.title || h.snippet || '（无标题）',
        hint: meta.label + (h.sub ? ' · ' + h.sub : ''),
        ic: meta.ic,
        group: 'hit',
        snippet: h.snippet,
        run: () => openHit(h),
      };
    });
    // 有搜索词时内容结果排前面 —— 搜「跑步」多半是想找那条待办，不是想跳页
    return k ? [...hitRows, ...matchedCmds] : matchedCmds;
  }, [q, cmds, hits]);

  useEffect(() => { if (open) { setQ(''); setSel(0); setHits([]); } }, [open]);
  useEffect(() => { setSel(0); }, [q, hits]);

  if (!open) return null;

  const runAt = (i: number) => {
    const it = rows[i];
    if (!it) return;
    it.run();
  };

  const hitCount = rows.filter((r) => r.group === 'hit').length;

  return (
    <div className="qmask" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="qpalette">
        <div className="qsearch">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={q}
            placeholder="搜日记、笔记、待办、记账…或者输入页面名"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); runAt(sel); }
            }}
          />
          <span className="small muted">
            {searching ? '搜索中…' : hitCount ? `${hitCount} 条内容` : '↑↓ 选择 · Enter 打开 · Esc 关闭'}
          </span>
        </div>
        <div className="qlist">
          {rows.map((it, i) => (
            <button
              key={it.k}
              className={`qrow ${i === sel ? 'on' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => runAt(i)}
              title={it.snippet || undefined}
            >
              <Icon name={it.ic} size={14} />
              <span className="n">
                {it.n}
                {it.snippet ? <span className="qsnp">{it.snippet}</span> : null}
              </span>
              <span className="h">{it.hint}</span>
            </button>
          ))}
          {!rows.length ? (
            <div className="empty small">
              {searching ? '正在找…' : '没有匹配的内容，换个词试试'}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 快捷键一览 ---------------- */

export function ShortcutHelp() {
  const open = useStore((s) => s.help);
  const setOpen = useStore((s) => s.setHelp);
  const settings = useStore((s) => s.settings);

  if (!open) return null;

  const rows: [string, string][] = [
    ['Ctrl + S', '立刻保存当前日记'],
    ['Ctrl + K', '命令面板：跳页 / 快速记录'],
    ['Ctrl + Shift + D', '写今天的日记'],
    ['Ctrl + Enter', '在快速记录窗里保存'],
    ['Esc', '关掉弹层 / 退出快速记录'],
    ['F1', '这一页'],
    [String(settings.hotkeyToggle || '—'), '全局：唤出 / 收起窗口'],
    [String(settings.hotkeyBoss || '—'), '全局：老板键（隐藏 / 伪装）'],
    [String(settings.hotkeyDiary || '—'), '全局：快速写日记'],
    [String(settings.hotkeyNote || '—'), '全局：快速记笔记'],
    [String(settings.hotkeyTodo || '—'), '全局：快速加待办'],
    [String(settings.hotkeyCd || '—'), '全局：新建倒计时'],
    [String(settings.hotkeyPomo || '—'), '全局：开始番茄钟'],
  ];

  return (
    <Dialog title="快捷键" onClose={() => setOpen(false)} footer={<button className="btn" onClick={() => setOpen(false)}>知道了</button>}>
      <div className="kbd-list">
        {rows.map(([k, n]) => (
          <div className="kbd-row" key={k + n}>
            <kbd>{k}</kbd>
            <span>{n}</span>
          </div>
        ))}
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>
        全局快捷键可以在「设置 → 快捷键」里改；被别的软件占用时那里会写明。
      </div>
    </Dialog>
  );
}
