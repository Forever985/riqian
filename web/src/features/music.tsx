import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog } from '../components/ui';
import { Icon } from '../components/Icons';
import { imgUrl } from '../lib/media';
import type { MusicItem } from '../types';

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * 音乐库。
 * 第 55 条要求「图片库/音乐库在设置里能用，独立页面也能用」，
 * 所以把它从 Profile 里抽成组件：哪里需要放哪里，行为只有一份。
 */
export function MusicLib({ compact }: { compact?: boolean }) {
  const toast = useStore((s) => s.toast);
  const setSetting = useStore((s) => s.setSetting);
  const settings = useStore((s) => s.settings);

  const [list, setList] = useState<MusicItem[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [urlName, setUrlName] = useState('');
  /* 第 26 条：正在下载的那条 / 全量缓存进度 */
  const [caching, setCaching] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = async () => setList(await api.music.list());
  useEffect(() => { void load(); }, []);

  /* 第 26 条：缓存一条网络音频到本地，之后断网也能播 */
  const cacheOne = async (m: MusicItem) => {
    if (caching) return;
    setCaching(m.id);
    try {
      const r = await api.music.cacheUrl(m.id);
      if (r.ok) {
        toast(r.already ? '这条已经缓存过了' : `已缓存到本地（${mb(r.bytes || 0)}）`);
        await load();
      } else {
        toast(r.err || '缓存失败');
      }
    } finally { setCaching(null); }
  };

  /* 第 26 条：一次把所有网络音频都缓存下来 */
  const cacheAll = async () => {
    if (bulk) return;
    const pending = list.filter((m) => m.url && !m.cached);
    if (!pending.length) { toast('没有需要缓存的链接音频'); return; }
    setBulk({ done: 0, total: pending.length });
    try {
      const r = await api.music.cacheAll();
      toast(`缓存完成：成功 ${r.done} 个，失败 ${r.failed} 个${r.err ? `（${r.err}）` : ''}`);
      await load();
    } finally { setBulk(null); }
  };

  const play = async (m: MusicItem) => {
    if (playing === m.id) { audioRef.current?.pause(); setPlaying(null); return; }
    /*
     * 第 26 条：缓存过的优先放本地文件 —— 断网也能听，而且不用再走一遍网络。
     * 没缓存过才回落到链接地址。
     */
    const src = m.cached ? imgUrl(m.id) : (m.url || imgUrl(m.id));
    if (!audioRef.current) audioRef.current = new Audio();
    const a = audioRef.current;
    a.src = src;
    a.volume = Math.max(0, Math.min(1, Number(settings.notifyVolume ?? 70) / 100));
    try { await a.play(); setPlaying(m.id); } catch { toast('先点一下页面再试：浏览器不让它自动播放'); }
  };

  const useAsSound = async (m: MusicItem) => {
    await setSetting('notifySoundId', m.id);
    await setSetting('notifySound', '1');
    toast(`提示音已设为「${m.name}」`);
  };

  const addUrl = async () => {
    if (!url.trim()) return;
    const r = await api.music.addUrl(url.trim(), urlName.trim());
    if (!r.ok) { toast(r.err || '添加失败'); return; }
    setUrl(''); setUrlName(''); setUrlOpen(false);
    await load();
    toast('已加入音乐库');
  };

  return (
    <div className={compact ? '' : 'card'}>
      {compact ? null : (
        <h3><Icon name="music" size={14} />音乐库 <span className="muted">提醒音 / 背景音</span></h3>
      )}
      <div className="row" style={{ marginBottom: 10 }}>
        <button
          className="btn sm"
          onClick={async () => {
            const r = await api.music.import();
            if (r.items.length) { toast(`已导入 ${r.items.filter((x) => x.ok).length} 个`); await load(); }
          }}
        >
          <Icon name="plus" size={13} />导入本地音频 / 视频
        </button>
        <button className="btn sm" onClick={() => setUrlOpen(true)}><Icon name="link" size={13} />添加链接</button>
        {/* 第 26 条：链接音频真的能缓存到本地，断网也能放 */}
        <button
          className="btn sm"
          disabled={!!bulk || !list.some((m) => m.url && !m.cached)}
          title="把清单里所有网络链接下载到本地，之后断网也能播放"
          onClick={() => void cacheAll()}
        >
          <Icon name="download" size={13} />
          {bulk ? `缓存中…` : '全部缓存到本地'}
        </button>
        <span className="small muted">视频只播放声音；链接可以缓存到本地</span>
        <span className="sp" />
        <button className="btn sm ghost" onClick={() => void load()} title="刷新"><Icon name="refresh" size={13} /></button>
      </div>

      {list.length ? (
        <div className="mlist">
          {list.map((m) => (
            <div className="mrow" key={m.id}>
              <button className="mplay" onClick={() => void play(m)}>
                <Icon name={playing === m.id ? 'pause' : 'play'} size={13} />
              </button>
              <span className="mn">{m.name || m.id}</span>
              <span className="chip">{m.kind === 'video' ? '视频·仅音频' : m.kind}</span>
              {m.url ? <span className="chip">{m.cached ? '已缓存' : '链接'}</span> : null}
              <span className="sp" />
              <span className="small muted">{m.bytes ? mb(m.bytes) : '—'}</span>
              {/* 第 26 条：每一条链接音频都能单独缓存 */}
              {m.url && !m.cached ? (
                <button
                  className="btn sm ghost"
                  disabled={caching === m.id}
                  title="下载到本地，之后断网也能播放"
                  onClick={() => void cacheOne(m)}
                >
                  {caching === m.id ? '下载中…' : '缓存到本地'}
                </button>
              ) : null}
              <button className="btn sm ghost" onClick={() => void useAsSound(m)}>设为提示音</button>
            </div>
          ))}
        </div>
      ) : <div className="empty small">还没有音频。导入本地文件，或粘贴一个 mp3 / m4a 链接。</div>}

      {urlOpen ? (
        <Dialog
          title="添加音频链接"
          onClose={() => setUrlOpen(false)}
          footer={<>
            <button className="btn" onClick={() => setUrlOpen(false)}>取消</button>
            <button className="btn primary" onClick={() => void addUrl()}>添加</button>
          </>}
        >
          <div className="field">
            <label>音频地址</label>
            <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/rain.mp3" autoFocus />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>显示名</label>
            <input className="inp" value={urlName} onChange={(e) => setUrlName(e.target.value)} placeholder="雨声" />
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>
            链接只存地址、不下载；断网就放不出来。要离线听，用上面的「导入本地音频」。
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
