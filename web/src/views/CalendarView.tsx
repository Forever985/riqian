import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar, askText } from '../components/ui';
import { MonthJump } from '../components/MonthJump';
import { PomoDayDialog } from '../components/PomoDayDialog';
import { Icon } from '../components/Icons';
import { MOODS } from '../lib/const';
import { WD, pad, parseKey, shiftMonth, todayKey } from '../lib/date';
import type { CalendarDay, CalendarMonth, EntryListItem, ReviewDay } from '../types';

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

/** 格子的最小高度：太小的话字全挤在一起，用户看不清 */
const CELL_MIN_H = 84;

/** 选中日跨页面切换（选项卡）后还要留着，所以放在模块级 */
let keepSelected = todayKey();

interface CellMenu { x: number; y: number; date: string }

/**
 * 双击 / 右键「看这天的总结」。
 * 总结页的日期是它自己的局部状态（不读 store.date），所以这里进页之后把它的日期框改掉，
 * 这样双击日历是「看这天的总结」，而不是稀里糊涂跳进日记编辑器。
 */
function openReviewAt(date: string) {
  void useStore.getState().go('review');
  let tries = 0;
  const tick = () => {
    const el = document.querySelector<HTMLInputElement>('#view-root input[type="date"]');
    if (el) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) {
        setter.call(el, date);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    if (++tries < 40) window.setTimeout(tick, 50);
    else useStore.getState().toast(`已打开总结，请把日期选到 ${date}`);
  };
  window.setTimeout(tick, 30);
}

/** 复制日期：WebView 里不一定有 clipboard 权限，给一个退路 */
async function copyDate(key: string, done: (msg: string) => void) {
  try {
    await navigator.clipboard.writeText(key);
    done(`已复制 ${key}`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = key;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done(`已复制 ${key}`);
    } catch {
      done(`复制失败，日期是 ${key}`);
    }
    ta.remove();
  }
}

/** 格子下面那三个圆点：正文 / 打卡 / 图片 */
function dotStyle(on: boolean) {
  return {
    display: 'block',
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: on ? 'var(--accent)' : 'var(--line)',
    opacity: on ? 0.9 : 0.7,
  } as const;
}

