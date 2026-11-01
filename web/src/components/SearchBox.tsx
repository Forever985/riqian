/**
 * 带历史下拉的搜索框（第 89 条）。
 *
 * 保留 `.searchbox` 的外层类和里面的 `<input>`，这样现有测试与样式都不用改。
 * 下拉分两组：「常用」按次数、「最近」按时间；点一条直接搜，右侧 ✕ 单独删掉某条。
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import { clearSearches, recentSearches, recordSearch, removeSearch, topSearches, type HistoryItem } from '../lib/searchHistory';

export function SearchBox({
  value, onChange, placeholder, onSubmit, style, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 用户敲回车或点了历史之后回调（不传就只调 onChange） */
  onSubmit?: (v: string) => void;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState<HistoryItem[]>([]);
  const [recent, setRecent] = useState<HistoryItem[]>([]);
  const box = useRef<HTMLDivElement | null>(null);

  const refresh = () => {
    setTop(topSearches(4));
    setRecent(recentSearches(6));
  };

  // 点外面收起来（不用 onBlur，否则点历史项时会先收起、点不到）
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const commit = (q: string) => {
    const k = q.trim();
    if (k) recordSearch(k);
    setOpen(false);
    onSubmit?.(q);
  };

  const pick = (q: string) => {
    onChange(q);
    recordSearch(q);
    setOpen(false);
    onSubmit?.(q);
  };

  const hasHist = top.length > 0 || recent.length > 0;

  return (
    <div className="searchbox sb-wrap" ref={box} style={style}>
      <Icon name="search" size={14} />
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { refresh(); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(value);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {value ? (
        <button className="sb-clear" title="清空" onClick={() => { onChange(''); onSubmit?.(''); }}>✕</button>
      ) : null}

      {open && hasHist ? (
        <div className="sb-hist">
          {top.length ? (
            <>
              <div className="sb-h">常用</div>
              <div className="sb-list">
                {top.map((h) => (
                  <button key={`t-${h.q}`} className="sb-item" onClick={() => pick(h.q)}>
                    <span className="q">{h.q}</span>
                    <span className="n">{h.n} 次</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {recent.length ? (
            <>
              <div className="sb-h">最近</div>
              <div className="sb-list">
                {recent.map((h) => (
                  <div key={`r-${h.q}`} className="sb-line">
                    <button className="sb-item" onClick={() => pick(h.q)}>
                      <span className="q">{h.q}</span>
                    </button>
                    <button
                      className="sb-x"
                      title="从历史里删掉这条"
                      onClick={() => { removeSearch(h.q); refresh(); }}
                    >✕</button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <div className="sb-foot">
            <button className="linkbtn" onClick={() => { clearSearches(); refresh(); }}>清空搜索历史</button>
            <span className="small muted">只留最近的 24 条，长期不用的会自动走</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
