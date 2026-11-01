/**
 * 第 107 / 170 条：字体选择器。
 *
 * 从 Settings.tsx 里抽出来的原因：原先是 6 个硬编码 <option>，就地将它扩成
 * 30 项预设 + 导入字体管理之后，那段 JSX 会占掉设置页小半屏；
 * 而且「选预设」「选导入字体」「管理导入文件」是三种不同的交互，
 * 混在一个 <select> 里只会互相拖累。抽出来之后设置页那边只留一行 <FontPicker/>。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Dialog } from '../components/ui';
import {
  FONT_GROUP_NAME, FONT_PRESETS, humanSize, importFamilyCss, isImportFamily,
  loadImportedFont, forgetImportedFont, type ImportedFont, type FontPreset,
} from '../lib/fonts';

/** 预览用的文本。中英数字混排 —— 只有中文看不出西文字体的差别，只有英文看不出中文字重 */
const SAMPLE = '永和九年，岁在癸丑 Aa Bb 2026 · 日签';

export function FontPicker({
  value, onChange,
}: {
  value: string;
  /** 选中的 font-family 串（预设）或 Rq:<file> 组成的串（导入字体） */
  onChange: (css: string) => void;
}) {
  const [pack, setPack] = useState<{ ok: boolean; dir: string; items: ImportedFont[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gone, setGone] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.font.list();
      setPack(r);
    } catch {
      setPack({ ok: false, dir: '', items: [] });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /*
   * 当前选的是导入字体但文件不在了（用户在外面手动删了目录里的文件，
   * 或者换过数据根目录）—— 这种情况必须明说，否则用户只会觉得
   * 「我选了这个字体怎么没反应」，然后反复点。
   */
  const missing = useMemo(() => {
    if (!isImportFamily(value) || !pack?.items) return false;
    const f = /"Rq:([^"]+)"/.exec(value)?.[1] || '';
    return !!f && !pack.items.some((x) => x.file === f);
  }, [value, pack]);

  useEffect(() => { setGone(missing); }, [missing]);

  /** 被别的项占用的字重/字形不需要管，导入就是「一族一款」 */
  const pick = async (css: string) => {
    setErr('');
    if (isImportFamily(css)) {
      const f = /"Rq:([^"]+)"/.exec(css)?.[1] || '';
      setBusy(true);
      const ok = await loadImportedFont(f);
      setBusy(false);
      if (!ok) { setErr(`「${f}」加载失败，已退回系统默认。可能是文件损坏或不是有效的字体。`); return; }
    }
    onChange(css);
  };

  const doImport = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await api.font.importFiles();
      await refresh();
      const first = r?.items?.find((x) => x.ok);
      // 只导了一个就直接切过去 —— 用户点「导入」的意图通常就是「我要用这个」
      if (first?.name) await pick(importFamilyCss(first.name));
      const bad = r?.items?.filter((x) => !x.ok) || [];
      if (bad.length) setErr(bad.map((x) => `${x.name}：${x.err}`).join('；'));
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (f: ImportedFont) => {
    setErr('');
    const r = await api.font.remove(f.file);
    if (!r?.ok) { setErr(r?.err || '删除失败'); return; }
    forgetImportedFont(f.file);
    await refresh();
    // 删的正好是当前在用的，退回系统默认，别留一个指向空文件的设置
    if (value.includes(`Rq:${f.file}"`)) onChange('');
  };

  const groups = useMemo(() => {
    const m = new Map<FontPreset['g'], FontPreset[]>();
    FONT_PRESETS.forEach((p) => {
      const arr = m.get(p.g) || [];
      arr.push(p);
      m.set(p.g, arr);
    });
    return Array.from(m.entries());
  }, []);

  const isPreset = FONT_PRESETS.some((p) => p.v === value);
  // 自定义串（用户手动填过 font-family）在下拉里没有对应项，得留个选项说明现状
  const showCustom = !!value && !isPreset && !isImportFamily(value);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <select
          className="inp" style={{ width: 216 }}
          value={value}
          onChange={(e) => void pick(e.target.value)}
          disabled={busy}
        >
          <option value="">系统默认</option>
          {showCustom && <option value={value}>自定义：{value.slice(0, 28)}…</option>}

          {!!pack?.items?.length && (
            <optgroup label="我导入的">
              {pack.items.map((f) => (
                <option key={f.file} value={importFamilyCss(f.file)}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          )}

          {groups.map(([g, arr]) => (
            <optgroup key={g} label={FONT_GROUP_NAME[g]}>
              {arr.map((p) => (
                <option key={p.v} value={p.v}>{p.n}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <button className="btn sm" disabled={busy} onClick={() => void doImport()} data-act="font-import">
          {busy ? '处理中…' : '导入字体'}
        </button>
        <button className="btn sm" onClick={() => setOpen(true)} data-act="font-manage">
          管理{pack?.items?.length ? ` (${pack.items.length})` : ''}
        </button>
      </div>

      {/* 预览。用当前正在生效的字体画一遍，选之前先看清效果 */}
      <div
        className="font-preview"
        style={{
          fontFamily: value || 'inherit',
          border: '1px solid var(--line, #ddd)',
          borderRadius: 8,
          padding: '10px 12px',
          fontSize: 15,
          lineHeight: 1.7,
          opacity: busy ? 0.5 : 1,
          transition: 'opacity .15s',
        }}
        data-act="font-preview"
      >
        {SAMPLE}
        <div style={{ fontSize: 12, opacity: 0.62, marginTop: 4, fontFamily: 'inherit' }}>
          0123456789 · 天地玄黄，宇宙洪荒 · 々 ー ～ “引号” 《书名》
        </div>
      </div>

      {gone && (
        <div className="hint" style={{ color: 'var(--warn, #b8863a)' }}>
          当前选的字体文件已经不在「字体」目录里了，正在用系统默认显示。
          重新导入同名文件，或者在上面换一个。
        </div>
      )}
      {err && <div className="hint" style={{ color: 'var(--danger, #b04a4a)' }}>{err}</div>}

      {open && (
        <Dialog title="管理导入的字体" wide onClose={() => setOpen(false)}>
          <div className="hint" style={{ marginBottom: 8 }}>
            字体文件在 <code>{pack?.dir || '数据目录/字体'}</code>。
            导入只是把文件复制进来，不会动你原来的文件；删也只是删这个副本。
          </div>
          {!pack?.items?.length ? (
            <div className="empty" style={{ padding: '24px 0', textAlign: 'center', opacity: 0.7 }}>
              还没有导入任何字体。点「导入字体」选 .woff2 / .ttf / .otf 文件。
            </div>
          ) : (
            <div className="fonts-table">
              {pack.items.map((f) => (
                <div
                  key={f.file}
                  className="row"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 2px', borderBottom: '1px solid var(--line, #eee)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.label}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.6, fontFamily: 'ui-monospace,monospace' }}>
                      {f.file} · {f.ext} · {humanSize(f.size)} · {f.at}
                    </div>
                  </div>
                  <button
                    className="btn sm"
                    onClick={() => void pick(importFamilyCss(f.file))}
                    data-act="font-use"
                  >
                    使用
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => void del(f)}
                    data-act="font-del"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

/** 「填一串 font-family」的兜底入口，给装了小众字体但没导文件的人用 */
export function CustomFontRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState('');
  const shown = useRef('');
  useEffect(() => {
    if (shown.current !== value) { setText(value); shown.current = value; }
  }, [value]);

  return (
    <div className="row" style={{ gap: 6 }}>
      <input
        className="inp" style={{ width: 216 }}
        placeholder='如 "LXGW WenKai",serif'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.trim())}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange(text.trim()); }}
        data-act="font-custom"
      />
      <span className="hint">直接填系统里已装字体的名字</span>
    </div>
  );
}