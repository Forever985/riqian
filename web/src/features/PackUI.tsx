/**
 * #241 三个中心（主题 / 插件 / 创意工坊）的共用界面零件。
 *
 * 为什么抽出来：三个中心的交互骨架是同一件事 ——
 * 「从文件装一个包」「粘贴一段内容装一个包」「看已装的、能卸能导出」。
 * 各写一遍会有三份几乎一样但细节不同的代码，改一处忘两处。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/ui';
import { useStore } from '../store';
import {
  type AnyPack, parsePack, stringifyPack, packSummary,
  PACK_VERSION, type PackKind,
} from '../lib/pack';
import {
  exportInstalled, readRegistry, type Registry, type Installed,
} from '../lib/extensions';

/* ---------------- 导入：拖文件 / 粘贴 ---------------- */

/**
 * 装包的统一入口弹层。
 *
 * 两条路都给：拖/选文件适合「别人发的 .json」，粘贴适合「从网页复制的」。
 * 用户经常拿到的是一段文本而不是文件，只做文件会把人挡住。
 */
export function InstallDialog({
  kind, title, onClose, onInstall,
}: {
  kind: PackKind;
  title: string;
  onClose: () => void;
  onInstall: (p: AnyPack) => Promise<string>;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AnyPack | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);

  /** 解析 + 预览。不直接装 —— 让用户先看清这个包会做什么 */
  const analyze = useCallback((raw: string) => {
    setErr(''); setOk('');
    const r = parsePack(raw);
    if (!r.ok) { setPreview(null); setErr(r.err); return; }
    if (r.pack.kind !== kind) {
      setPreview(null);
      setErr(`这是一个「${KIND_NAME[r.pack.kind]}」包，不能在${title}里安装`);
      return;
    }
    setPreview(r.pack);
  }, [kind, title]);

  const readFile = async (f: File) => {
    if (f.size > 2 * 1024 * 1024) { setErr('文件超过 2 MB，不像是扩展包'); return; }
    const t = await f.text();
    setText(t);
    analyze(t);
  };

  const doInstall = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const msg = await onInstall(preview);
      setOk(msg);
      toast(msg);
      setPreview(null);
      setText('');
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={title}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>关闭</button>
          <button
            className="btn primary"
            disabled={!preview || busy}
            onClick={() => void doInstall()}
            data-act="pack-install"
          >
            {busy ? '安装中…' : preview ? `安装「${preview.name}」` : '安装'}
          </button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 10 }}>
        支持 <code>.json</code> 扩展包（格式版本 ≤ {PACK_VERSION}）。
        拖进来、选文件、或者把内容直接粘到下面都行。
      </div>

      {/* 拖放区 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) void readFile(f);
        }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${drag ? 'var(--accent)' : 'var(--line)'}`,
          borderRadius: 10,
          padding: '18px 12px',
          textAlign: 'center',
          cursor: 'pointer',
          background: drag ? 'var(--accentSoft)' : 'transparent',
          transition: 'all .15s',
          marginBottom: 10,
        }}
        data-act="pack-drop"
      >
        <div style={{ fontWeight: 550 }}>选一个 .json 文件，或者拖到这里</div>
        <div className="hint" style={{ marginTop: 4 }}>装之前会先给你看这个包会做什么</div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readFile(f);
          e.target.value = '';
        }}
      />

      <div className="small muted" style={{ margin: '10px 0 4px' }}>或者粘贴内容</div>
      <textarea
        className="inp"
        rows={6}
        style={{ width: '100%', fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 12 }}
        placeholder='{ "rq": 1, "kind": "theme", "id": "...", ... }'
        value={text}
        onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) analyze(e.target.value); else { setPreview(null); setErr(''); } }}
        data-act="pack-paste"
      />

      {err && <div className="hint" style={{ color: 'var(--bad, #b3483f)', marginTop: 8 }}>{err}</div>}
      {ok && <div className="hint" style={{ color: 'var(--ok, #5f8256)', marginTop: 8 }}>{ok}</div>}

      {preview && <PackPreview pack={preview} />}
    </Dialog>
  );
}

const KIND_NAME: Record<PackKind, string> = {
  theme: '主题', plugin: '插件', workshop: '工坊作品',
};

/** 装之前的预览：这个包叫什么、谁做的、会改动什么 */
export function PackPreview({ pack }: { pack: AnyPack }) {
  return (
    <div className="card" style={{ padding: 12, marginTop: 10, background: 'var(--panel2)' }} data-act="pack-preview">
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 14 }}>{pack.name}</b>
        <span className="small muted">{KIND_NAME[pack.kind]} · v{pack.version}</span>
        {pack.author && <span className="small muted">by {pack.author}</span>}
      </div>
      {pack.desc && <div className="small" style={{ marginTop: 6, lineHeight: 1.6 }}>{pack.desc}</div>}
      <div className="small muted" style={{ marginTop: 6 }}>{packSummary(pack)}</div>
      <div className="small" style={{ marginTop: 8, fontFamily: 'ui-monospace,monospace', opacity: 0.7 }}>
        id: {pack.id}
      </div>

      {pack.kind === 'theme' && (
        <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }} data-act="pack-swatches">
          {Object.entries(pack.colors).slice(0, 16).map(([k, v]) => (
            <div key={k} title={`${k} = ${v}`}
              style={{ width: 26, height: 26, borderRadius: 6, background: v, border: '1px solid var(--line)' }} />
          ))}
        </div>
      )}

      {pack.kind === 'plugin' && !!pack.modules?.length && (
        <div style={{ marginTop: 10 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>会新增这些模块：</div>
          {pack.modules.map((m, i) => (
            <div key={i} className="small" style={{ padding: '2px 0' }}>
              · {m.title}（{m.type}）
            </div>
          ))}
        </div>
      )}

      {pack.kind === 'plugin' && !!pack.settings && Object.keys(pack.settings).length > 0 && (
        <div style={{ marginTop: 8 }} className="small muted">
          会改这些设置：{Object.keys(pack.settings).join('、')}
        </div>
      )}
    </div>
  );
}

