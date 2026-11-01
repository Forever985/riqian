import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { imgUrl } from '../lib/media';
import { todayKey } from '../lib/date';
import { Icon } from '../components/Icons';
import type { EncourageItem } from '../types';

const STORE_KEY = 'rq.encourage.turn';

/** 同一天固定从同一条开始：把日期揉成一个数 */
function daySeed(d: string): number {
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) % 100000;
  return h;
}

function readTurn(day: string): number {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return 0;
    const o = JSON.parse(raw) as { d?: string; n?: number };
    if (o.d !== day) return 0;
    return Number.isFinite(o.n) ? Math.max(0, Math.floor(Number(o.n))) : 0;
  } catch {
    return 0;
  }
}

function writeTurn(day: string, n: number) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ d: day, n })); } catch { /* 隐私模式下存不了，退回内存态 */ }
}

/**
 * 首页的「给自己的一句话」。
 * 内容在设置里维护，这里只负责按天轮换展示 + 换一句（当天内记住换到第几条）。
 */
export function EncourageQuote() {
  const day = todayKey();
  const [list, setList] = useState<EncourageItem[]>([]);
  const [turn, setTurn] = useState(() => readTurn(day));
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  /** 媒体索引是异步铺好的，它变了要重算一次地址 */
  const mediaVer = useStore((s) => s.mediaList.length);

  useEffect(() => {
    void (async () => {
      try {
        setList(await api.encourageList());
      } catch {
        setList([]);
      }
    })();
  }, []);

  // 跨天：新的一天从固定那条重新开始
  useEffect(() => {
    setTurn(readTurn(day));
  }, [day]);

  const enabled = useMemo(() => list.filter((x) => x.enabled), [list]);

  const cur = useMemo(() => {
    if (!enabled.length) return null;
    return enabled[(daySeed(day) + turn) % enabled.length];
  }, [enabled, day, turn]);

  // 换内容时把正在放的音频停下来
  useEffect(() => {
    setPlaying(false);
    const a = audioRef.current;
    if (a) { a.pause(); a.currentTime = 0; }
  }, [cur?.id]);

  const next = useCallback(() => {
    if (enabled.length < 2) return;
    setTurn((t) => {
      const n = t + 1;
      writeTurn(day, n);
      return n;
    });
  }, [enabled.length, day]);

  const toggleAudio = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    try {
      await a.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  const src = useMemo(() => imgUrl(cur?.mediaId || ''), [cur?.mediaId, mediaVer]);

  if (!cur) return null;

  return (
    <div className="enc">
      <div className="enc-main">
        <div className="enc-k"><Icon name="sparkle" size={12} />给自己的一句话</div>

        {cur.kind === 'image' ? (
          src ? (
            <img className="enc-img" src={src} alt={cur.text || '打气图'} />
          ) : (
            <div className="enc-text enc-miss">这张图在本地找不到了，去设置里换一张吧。</div>
          )
        ) : cur.kind === 'audio' ? (
          <div className="enc-audio">
            <button className="btn sm" onClick={() => void toggleAudio()} disabled={!src}>
              <Icon name={playing ? 'pause' : 'play'} size={12} />{playing ? '暂停' : '播放'}
            </button>
            <span className="enc-text">{cur.text || '听一句'}</span>
            {src ? <audio ref={audioRef} src={src} onEnded={() => setPlaying(false)} preload="none" /> : null}
          </div>
        ) : (
          <div className="enc-text">{cur.text}</div>
        )}
      </div>

      {enabled.length > 1 ? (
        <button className="btn sm ghost enc-next" onClick={next} title="换一条（今天内会记住）">
          <Icon name="refresh" size={12} />换一句
        </button>
      ) : null}

      <style>{`
        .enc{
          display:flex;align-items:flex-start;gap:12px;
          margin:-4px 0 16px;padding:12px 16px;border-radius:var(--r);
          border:1px dashed color-mix(in srgb,var(--accent) 35%,var(--line));
          background:color-mix(in srgb,var(--accent) 5%,var(--panel));
        }
        .enc-main{flex:1;min-width:0}
        .enc-k{
          display:flex;align-items:center;gap:5px;font-size:11px;letter-spacing:.12em;
          color:var(--ink3);margin-bottom:6px;
        }
        .enc-text{font-size:14px;line-height:1.75;color:var(--ink);word-break:break-word}
        .enc-miss{color:var(--ink3);font-size:12.5px}
        .enc-img{max-width:100%;max-height:190px;border-radius:9px;display:block;object-fit:contain}
        .enc-audio{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
        .enc-audio .enc-text{flex:1;min-width:120px}
        .enc-next{flex:0 0 auto;margin-top:14px}
      `}</style>
    </div>
  );
}
