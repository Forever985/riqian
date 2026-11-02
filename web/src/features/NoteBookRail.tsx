/**
 * 笔记左栏：笔记本树（第 32 / 220 / 230 条）。
 *
 * 拆出来的理由：这一块是整个笔记页里唯一「自己管自己」的部分 ——
 * 树怎么建、折叠状态、拖动排序、跨层搬运，全都在内部闭环，
 * 主组件只关心「现在是哪一本」（nb）。
 *
 * 原来它和主组件混在一起，`roots` / `kidsOf` / `countOf` / `deepCount` /
 * `flatBooks` / `reorderBooks` / `bookDrag` 七个东西散在两百多行里，
 * 想看清「左栏到底怎么画的」得来回跳。拎出来之后，
 * 主组件的 return 里这块就只剩一行 <NoteBookRail ... />。
 *
 * 三个必须守住的细节：
 *   1. **树要铺平成一维**才挂得上拖动排序（嵌套 <div> 拿不到「第 N 个是谁」）。
 *   2. **折叠的子树不进排序数组** —— 看不见的东西不该参与。
 *   3. **跨层拖动的落点要重排一次**，否则它会按名字插到说不清的位置。
 */
import { useMemo, useState } from 'react';
import { api } from '../api';
import { askText } from '../components/ui';
import { Icon } from '../components/Icons';
import { useDragSort } from '../components/DragSort';
import { NOTE_COLORS } from './notes';
import type { Notebook, NoteRow } from '../types';

