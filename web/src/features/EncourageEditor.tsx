import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from '../components/Icons';
import { imgUrl } from '../lib/media';
import type { EncourageItem } from '../types';
import { askConfirm } from '../components/ui';

/**
 * 第 211 条：首页「给自己的一句话」的内容维护。
 *
 * 之前这块只有后端接口（encourage.list / save / delete）和首页的展示组件，
 * 设置页里一次都没出现过 —— 用户能看到那句话，但没有任何地方能改它，
 * 等于数据表建好了、入口忘了接。这里把入口补上。
 *
 * 三种类型：
 *   text  纯文字，最常用
 *   image 从多媒体库挑一张图，文字当图注
 *   audio 从多媒体库里挑一段音频，文字当标题
 */

const KINDS: { k: 'text' | 'image' | 'audio'; n: string; note: string }[] = [
  { k: 'text', n: '文字', note: '一句话就够了' },
  { k: 'image', n: '图片', note: '从多媒体库挑一张' },
  { k: 'audio', n: '音频', note: '从多媒体库挑一段' },
];

const PRESETS = [
  '今天也只写一句就很好。',
  '不用等到状态好才开始。',
  '写完这一页，今天就有着落了。',
  '慢一点也没关系，别停就行。',
  '你已经比昨天多知道一点了。',
];

