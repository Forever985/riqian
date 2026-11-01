import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar, Dialog, askText } from '../components/ui';
import { Icon } from '../components/Icons';
import { ShareDialog, type ShareData } from '../features/share';
import { WD, cnDateLabel, fmtDate, parseKey, shiftDay, todayKey } from '../lib/date';
import type { FestivalItem, ReviewDay, ReviewRange, SummaryRow } from '../types';

const MOOD_E = ['', '😣', '😕', '😐', '🙂', '😄'];

/** 把当前这版总结固化成一段可留存的 HTML（存库、导出、分享都用它） */
function summaryHtml(title: string, blocks: { k: string; v: string }[], lines: string[]): string {
  return `<h1>${title}</h1>`
    + `<div class="sum-kpi">${blocks.map((b) => `<div><b>${b.v}</b><span>${b.k}</span></div>`).join('')}</div>`
    + (lines.length ? `<ol class="sum-list">${lines.map((l) => `<li>${l}</li>`).join('')}</ol>` : '');
}

function stripTags(s: string) {
  return (s || '').replace(/<[^>]*>/g, '');
}

export function ReviewView() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const setDate = useStore((s) => s.setDate);
  const toast = useStore((s) => s.toast);

  const [mode, setMode] = useState<'day' | 'range'>('day');
  const [day, setDay] = useState(todayKey());
  const [days, setDays] = useState(Number(settings.reviewDays) || 7);
  const [data, setData] = useState<ReviewDay | null>(null);
  const [range, setRange] = useState<ReviewRange | null>(null);
  const [lunar, setLunar] = useState<string[]>([]);
  const [history, setHistory] = useState<SummaryRow[]>([]);
  const [share, setShare] = useState<ShareData | null>(null);
  const [viewing, setViewing] = useState<SummaryRow | null>(null);
  const [busy, setBusy] = useState(false);

  const from = useMemo(() => shiftDay(todayKey(), -(days - 1)), [days]);

  const loadHistory = useCallback(async () => {
    setHistory(await api.summary.list().catch(() => [] as SummaryRow[]));
  }, []);

  const load = useCallback(async () => {
    if (mode === 'day') {
      const [d, f] = await Promise.all([
        api.review.day(day).catch(() => null),
        api.festival.day(day).catch(() => [] as string[]),
      ]);
      setData(d);
      setLunar(f || []);
    } else {
      setRange(await api.review.range(from, todayKey()).catch(() => null));
    }
  }, [mode, day, from]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { if (days !== Number(settings.reviewDays)) void setSetting('reviewDays', String(days)); }, [days, settings.reviewDays, setSetting]);

  const d = parseKey(day);
  const today = todayKey();

  // 第 106 / 229 条：年月日顺序由设置和语言决定，不再写死空格拼接
  const dayTitle = fmtDate(d);

  const dayShare = (x: ReviewDay): ShareData => ({
    // 第 229 条：这里原来硬拼「11 月 1 日」，既不跟语言也不跟用户的年月日顺序
    heading: fmtDate(x.date),
    sub: `${WD[parseKey(x.date).getDay()]} · ${x.mood ? MOOD_E[x.mood] : ''}${x.weather ? ' ' + x.weather : ''}`.trim(),
    body: x.oneLine || x.plain.slice(0, 160) || '这一天没有留下文字。',
    tags: x.tags,
    stats: [
      { label: '字数', value: String(x.chars) },
      { label: '打卡', value: `${x.habitDone}/${x.habitTotal}` },
      { label: '专注', value: `${x.pomoMinutes} 分` },
    ],
  });

  const rangeShare = (r: ReviewRange): ShareData => ({
    heading: `${r.days} 天小结`,
    sub: `${r.from} → ${r.to}`,
    body: r.byDay.filter((x) => x.oneLine).slice(-4).map((x) => `· ${x.oneLine}`).join('\n') || '这段时间还没有记录。',
    tags: r.tagsTop.slice(0, 4).map((t) => t.tag),
    stats: [
      { label: '记录了', value: `${r.activeDays} 天` },
      { label: '总字数', value: String(r.totalChars) },
      { label: '专注', value: `${r.pomoMinutes} 分` },
    ],
  });

  const save = async () => {
    setBusy(true);
    try {
      let title = '';
      let body = '';
      let plain = '';
      if (mode === 'day' && data) {
        title = `${dayTitle} · 一日总结`;
        body = summaryHtml(title, [
          { k: '字数', v: String(data.chars) },
          { k: '打卡', v: `${data.habitDone}/${data.habitTotal}` },
          { k: '专注', v: `${data.pomoMinutes} 分` },
          { k: '待办完成', v: String(data.todoDone) },
        ], [data.oneLine || data.plain.slice(0, 200) || '（这一天没有留下文字）']);
        plain = `${dayTitle}：${data.chars} 字，打卡 ${data.habitDone}/${data.habitTotal}，专注 ${data.pomoMinutes} 分钟。${data.oneLine}`;
      } else if (mode === 'range' && range) {
        title = `${range.from} ~ ${range.to} · ${range.days} 天小结`;
        body = summaryHtml(title, [
          { k: '记录天数', v: `${range.activeDays}/${range.days}` },
          { k: '总字数', v: String(range.totalChars) },
          { k: '日均', v: String(range.avgChars) },
          { k: '最长连续', v: `${range.longest} 天` },
        ], range.byDay.filter((x) => x.oneLine).map((x) => `${x.date}：${x.oneLine}`));
        plain = `${range.from} ~ ${range.to}：记录 ${range.activeDays} 天，共 ${range.totalChars} 字，最长连续 ${range.longest} 天。`;
      } else return;

      const finalTitle = title;
      const fixed = await askText('给这份总结起个标题', finalTitle);
      if (fixed === null) return;
      const r = await api.summary.save({
        kind: mode, from: mode === 'day' ? day : from, to: mode === 'day' ? day : today,
        title: fixed || finalTitle, body, plain: stripTags(plain),
      });
      if (r.ok) { toast('已留存，随时可以在右边回看'); await loadHistory(); }
    } finally { setBusy(false); }
  };

  return (
    <>
      <Topbar
        title="总结"
        sub={mode === 'day' ? cnDateLabel(day, today) : `最近 ${days} 天`}
        right={<button className="btn sm ghost" onClick={() => useStore.getState().goSettings('share')}>总结偏好 →</button>}
      />
      <div className="wrap">
        <div className="card review-bar">
          <div className="row">
            <button className={`chip ${mode === 'day' ? 'on' : ''}`} onClick={() => setMode('day')}>一日总结</button>
            <button className={`chip ${mode === 'range' ? 'on' : ''}`} onClick={() => setMode('range')}>近几日总结</button>
            <span className="sp" />
            {mode === 'day' ? (
              <>
                <button className="btn sm ghost" data-tip="前一天" onClick={() => setDay(shiftDay(day, -1))}><Icon name="left" size={13} /></button>
                <input type="date" className="inp" style={{ width: 150 }} value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
                <button className="btn sm ghost" data-tip="后一天" onClick={() => setDay(shiftDay(day, 1))} disabled={day >= today}><Icon name="right" size={13} /></button>
                <button className="btn sm" onClick={() => setDay(today)}>今天</button>
              </>
            ) : (
              <>
                {[3, 7, 14, 30].map((n) => (
                  <button key={n} className={`chip ${days === n ? 'on' : ''}`} onClick={() => setDays(n)}>{n} 天</button>
                ))}
                <input
                  type="number" className="inp" style={{ width: 76 }} min={1} max={365}
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                />
                <span className="small muted">天</span>
              </>
            )}
          </div>
        </div>

        <div className="review-grid">
          <div>
            {mode === 'day' && data ? (
              <div className="card sum-card">
                <div className="sum-head">
                  <div>
                    <div className="sum-d">{dayTitle}</div>
                    <div className="sum-s">
                      星期{WD[d.getDay()]} · {data.chars} 字
                      {lunar.length ? ` · ${lunar.join(' · ')}` : ''}
                    </div>
                  </div>
                  <div className="row">
                    {data.mood ? <span className="sum-mood">{MOOD_E[data.mood]}</span> : null}
                    {data.weather ? <span className="chip">{data.weather}</span> : null}
                    {data.fav ? <span className="chip on">★ 收藏</span> : null}
                  </div>
                </div>

                <div className="sum-kpis">
                  <div><b>{data.chars}</b><span>字数</span></div>
                  <div><b>{data.habitDone}<small>/{data.habitTotal}</small></b><span>打卡</span></div>
                  <div><b>{data.pomoMinutes}</b><span>专注分钟</span></div>
                  <div><b>{data.todoDone}</b><span>待办完成</span></div>
                  <div><b>{data.images}</b><span>图片</span></div>
                </div>

                {data.oneLine ? (
                  <div className="sum-quote">
                    <span className="q">“</span>{data.oneLine}
                  </div>
                ) : null}

                {data.plain ? (
                  <div className="sum-body">{data.plain.slice(0, 900)}{data.plain.length > 900 ? '…' : ''}</div>
                ) : (
                  <div className="empty small">这一天还没有写。要不现在补一句？</div>
                )}

                {data.tags.length ? (
                  <div className="row" style={{ marginTop: 12 }}>
                    {data.tags.map((t) => <span className="chip" key={t}>#{t}</span>)}
                  </div>
                ) : null}

                <div className="sum-foot">
                  <button className="btn sm" onClick={() => void setDate(day)}>打开这一天 →</button>
                  <span className="sp" />
                  <button className="btn sm" onClick={() => void save()} disabled={busy}>{busy ? '留存中…' : '留存这版'}</button>
                  <button className="btn sm primary" onClick={() => setShare(dayShare(data))}>
                    <Icon name="share" size={13} />分享
                  </button>
                </div>
              </div>
            ) : null}

            {mode === 'range' && range ? (
              <>
                <div className="card sum-card">
                  <div className="sum-head">
                    <div>
                      <div className="sum-d">{days} 天小结</div>
                      <div className="sum-s">{range.from} → {range.to} · 有记录 {range.activeDays} 天</div>
                    </div>
                    <span className={`chip ${range.tail >= 3 ? 'on' : ''}`}>连续 {range.tail} 天</span>
                  </div>

                  <div className="sum-kpis">
                    <div><b>{range.totalChars}</b><span>总字数</span></div>
                    <div><b>{Number.isFinite(range.avgChars) ? range.avgChars : 0}</b><span>日均</span></div>
                    <div><b>{range.longest}</b><span>最长连续</span></div>
                    <div><b>{range.pomoMinutes}</b><span>专注分钟</span></div>
                    <div><b>{range.todoDone}</b><span>待办完成</span></div>
                  </div>

                  <div className="sum-bars" title="每天的字数">
                    {range.byDay.map((x) => {
                      const max = Math.max(1, ...range.byDay.map((y) => y.chars));
                      return (
                        <div className="sb" key={x.date} title={`${x.date} · ${x.chars} 字`}>
                          <i style={{ height: `${Math.max(2, (x.chars / max) * 100)}%` }} />
                        </div>
                      );
                    })}
                  </div>

                  {range.moodDist.some((n) => n > 0) ? (
                    <div className="row" style={{ marginTop: 10 }}>
                      <span className="small muted">心情分布</span>
                      {range.moodDist.map((n, i) => n > 0 ? <span className="chip" key={i}>{MOOD_E[i + 1]} {n}</span> : null)}
                    </div>
                  ) : null}

                  <div className="row" style={{ marginTop: 12 }}>
                    {range.tagsTop.slice(0, 6).map((t) => <span className="chip" key={t.tag}>#{t.tag} <b>{t.n}</b></span>)}
                    {range.habitsTop.slice(0, 4).map((h) => <span className="chip" key={h.name}>{h.name} <b>{h.n}</b></span>)}
                  </div>

                  <div className="sum-foot">
                    <button
                      className="btn sm"
                      disabled={!range.maxCharsDate}
                      title={range.maxCharsDate ? '去那一天' : '这段时间还没有字，没得跳'}
                      onClick={() => { if (range.maxCharsDate) void setDate(range.maxCharsDate); }}
                    >
                      字数最多的一天：{range.maxCharsDate || '还没有记录'}
                    </button>
                    <span className="sp" />
                    <button className="btn sm" onClick={() => void save()} disabled={busy}>{busy ? '留存中…' : '留存这版'}</button>
                    <button className="btn sm primary" onClick={() => setShare(rangeShare(range))}>
                      <Icon name="share" size={13} />分享
                    </button>
                  </div>
                </div>

                <div className="card">
                  <h3>每日一句 <span className="muted">{range.byDay.filter((x) => x.oneLine).length} 天有记录</span></h3>
                  {range.byDay.filter((x) => x.oneLine).slice().reverse().map((x) => (
                    <div className="sum-line" key={x.date} onClick={() => void setDate(x.date)}>
                      <span className="d">{x.date.slice(5)}</span>
                      <span className="t">{x.oneLine}</span>
                      <span className="n">{x.chars}</span>
                    </div>
                  ))}
                  {!range.byDay.some((x) => x.oneLine) ? <div className="empty small">这段时间还没有记录。</div> : null}
                </div>
              </>
            ) : null}

            {!data && !range ? <div className="card"><div className="empty">正在汇总…</div></div> : null}
          </div>

          <div>
            <div className="card">
              <h3><Icon name="archive" size={14} />留存的总结 <span className="muted">{history.length}</span></h3>
              <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.8 }}>
                点「留存这版」会把当前这版存下来；日记本身不动，删总结也不会动日记。
              </div>
              {history.length ? history.map((h) => (
                <div className="sum-hist" key={h.id}>
                  <button className="h-main" onClick={async () => setViewing(await api.summary.get(h.id))}>
                    <span className="h-t">{h.title}</span>
                    <span className="h-s">{h.fromDate === h.toDate ? h.fromDate : `${h.fromDate} → ${h.toDate}`} · {h.createdAt.slice(0, 16)}</span>
                  </button>
                  <button
                    className="btn sm ghost"
                    title={h.pinned ? '取消置顶' : '置顶'}
                    onClick={async () => { await api.summary.pin(h.id, h.pinned ? 0 : 1); await loadHistory(); }}
                  ><Icon name={h.pinned ? 'star-on' : 'star'} size={13} /></button>
                  <button
                    className="btn sm ghost"
                    data-act="del"
                    title="删除"
                    onClick={async () => {
                      if (!confirm(`删除「${h.title}」？只删这份总结，日记不受影响。`)) return;
                      await api.summary.remove(h.id);
                      await loadHistory();
                      toast('已删除');
                    }}
                  >✕</button>
                </div>
              )) : <div className="empty small">还没有留存过总结。</div>}
            </div>
          </div>
        </div>
      </div>

      {share ? <ShareDialog data={share} onClose={() => setShare(null)} /> : null}
      {viewing ? (
        <Dialog
          title={viewing.title}
          wide
          onClose={() => setViewing(null)}
          footer={<>
            <button className="btn" onClick={() => setViewing(null)}>关闭</button>
            <button
              className="btn"
              onClick={async () => {
                await api.share.copyText(viewing.plain || viewing.title);
                toast('文字已复制');
              }}
            >复制文字</button>
          </>}
        >
          <div className="sum-view" dangerouslySetInnerHTML={{ __html: viewing.body || '' }} />
        </Dialog>
      ) : null}
    </>
  );
}

/** 供「今天」页复用：把一天的数据直接包成分享数据 */
export function dayShareData(x: ReviewDay, festivals: FestivalItem[] = []): ShareData {
  const d = parseKey(x.date);
  return {
    // 第 229 条：同 dayShare，别在这里再硬拼一份
    heading: fmtDate(d),
    sub: [`星期${WD[d.getDay()]}`, x.mood ? MOOD_E[x.mood] : '', x.weather, ...festivals.map((f) => f.name)]
      .filter(Boolean).join(' · '),
    body: x.plain.slice(0, 200) || '这一天没有留下文字。',
    tags: x.tags,
    stats: [
      { label: '字数', value: String(x.chars) },
      { label: '打卡', value: `${x.habitDone}/${x.habitTotal}` },
      { label: '专注', value: `${x.pomoMinutes} 分` },
    ],
  };
}
