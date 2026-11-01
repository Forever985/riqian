import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * 可输入的下拉选择器（第 190 条）。
 *
 * 记录页原来的「按标签筛选」是个 `<select>` —— 标签是用户自己定的，
 * 多起来之后下拉里翻半天找不到，还没法搜。这里换成「输入框 + 下拉」：
 * 点开是完整列表，打字就过滤，选中之后框里显示选中的名字，点 ✕ 清空。
 */
export function TagPicker({
  value, options, onChange, placeholder = '全部标签', width = 160,
}: {
  value: string;
  /** 选项：值 + 显示名 + 右侧计数 */
  options: { v: string; n: string; c?: number }[];
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  /* 点外面收起 */
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQ(''); }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return options;
    return options.filter((o) => o.n.toLowerCase().includes(k));
  }, [options, q]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQ('');
  };

  return (
    <div className="tagpick" ref={box} style={{ width }}>
      <div className="tagpick-box">
        <input
          className="inp"
          value={open ? q : (value ? (options.find((o) => o.v === value)?.n || value) : '')}
          placeholder={value && !open ? '' : placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); setQ(''); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (list.length) pick(list[0].v);
              else if (!q.trim()) pick('');
            }
          }}
        />
        {value ? (
          <button className="tagpick-x" title="取消这个筛选" onClick={() => pick('')}>✕</button>
        ) : null}
      </div>
      {open ? (
        <div className="tagpick-pop">
          <button className={`tagpick-it ${value === '' ? 'on' : ''}`} onClick={() => pick('')}>
            <span className="n">全部标签</span>
          </button>
          {list.length ? list.map((o) => (
            <button
              key={o.v}
              className={`tagpick-it ${value === o.v ? 'on' : ''}`}
              onClick={() => pick(o.v)}
            >
              <span className="n">{o.n}</span>
              {o.c != null ? <span className="c">{o.c}</span> : null}
            </button>
          )) : <div className="tagpick-empty">没有匹配的标签</div>}
        </div>
      ) : null}
    </div>
  );
}