export function EncourageEditor() {
  const media = useStore((s) => s.mediaList);
  const reloadMedia = useStore((s) => s.reloadMedia);
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<EncourageItem[]>([]);
  const [busy, setBusy] = useState(false);

  /* 新增时的草稿；不在编辑态就一直空着 */
  const [draftKind, setDraftKind] = useState<'text' | 'image' | 'audio'>('text');
  const [draftText, setDraftText] = useState('');
  const [draftMedia, setDraftMedia] = useState('');

  const reload = useCallback(async () => {
    try {
      setList(await api.encourageList());
    } catch {
      setList([]);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const images = media.filter((m) => m.kind === 'image');
  const audios = media.filter((m) => m.kind === 'audio');

  const kindName = (k: string) => KINDS.find((x) => x.k === k)?.n || k;

  const add = async () => {
    const text = draftText.trim();
    if (draftKind === 'text' && !text) { toast('写点什么吧'); return; }
    if (draftKind !== 'text' && !draftMedia) { toast('先从多媒体库里挑一个'); return; }
    setBusy(true);
    try {
      await api.encourageSave({ kind: draftKind, text, mediaId: draftMedia, enabled: 1 });
      setDraftText('');
      setDraftMedia('');
      await reload();
      toast('已添加');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (it: EncourageItem, next: Partial<EncourageItem>) => {
    const merged = { ...it, ...next };
    await api.encourageSave({
      id: merged.id, kind: merged.kind, text: merged.text, mediaId: merged.mediaId, enabled: merged.enabled,
    });
    await reload();
  };

  const remove = async (it: EncourageItem) => {
    if (!(await askConfirm('删掉这条？', { body: '首页就不会再轮到它了。', ok: '删掉' }))) return;
    await api.encourageDelete(it.id);
    await reload();
  };

  /**
   * 第 236 条：在这里直接导入，不该逼用户先去多媒体库再回来。
   *
   * 和第 197 条（软件背景）一样的毛病 —— 那里已经修过，这里照着修。
   * 用的是宿主文件选择框，不限制后缀：图片和音频都要能选，
   * 具体是哪一类交给后端按扩展名判断，导完按 kind 自动落到「图片」还是「音频」档。
   */
  const importFromPc = async () => {
    setBusy(true);
    try {
      const r = await api.media.importFiles().catch(() => ({ ok: false, items: [] }));
      const goods = (r.items || []).filter((x) => x.ok);
      if (!goods.length) {
        if ((r.items || []).some((x) => x.dup)) toast('这些文件多媒体库里已经有了');
        return;
      }
      await reloadMedia();

      // 导入成功后把新文件直接预选上：用户点「从电脑导入」的意图就是「用它」，
      // 再让他在下拉框里翻一遍找刚导进来的那个，属于自己给自己添麻烦。
      // 取第一个新导入的 id，并按当前档位决定要不要切档。
      const first = goods[0];
      const fresh = (useStore.getState().mediaList || []).find((m) => m.id === first.id);
      if (fresh) {
        if (fresh.kind === 'audio' && draftKind === 'image') setDraftKind('audio');
        else if (fresh.kind === 'image' && draftKind === 'audio') setDraftKind('image');
        setDraftMedia(first.id || '');
      }
      toast(`已导入 ${goods.length} 个文件${goods.length === 1 ? '，已经帮你选上' : '，第一个已选上'}`);
    } finally {
      setBusy(false);
    }
  };

  const onCount = list.filter((x) => x.enabled).length;

  return (
    <div className="enc-edit">
      <div className="enc-edit-head">
        <span className="small muted">
          {list.length
            ? `共 ${list.length} 条，启用 ${onCount} 条${onCount ? '，首页每天轮换一条' : ''}`
            : '还没有内容，首页那块不会显示'}
        </span>
      </div>

      {list.length ? (
        <div className="enc-rows">
          {list.map((it) => (
            <div key={it.id} className={`enc-row ${it.enabled ? '' : 'off'}`}>
              <div className="enc-row-main">
                <span className="enc-tag">{kindName(it.kind)}</span>
                {it.kind === 'image' && it.mediaId ? (
                  <img className="enc-row-thumb" src={imgUrl(it.mediaId)} alt="" />
                ) : null}
                {it.kind === 'text' ? (
                  <input
                    className="inp enc-row-inp"
                    value={it.text}
                    onChange={(e) => {
                      const v = e.target.value;
                      setList((arr) => arr.map((x) => (x.id === it.id ? { ...x, text: v } : x)));
                    }}
                    onBlur={() => void patch(it, { text: it.text })}
                  />
                ) : (
                  <span className="enc-row-text">{it.text || <span className="muted">（没写文字）</span>}</span>
                )}
              </div>
              <div className="enc-row-ops">
                {it.kind !== 'text' ? (
                  <button
                    className="btn sm ghost"
                    title="换文字"
                    onClick={async () => {
                      const v = prompt('这条的说明文字（可留空）：', it.text || '');
                      if (v === null) return;
                      await patch(it, { text: v });
                    }}
                  >✎</button>
                ) : null}
                <button
                  className="btn sm ghost"
                  title={it.enabled ? '先停用（不删，随时能开回来）' : '重新启用'}
                  onClick={() => void patch(it, { enabled: it.enabled ? 0 : 1 })}
                >{it.enabled ? '停用' : '启用'}</button>
                <button className="btn sm ghost danger" title="删除" onClick={() => void remove(it)}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* ---------------- 新增 ---------------- */}
      <div className="enc-add">
        <div className="row" style={{ gap: 6, marginBottom: 7 }}>
          {KINDS.map((x) => (
            <button
              key={x.k}
              className={`chip ${draftKind === x.k ? 'on' : ''}`}
              title={x.note}
              onClick={() => { setDraftKind(x.k); setDraftMedia(''); }}
            >{x.n}</button>
          ))}
        </div>

        {draftKind === 'text' ? (
          <>
            <textarea
              className="inp enc-add-inp"
              rows={2}
              placeholder="写一句给自己的话"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); }
              }}
            />
            <div className="enc-presets">
              {PRESETS.map((p) => (
                <button key={p} className="chip" onClick={() => setDraftText(p)}>{p}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* 第 236 条：多媒体库里没有也能就地导入，不用跳出去 */}
            <div className="row" style={{ gap: 6, marginBottom: 7, alignItems: 'center' }}>
              <span className="small muted" style={{ flex: 1 }}>
                {(draftKind === 'image' ? images : audios).length
                  ? `多媒体库里已有 ${(draftKind === 'image' ? images : audios).length} 个可选的`
                  : `多媒体库里还没有${draftKind === 'image' ? '图片' : '音频'}`}
              </span>
              <button
                className="btn sm"
                disabled={busy}
                title={`从电脑选${draftKind === 'image' ? '图片' : '音频'}导入多媒体库，导完自动选上`}
                onClick={() => void importFromPc()}
              ><Icon name="plus" size={12} />从电脑导入</button>
            </div>
            <select
              className="inp"
              style={{ width: '100%', marginBottom: 7 }}
              value={draftMedia}
              onChange={(e) => setDraftMedia(e.target.value)}
            >
              <option value="">{draftKind === 'image' ? '选一张图片…' : '选一段音频…'}</option>
              {(draftKind === 'image' ? images : audios).map((m) => (
                <option key={m.id} value={m.id}>{m.alias || m.name || m.id}</option>
              ))}
            </select>
            {(draftKind === 'image' ? images : audios).length === 0 ? (
              <div className="small muted" style={{ marginBottom: 7 }}>
                点上面的「从电脑导入」直接加进来；也可以去「数据与缓存 → 多媒体库」批量上传。
              </div>
            ) : null}
            {draftKind === 'image' && draftMedia ? (
              <img className="enc-add-prev" src={imgUrl(draftMedia)} alt="" />
            ) : null}
            <input
              className="inp"
              placeholder={draftKind === 'image' ? '图注（可留空）' : '这段音频叫什么（可留空）'}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              style={{ marginTop: 7 }}
            />
          </>
        )}

        <div className="row" style={{ marginTop: 9, justifyContent: 'flex-end' }}>
          <button className="btn sm" onClick={() => void add()} disabled={busy}>
            <Icon name="plus" size={12} />添加
          </button>
        </div>
      </div>
    </div>
  );
}