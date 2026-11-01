import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { EntryListItem, MediaItem, RevisionDetail, RevisionRow, Template } from '../types';
import { Dialog, askText } from '../components/ui';
import { Icon } from '../components/Icons';
import { importImageFiles, pickImageFiles } from '../lib/upload';
import { imgUrl } from '../lib/media';
import {
  BG_ONE, ToneSliders, bgJson, bgLayerStyle, parseBg, type BgFit, type BgOpts,
} from './mediaTone';

/* ---------------- 背景选择 ---------------- */

const BGS = ['#fdf6e3', '#f6e6dc', '#e8f0e6', '#e6eef4', '#f2e8f4', '#f7f0e0', '', '#1e1c18'];

/** 只有图片能当背景：音频/视频也在 media 表里，不过滤会渲染出一堆 <img src=xxx.mp3> */
const isImage = (m: MediaItem) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(m.file || '');

export function BgPicker({ onClose }: { onClose: () => void }) {
  const mediaList = useStore((s) => s.mediaList);
  const images = mediaList.filter(isImage);
  const reloadMedia = useStore((s) => s.reloadMedia);
  const draft = useStore((s) => s.draft);
  const setBg = useStore((s) => s.setBg);
  const toast = useStore((s) => s.toast);

  const [sel, setSel] = useState(draft.bg || '');
  const [opts, setOpts] = useState<BgOpts>(() => parseBg(draft.bgTone));
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  // 媒体索引可能是旧的（刚在别处导入 / 上一轮才加的图），进弹层先刷一次
  useEffect(() => { void reloadMedia(); }, [reloadMedia]);

  const isImg = !!sel && !sel.startsWith('#');
  const src = isImg ? imgUrl(sel) : '';

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 纯色没有调色参数，清掉旧的，免得换了纯色还留着上次那套
      await setBg(sel, isImg ? bgJson(opts) : '');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="这一天的背景"
      wide
      onClose={onClose}
      footer={<>
        <button
          className="btn"
          onClick={async () => { await setBg('', ''); onClose(); }}
        >
          去掉背景
        </button>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => void apply()} disabled={busy}>
          {busy ? '应用中…' : '应用'}
        </button>
      </>}
    >
      <style>{BG_CSS}</style>

      {/* 预览：背景层、蒙层、文字层是三张独立的层，所以文字不会被滤镜染色 */}
      <div className="bgprev">
        {isImg ? (
          <>
            <div className="bgprev-img" style={bgLayerStyle(src, opts)} />
            {opts.veil > 0.01 ? <div className="bgprev-veil" style={{ opacity: opts.veil }} /> : null}
          </>
        ) : (
          <div className="bgprev-solid" style={{ background: sel || 'var(--panel2)' }} />
        )}
        <div className="bgprev-txt">
          <b>{sel ? '预览' : '还没选背景'}</b>
          <span>这是正文层的文字</span>
          <span>调色只作用在背景上，字不会被一起染色</span>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <span className="small muted">纯色</span>
        <button className="btn sm ghost" onClick={() => setSel('')}>不用</button>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        {BGS.map((c) => (
          <div
            key={c || 'none'}
            onClick={() => setSel(c)}
            title={c || '不用背景'}
            style={{
              width: 32, height: 32, borderRadius: 9, cursor: 'pointer',
              border: `2px solid ${sel === c ? 'var(--accent)' : 'var(--line)'}`,
              background: c || 'linear-gradient(135deg,#fff,#eee)',
            }}
          />
        ))}
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small muted">
          从多媒体库选 <span style={{ color: 'var(--ink3)' }}>（{images.length} 张，点一下选中，再按「应用」）</span>
        </span>
        <button
          className="btn sm"
          style={{ marginLeft: 'auto' }}
          onClick={async () => {
            const files = await pickImageFiles();
            if (!files.length) return;
            const ids = await importImageFiles(files);
            await reloadMedia();
            // 导入完不关闭：用户来这儿是为了选背景，导完正好接着挑（以前会把这个弹层关掉，等于白导）
            if (ids.length) {
              toast(`已导入 ${ids.length} 张，已帮你选中最后一张`);
              setSel(ids[ids.length - 1]);
            }
          }}
        >
          <Icon name="plus" size={13} />导入图片
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))', gap: 9, maxHeight: '30vh', overflow: 'auto', marginBottom: 12 }}>
        {images.length ? images.slice(0, 160).map((m: MediaItem) => (
          <div key={m.id} className="imgpick" onClick={() => setSel(m.id)} style={{ cursor: 'pointer' }}>
            <div className="imgc" style={{ borderColor: sel === m.id ? 'var(--accent)' : 'var(--line)' }}>
              <img src={imgUrl(m.id, true)} loading="lazy" alt="" />
            </div>
            <div className="imgmeta">{m.name || m.id.slice(0, 8)}</div>
          </div>
        )) : <div className="empty" style={{ gridColumn: '1/-1' }}>多媒体库里还没有图片，先去「多媒体库」导入。</div>}
      </div>

      {isImg ? (
        <div className="card" style={{ padding: 14, background: 'var(--panel2)' }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: 13 }}>图片参数</b>
            <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setAdvanced((v) => !v)}>
              {advanced ? '收起高级' : '高级参数'}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => setOpts({ ...BG_ONE })}
            >
              重置
            </button>
          </div>

          <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <span className="small muted">铺法</span>
            {([['cover', '铺满'], ['contain', '完整显示'], ['tile', '平铺']] as [BgFit, string][]).map(([k, n]) => (
              <button key={k} className={`chip ${opts.fit === k ? 'on' : ''}`} onClick={() => setOpts({ ...opts, fit: k })}>{n}</button>
            ))}
            <span className="small muted" style={{ marginLeft: 10 }}>蒙层</span>
            <input
              type="range" min={0} max={0.9} step={0.05} value={opts.veil}
              style={{ width: 110, accentColor: 'var(--accent)' }}
              onChange={(e) => setOpts({ ...opts, veil: Number(e.target.value) })}
            />
            <span className="tv small muted">{Math.round(opts.veil * 100)}%</span>
          </div>

          <ToneSliders tone={opts.t} onChange={(t) => setOpts({ ...opts, t })} groups={advanced ? 'all' : 'basic'} />
        </div>
      ) : null}
    </Dialog>
  );
}

