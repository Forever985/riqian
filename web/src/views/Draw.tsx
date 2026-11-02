import { useState } from 'react';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { DrawBoard, DrawList } from '../features/draw';

/**
 * 第 178 条：画板页。
 *
 * 放在导航里而不是只挂在笔记里 —— 原文说的是「应该直接在整个轮子中增加画板」，
 * 笔记只是它的一个使用场景。这里独立成页，笔记里想插图时再从多媒体库取。
 */
export function DrawView() {
  const [editing, setEditing] = useState<string | null>(null);
  /* 存一个自增的重载计数：新建完回到列表要重新拉一次，
     但 DrawList 的 load 只在挂载时跑，所以靠改 key 强制重挂 */
  const [ver, setVer] = useState(0);

  return (
    <>
      <Topbar
        title="画板"
        sub="存的是笔画不是图，随时能再改；要图就导进多媒体库"
        right={
          <button className="btn sm" onClick={() => { setEditing(''); }} title="新建一块画板">
            <Icon name="plus" size={13} />新建
          </button>
        }
        lock={{ scope: 'draw', label: '画板' }}
      />
      <div className="wrap">
        <div className="card">
          <DrawList key={ver} onOpen={(id) => setEditing(id)} />
        </div>
      </div>

      {editing !== null ? (
        <DrawBoard
          drawingId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setVer((x) => x + 1); }}
        />
      ) : null}
    </>
  );
}