export function NoteBookRail({
  books, rows, nb, onPick, onEdit, onChanged, onApplyOrder, toast, vaultRules,
}: {
  books: Notebook[];
  /** 用来数「这一本（含子本）有多少篇」 */
  rows: NoteRow[];
  /** 当前选中的笔记本 id，'' = 全部 */
  nb: string;
  onPick: (id: string) => void;
  onEdit: (b: Notebook) => void;
  /** 新建 / 重排之后让外面重新拉一次 */
  onChanged: () => Promise<void> | void;
  /** 乐观更新：把 ids 换算成 sort（0/10/20…）写回父组件的 books */
  onApplyOrder: (ids: string[]) => void;
  toast: (m: string) => void;
  vaultRules: { scope: string; target: string }[];
}) {
  /** 折叠起来的笔记本 id。默认全展开 */
  const [folded, setFolded] = useState<string[]>([]);

  /* ---------------- 树 ---------------- */

  const roots = useMemo(() => {
    const ids = new Set(books.map((b) => b.id));
    return books
      /* 父节点不存在（被软删了）的也当顶层 —— 否则它会在左栏里凭空消失 */
      .filter((b) => !b.parentId || !ids.has(b.parentId))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'zh'));
  }, [books]);

  const kidsOf = (id: string) => books
    .filter((b) => b.parentId === id)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'zh'));

  const countOf = (id: string) => rows.filter((r) => r.notebookId === id).length;

  /** 这个笔记本连同它下面所有子本里的笔记数（第 220 条：层级深了，只看本层就不知道底下有多少） */
  const deepCount = (id: string): number => {
    let n = countOf(id);
    for (const k of kidsOf(id)) n += deepCount(k.id);
    return n;
  };

  /**
   * 第 230 条：把树**铺平**成一维，才能挂拖动排序。
   *
   * 之前这里是递归 `map` 渲染嵌套 `<div>` —— 视觉上是对的，但结构上是一棵树，
   * 拿不到「当前视图里第 N 个是谁」这个线性顺序，`useDragSort` 也就无从下手。
   * 铺平之后：深度带出来自己做缩进，顺序由这个数组决定，拖动就是数组换位。
   *
   * 折叠的子树不进去 —— 看不见的东西不该参与排序。
   */
  const flatBooks = useMemo(() => {
    const out: { b: Notebook; depth: number }[] = [];
    const walk = (parentId: string, depth: number) => {
      if (depth > 6) return;
      for (const b of (parentId ? kidsOf(parentId) : roots)) {
        out.push({ b, depth });
        if (!folded.includes(b.id)) walk(b.id, depth + 1);
      }
    };
    walk('', 0);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, folded]);

  /* ---------------- 拖动 ---------------- */

  /** 第 230 条：同一组的兄弟之间重排，一条语句写完 */
  const reorderBooks = async (ids: string[]) => {
    if (ids.length < 2) return;
    /*
     * 先本地乐观更新：拖完立刻就在新位置，不用等后端回来再跳一下。
     * books 是父组件的 state，所以这里交回给 onApplyOrder 去改 ——
     * 原来这段是 setBooks(...)，逻辑一字未动，只是换了个执行的地方。
     */
    onApplyOrder(ids);
    try {
      await api.notebooks.reorder(ids);
    } catch {
      toast('顺序没存上');
    }
    await onChanged();
  };

  /**
   * 笔记本拖动（第 230 条）。
   *
   * 两种落点要分开处理：
   *   · 落在同一层 → 换位置（reorder）
   *   · 落在别的层 → 改上级（setParent），落完再排一次让它停在松手的那个位置
   * 后者的防环交给后端 —— 拖进自己的子孙里会被拒，这里只负责把错说出来。
   */
  const bookDrag = useDragSort({
    keys: flatBooks.map((x) => x.b.id),
    groupOf: (k) => books.find((b) => b.id === k)?.parentId || '',
    onReorder: async (from, to) => {
      const ids = flatBooks.map((x) => x.b.id);
      if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
      const g = books.find((b) => b.id === ids[from])?.parentId || '';
      /* 只在本层里换：跨层的那半截交给 onMoveTo，走不到这里 */
      const sibs = ids.filter((id) => (books.find((b) => b.id === id)?.parentId || '') === g);
      const a = sibs.indexOf(ids[from]);
      const z = sibs.indexOf(ids[to]);
      if (a < 0 || z < 0 || a === z) return;
      sibs.splice(z, 0, sibs.splice(a, 1)[0]);
      await reorderBooks(sibs);
    },
    onMoveTo: async (f, t) => {
      if (f.group === t.group) {
        /* 同层拖动走上面那条，这里兜一下（groupOf 取不到时会是空串） */
        const ids = flatBooks
          .filter((x) => (x.b.parentId || '') === f.group)
          .map((x) => x.b.id);
        const a = ids.indexOf(f.key);
        const z = ids.indexOf(t.key);
        if (a < 0 || z < 0 || a === z) return;
        ids.splice(z, 0, ids.splice(a, 1)[0]);
        await reorderBooks(ids);
        return;
      }
      const r = await api.notebooks.setParent(f.key, t.group);
      if (!r?.ok) { toast(r?.err || '拖不过去'); return; }
      /* 落进去之后在目标层再排一次，否则它会按名字插到某个说不清的位置 */
      const sib = kidsOf(t.group).map((b) => b.id).filter((id) => id !== f.key);
      const at = sib.indexOf(t.key);
      sib.splice(at < 0 ? sib.length : at, 0, f.key);
      await reorderBooks(sib);
      toast(f.group ? '已换到这一层' : '已移到最上层');
    },
  });

  const addBook = async () => {
    const v = await askText('新建笔记本 / 分组', '', '例如：读书摘录');
    if (!v || !v.trim()) return;
    await api.notebookAdd2(v.trim(), NOTE_COLORS[books.length % NOTE_COLORS.length], '');
    await onChanged();
    toast('已新建，点它的 ⋯ 可以在下面加子笔记本');
  };

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="nbooks">
      <button className={`nbook ${nb === '' ? 'on' : ''}`} onClick={() => onPick('')}>
        <Icon name="book" size={14} /><span>全部笔记</span>
        <span className="n">{rows.length}</span>
      </button>

      {/* 第 230 条：树改成一维铺平再渲染 —— 一维才挂得上拖动排序。
          缩进由 depth 算，封顶 6 层（再深缩进把名字挤没了）。
          ref 挂在外层，FLIP 才能量到每一项的位置。
          display:contents 是为了不破坏 .nbooks 的 flex 间距。 */}
      <div ref={bookDrag.boxRef} style={{ display: 'contents' }}>
        {flatBooks.map(({ b, depth }, i) => {
          const kids = kidsOf(b.id);
          const open = !folded.includes(b.id);
          const pad = 9 + depth * 12;
          const dp = bookDrag.props(i);
          return (
            <div
              key={b.id}
              {...dp}
              className={`nbookrow ${dp.className}`}
              /* 第 230 条：缩进靠这里给，不再靠嵌套 div —— 嵌套会让拖动算位置算错 */
              style={{ paddingLeft: depth ? depth * 2 : 0 }}
            >
              <button
                className={`nbook ${nb === b.id ? 'on' : ''}`}
                style={{ paddingLeft: pad, fontSize: depth ? 12.5 : undefined }}
                title={kids.length ? '点名字看这一层的笔记，点箭头展开下一层；按住能拖到别的层' : '点名字看这个笔记本里的笔记；按住能拖到别的层'}
                onClick={() => onPick(b.id)}
              >
                {kids.length ? (
                  <span
                    style={{ flex: '0 0 12px', textAlign: 'center', color: 'var(--ink3)', fontSize: 10 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFolded(open ? [...folded, b.id] : folded.filter((x) => x !== b.id));
                    }}
                  >{open ? '▾' : '▸'}</span>
                ) : (
                  <span style={{ flex: '0 0 12px' }} />
                )}
                <span className="dot" style={{ background: b.color, width: depth ? 6 : 8, height: depth ? 6 : 8 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                {/* 第 32 条：加过密码的笔记本标一把小锁，不然「点进去要密码」会让人懵 */}
                {vaultRules.some((r) => r.scope === 'notebook' && r.target === b.id) ? (
                  <span style={{ flex: '0 0 auto', color: 'var(--ink3)', opacity: 0.8 }} title="这个笔记本加过密码">
                    <Icon name="lock" size={10} />
                  </span>
                ) : null}
                <span className="n">{deepCount(b.id)}</span>
              </button>
              <button className="nbookmenu" title="笔记本设置" onClick={() => onEdit(b)}>⋯</button>
            </div>
          );
        })}
      </div>

      <button className="nbook ghost" onClick={() => void addBook()}>
        <Icon name="plus" size={13} /><span>新建笔记本</span>
      </button>
      <div className="small muted" style={{ padding: '2px 9px', fontSize: 11, lineHeight: 1.6 }}>
        可以一层层往下嵌套，也能直接把它拖进别的笔记本里。点 ⋯ 能改名、调颜色、换上级。
      </div>
    </div>
  );
}