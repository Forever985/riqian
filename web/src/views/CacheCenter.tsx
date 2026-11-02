import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { MusicLib } from '../features/music';
import type { CacheStats } from '../types';

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * 缓存中心（第 55 条）。
 *
 * 用户原话：「缓存和图片库、音乐库这种应该专门独立做一个模块或者额外做一个模块
 * （就是在对应的地方有，同时也单独有）」。
 *
 * 以前「缓存占用」只藏在「我的 → 数据」里，是一小块统计 + 两个按钮；
 * 想搞清楚「到底什么占了空间、哪些能清、清了会丢什么」得在三四个页面之间跳。
 * 这里把它们收到一处：占用明细、清理、策略、以及链接音频的缓存进度。
 *
 * 对应关系保留着 —— 设置里仍然有缓存策略，我的页面仍然有占用条，
 * 它们各自链到这一页，不是搬走而是多一个更完整的入口。
 */
export function CacheCenterView() {
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  /* 第 26 条那段要显示「几个链接音频 / 几个已缓存」，直接读音乐库自己的清单 */
  const [music, setMusic] = useState<{ id: string; url?: string; cached?: number }[]>([]);
  useEffect(() => { void api.music.list().then(setMusic).catch(() => setMusic([])); }, []);

  const [c, setC] = useState<CacheStats | null>(null);
  const [busy, setBusy] = useState('');
  /** 待确认的清理目标；media 不在可清项里（原文件删了就找不回来），只出现在「全部清空」的提示中 */
  const [confirm, setConfirm] = useState<'' | 'thumbs' | 'backup' | 'cache' | 'all'>('');

  const load = async () => {
    try { setC(await api.cache.stats()); } catch { toast('缓存统计没读出来'); }
  };
  useEffect(() => { void load(); }, []);

  const doClear = async (what: 'cache' | 'thumbs' | 'backup' | 'all') => {
    setBusy(what);
    try {
      const r = await api.cache.clear(what);
      toast(`清掉了 ${r.removed} 个文件，释放 ${r.freedMB.toFixed(1)} MB`);
      setConfirm('');
      await load();
    } catch { toast('清理失败，稍后再试'); }
    finally { setBusy(''); }
  };

  const doPrune = async () => {
    setBusy('prune');
    try {
      const r = await api.cache.prune(Number(settings.cacheDays) || 0, Number(settings.cacheMaxMB) || 0);
      toast(r.removed ? `按策略清掉 ${r.removed} 个文件，释放 ${r.freedMB.toFixed(1)} MB` : '没有可清理的，一切都在策略范围内');
      await load();
    } catch { toast('清理失败，稍后再试'); }
    finally { setBusy(''); }
  };

  /* 每一项：标题、大小、文件数、能清不能清、清了会怎样
     注意：媒体「原文件」不提供单清 —— 那是用户自己的照片和录音，删了磁盘上就没了。
     它只在「全部清空」里出现，且那一步有专门的警告。 */
  const rows: { k: 'media' | 'thumbs' | 'backup' | 'cache'; t: string; sub: string; n?: number; noClear?: boolean }[] = c ? [
    { k: 'media', t: '媒体原文件', sub: '日记里引用的图片、音频、视频本体。这是你的原始素材，不提供单独清理', n: c.files, noClear: true },
    { k: 'thumbs', t: '缩略图缓存', sub: '为了翻得快生成的预览图。清掉不影响内容，下次打开会自动重建', n: 0 },
    { k: 'backup', t: '自动备份', sub: '历次保存留下的数据库快照。清掉会失去回退到旧版本的能力', n: 0 },
    { k: 'cache', t: '网页缓存 / 临时文件', sub: 'WebView2 的运行时缓存和下载的中转文件，删了没影响', n: c.cacheFiles },
  ] : [];

  const usedPct = c && c.maxMB > 0 ? Math.min(100, Math.round((c.total / (c.maxMB * 1024 * 1024)) * 100)) : 0;
  const overWarn = c ? c.total >= (c.warnMB || 0) * 1024 * 1024 : false;

  return (
    <>
      <Topbar
        title="缓存"
        sub={c ? `共占 ${mb(c.total)} · ${c.cacheFiles + c.files} 个文件 · 上限 ${c.maxMB} MB` : '正在统计…'}
        lock={{ scope: 'cache', label: '缓存中心' }}
        right={(
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => void load()} title="重新统计">
              <Icon name="refresh" size={13} />刷新
            </button>
            <button className="btn sm ghost" onClick={() => void api.cache.open()}>
              <Icon name="folder" size={13} />打开目录
            </button>
          </div>
        )}
      />
      <div className="wrap">
        <div className="card">
          <h3><Icon name="database" size={14} />占用明细</h3>
          {!c ? <div className="empty small">统计中…</div> : (
            <>
              {/* 总占用条：超过「提醒阈值」就变红，用户一眼知道该清了 */}
              <div className="cache-bar" data-over={overWarn ? '1' : '0'}>
                <i style={{ width: `${Math.max(usedPct, c.total > 0 ? 2 : 0)}%` }} />
              </div>
              <div className="small muted" style={{ margin: '6px 0 14px' }}>
                已用 {mb(c.total)} / 上限 {c.maxMB} MB（{usedPct}%）
                {overWarn ? <b style={{ color: 'var(--danger)' }}> · 已超过提醒线 {c.warnMB} MB，建议清理</b> : null}
                {c.cachedLinks > 0 ? ` · 其中 ${c.cachedLinks} 个链接音频已缓存到本地` : null}
              </div>

              <div className="cache-list">
                {rows.map((r) => (
                  <div className="cache-row" key={r.k}>
                    <div className="cache-info">
                      <div className="cache-t">{r.t}{r.n ? <span className="muted"> · {r.n} 个</span> : null}</div>
                      <div className="cache-s">{r.sub}</div>
                    </div>
                    <div className="cache-size">{mb(c[r.k])}</div>
                    <button
                      className={`btn sm ${r.k === 'backup' ? 'ghost' : ''}`}
                      disabled={!!busy || c[r.k] === 0 || r.noClear}
                      title={r.noClear ? '原始素材不在这清，避免误删你的照片和录音' : `清掉${r.t}`}
                      onClick={() => { if (r.noClear) return; setConfirm(r.k as 'thumbs'); }}
                    >
                      {busy === r.k ? '清理中…' : r.noClear ? '不可单独清' : '清理'}
                    </button>
                  </div>
                ))}
              </div>

              {/* 两步确认：这些操作不可撤销，不能一点就清 */}
              {confirm ? (
                <div className="cache-confirm">
                  <div className="small" style={{ lineHeight: 1.8 }}>
                    要清掉「{rows.find((x) => x.k === confirm)?.t}」吗？
                    {confirm === 'backup'
                      ? ' 清掉之后就没有历史版本可回退了。'
                      : ' 这个清掉没有影响，下次用的时候会自动重建。'}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <button className="btn sm" onClick={() => setConfirm('')}>算了</button>
                    <button className="btn sm primary" onClick={() => void doClear(confirm as 'cache')}>
                      确认清理 {mb(c[confirm as 'cache'])}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm" disabled={!!busy} onClick={() => void doPrune()}>
                  {busy === 'prune' ? '清理中…' : '按策略清理一次'}
                </button>
                <button
                  className="btn sm ghost"
                  disabled={!!busy}
                  onClick={() => setConfirm('all')}
                >
                  全部清空（保留数据库）
                </button>
                <button className="btn sm ghost" onClick={() => useStore.getState().goSettings('data')}>
                  去设置里调策略 →
                </button>
              </div>
              {confirm === 'all' ? (
                <div className="cache-confirm">
                  <div className="small" style={{ lineHeight: 1.8 }}>
                    「全部清空」会删掉媒体原文件、缩略图、备份和临时文件，<b>数据库本身不动</b>。
                    日记文字都在，但引用的图片和音频会变成空白。导出备份之后再做更稳妥。
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <button className="btn sm" onClick={() => setConfirm('')}>算了</button>
                    <button className="btn sm primary" onClick={() => void doClear('all')}>确认全部清空</button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* 策略摘要：这里只读，改还是去设置页，避免两处都能改导致行为不一致 */}
        <div className="card">
          <h3><Icon name="sliders" size={14} />当前策略</h3>
          <div className="cache-kv">
            <span>保留天数</span><b>{Number(settings.cacheDays) || 30} 天</b>
            <span>总大小上限</span><b>{Number(settings.cacheMaxMB) || 512} MB</b>
            <span>提醒阈值</span><b>{Number(settings.cacheWarnMB) || 400} MB</b>
            <span>缓存网络音频</span><b>{String(settings.cacheAudio ?? '1') === '1' ? '开' : '关'}</b>
            <span>允许的后缀</span><b>{String(settings.cacheSuffix || '（不限）')}</b>
          </div>
          <div className="small muted" style={{ marginTop: 8, lineHeight: 1.75 }}>
            这些开关同时影响「多媒体库」里的缓存按钮和后台的自动清理。
            想改成别的值，去 <a
              style={{ color: 'var(--accent)', cursor: 'pointer' }}
              onClick={() => useStore.getState().goSettings('data')}
            >设置 → 数据与缓存</a>。
          </div>
        </div>

        {/* 链接音频的缓存进度：第 26 条的后半段，顺手在这儿也能操作 */}
        <div className="card">
          <h3><Icon name="music" size={14} />链接音频</h3>
          <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.8 }}>
            {music.some((m) => m.url)
              ? `有 ${music.filter((m) => m.url).length} 个链接音频，其中 ${music.filter((m) => m.url && m.cached).length} 个已经缓存到本地。缓存之后断网也能播放。`
              : '还没有添加过链接音频。粘一个 mp3 / m4a 地址进来，就能缓存到本地离线听。'}
          </div>
          <MusicLib compact />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm ghost" onClick={() => useStore.getState().go('media')}>
              去多媒体库看全部 →
            </button>
          </div>
        </div>

        <style>{`
          .cache-bar{
            height:8px;border-radius:99px;background:var(--line2);overflow:hidden;margin-top:4px;
          }
          .cache-bar > i{
            display:block;height:100%;border-radius:99px;background:var(--accent);
            transition:width .3s ease;
          }
          .cache-bar[data-over="1"] > i{background:var(--danger)}
          .cache-list{display:flex;flex-direction:column;gap:2px}
          .cache-row{
            display:flex;align-items:center;gap:14px;padding:10px 2px;
            border-bottom:1px dashed var(--line2);
          }
          .cache-row:last-child{border-bottom:0}
          .cache-info{flex:1;min-width:0}
          .cache-t{font-size:13px;color:var(--ink);font-weight:600;line-height:1.5}
          .cache-s{font-size:11.5px;color:var(--ink3);margin-top:2px;line-height:1.6}
          .cache-size{
            font-size:12.5px;color:var(--ink2);font-variant-numeric:tabular-nums;
            min-width:74px;text-align:right;
          }
          .cache-confirm{
            margin-top:10px;padding:12px 14px;border-radius:10px;
            background:color-mix(in srgb,var(--danger) 8%,var(--panel));
            border:1px solid color-mix(in srgb,var(--danger) 26%,var(--line));
          }
          .cache-kv{
            display:grid;grid-template-columns:auto 1fr;gap:6px 18px;
            font-size:12.5px;color:var(--ink3);align-items:baseline;
          }
          .cache-kv b{color:var(--ink2);font-weight:600}
        `}</style>
      </div>
    </>
  );
}