/** 只属于这个弹窗的样式：预览区三层结构 */
const BG_CSS = `
.bgprev{position:relative;height:170px;border-radius:14px;overflow:hidden;border:1px solid var(--line);margin-bottom:14px;background:var(--panel2)}
.bgprev-img{position:absolute;inset:0;z-index:0}
.bgprev-veil{position:absolute;inset:0;z-index:1;background:var(--panel)}
.bgprev-solid{position:absolute;inset:0;z-index:0}
.bgprev-txt{position:absolute;left:18px;right:18px;bottom:16px;z-index:2;display:flex;flex-direction:column;gap:3px}
.bgprev-txt b{font-size:15px;color:var(--ink);text-shadow:0 1px 2px color-mix(in srgb,var(--bg) 60%,transparent)}
.bgprev-txt span{font-size:12px;color:var(--ink2);text-shadow:0 1px 2px color-mix(in srgb,var(--bg) 60%,transparent)}
`;

/* ---------------- 历史版本 ---------------- */

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const date = useStore((s) => s.date);
  const toast = useStore((s) => s.toast);
  const reloadEntry = useStore((s) => s.reloadEntry);
  const modules = useStore((s) => s.modules);
  const [list, setList] = useState<RevisionRow[] | null>(null);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);

  useEffect(() => {
    void (async () => {
      const all = await api.rev.list(date);
      // 同内容只留一条（第 123 条）：自动保存每 420ms 一条，翻历史像在看复读机
      const keepIds = await api.revDedup(date).then((x) => new Set(x.map((r) => r.id))).catch(() => null);
      setList(keepIds && keepIds.size ? all.filter((r) => keepIds.has(r.id)) : all);
    })();
  }, [date]);

  const plainOf = (d: RevisionDetail) => {
    const vals = d.snapshot?.values || {};
    return modules
      .filter((m) => m.type === 'richtext')
      .map((m) => (typeof vals[m.id] === 'string' ? (vals[m.id] as string) : ''))
      .join('');
  };

  if (detail) {
    const html = plainOf(detail);
    return (
      <Dialog
        title={detail.ts}
        wide
        onClose={() => setDetail(null)}
        footer={<>
          <button className="btn" onClick={() => setDetail(null)}>取消</button>
          <button
            className="btn primary"
            onClick={async () => {
              if (!confirm('恢复会覆盖当前内容（当前内容也会存成一个新版本，可以再撤回）。')) return;
              await api.rev.restore(detail.id);
              await reloadEntry();
              toast('已恢复');
              onClose();
            }}
          >
            恢复到这个版本
          </button>
        </>}
      >
        <div
          className="rt"
          style={{ minHeight: 'auto', maxHeight: '60vh', overflow: 'auto' }}
          dangerouslySetInnerHTML={{ __html: html || '<div class="empty">这个版本没有正文</div>' }}
        />
      </Dialog>
    );
  }

  return (
    <Dialog title={`历史版本 · ${date}`} wide onClose={onClose} footer={<button className="btn" onClick={onClose}>关闭</button>}>
      {list == null ? <div className="empty">读取中…</div> : list.length ? list.map((r) => (
        <div
          className="quote-pick"
          key={r.id}
          onClick={async () => setDetail(await api.rev.get(r.id))}
          style={{ cursor: 'pointer' }}
        >
          <b>{r.ts}</b> <span className="small muted">{r.chars} 字</span><br />
          <span className="small">{r.preview}</span>
        </div>
      )) : <div className="empty">还没有历史版本。每次编辑会自动记一份。</div>}
    </Dialog>
  );
}

