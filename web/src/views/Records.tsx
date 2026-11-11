import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { SearchBox } from '../components/SearchBox';
import { TagPicker } from '../components/TagPicker';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import { TimelineView } from './Timeline';
import { entryHasMedia } from '../features/media';
import { Topbar } from '../components/ui';
import { MOODS } from '../lib/const';
import { WD, parseKey } from '../lib/date';
import type { EntryListItem } from '../types';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

function highlight(text: string, q: string) {
  const raw = esc(text || '');
  const qq = q.trim();
  if (!qq) return raw.slice(0, 260);
  const i = raw.toLowerCase().indexOf(esc(qq).toLowerCase());
  if (i < 0) return raw.slice(0, 260);
  return `…${raw.slice(Math.max(0, i - 50), i)}<mark>${raw.slice(i, i + qq.length)}</mark>${raw.slice(i + qq.length, i + qq.length + 200)}…`;
}

export function RecordsView() {
  const tags = useStore((s) => s.tags);
  const modules = useStore((s) => s.modules);
  const setDate = useStore((s) => s.setDate);
  const reloadTags = useStore((s) => s.reloadTags);
  const toast = useStore((s) => s.toast);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mood, setMood] = useState('0');
  const [tag, setTag] = useState('');
  const [extra, setExtra] = useState('');
  const [items, setItems] = useState<EntryListItem[]>([]);
  const [loading, setLoading] = useState(false);
  /** 第 188 条：记录页现在有两种看法 —— 列表 / 时间轴（同一批日记，只是铺法不同） */
  const [mode, setMode] = useState<'list' | 'line'>('list');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moodMod = modules.filter((m) => m.enabled === 1).find((m) => m.type === 'mood');

  const run = async (over?: { q?: string }) => {
    setLoading(true);
    try {
      const list = await api.entry.list({
        q: over?.q ?? q,
        from: from || undefined,
        to: to || undefined,
        mood: Number(mood) || undefined,
        tag: tag || undefined,
        fav: extra === 'fav' ? 1 : 0,
        hasImg: extra === 'img' ? 1 : 0,
        limit: 300,
        offset: 0,
      });
      setItems(list);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 从别处带着条件进来（统计页的常用标签 / 方块）。直接按条件查一次，
   * 不走 setState 再等 effect —— 那样会和下面那个"筛选变化就重查"的 effect 抢时序。
   */
  useEffect(() => {
    const st = useStore.getState();
    const preset = st.recordsPreset;
    if (!preset) return;
    st.takeRecordsPreset();
    if (preset.tag) setTag(preset.tag);
    if (preset.q) setQ(preset.q);
    if (preset.kind) setExtra(preset.kind);
    void (async () => {
      setLoading(true);
      try {
        const list = await api.entry.list({
          q: preset.q || '',
          tag: preset.tag || undefined,
          hasImg: preset.kind === 'img' ? 1 : 0,
          limit: 300,
          offset: 0,
        });
        setItems(list);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 进页面先刷新标签云，否则刚加的标签在这个下拉里看不到（只认启动时那一份）
  useEffect(() => { void reloadTags(); }, [reloadTags]);

  useEffect(() => { void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onQ = (v: string) => {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run({ q: v }), 320);
  };

  const clearAll = () => {
    setQ(''); setFrom(''); setTo(''); setMood('0'); setTag(''); setExtra('');
    void api.entry.list({ limit: 300, offset: 0 }).then(setItems);
  };

  const count = useMemo(() => items.length, [items]);

  /**
   * 第 235 条：记录列表原来右键是空的。
   * 这些日子条目上有「打开 / 收藏」两个动作，其余（复制日期、复制正文、
   * 按这天建待办、删掉这篇）都得先进去才能做 —— 右键直接给出来。
   */
  const ctx = useContextMenu();
  const [tagsOf, setTagsOf] = useState<Record<string, string[]>>({});

  const copy = async (txt: string, what: string) => {
    try { await navigator.clipboard.writeText(txt); } catch { /* 被拦就算了，不吵 */ }
    void what;
  };

  const menuFor = (it: EntryListItem): MenuItem[] => {
    /* 标签是按日期懒加载的：右键时才去取，不在列表里铺 300 条请求 */
    const tagsNow = tagsOf[it.date] || it.tags || [];
    /*
     * #244 衍生：加了密码的那天，右键菜单只留「打开（去解锁）」和「复制日期」。
     *
     * 其余几项在锁定状态下都不该给：
     *   · 复制正文 / 复制整条 —— 正文本来就是空的，给了也是空操作，但会让人以为「内容没了」
     *   · 清掉标签 —— tagsNow 是空的（后端已清空），点了会真的把库里的标签删掉，
     *     这是**绕过密码造成的实质数据损失**
     *   · 删除这一天 —— 更要紧：没解锁就能删掉一篇有内容且被保护的日记
     */
    if (it.locked) {
      return [
        { label: '打开这一天', hint: '需要密码', onClick: () => void setDate(it.date) },
        { sep: true },
        { label: '复制日期', hint: it.date, onClick: () => copy(it.date, '日期') },
        {
          label: it.fav ? '取消收藏' : '收藏这一天', hint: '★',
          onClick: async () => {
            const nv = it.fav ? 0 : 1;
            await api.entry.fav(it.date, nv);
            setItems((prev) => prev.map((x) => (x.date === it.date ? { ...x, fav: nv } : x)));
          },
        },
      ];
    }
    return [
      { label: '打开这一天', hint: '进「今天」写', onClick: () => void setDate(it.date) },
      { label: it.fav ? '取消收藏' : '收藏这一天', hint: '★',
        onClick: async () => {
          const nv = it.fav ? 0 : 1;
          await api.entry.fav(it.date, nv);
          setItems((prev) => prev.map((x) => (x.date === it.date ? { ...x, fav: nv } : x)));
        } },
      { sep: true },
      { label: '复制日期', hint: it.date, onClick: () => copy(it.date, '日期') },
      { label: '复制正文', disabled: !it.plain, onClick: () => copy(it.plain || '', '正文') },
      { label: '复制成「日期 + 正文」', disabled: !it.plain,
        onClick: () => copy(`${it.date}\n\n${it.plain || ''}`, '整条记录') },
      { sep: true },
      { label: '把这天做成待办', hint: '标题带日期',
        onClick: async () => {
          const t = (it.title || it.plain || it.date).slice(0, 40);
          await api.todos.add({ title: t, due: it.date, priority: 1, note: `来自 ${it.date} 的记录` });
          toast('已加到待办，去「待办」里看');
        } },
      { label: tagsNow.length ? '清掉这天的标签' : '这天的标签', hint: tagsNow.join(' ') || '',
        disabled: !tagsNow.length,
        confirm: `清掉 ${it.date} 上的所有标签？正文不受影响。`,
        onClick: async () => {
          await api.tags.set(it.date, []);
          setItems((prev) => prev.map((x) => (x.date === it.date ? { ...x, tags: [] } : x)));
          setTagsOf((p) => ({ ...p, [it.date]: [] }));
          await reloadTags();
          toast('标签清掉了');
        } },
      { sep: true },
      { label: '删除这一天', hint: '进草稿箱前先想清楚', danger: true,
        confirm: `删掉 ${it.date} 的整篇记录？删了就找不回来了。`,
        onClick: async () => {
          await api.entry.remove(it.date);
          setItems((prev) => prev.filter((x) => x.date !== it.date));
          toast('已删除');
        } },
    ];
  };

  return (
    <>
      <Topbar
        title="记录"
        sub={mode === 'list' ? `${count} 条结果` : '按下笔的日子铺开'}
        right={
          <div className="seg">
            <button className={`seg-b ${mode === 'list' ? 'on' : ''}`} onClick={() => setMode('list')}>列表</button>
            <button className={`seg-b ${mode === 'line' ? 'on' : ''}`} onClick={() => setMode('line')}>时间轴</button>
          </div>
        }
        lock={{ scope: 'records', label: '记录搜索' }}
      />
      <div className="wrap">
        {mode === 'line' ? <TimelineView embedded /> : (
        <>
        <div className="card">
          <div className="filters">
            <SearchBox
              value={q}
              onChange={onQ}
              onSubmit={onQ}
              placeholder="搜索正文、标签、日期…（回车记入历史）"
            />
            <input className="inp" type="date" value={from} title="起始日期"
              onChange={(e) => { setFrom(e.target.value); void run(); }} />
            <input className="inp" type="date" value={to} title="结束日期"
              onChange={(e) => { setTo(e.target.value); void run(); }} />
            <select className="inp" style={{ flex: '0 0 auto' }} value={mood}
              onChange={(e) => { setMood(e.target.value); void run(); }}>
              <option value="0">全部心情</option>
              {MOODS.map((m) => <option key={m.v} value={String(m.v)}>{m.e} {m.t}</option>)}
            </select>
            {/* 第 190 条：标签是用户自己起的，多起来下拉里翻不到，改成可输入可筛选 */}
            <TagPicker
              value={tag}
              options={tags.map((t) => ({ v: t.tag, n: t.tag, c: t.n }))}
              onChange={(v) => { setTag(v); void run(); }}
            />
            <select className="inp" style={{ flex: '0 0 auto' }} value={extra}
              onChange={(e) => { setExtra(e.target.value); void run(); }}>
              <option value="">全部</option>
              <option value="fav">只看收藏</option>
              <option value="img">带图片</option>
              <option value="video">带视频</option>
              <option value="audio">带音频</option>
            </select>
            <button className="btn sm" onClick={clearAll}>清空</button>
          </div>

          <div className="small muted" style={{ marginBottom: 10 }}>
            {loading ? '搜索中…' : `共 ${count} 条`}
          </div>

          {(extra === 'video' || extra === 'audio'
            ? items.filter((x) => entryHasMedia(x.values as Record<string, unknown>, extra as 'video' | 'audio'))
            : items).length ? (extra === 'video' || extra === 'audio'
            ? items.filter((x) => entryHasMedia(x.values as Record<string, unknown>, extra as 'video' | 'audio'))
            : items).map((it) => {
            const d = parseKey(it.date);
            const mv = moodMod ? Number(it.values[moodMod.id]) : 0;
            /*
             * #244 衍生：这一天加了密码，后端已经不返回标题/正文/标签了。
             * 不处理的话这一行看起来是「一条 0 字的空记录」，
             * 用户很可能以为是垃圾数据，顺手就删了 —— 而那其实是有内容的日记。
             */
            const locked = !!it.locked;
            return (
              <div
                className={`rec ${locked ? 'locked' : ''}`}
                key={it.date}
                onContextMenu={(e) => ctx.open(e, menuFor(it))}
              >
                <div className="hd">
                  <span className="dt">{it.date}</span>
                  <span className="dt muted">星期{WD[d.getDay()]}</span>
                  {locked ? <span className="tag">🔒 已加锁</span> : (
                    <>
                      {mv ? <span>{MOODS.find((x) => x.v === mv)?.e}</span> : null}
                      {(it.tags || []).map((t) => <span className="tag" key={t}>{t}</span>)}
                    </>
                  )}
                  {it.fav ? <span style={{ color: 'var(--accent)' }}>★</span> : null}
                  {!locked && it.status === 'draft' ? <span className="chip">草稿</span> : null}
                  <button className="go" onClick={() => void setDate(it.date)}>
                    {locked ? '去解锁' : '打开'}
                  </button>
                </div>
                {locked ? (
                  <div className="tx muted">这一天的日记设了密码，内容不在列表里显示。</div>
                ) : (
                  <>
                    {it.title ? <div className="rec-title" dangerouslySetInnerHTML={{ __html: highlight(it.title, q) }} /> : null}
                    <div className="tx" dangerouslySetInnerHTML={{ __html: highlight(it.plain, q) }} />
                  </>
                )}
              </div>
            );
          }) : <div className="empty">没有符合条件的记录。</div>}
        </div>
        </>
        )}
      </div>
      {ctx.node}
    </>
  );
}