/* ---------------- 已装列表 ---------------- */

/**
 * 已装包的列表。
 *
 * `slotExtra` 给主题用：每套主题除了"卸载"还要能"启用"，
 * 而启用是主题独有的操作，插件没有对应物，所以用插槽形式传进来。
 */
export function InstalledList({
  kind, emptyText, onRefresh, slotExtra,
}: {
  kind: PackKind;
  emptyText: string;
  /** 装/卸之后要让外层重新读一次清单 */
  onRefresh: () => void;
  /** 每行右侧额外的按钮 */
  slotExtra?: (rec: Installed, reg: Registry) => React.ReactNode;
}) {
  const settings = useStore((s) => s.settings) as Record<string, unknown>;
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState('');

  const reg = useMemo(() => readRegistry(settings), [settings]);
  const list = reg.items.filter((x) => x.kind === kind);

  if (!list.length) {
    return <div className="empty" style={{ padding: '28px 0', textAlign: 'center', opacity: 0.7 }}>{emptyText}</div>;
  }

  const doExport = (rec: Installed) => {
    const { text, name } = exportInstalled(rec);
    /*
     * 用 Blob + a[download] 落盘。WebView2 支持这条路径（虚拟主机有真 origin），
     * 不需要绕到宿主去开保存对话框。
     */
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`已导出 ${name}`);
  };

  return (
    <div className="pack-list" data-act="pack-list">
      {list.map((rec) => (
        <div
          key={rec.id}
          className="row"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 2px', borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 550, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.name}</span>
              <span className="small muted">v{rec.version}</span>
            </div>
            <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {rec.author ? `${rec.author} · ` : ''}{rec.at}
              {rec.desc ? ` · ${rec.desc.slice(0, 40)}` : ''}
            </div>
          </div>

          {slotExtra?.(rec, reg)}

          <button className="btn sm ghost" onClick={() => doExport(rec)} data-act="pack-export">
            导出
          </button>
          <button
            className="btn sm"
            disabled={busy === rec.id}
            onClick={async () => {
              setBusy(rec.id);
              try {
                const { uninstall } = await import('../lib/extensions');
                await uninstall(rec);
                toast(`已卸载「${rec.name}」`);
                onRefresh();
              } catch (e) {
                toast('卸载失败：' + String((e as Error).message || e));
              } finally {
                setBusy('');
              }
            }}
            data-act="pack-uninstall"
          >
            {busy === rec.id ? '…' : '卸载'}
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 给别人做一个包 ---------------- */

/**
 * 「导出我的当前状态成一个包」。
 *
 * 这个入口是让用户**当作者**的：调好一套配色 / 配好一组模块，
 * 一键变成别人能装的包。没有它，生态就是单向的（只能装别人的）。
 */
export function MakePackDialog({
  kind, onClose,
}: { kind: PackKind; onClose: () => void }) {
  const settings = useStore((s) => s.settings) as Record<string, unknown>;
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [author, setAuthor] = useState('');
  const [desc, setDesc] = useState('');
  const [text, setText] = useState('');

  const gen = () => {
    try {
      const built = buildPackFromCurrent(kind, settings, { name, id, author, desc });
      setText(stringifyPack(built));
    } catch (e) {
      toast(String((e as Error).message || e));
    }
  };

  return (
    <Dialog
      title="做一个包分享给别人"
      wide
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>关闭</button>}
    >
      <div className="hint" style={{ marginBottom: 10 }}>
        把你现在的{kind === 'theme' ? '配色' : kind === 'plugin' ? '模块配置' : '内容'}打成一份包。
        别人用「安装」就能装进去。
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted" style={{ width: 52 }}>名字</span>
          <input className="inp" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：暖阳纸" data-act="make-name" />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted" style={{ width: 52 }}>id</span>
          <input className="inp" style={{ flex: 1 }} value={id} onChange={(e) => setId(e.target.value)} placeholder="比如：yourname.warm-paper（字母数字点横线）" data-act="make-id" />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted" style={{ width: 52 }}>作者</span>
          <input className="inp" style={{ flex: 1 }} value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="你的昵称" data-act="make-author" />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted" style={{ width: 52 }}>说明</span>
          <input className="inp" style={{ flex: 1 }} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="一句话介绍" data-act="make-desc" />
        </div>
        <button className="btn" onClick={gen} data-act="make-gen">生成</button>
      </div>

      {text && (
        <>
          <textarea
            className="inp" readOnly rows={10}
            style={{ width: '100%', fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 11.5 }}
            value={text}
            data-act="make-output"
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => {
                const blob = new Blob([text], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `riqian-${kind}-${id || 'pack'}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 4000);
              }}
              data-act="make-download"
            >
              下载成文件
            </button>
            <button
              className="btn ghost"
              onClick={async () => {
                try { await navigator.clipboard.writeText(text); toast('已复制'); }
                catch { toast('复制失败，请手动全选'); }
              }}
              data-act="make-copy"
            >
              复制
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** 从当前设置生成一个包。三种 kind 各自的取法 */
function buildPackFromCurrent(
  kind: PackKind,
  settings: Record<string, unknown>,
  meta: { name: string; id: string; author: string; desc: string },
): AnyPack {
  const base = {
    rq: 1,
    id: meta.id.trim() || `local.${Date.now()}`,
    name: meta.name.trim() || '未命名',
    version: '1.0.0',
    author: meta.author.trim(),
    desc: meta.desc.trim(),
  };

  if (kind === 'theme') {
    /*
     * 导出当前配色。
     * 取的是 `--xx` 实际计算值而不是 themeCustom 里存的差量 ——
     * 用户可能只改过两个槽，但别人装的时候需要完整的 16 个，
     * 否则会 "只变了两个颜色，其它全乱"。这里读一遍算好的 CSS 变量最省事。
     */
    const cs = getComputedStyle(document.documentElement);
    const keys = [
      'bg', 'side', 'panel', 'panel2', 'ink', 'ink2', 'ink3', 'line', 'line2',
      'accent', 'accent2', 'accentSoft', 'ok', 'warn', 'bad', 'blue',
    ];
    const colors: Record<string, string> = {};
    for (const k of keys) {
      const v = cs.getPropertyValue(`--${k}`).trim();
      if (v) colors[k] = v;
    }
    return { ...base, kind: 'theme', base: String(settings.theme || 'paper'), colors };
  }

  if (kind === 'plugin') {
    /*
     * 插件导出的是「当前启用了哪些模块」。
     * 只导启用的、只导类型和标题 —— config 里可能带着用户的私人内容
     * （比如评分上限是小事，但某个模块配置里塞了自己的清单就不好外传）。
     */
    const mods = ((settings as { _modules?: unknown })._modules) as unknown;
    void mods;
    const store = useStore.getState();
    const modules = (store.modules || [])
      .filter((m) => Number(m.enabled) !== 0)
      .map((m) => ({ type: m.type, title: m.title }));
    return { ...base, kind: 'plugin', modules, enabled: true };
  }

  // 工坊：导出全部标签（最常见的"我整理好一套标签想分享"场景）
  const store = useStore.getState();
  return {
    ...base,
    kind: 'workshop',
    work: 'tags',
    items: (store.tags || []).map((t) => ({ name: t.tag })),
  };
}