/* ---------------- 模板 ---------------- */

export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const date = useStore((s) => s.date);
  const toast = useStore((s) => s.toast);
  const reloadModules = useStore((s) => s.reloadModules);
  const reloadEntry = useStore((s) => s.reloadEntry);
  const modules = useStore((s) => s.modules);
  const draft = useStore((s) => s.draft);
  const [list, setList] = useState<Template[]>([]);

  useEffect(() => { void api.templates.list().then(setList); }, []);

  const saveAsTemplate = async () => {
    const name = await askText('模板名称', '', '比如：我的周复盘');
    if (!name?.trim()) return;
    const blocks = modules
      .filter((m) => m.enabled === 1 && m.type === 'richtext')
      .map((m) => ({ type: 'richtext', title: m.title, html: draft.values[m.id] }))
      .filter((b) => typeof b.html === 'string' && (b.html as string).trim());
    if (!blocks.length) { toast('这一天没有可保存的正文'); return; }
    await api.templates.save(name.trim(), JSON.stringify(blocks));
    toast('已保存为模板');
    setList(await api.templates.list());
  };

  const apply = async (t: Template) => {
    if (!confirm(`套用「${t.name}」会覆盖当天的正文内容，继续？`)) return;
    const r = await api.templates.apply(date, t.id);
    if (r.ok) {
      await reloadModules();
      await reloadEntry();
      toast('已套用模板');
      onClose();
    } else {
      toast(r.err || '套用失败');
    }
  };

  return (
    <Dialog
      title="套用模板"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={() => void saveAsTemplate()}>把今天存成模板</button>
        <button className="btn" onClick={onClose}>取消</button>
      </>}
    >
      <div className="small muted" style={{ marginBottom: 12 }}>
        模板会把结构和提示语写进今天，你只需要填空。套用前请先备份当天内容（会覆盖正文模块）。
      </div>
      <div className="tpl-grid">
        {list.map((t) => (
          <div className="tpl" key={t.id} onClick={() => void apply(t)} style={{ cursor: 'pointer' }}>
            <div className="n">{t.name}</div>
            <div className="d">{t.kind === 'week' ? '周报' : t.kind === 'month' ? '月报' : '日记'}</div>
            {t.builtin ? null : <span className="tag">自定义</span>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/* ---------------- 选日期（单/多选） ---------------- */

export function PickDatesDialog({
  title, multi, onClose, onPick,
}: {
  title: string;
  multi?: boolean;
  onClose: () => void;
  onPick: (dates: string[]) => void;
}) {
  const [items, setItems] = useState<EntryListItem[]>([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    void api.entry.list({ limit: 400, offset: 0 }).then(setItems);
  }, []);

  const filtered = items.filter((x) => !q || x.date.includes(q) || (x.plain || '').includes(q));

  const click = (d: string) => {
    if (!multi) { onPick([d]); return; }
    setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  };

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={multi ? (
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={() => { if (picked.length) onPick(picked); }}>关联选中</button>
        </>
      ) : <button className="btn" onClick={onClose}>取消</button>}
    >
      <input className="inp" placeholder="搜索日期或内容…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
        {filtered.length ? filtered.map((x) => (
          <div
            key={x.date}
            className={multi ? `pick-item ${picked.includes(x.date) ? 'on' : ''}` : 'quote-pick'}
            onClick={() => click(x.date)}
            style={{ cursor: 'pointer' }}
          >
            {multi ? <span className="box">{picked.includes(x.date) ? '✓' : ''}</span> : null}
            <span>
              <b>{x.date}</b> <span className="small muted">{x.chars} 字</span><br />
              <span className="small">{(x.plain || '').slice(0, 46)}</span>
            </span>
          </div>
        )) : <div className="empty">没有匹配的日记。</div>}
      </div>
      {!multi ? <div className="small muted" style={{ marginTop: 10 }}>点一天，继续下一步。</div> : null}
    </Dialog>
  );
}

/* ---------------- 选一段引用 ---------------- */

function paragraphsFrom(html: string): string[] {
  if (!html) return [];
  const box = document.createElement('div');
  box.innerHTML = html;
  return Array.from(box.querySelectorAll('p,li,blockquote')).map((n) => (n.textContent || '').trim());
}

export function QuotePickerDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const [paras, setParas] = useState<string[] | null>(null);
  const modules = useStore((s) => s.modules);
  const draft = useStore((s) => s.draft);
  const patchDraft = useStore((s) => s.patchDraft);
  const scheduleSave = useStore((s) => s.scheduleSave);
  const flushSave = useStore((s) => s.flushSave);
  const reloadModules = useStore((s) => s.reloadModules);
  const reloadEntry = useStore((s) => s.reloadEntry);
  const curDate = useStore((s) => s.date);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void (async () => {
      const e = await api.entry.get(date);
      const out: string[] = [];
      (e.plain || '').split('\n').map((s) => s.trim()).filter(Boolean).forEach((s) => {
        if (s.length > 6 && !out.includes(s)) out.push(s);
      });
      Object.keys(e.values || {}).forEach((mid) => {
        const m = modules.find((x) => x.id === mid);
        if (!m || m.type !== 'richtext') return;
        const val = e.values[mid];
        if (typeof val === 'string') paragraphsFrom(val).forEach((t) => {
          if (t.length > 6 && !out.includes(t)) out.push(t);
        });
      });
      setParas(out.slice(0, 40));
    })();
  }, [date, modules]);

  const pick = async (text: string) => {
    // 「引用」模块默认可能关着，第一次引用时自动打开，别让按钮点下去没反应
    let qm = modules.find((m) => m.type === 'quote' && m.enabled === 1);
    if (!qm) {
      const existing = modules.find((m) => m.type === 'quote');
      if (existing) await api.modules.update({ id: existing.id, enabled: 1 });
      else await api.modules.add('quote', '引用');
      await reloadModules();
      qm = useStore.getState().modules.find((m) => m.type === 'quote');
    }
    if (!qm) { toast('引用模块创建失败'); return; }

    const cur = draft.values[qm.id];
    const arr = Array.isArray(cur) ? ([...cur] as { date: string; text: string }[]) : [];
    arr.push({ date, text });
    patchDraft({ values: { ...draft.values, [qm.id]: arr } });
    await api.link.add(curDate, date, 'quote', text);
    await flushSave();
    scheduleSave();
    await reloadEntry();
    toast('已引用');
    onClose();
  };

  return (
    <Dialog title={`选一段引用（${date}）`} onClose={onClose} footer={<button className="btn" onClick={onClose}>取消</button>}>
      {paras == null ? <div className="empty">读取中…</div> : paras.length ? paras.map((t, i) => (
        <div className="quote-pick" key={i} onClick={() => void pick(t)} style={{ cursor: 'pointer' }}>{t}</div>
      )) : <div className="empty">这一天没有可引用的段落。</div>}
    </Dialog>
  );
}
