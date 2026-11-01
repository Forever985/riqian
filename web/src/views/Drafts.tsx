import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar, Dialog } from '../components/ui';
import { Icon } from '../components/Icons';
import { SortBar, type SortDir, type SortOption } from '../components/SortBar';
import { cnDateLabel, todayKey } from '../lib/date';
import type { DraftItem } from '../types';

/**
 * 第 227 条：草稿箱也要是「齐的」。
 *
 * 原来这里只有一个平铺列表：不能排、不能筛、删了就没。
 * 用户的原话是「草稿箱功能也要齐全」—— 那齐全的标准是什么？
 * 参照回收站/笔记那几块的成熟做法，至少得有四件：
 *   1. 排序（按改过的时间 / 字数 / 日期，还能反着排）
 *   2. 筛选（搜索关键词，只看某一类）
 *   3. 回收站（删了能捡回来，捡不回来还能彻底删）
 *   4. 批量（定稿、删除都能一次选多条）
 * 这里照着这个标准补齐。排序偏好存 settings，下次进来还是上次那样。
 */
type SortKey = 'updated' | 'chars' | 'date';
type Filter = 'all' | 'week' | 'month' | 'empty';

const SORTS: SortOption<SortKey>[] = [
  { v: 'updated', n: '改过的时间', tip: '最近动过的排前面' },
  { v: 'chars', n: '字数', tip: '写得多排前面' },
  { v: 'date', n: '日期', tip: '按日记本身的日期排' },
];

const FILTERS: { v: Filter; n: string; tip: string }[] = [
  { v: 'all', n: '全部', tip: '所有草稿' },
  { v: 'week', n: '这七天', tip: '最近七天动过的' },
  { v: 'month', n: '这个月', tip: '本月改过的' },
  { v: 'empty', n: '几乎空的', tip: '字数少于 50，多半是开了个头就放下了' },
];

