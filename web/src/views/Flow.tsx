import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { imgUrl } from '../lib/media';
import { bgLayerStyle, parseBg } from '../features/mediaTone';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { MOODS } from '../lib/const';
import { WD, parseKey, todayKey } from '../lib/date';
import type { EntryListItem } from '../types';

const PAGE = 40;

/**
 * 第 216 条：流的四个方向。
 *
 * 之前只有「纵向 / 横向」两个值，用户要的是东南西北都能翻：
 * 向下（默认，越往下越早）、向上（反过来，越往下越近）、
 * 向右（横向向右是更早）、向左（横向向左是更早）。
 *
 * 实现上不重排数组，只用 flex-direction 的 reverse —— 数据顺序永远是从新到旧，
 * 「往哪个方向是更早」交给 CSS 决定。这样翻到一半切方向也不会跳位。
 */
type FlowDir = 'v' | 'vr' | 'h' | 'hl';

const DIRS: { v: FlowDir; n: string; icon: 'up' | 'down' | 'left' | 'right'; tip: string }[] = [
  { v: 'v', n: '向下', icon: 'down', tip: '竖排，往下翻看更早的' },
  { v: 'vr', n: '向上', icon: 'up', tip: '竖排，往上翻看更早的' },
  { v: 'h', n: '向右', icon: 'right', tip: '横排，往右翻看更早的' },
  { v: 'hl', n: '向左', icon: 'left', tip: '横排，往左翻看更早的' },
];

/**
 * 流视图里的一格正文。
 * 关键点：非受控 —— 只在挂载时写入一次 HTML，之后交给浏览器自己管。
 * 否则每次输入都 setState → 重渲染 → innerHTML 被覆盖，光标跳到开头，字还会被吞。
 */
function FlowBody({ initial, onInput }: { initial: string; onInput: (html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initial) ref.current.innerHTML = initial || '';
    // 只在挂载时同步一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className="fw-body rt"
      contentEditable
      suppressContentEditableWarning
      data-ph="这天没有正文，点一下就能补写"
      onInput={(e) => onInput((e.target as HTMLDivElement).innerHTML)}
    />
  );
}

