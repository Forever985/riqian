import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar, askConfirm } from '../components/ui';
import { ModuleList } from '../modules/ModuleList';
import { BgPicker, HistoryDialog, PickDatesDialog, QuotePickerDialog, TemplatesDialog } from '../features/dialogs';
import { ShareDialog, type ShareData } from '../features/share';
import { Icon } from '../components/Icons';
import { askProtect } from '../components/Lock';
import { WD, parseKey, shiftDay, todayKey, weekOfMonth } from '../lib/date';
import { imgUrl } from '../lib/media';
import { bgLayerStyle, parseBg } from '../features/mediaTone';
import type { OnThisDay } from '../types';

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '');

export function TodayView() {
  const date = useStore((s) => s.date);
  const draft = useStore((s) => s.draft);
  const entry = useStore((s) => s.entry);
  const saveState = useStore((s) => s.saveState);
  const saveBad = useStore((s) => s.saveBad);
  const dirty = useStore((s) => s.dirty);
  const dayStale = useStore((s) => s.dayStale);
  const dayAnchor = useStore((s) => s.dayAnchor);
  const rollover = useStore((s) => s.rollover);
  const setTitle = useStore((s) => s.setTitle);
  const publish = useStore((s) => s.publish);
  const settings = useStore((s) => s.settings);
  const patchDraft = useStore((s) => s.patchDraft);
  const setDate = useStore((s) => s.setDate);
  const reloadEntry = useStore((s) => s.reloadEntry);
  const toast = useStore((s) => s.toast);
  const modules = useStore((s) => s.modules);

  const [bgOpen, setBgOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [pickDates, setPickDates] = useState<'relate' | 'quote' | null>(null);
  const [quoteDate, setQuoteDate] = useState<string | null>(null);
  const [otd, setOtd] = useState<OnThisDay[]>([]);
  const [share, setShare] = useState<ShareData | null>(null);

  const d = parseKey(date);
  const isToday = date === todayKey();
  const published = (entry?.status || 'draft') === 'published';
  const titleOn = String(settings.entryTitleOn ?? '1') === '1';

  /** 保存状态：给一个确定的三种状态，而不是一直挂着「已保存」 */
  const saveChip = saveBad
    ? { t: '保存失败', c: 'var(--bad)' }
    : saveState === '保存中…'
      ? { t: '保存中…', c: 'var(--ink3)' }
      : dirty
        ? { t: '未保存', c: 'var(--warn)' }
        : entry?.updatedAt
          ? { t: '已保存', c: 'var(--ok)' }
          : { t: '还没写', c: 'var(--ink3)' };

  useEffect(() => { void api.stats.onThisDay().then(setOtd).catch(() => setOtd([])); }, [date]);

  /** 分享前先把没落盘的字写完，否则卡片里少了刚打的最后一句 */
  const openShare = async () => {
    if (useStore.getState().dirty) await useStore.getState().flushSave();
    const x = await api.review.day(date).catch(() => null);
    if (!x) { toast('这一天的数据还没准备好'); return; }
    const week = WD[parseKey(date).getDay()];
    const title = (draft.title || '').trim();
    setShare({
      // 有标题就用标题当大标题，日期挪到副标题 —— 否则分享出去只是一串日期，没人知道写了啥
      heading: title || `${d.getMonth() + 1} 月 ${d.getDate()} 日`,
      sub: [
        title ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : '',
        `星期${week}`,
        x.mood ? ['', '😣', '😕', '😐', '🙂', '😄'][x.mood] : '',
        x.weather,
      ].filter(Boolean).join(' · '),
      body: x.plain.slice(0, 220) || '这一天没有留下文字。',
      tags: x.tags,
      stats: [
        { label: '字数', value: String(x.chars) },
        { label: '打卡', value: `${x.habitDone}/${x.habitTotal}` },
        { label: '专注', value: `${x.pomoMinutes} 分` },
      ],
    });
  };

  const links = entry?.links || [];
  const backlinks = entry?.backlinks || [];
  const allLinks = [
    ...links.map((l) => ({ ...l, dir: 'out' as const })),
    ...backlinks.map((l) => ({ ...l, dir: 'in' as const })),
  ];

  const chars = modules
    .filter((m) => m.type === 'richtext' && typeof draft.values[m.id] === 'string')
    .map((m) => stripHtml(draft.values[m.id] as string).replace(/\s/g, '').length)
    .reduce((a, b) => a + b, 0);

  // 背景分两种：纯色直接铺卡片；图片必须单独占一层 ——
  // 否则调色/透明度套在卡片上，正文文字会跟着变暗、褪色（第 78 条踩的就是这个）
  const bgSolid = draft.bg && draft.bg.startsWith('#') ? { background: draft.bg } : {};
  const bgImg = draft.bg && !draft.bg.startsWith('#') ? imgUrl(draft.bg) : '';
  const bgOpts = parseBg(draft.bgTone);

  return (
    <>
      <Topbar title="今天" sub={isToday ? undefined : `回顾 ${date}`} />
      <div className="wrap">
        {dayStale && date === dayAnchor ? (
          <div className="daybar">
            <span className="dot" />
            <span>
              已经过了日界线，但你还停在 <b>{date}</b>。要不要开新的一页？
            </span>
            <span className="sp" />
            <button className="btn sm" onClick={() => void rollover()}>开新的一页 →</button>
            <button className="btn sm ghost" onClick={() => void setDate(todayKey())}>看今天</button>
          </div>
        ) : null}

        <div className="today">
          <div>
            <div className="datehead">
              <div>
                <div className="d1">
                  {/* 第 184 条：翻前一天 / 后一天不该非得去点日历 */}
                  <button className="dnav" title="前一天" onClick={() => void setDate(shiftDay(date, -1))}>
                    <Icon name="left" size={13} />
                  </button>
                  <span>{d.getMonth() + 1} 月 {d.getDate()} 日</span>
                  <button className="dnav" title="后一天" onClick={() => void setDate(shiftDay(date, 1))}>
                    <Icon name="right" size={13} />
                  </button>
                </div>
                <div className="d2">
                  星期{WD[d.getDay()]} · {d.getFullYear()} 年 · 第 {weekOfMonth(d)} 周{isToday ? '' : ' · 回顾'}
                </div>
              </div>
              <div className="rt">
                <span className="savechip" title={entry?.updatedAt ? `最后保存 ${entry.updatedAt}` : '还没保存过'}>
                  <i style={{ background: saveChip.c }} />
                  <em style={{ color: saveChip.c }}>{saveChip.t}</em>
                </span>
                <button
                  className={`btn sm ${published ? 'ghost' : 'primary'}`}
                  title={published ? '改回草稿，继续修改' : '定稿：写完收工，之后默认只读'}
                  onClick={async () => {
                    const on = !published;
                    if (!on && !(await askConfirm('改回草稿？', { body: '改完可以再定稿。', ok: '改回草稿' }))) return;
                    const r = await publish(on);
                    toast(r.status === 'published' ? '已定稿，这一天收工了' : '已改回草稿');
                  }}
                >
                  {published ? '已定稿 ✓' : '定稿'}
                </button>
                <button
                  className="btn sm"
                  data-act="fav"
                  title="收藏这一天"
                  onClick={async () => {
                    const fav = draft.fav ? 0 : 1;
                    patchDraft({ fav });
                    await api.entry.fav(date, fav);
                    await reloadEntry();
                    toast(fav ? '已收藏' : '已取消收藏');
                  }}
                >
                  {draft.fav ? '★ 已收藏' : '☆ 收藏'}
                </button>
                <button className="btn sm" onClick={() => setTplOpen(true)}>模板</button>
                <button className="btn sm" onClick={() => setBgOpen(true)}>背景</button>
                <button className="btn sm" onClick={() => void openShare()} title="生成一张图片，可保存或直接粘贴到微信">分享</button>
                <button className="btn sm" onClick={() => setHistOpen(true)}>历史版本</button>
                {/* 第 31 条：日记加锁的后端（vault 的 diary / diaryRange scope）一直都有，
                    但界面上没入口，等于没有。这里补一把锁。 */}
                <button
                  className="btn sm"
                  title="给这一天的日记加密码：之后打开这天要先输密码"
                  onClick={async () => {
                    await askProtect('diary', date, `${date} 这篇日记`);
                    toast('已给这一天加密码');
                  }}
                >🔒 加锁</button>
                {isToday ? null : (
                  <button className="btn sm" onClick={() => void setDate(todayKey())}>回到今天</button>
                )}
              </div>
            </div>

            {titleOn ? (
              <input
                className="entrytitle"
                value={draft.title}
                readOnly={published}
                maxLength={80}
                placeholder="给这一天起个标题（可留空）"
                onChange={(e) => setTitle(e.target.value)}
              />
            ) : null}

            <div className={`card ${published ? 'published' : ''} ${bgImg ? 'hasbg' : ''}`} style={bgSolid}>
              {bgImg ? (
                <>
                  <div className="card-bg" style={bgLayerStyle(bgImg, bgOpts)} aria-hidden />
                  {bgOpts.veil > 0.01 ? (
                    <div className="card-bg-veil" style={{ background: 'var(--panel)', opacity: bgOpts.veil }} aria-hidden />
                  ) : null}
                </>
              ) : null}
              <div className="card-inner">
              {published ? (
                <div className="pubbar">
                  <span>✓ 已定稿{published && entry?.publishedAt ? ` · ${entry.publishedAt.slice(0, 16)}` : ''}</span>
                  <span className="sp" />
                  <span className="small muted">定稿后默认只读，防止误改</span>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      if (!(await askConfirm('改回草稿？', { body: '改完可以再定稿。', ok: '改回草稿' }))) return;
                      await publish(false);
                      toast('已改回草稿');
                    }}
                  >改回草稿</button>
                </div>
              ) : null}
                <div className={published ? 'ro' : ''}>
                  <ModuleList date={date} />
                </div>
              </div>
            </div>
          </div>

          {/* 第 122 条：专注写作时这一列会被收掉（.app[data-focus-write="1"] .today-side） */}
          <div className="today-side">
            <div className="card">
              <h3>关联 <span className="muted">{allLinks.length || ''}</span></h3>
              {allLinks.length ? allLinks.map((l) => (
                <div className="row" key={`${l.dir}-${l.id}-${l.date}`} style={{ padding: '5px 0', borderBottom: '1px dashed var(--line2)' }}>
                  <span className="small" style={{ color: 'var(--ink3)' }}>{l.dir === 'out' ? '→' : '←'}</span>
                  <a href="#" className="small" onClick={(e) => { e.preventDefault(); void setDate(l.date); }}>{l.date}</a>
                  <span className="small muted">{l.kind === 'quote' ? '引用' : '相关'}</span>
                  {l.dir === 'out' ? (
                    <button
                      className="btn sm ghost"
                      style={{ marginLeft: 'auto', padding: '0 5px' }}
                      onClick={async () => { await api.link.remove(Number(l.id)); await reloadEntry(); }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              )) : <div className="empty small">还没有关联的日记。</div>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={() => setPickDates('relate')}>关联另一天</button>
                <button className="btn sm" onClick={() => setPickDates('quote')}>引用一段话</button>
              </div>
            </div>

            {otd.length ? (
              <div className="card">
                <h3>那年今日</h3>
                {otd.map((o) => (
                  <div key={o.date} style={{ padding: '7px 0', borderBottom: '1px dashed var(--line2)' }}>
                    <div
                      className="small"
                      style={{ color: 'var(--accent2)', cursor: 'pointer' }}
                      onClick={() => void setDate(o.date)}
                    >
                      {o.years > 0 ? `${o.years} 年前的今天` : o.date}
                    </div>
                    <div style={{
                      fontSize: 12.5, color: 'var(--ink2)', marginTop: 2,
                      display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {o.plain}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="card">
              <h3>这一天</h3>
              <div className="row small" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <span className="muted">字数</span><span>{chars} 字</span>
              </div>
              <div className="row small" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <span className="muted">编辑时间</span><span>{entry?.updatedAt || '—'}</span>
              </div>
              <div className="row small" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <span className="muted">历史版本</span><span>{entry?.revisionCount || 0} 个</span>
              </div>
              <div className="row small" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                <span className="muted">标签</span><span>{(entry?.tags || []).length} 个</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {bgOpen ? <BgPicker onClose={() => setBgOpen(false)} /> : null}
      {histOpen ? <HistoryDialog onClose={() => setHistOpen(false)} /> : null}
      {tplOpen ? <TemplatesDialog onClose={() => setTplOpen(false)} /> : null}
      {share ? <ShareDialog data={share} onClose={() => setShare(null)} /> : null}

      {pickDates === 'relate' ? (
        <PickDatesDialog
          title="关联哪几天？（可多选）"
          multi
          onClose={() => setPickDates(null)}
          onPick={async (dates) => {
            setPickDates(null);
            await api.link.addMany(date, dates, 'related');
            await reloadEntry();
            toast(`已关联 ${dates.length} 天`);
          }}
        />
      ) : null}

      {pickDates === 'quote' ? (
        <PickDatesDialog
          title="选择要引用的那一天"
          onClose={() => setPickDates(null)}
          onPick={(dates) => { setPickDates(null); setQuoteDate(dates[0]); }}
        />
      ) : null}

      {quoteDate ? <QuotePickerDialog date={quoteDate} onClose={() => setQuoteDate(null)} /> : null}
    </>
  );
}