export function DraftsView() {
  const go = useStore((s) => s.go);
  const setDate = useStore((s) => s.setDate);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);

  const [list, setList] = useState<DraftItem[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<{
    date: string; title: string; excerpt: string; chars: number;
    updatedAt: string; deletedAt: string;
  }[]>([]);

  /* 排序偏好落 settings，全站排序条一个规矩（第 200/201 条） */
  const rawSort = String(settings?.draftSort || 'updated');
  const sort: SortKey = (['updated', 'chars', 'date'] as const).includes(rawSort as SortKey)
    ? (rawSort as SortKey) : 'updated';
  const rawDir = String(settings?.draftSortDir || 'desc');
  const dir: SortDir = rawDir === 'asc' ? 'asc' : 'desc';
  const setSort = (v: SortKey) => { void setSetting('draftSort', v); };
  const setDir = (d: SortDir) => { void setSetting('draftSortDir', d); };

  const load = useCallback(async () => {
    setList(await api.entry.drafts().catch(() => [] as DraftItem[]));
  }, []);

  const loadTrash = useCallback(async () => {
    setTrash(await api.drafts.trashList().catch(() => []));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

    let out = (list || []).filter((d) => {
      if (filter === 'week' && d.date < weekAgo) return false;
      if (filter === 'month' && d.date < monthAgo) return false;
      if (filter === 'empty' && d.chars >= 50) return false;
      if (kw && !`${d.title || ''} ${d.excerpt || ''} ${d.date}`.toLowerCase().includes(kw)) return false;
      return true;
    });

    const mul = dir === 'asc' ? 1 : -1;
    out = out.slice().sort((a, b) => {
      if (sort === 'chars') return mul * ((a.chars || 0) - (b.chars || 0));
      if (sort === 'date') return mul * (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      const x = a.updatedAt || '';
      const y = b.updatedAt || '';
      /* 空的永远垫底 —— 升序翻转时也一样，不然「没时间的」会突然跑到最上面 */
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return mul * x.localeCompare(y);
    });
    return out;
  }, [list, q, filter, sort, dir]);

  const totalChars = rows.reduce((a, b) => a + b.chars, 0);
  const allPicked = rows.length > 0 && picked.length === rows.length;

  const moveToTrash = async (date: string) => {
    await api.drafts.trash(date);
    setPicked((p) => p.filter((x) => x !== date));
    await load();
    toast('已移到回收站，还能捡回来');
  };

  const publishOne = async (date: string) => {
    await api.entry.publish(date, true);
    setPicked((p) => p.filter((x) => x !== date));
    await load();
    toast('已定稿');
  };

  /* 批量操作：选了几条就一起做，不用一条条点 */
  const bulk = async (act: 'publish' | 'trash') => {
    if (!picked.length) return;
    const ids = picked.slice();
    for (const d of ids) {
      try {
        if (act === 'trash') await api.drafts.trash(d);
        else await api.entry.publish(d, true);
      } catch { /* 单条失败不影响其它 */ }
    }
    setPicked([]);
    await load();
    toast(act === 'trash' ? `${ids.length} 篇已移到回收站` : `${ids.length} 篇已定稿`);
  };

  return (
    <>
      <Topbar
        title="草稿箱"
        sub={list ? `${rows.length} 篇 · ${totalChars.toLocaleString('zh-CN')} 字` : '读取中…'}
        right={<>
          <button className="btn sm" onClick={() => { void loadTrash(); setTrashOpen(true); }}>
            <Icon name="trash" size={13} />回收站
          </button>
          <button className="btn sm" onClick={() => void load()}><Icon name="refresh" size={13} />刷新</button>
        </>}
      />
      <div className="wrap">
        <div className="card drill-tools">
          <div className="small muted" style={{ lineHeight: 1.9, marginBottom: 10 }}>
            写完点「定稿」，这一天就不再出现在这里。定稿只是给自己一个「写完了」的标记，
            不删东西、不上传，随时可以改回草稿。不要了可以移进回收站，回收站里的还能捡回来。
          </div>

          <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="inp"
              style={{ flex: '1 1 180px', minWidth: 120, padding: '4px 10px', fontSize: 12.5 }}
              placeholder="搜标题或正文"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {FILTERS.map((f) => (
              <button
                key={f.v}
                className={`chip ${filter === f.v ? 'on' : ''}`}
                data-filter={f.v}
                title={f.tip}
                onClick={() => setFilter(f.v)}
              >{f.n}</button>
            ))}
          </div>

          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SortBar options={SORTS} sort={sort} dir={dir} onSort={setSort} onDir={setDir} compact />
            <span style={{ flex: 1 }} />
            {picked.length ? (
              <>
                <span className="small muted">{picked.length} 篇已选</span>
                <button className="btn sm" onClick={() => void bulk('publish')}>批量定稿</button>
                <button className="btn sm danger" onClick={() => void bulk('trash')}>批量删除</button>
                <button className="btn sm ghost" onClick={() => setPicked([])}>取消选择</button>
              </>
            ) : rows.length ? (
              <button className="btn sm ghost" onClick={() => setPicked(allPicked ? [] : rows.map((r) => r.date))}>
                {allPicked ? '取消全选' : '全选'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="card">
          {list === null ? <div className="empty">读取中…</div>
            : rows.length === 0 ? (
              <div className="empty">
                {q || filter !== 'all'
                  ? '这个条件下没有草稿。换个筛选或者清掉搜索词试试。'
                  : '草稿箱是空的 —— 要么都在写，要么都定稿了。'}
              </div>
            )
              : rows.map((d) => {
                const on = picked.includes(d.date);
                return (
                  <div className="draft-row" key={d.date} data-date={d.date}>
                    <button
                      className={`pickbox ${on ? 'on' : ''}`}
                      style={{ position: 'static', flex: '0 0 auto' }}
                      title={on ? '取消选择' : '选择'}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== d.date) : [...p, d.date]))}
                    >{on ? '✓' : ''}</button>
                    <button className="dr-main" onClick={async () => { await setDate(d.date); await go('today'); }}>
                      <span className="dr-d">{d.date === todayKey() ? '今天' : cnDateLabel(d.date, todayKey())}</span>
                      <span className="dr-t">{d.title || d.excerpt || '（没有正文）'}</span>
                      <span className="sp" />
                      <span className="dr-n">{d.chars} 字</span>
                      <span className="dr-time">{d.updatedAt.slice(5, 16)}</span>
                    </button>
                    <button className="btn sm ghost" title="直接定稿" onClick={() => void publishOne(d.date)}>定稿</button>
                    <button
                      className="btn sm ghost"
                      title="移进回收站（还能捡回来）"
                      onClick={() => void moveToTrash(d.date)}
                    ><Icon name="trash" size={12} /></button>
                    <button
                      className="btn sm ghost"
                      title="打开继续写"
                      onClick={async () => { await setDate(d.date); await go('today'); }}
                    ><Icon name="right" size={13} /></button>
                  </div>
                );
              })}
        </div>
      </div>

      {trashOpen ? (
        <Dialog
          title="草稿回收站"
          onClose={() => setTrashOpen(false)}
          footer={<button className="btn" onClick={() => setTrashOpen(false)}>关闭</button>}
        >
          <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
            这里是被移进回收站的草稿。捡回来就回到草稿箱；彻底删掉就真的没了。
          </div>
          {trash.length === 0 ? (
            <div className="empty small">回收站是空的。</div>
          ) : trash.map((d) => (
            <div className="draft-row" key={d.date} data-trash-date={d.date}>
              <span className="dr-main" style={{ cursor: 'default' }}>
                <span className="dr-d">{cnDateLabel(d.date, todayKey())}</span>
                <span className="dr-t">{d.title || d.excerpt || '（没有正文）'}</span>
                <span className="sp" />
                <span className="dr-n">{d.chars} 字</span>
                <span className="dr-time">{d.deletedAt.slice(5, 16)} 删的</span>
              </span>
              <button
                className="btn sm"
                onClick={async () => {
                  await api.drafts.restore(d.date);
                  await loadTrash();
                  await load();
                  toast('捡回来了');
                }}
              >捡回来</button>
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (!window.confirm(`彻底删掉 ${d.date} 这一天？删了就找不回来了。`)) return;
                  const r = await api.drafts.purge(d.date);
                  if (!r.ok) { toast(r.err || '没删掉'); return; }
                  await loadTrash();
                  toast('已彻底删除');
                }}
              >彻底删</button>
            </div>
          ))}
        </Dialog>
      ) : null}
    </>
  );
}