export function FlowView() {
  const modules = useStore((s) => s.modules);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const setDate = useStore((s) => s.setDate);
  const toast = useStore((s) => s.toast);

  const [items, setItems] = useState<EntryListItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [tw, setTw] = useState(false);
  const [focus, setFocus] = useState(false);
  /** 第 210 / 216 条：当前停在哪一条（快捷翻页要知道从哪翻） */
  const [at, setAt] = useState(0);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flowRef = useRef<HTMLDivElement>(null);

  const enabled = modules.filter((m) => m.enabled === 1);
  const rt = enabled.find((m) => m.type === 'richtext');
  const moodMod = enabled.find((m) => m.type === 'mood');

  /* 第 216 条：方向存 settings，老值 'v'/'h' 直接兼容，不认识的当 'v' */
  const rawDir = String(settings.flowDir || 'v');
  const dir: FlowDir = (['v', 'vr', 'h', 'hl'] as const).includes(rawDir as FlowDir)
    ? (rawDir as FlowDir) : 'v';
  const horiz = dir === 'h' || dir === 'hl';

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    try {
      const start = reset ? 0 : offset;
      const list = await api.entry.list({ limit: PAGE, offset: start });
      if (list.length < PAGE) setHasMore(false);
      setOffset(start + list.length);
      setItems((prev) => (reset ? list : [...prev, ...list]));
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // 滚到底自动加载更早的（滚动容器是 .view）
  useEffect(() => {
    const box = document.getElementById('view-root');
    if (!box) return;
    const onScroll = () => {
      if (loading || !hasMore) return;
      /* 横排时「到头」的方向反了：往右翻是看更早，要判 scrollLeft 接近最大 */
      const near = horiz
        ? box.scrollLeft + box.clientWidth > box.scrollWidth - 400
        : box.scrollTop + box.clientHeight > box.scrollHeight - 400;
      if (near) void load(false);
    };
    box.addEventListener('scroll', onScroll);
    return () => box.removeEventListener('scroll', onScroll);
  }, [loading, hasMore, load, horiz]);

  // 打字机模式：光标始终拉回中线附近
  useEffect(() => {
    if (!tw) return;
    const box = document.getElementById('view-root');
    if (!box) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.('.fw-body')) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const vb = box.getBoundingClientRect();
      const mid = vb.top + vb.height * 0.42;
      if (rect.top < mid - 110 || rect.top > mid + 110) {
        box.scrollBy({ top: rect.top - mid, behavior: 'smooth' });
      }
    };
    box.addEventListener('keyup', onKey);
    return () => box.removeEventListener('keyup', onKey);
  }, [tw]);

  /**
   * 第 210 条：快捷翻页。
   *
   * 用户原话：「不能光靠鼠标滚轮之类的去翻页」。
   * 所以给三个入口：
   *   1. 右下角上下两条（横排时是左右两条）
   *   2. Alt+↑ / Alt+↓（横排时 Alt+← / Alt+→）以及 PageUp/PageDown
   *   3. 顶栏直接跳到某一天
   * 判定「当前在哪一条」靠 scrollIntoView 的镜像：算每条的中线离视口中线最近的。
   */
  const scrollToIdx = (idx: number, smooth = true) => {
    const list = flowRef.current?.querySelectorAll<HTMLElement>('.fw-entry');
    if (!list || !list.length) return;
    const i = Math.max(0, Math.min(list.length - 1, idx));
    setAt(i);
    list[i].scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start', inline: 'start' });
  };

  const step = (n: number) => {
    if (n > 0 && at + n >= items.length && hasMore) void load(false);
    scrollToIdx(at + n);
  };

  /* 键盘：Alt + 方向键 / PageUp / PageDown。输入框里不抢键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, [contenteditable="true"], select')) return;
      const back = horiz ? 'ArrowLeft' : 'ArrowUp';
      const fwd = horiz ? 'ArrowRight' : 'ArrowDown';
      if (!e.altKey) {
        if (e.key === 'PageUp') { e.preventDefault(); step(-1); }
        else if (e.key === 'PageDown') { e.preventDefault(); step(1); }
        return;
      }
      if (e.key === back) { e.preventDefault(); step(-1); }
      else if (e.key === fwd) { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* 滚动时把「当前条」同步过来，翻页按钮才不会从错误的位置开始 */
  useEffect(() => {
    const box = document.getElementById('view-root');
    if (!box) return;
    const onScroll = () => {
      const list = flowRef.current?.querySelectorAll<HTMLElement>('.fw-entry');
      if (!list || !list.length) return;
      const vb = box.getBoundingClientRect();
      const mid = horiz ? vb.left + vb.width / 2 : vb.top + vb.height / 2;
      let best = 0;
      let bestD = Infinity;
      list.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const c = horiz ? r.left + r.width / 2 : r.top + r.height / 2;
        const d = Math.abs(c - mid);
        if (d < bestD) { bestD = d; best = i; }
      });
      setAt((prev) => (prev === best ? prev : best));
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, [horiz, items.length]);

  const queueSave = (date: string, values: Record<string, unknown>, fav: number, bg: string) => {
    if (timers.current[date]) clearTimeout(timers.current[date]);
    timers.current[date] = setTimeout(async () => {
      try {
        await api.entry.save({ date, values: values as never, fav, bg });
      } catch (e) {
        toast('保存失败：' + (e as Error).message);
      }
    }, 700);
  };

  /* ---------------- 右键菜单（第 235 条） ---------------- */
  const ctx = useContextMenu();

  const copy = async (txt: string) => {
    try { await navigator.clipboard.writeText(txt); toast('已复制'); } catch { toast('复制失败'); }
  };

  const menuFor = (it: EntryListItem): MenuItem[] => [
    { label: '打开这一天', hint: '进「今天」', onClick: () => void setDate(it.date) },
    { label: it.fav ? '取消收藏' : '收藏这一天', onClick: async () => {
      const nv = it.fav ? 0 : 1;
      await api.entry.fav(it.date, nv);
      setItems((prev) => prev.map((x) => (x.date === it.date ? { ...x, fav: nv } : x)));
    } },
    { sep: true },
    { label: '复制日期', onClick: () => void copy(it.date) },
    { label: '复制正文', disabled: !it.plain, onClick: () => void copy(it.plain || '') },
    { sep: true },
    { label: '这一天做成待办', hint: '标题取前 40 字', onClick: async () => {
      await api.todos.add({
        title: (it.title || it.plain || it.date).slice(0, 40),
        due: it.date, priority: 1, note: `来自 ${it.date} 的记录`,
      });
      toast('已加到待办');
    } },
    { label: it.bg ? '清掉这天的背景' : '这天没有背景', disabled: !it.bg,
      confirm: `清掉 ${it.date} 的背景？正文不受影响。`,
      onClick: async () => {
        await api.entry.bg(it.date, '');
        setItems((prev) => prev.map((x) => (x.date === it.date ? { ...x, bg: '' } : x)));
        toast('背景清掉了');
      } },
    { sep: true },
    { label: '跳到这天', hint: '在流里定位', onClick: () => scrollToIdx(items.findIndex((x) => x.date === it.date)) },
  ];

  /** 跳到指定日期：先查在不在已经拉下来的这一段里，不在就按日期重新查一次 */
  const jumpTo = async (date: string) => {
    if (!date) return;
    const i = items.findIndex((x) => x.date === date);
    if (i >= 0) { scrollToIdx(i); toast(`跳到 ${date}`); return; }
    const list = await api.entry.list({ from: date, to: todayKey(), limit: 8, offset: 0 }).catch(() => [] as EntryListItem[]);
    const hit = list.find((x) => x.date === date);
    if (!hit) { toast(`没有 ${date} 这一天的记录`); return; }
    setItems((prev) => (prev.some((x) => x.date === date) ? prev : [hit, ...prev].sort((a, b) => (a.date < b.date ? 1 : -1))));
    setOffset((n) => n + 1);
    setTimeout(() => scrollToIdx(0), 30);
    toast(`跳到 ${date}`);
  };

  return (
    <>
      <Topbar
        title="流"
        sub={horiz ? '左右翻，一格一天' : '所有日记首尾相接，直接在上面写'}
        right={<>
          {/* 第 216 条：四个方向 */}
          <div className="seg seg-icon" title="流往哪边长">
            {DIRS.map((d) => (
              <button
                key={d.v}
                className={`seg-b ${dir === d.v ? 'on' : ''}`}
                data-flowdir={d.v}
                title={d.tip}
                onClick={() => void setSetting('flowDir', d.v)}
              >
                <Icon name={d.icon} size={13} />
              </button>
            ))}
          </div>
          <input
            className="inp fw-jump"
            type="date"
            title="跳到某一天"
            value=""
            onChange={(e) => void jumpTo(e.target.value)}
          />
          <button className={`btn sm ${tw ? 'primary' : ''}`} onClick={() => setTw((x) => !x)}>打字机</button>
          <button className={`btn sm ${focus ? 'primary' : ''}`} onClick={() => setFocus((x) => !x)}>焦点</button>
        </>}
        lock={{ scope: 'flow', label: '流' }}
      />
      <div className="wrap">
        <div
          ref={flowRef}
          className={`flow ${tw ? 'tw' : ''} ${focus ? 'focus' : ''}`}
          data-dir={dir}
        >
          {items.length ? items.map((it) => {
            const d = parseKey(it.date);
            const mv = moodMod ? Number(it.values[moodMod.id]) : 0;
            const mood = mv ? MOODS.find((x) => x.v === mv)?.e : '';
            /*
             * #244：这一天加了密码。
             *
             * 后端 entry.list 已经不再返回它的正文（title/plain/values/tags 全是空的），
             * 这里只是别把它画成「一天什么都没写」—— 那会让用户以为内容丢了。
             * 明确说一句「被保护了」，并给一个去「今天」解锁的入口。
             */
            const locked = !!it.locked;
            return (
              <article
                className="fw-entry"
                key={it.date}
                data-entry={it.date}
                onContextMenu={(e) => { if (!locked) ctx.open(e, menuFor(it)); }}
              >
                <div className="fw-date">
                  <span className="d">{d.getMonth() + 1}月{d.getDate()}日</span>
                  <span className="w">星期{WD[d.getDay()]} {d.getFullYear()}</span>
                  <span className="meta">
                    {locked ? (
                      <span style={{ color: 'var(--ink3)' }}>🔒 已加锁</span>
                    ) : (
                      <>
                        {(it.tags || []).map((t) => <span className="tag" key={t}>{t}</span>)}
                        <span>{it.chars || 0} 字</span>
                        {mood ? <span>{mood}</span> : null}
                        <span
                          className="star"
                          style={{ cursor: 'pointer' }}
                          onClick={async () => {
                            const nv = it.fav ? 0 : 1;
                            await api.entry.fav(it.date, nv);
                            setItems((prev) => prev.map((x) => (x.date === it.date ? { ...x, fav: nv } : x)));
                          }}
                        >
                          {it.fav ? '★' : '☆'}
                        </span>
                      </>
                    )}
                    <span style={{ cursor: 'pointer' }} onClick={() => void setDate(it.date)}>打开</span>
                  </span>
                </div>
                {locked ? (
                  <div className="fw-locked">
                    <span>这一天的日记设了密码，先解锁才能在这里看到。</span>
                    <button className="btn sm" onClick={() => void setDate(it.date)}>去解锁</button>
                  </div>
                ) : (
                  <>
                    {it.title ? <h3 className="fw-title">{it.title}</h3> : null}
                    {/* 只有背景没有正文的一天：把背景铺成一条，别让它看起来是空条目 */}
                    {it.bg ? (
                      <button
                        className="fw-bg"
                        title="这一天设了背景，点开看看"
                        onClick={() => void setDate(it.date)}
                        style={it.bg.startsWith('#') ? { background: it.bg } : undefined}
                      >
                        {/* 和「今天」页同一套参数：背景层单独一层，调色不会染到下面那行小字 */}
                        {!it.bg.startsWith('#') ? (
                          <>
                            <i className="fw-bg-fill" style={bgLayerStyle(imgUrl(it.bg), parseBg(it.bgTone))} />
                            {parseBg(it.bgTone).veil > 0.01 ? (
                              <i className="fw-bg-veil" style={{ opacity: parseBg(it.bgTone).veil }} />
                            ) : null}
                          </>
                        ) : null}
                        {it.chars ? null : <span className="fw-bg-tip">这一天只有一张背景</span>}
                      </button>
                    ) : null}
                    {rt ? (
                      <FlowBody
                        key={it.date}
                        initial={(it.values[rt.id] as string) || ''}
                        onInput={(html) => {
                          setItems((prev) => prev.map((x) => (
                            x.date === it.date ? { ...x, values: { ...x.values, [rt.id]: html } } : x
                          )));
                          queueSave(it.date, { ...it.values, [rt.id]: html }, it.fav, it.bg);
                        }}
                      />
                    ) : <div className="empty">没有启用的正文模块</div>}
                  </>
                )}
              </article>
            );
          }) : (
            <div className="fw-empty">还没有任何记录。<br />去「今天」写第一篇吧。</div>
          )}

          {loading ? <div className="fw-more">加载中…</div>
            : hasMore
              ? <div className="fw-more"><button className="btn" onClick={() => void load(false)}>加载更早</button></div>
              : <div className="fw-more">— 到底了 —</div>}
        </div>
      </div>

      {/*
        第 210 条：既然不让只靠滚轮，那得有个一直看得见的东西。
        固定在右下角，横排时换成左右箭头；到底了就自动变灰。
      */}
      {items.length > 1 ? (
        <div className={`fw-pager ${horiz ? 'h' : ''}`} data-at={at}>
          <button
            className="fw-pg"
            data-act="prev"
            title={horiz ? '上一天（Alt+←）' : '上一天（Alt+↑）'}
            disabled={at <= 0}
            onClick={() => step(-1)}
          >
            <Icon name={horiz ? 'left' : 'up'} size={14} />
          </button>
          <span className="fw-pgn">{at + 1}/{items.length}</span>
          <button
            className="fw-pg"
            data-act="next"
            title={horiz ? '下一天（Alt+→）' : '下一天（Alt+↓）'}
            disabled={at >= items.length - 1 && !hasMore}
            onClick={() => step(1)}
          >
            <Icon name={horiz ? 'right' : 'down'} size={14} />
          </button>
        </div>
      ) : null}

      {ctx.node}
    </>
  );
}