export function CalendarView() {
  const ym = useStore((s) => s.ym);
  const setYm = useStore((s) => s.setYm);
  const setDate = useStore((s) => s.setDate);
  const todos = useStore((s) => s.todos);
  const reloadTodos = useStore((s) => s.reloadTodos);
  const toast = useStore((s) => s.toast);

  const [days, setDays] = useState<CalendarDay[]>([]);
  const [items, setItems] = useState<Record<string, EntryListItem>>({});
  const [imgDays, setImgDays] = useState<Record<string, 1>>({});
  const [fest, setFest] = useState<{ date: string; name: string }[]>([]);
  const [selected, setSelected] = useState(keepSelected);
  const [menu, setMenu] = useState<CellMenu | null>(null);
  // 菜单刚打开时忽略 scroll/mousedown，避免开了立刻被关
  const openedAt = useRef(0);
  const [review, setReview] = useState<ReviewDay | null>(null);
  /** 第 182 条：按月汇总，给年月快跳面板打点（一次拉全，别每次开面板都请求） */
  const [months, setMonths] = useState<CalendarMonth[]>([]);
  /** 第 186 条：正在看哪一天的专注明细（null 就不开弹层） */
  const [pomoDate, setPomoDate] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const [y, m] = ym.split('-').map(Number);
  const monthDays = new Date(y, m, 0).getDate();
  const tk = todayKey();

  useEffect(() => { keepSelected = selected; }, [selected]);
  useEffect(() => { void reloadTodos(); }, [reloadTodos]);

  /** 一个月的数据一次拉齐：日历格子 + 每天标题/正文摘要 + 有图的日子 + 节日 */
  const load = useCallback(async () => {
    const [yy, mm] = ym.split('-').map(Number);
    const last = new Date(yy, mm, 0).getDate();
    const from = `${ym}-01`;
    const to = `${ym}-${pad(last)}`;

    const [cal, list, imgs, f] = await Promise.all([
      api.stats.calendar(ym).catch(() => [] as CalendarDay[]),
      api.entry.list({ from, to, limit: 500 }).catch(() => [] as EntryListItem[]),
      api.entry.list({ from, to, hasImg: 1, limit: 500 }).catch(() => [] as EntryListItem[]),
      api.festival.month(ym).catch(() => [] as { date: string; name: string; lunar: boolean }[]),
    ]);

    const byDate: Record<string, EntryListItem> = {};
    list.forEach((x) => { byDate[x.date] = x; });
    const withImg: Record<string, 1> = {};
    imgs.forEach((x) => { withImg[x.date] = 1; });

    setDays(cal);
    setItems(byDate);
    setImgDays(withImg);
    setFest((f || []).map((x) => ({ date: x.date, name: x.name })));
  }, [ym]);

  useEffect(() => { void load(); }, [load]);

  // 有记录的月份只需要拉一次：换月、换日都不影响它
  useEffect(() => {
    void api.stats.calMonths().then(setMonths).catch(() => setMonths([]));
  }, []);

  // 侧栏议程只跟着选中日走，不动页面
  useEffect(() => {
    let alive = true;
    setReview(null);
    void api.review.day(selected).then((x) => {
      if (alive) setReview(x);
    }).catch(() => null);
    return () => { alive = false; };
  }, [selected]);

  // 菜单：点外部、按 Esc、滚动、改窗口大小都收起来
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const onScroll = () => {
      if (Date.now() - openedAt.current < 350) return;
      setMenu(null);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [menu]);

  const map = useMemo(() => {
    const out: Record<string, CalendarDay> = {};
    days.forEach((d) => { out[d.date] = d; });
    return out;
  }, [days]);

  const festOf = useMemo(() => {
    const o: Record<string, string[]> = {};
    for (const f of fest) (o[f.date] || (o[f.date] = [])).push(f.name);
    return o;
  }, [fest]);

  /** 快跳面板的打点数据：只把「有内容」的月份放进去，空月份不打点 */
  const monthMarks = useMemo(() => {
    const o: Record<string, number> = {};
    for (const x of months) {
      const w = x.days > 0 ? x.days : 0;
      if (w > 0) o[x.ym] = w;
    }
    return o;
  }, [months]);

  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;              // 周一为一周开始
  const prevMonthDays = new Date(y, m - 1, 0).getDate();
  const totalCells = Math.ceil((lead + monthDays) / 7) * 7;

  let activeDays = 0;
  let monthChars = 0;
  let checksSum = 0;
  let starDays = 0;
  Object.values(map).forEach((d) => {
    if (d.chars > 0 || d.checks > 0) activeDays++;
    monthChars += d.chars;
    checksSum += d.checks;
    if (d.fav) starDays++;
  });

  /** 换月不丢选中：尽量落在同一个「几号」，月底没有就取当月最后一天 */
  const goMonth = (nextYm: string) => {
    const [ny, nm] = nextYm.split('-').map(Number);
    const last = new Date(ny, nm, 0).getDate();
    const want = Number(selected.slice(8, 10)) || 1;
    setYm(nextYm);
    setSelected(`${nextYm}-${pad(Math.min(want, last))}`);
  };

  const goToday = () => {
    setYm(tk.slice(0, 7));
    setSelected(tk);
  };

  /** 只换选中日，不跳页 */
  const viewDay = (date: string) => {
    const mm = date.slice(0, 7);
    if (mm !== ym) setYm(mm);
    setSelected(date);
  };

  const toggleFav = async (date: string) => {
    const cur = items[date]?.fav ?? map[date]?.fav ?? 0;
    try {
      await api.entry.fav(date, cur ? 0 : 1);
      toast(cur ? '已取消收藏' : '已收藏这一天');
      await load();
    } catch (e) {
      toast('没成功：' + (e as Error).message);
    }
  };

  const openMenu = (e: ReactMouseEvent, date: string) => {
    e.preventDefault();
    e.stopPropagation();
    const w = 184;
    const h = 236;
    openedAt.current = Date.now();
    setMenu({
      x: Math.max(6, Math.min(e.clientX, window.innerWidth - w - 6)),
      y: Math.max(6, Math.min(e.clientY, window.innerHeight - h - 6)),
      date,
    });
  };

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const offset = i - lead;
    let dayNum: number;
    let cellYm = ym;
    let other = false;
    if (offset < 0) {
      dayNum = prevMonthDays + offset + 1;
      cellYm = shiftMonth(ym, -1);
      other = true;
    } else if (offset >= monthDays) {
      dayNum = offset - monthDays + 1;
      cellYm = shiftMonth(ym, 1);
      other = true;
    } else {
      dayNum = offset + 1;
    }
    const [cy, cm] = cellYm.split('-').map(Number);
    const key = `${cy}-${pad(cm)}-${pad(dayNum)}`;
    const info = map[key];
    const item = items[key];
    const isWe = (i % 7) >= 5;
    const hasText = !!(info?.chars || item?.chars);
    const hasCheck = (info?.checks ?? 0) > 0;
    const hasImg = !!imgDays[key];
    const festName = festOf[key]?.[0] || '';
    const excerpt = item ? (item.title || item.plain || '').replace(/\s+/g, ' ').trim() : '';

    cells.push(
      <button
        key={`${cellYm}-${dayNum}`}
        className={[
          'cal2-cell',
          other ? 'other' : '',
          isWe ? 'we' : '',
          key === tk ? 'today' : '',
          key === selected ? 'sel' : '',
        ].join(' ')}
        title={info ? `${key} · ${info.chars} 字 · ${info.checks} 项打卡` : key}
        style={{ minHeight: CELL_MIN_H, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}
        onClick={() => {
          if (other) setYm(cellYm);
          setSelected(key);
        }}
        onDoubleClick={() => { viewDay(key); openReviewAt(key); }}
        onContextMenu={(e) => openMenu(e, key)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 14 }}>
          <span className="n">{dayNum}</span>
          {info?.fav ? <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--accent)', lineHeight: 1 }}>★</span> : null}
        </span>

        {festName ? (
          <span
            style={{
              fontSize: 10, color: 'var(--accent)', lineHeight: 1.25, maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {festName}
          </span>
        ) : null}

        {excerpt ? (
          <span
            style={{
              fontSize: 10.5, color: 'var(--ink3)', lineHeight: 1.3, maxWidth: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {excerpt}
          </span>
        ) : null}

        <span style={{ display: 'flex', gap: 4, marginTop: 'auto', paddingTop: 3 }} title="依次是：有正文 / 有打卡 / 有图">
          <i style={dotStyle(hasText)} />
          <i style={dotStyle(hasCheck)} />
          <i style={dotStyle(hasImg)} />
        </span>
      </button>,
    );
  }

  const selInfo = map[selected];
  const selItem = items[selected];
  const selTodos = todos.filter((t) => !t.trashed && t.due === selected);
  const selDate = parseKey(selected);
  const chars = review?.chars ?? selInfo?.chars ?? selItem?.chars ?? 0;
  const moodV = review?.mood ?? selInfo?.mood ?? 0;
  const moodT = moodV ? MOODS.find((x) => x.v === moodV)?.t || '' : '';
  const tags = review?.tags && review.tags.length ? review.tags : (selItem?.tags || []);
  const habitDone = review?.habitDone ?? selInfo?.checks ?? 0;
  const habitTotal = review?.habitTotal ?? 0;
  const pomoMinutes = review?.pomoMinutes ?? 0;
  const pomoCount = review?.pomoCount ?? 0;
  const selTitle = selItem?.title || '';
  const selOneLine = review?.oneLine || '';
  const selFav = !!(selInfo?.fav ?? selItem?.fav);
  const isToday = selected === tk;

  const kvKey = { fontSize: 11.5, color: 'var(--ink3)' } as const;
  const kvVal = { fontSize: 12.5, color: 'var(--ink2)' } as const;

  return (
    <>
      <Topbar
        title="日历"
        sub={`${y} 年 ${m} 月 · ${activeDays} 天有记录 · ${monthChars} 字`}
        right={
          <button
            className={`btn sm ${isToday ? '' : 'primary'}`}
            title={isToday ? '已经在今天' : `选中日是 ${selected}，点这里回到今天`}
            onClick={goToday}
          >
            回到今天
          </button>
        }
      />
      <div className="wrap wide">
        <div className="cal2">
          <div className="card">
            <div className="cal2-head">
              {/*
                第 182 条：以前这里是「11 月」+「2026」两个死字，只能靠左右箭头一个月一个月挪。
                现在这两个字本身就是开关 —— 点开是十年段 + 12 格的快跳面板。
                不再在右边另外放一个按钮，否则同一个月份在一行里出现两次。
              */}
              <MonthJump
                ym={ym}
                marks={monthMarks}
                unit=" 天"
                title="跳到某年某月"
                variant="title"
                onPick={(next) => goMonth(next)}
                label={`${y} 年 ${m} 月`}
              />
              <span className="nav">
                <button className="btn sm" data-act="prev-month" title="上个月" onClick={() => goMonth(shiftMonth(ym, -1))}>
                  <Icon name="left" size={14} />
                </button>
                <button className="btn sm" title="回到本月" onClick={() => goMonth(tk.slice(0, 7))}>本月</button>
                <button className="btn sm" data-act="next-month" title="下个月" onClick={() => goMonth(shiftMonth(ym, 1))}>
                  <Icon name="right" size={14} />
                </button>
              </span>
            </div>

            <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
              <div
                className="cal2-grid"
                style={{ gridTemplateColumns: 'repeat(7, minmax(78px, 1fr))', gridAutoRows: `minmax(${CELL_MIN_H}px, auto)`, gap: 6, minWidth: 560 }}
              >
                {WEEK_HEAD.map((w, i) => (
                  <div className={`cal2-wd ${i >= 5 ? 'we' : ''}`} key={w}>{w}</div>
                ))}
                {cells}
              </div>
            </div>

            <div className="legend" style={{ marginTop: 12 }}>
              <span className="small muted">
                {activeDays} 天有记录 · {monthChars} 字 · {checksSum} 项打卡{starDays ? ` · ★${starDays}` : ''}
              </span>
              <span style={{ marginLeft: 'auto' }} className="small muted">
                单击看当天 · 双击看总结 · 右键更多
              </span>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              格子底部的三个圆点依次表示：有正文、有打卡、有图。
            </div>
          </div>

          <div className="card">
            <div className="agenda">
              <div className="ad">
                {selDate.getMonth() + 1} 月 {selDate.getDate()} 日 · 星期{WD[selDate.getDay()]}
                {isToday ? ' · 今天' : ''}
              </div>

              {selTitle || selOneLine ? (
                <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, marginBottom: 6 }}>
                  {selTitle || selOneLine}
                </div>
              ) : null}

              <div className="big">
                {chars}
                <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink3)' }}> 字</span>
                {selFav ? <span style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 8 }}>★ 收藏</span> : null}
              </div>
              <div className="lbl">
                {selInfo || review?.hasEntry ? '这一天有记录' : '这天还没有记录'}
                {habitTotal ? ` · 打卡 ${habitDone}/${habitTotal}` : habitDone ? ` · 打卡 ${habitDone} 项` : ''}
              </div>

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: '7px 10px', alignItems: 'center' }}>
                <span style={kvKey}>心情</span>
                <span style={kvVal}>{moodT || '—'}</span>

                <span style={kvKey}>标签</span>
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {tags.length ? tags.slice(0, 6).map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11, padding: '1px 7px', borderRadius: 20,
                        border: '1px solid var(--line)', color: 'var(--ink2)', background: 'var(--panel2)',
                      }}
                    >
                      {t}
                    </span>
                  )) : <span style={kvVal}>—</span>}
                </span>

                <span style={kvKey}>打卡</span>
                <span style={kvVal}>{habitTotal ? `${habitDone} / ${habitTotal} 项完成` : habitDone ? `${habitDone} 项完成` : '—'}</span>

                <span style={kvKey}>专注</span>
                <span style={kvVal}>
                  {pomoMinutes ? (
                    <button
                      className="linkbtn"
                      data-act="pomo-day"
                      title="看这一天每颗番茄分别做了什么"
                      onClick={() => setPomoDate(selected)}
                    >
                      {pomoMinutes} 分钟{pomoCount ? ` · ${pomoCount} 颗` : ''} → 看明细
                    </button>
                  ) : '—'}
                </span>
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="lbl" style={{ marginBottom: 4 }}>
                  这天的待办{selTodos.length ? `（${selTodos.length}）` : ''}
                </div>
                {selTodos.length ? selTodos.slice(0, 6).map((t) => (
                  <div className="arow" key={t.id}>
                    <span style={{ color: t.done ? 'var(--ink3)' : 'var(--accent)' }}>{t.done ? '✓' : '○'}</span>
                    <span style={{
                      textDecoration: t.done ? 'line-through' : 'none', flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.title}
                    </span>
                  </div>
                )) : <div className="small muted">没有。</div>}
              </div>

              <div className="row" style={{ marginTop: 16 }}>
                <button className="btn primary sm" onClick={() => void setDate(selected)}>
                  <Icon name="pen" size={13} />打开这一天
                </button>
                <button className="btn sm ghost" onClick={() => openReviewAt(selected)}>看总结</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {menu ? createPortal(
        <div
          ref={menuRef}
          className="rowmenu"
          style={{ position: 'fixed', left: menu.x, top: menu.y, right: 'auto', minWidth: 176, zIndex: 120 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div style={{ padding: '4px 8px 5px', fontSize: 11, color: 'var(--ink3)' }}>{menu.date}</div>
          <button onClick={() => { const d = menu.date; setMenu(null); viewDay(d); }}>查看这一天</button>
          <button onClick={() => { const d = menu.date; setMenu(null); void setDate(d); }}>写这天日记</button>
          {/*
            * 第 207 条：用户原话「我在浏览日历的时候突然想在这一天有待办、有事要做」。
            * 所以右键里直接能加，不用先切到待办页再挑日期。
            */}
          <button
            data-act="cal-add-todo"
            onClick={async () => {
              const d = menu.date;
              setMenu(null);
              const title = await askText(`在这天加一条待办（${d}）`, '', '要做什么');
              if (!title || !title.trim()) return;
              await api.todos.add({ title: title.trim(), due: d, dueTime: '', priority: 1 });
              toast(`已加到 ${d}`);
            }}
          >在这天加待办</button>
          <button
            data-act="cal-add-cd"
            onClick={async () => {
              const d = menu.date;
              setMenu(null);
              const title = await askText(`在这天加一个倒计时（${d}）`, '', '倒数什么');
              if (!title || !title.trim()) return;
              await api.cd.add({ title: title.trim(), date: d, repeat: '', color: '', note: '' });
              toast(`已加到 ${d}`);
            }}
          >在这天加倒计时</button>
          <button onClick={() => { const d = menu.date; setMenu(null); openReviewAt(d); }}>看这天的总结</button>
          <button onClick={() => { const d = menu.date; setMenu(null); setPomoDate(d); }}>看这天的专注</button>
          <button onClick={() => { const d = menu.date; setMenu(null); void toggleFav(d); }}>
            {(items[menu.date]?.fav ?? map[menu.date]?.fav) ? '取消收藏' : '收藏这一天'}
          </button>
          <button onClick={() => { const d = menu.date; setMenu(null); void copyDate(d, toast); }}>复制日期</button>
        </div>,
        document.body,
      ) : null}

      <PomoDayDialog date={pomoDate} onClose={() => setPomoDate(null)} />
    </>
  );
}
