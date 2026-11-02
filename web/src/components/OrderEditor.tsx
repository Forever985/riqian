import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon } from './Icons';
import { useDragSort } from './DragSort';

export interface OrderItem { k: string; n: string }

/**
 * 通用「顺序编辑器」。
 * 导航、个人中心、设置页三处的排序都用它 —— 之前导航一份、模块一份、设置没有，
 * 结果就是「有的地方能调、有的地方根本找不到」，第 53/54 条说的就是这个。
 *
 * #169：用户原话「导航顺序不能拖动了，只能点上下了，这不好」。
 * 原来那个 `≡` 手柄纯粹是个装饰 —— 看着像能拖，一拖什么都不发生。
 * 这比没有手柄更糟：它让人以为程序坏了。现在真接上拖动，上下箭头保留
 * （键盘用户和"只想挪一格"时，点一下比拖一段准）。
 */
export function OrderEditor({
  items, settingKey, hint, labelOf,
}: {
  items: OrderItem[];
  /** 存哪个设置项（JSON 数组） */
  settingKey: string;
  hint?: string;
  labelOf?: (k: string) => string;
}) {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);

  const [order, setOrder] = useState<string[]>(() => normalize(settings[settingKey], items));
  useEffect(() => { setOrder(normalize(settings[settingKey], items)); }, [settings[settingKey], items]);

  const commit = async (next: string[]) => {
    setOrder(next);
    await setSetting(settingKey, JSON.stringify(next));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    void commit(next);
  };

  const drag = useDragSort({
    keys: order,
    onReorder: (from, to) => {
      if (from === to) return;
      const next = order.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      void commit(next);
    },
  });

  const nameOf = (k: string) => labelOf?.(k) || items.find((x) => x.k === k)?.n || k;

  return (
    <div className="orderlist" ref={drag.boxRef} data-act="orderlist">
      {order.map((k, i) => {
        const dp = drag.props(i);
        return (
          <div
            key={k}
            {...dp}
            className={`orow ${dp.className}`}
          >
            <span className="grip" title="按住拖动能调整顺序">≡</span>
            <span className="nm">{nameOf(k)}</span>
            <button className="btn sm ghost" data-act="up" onClick={() => move(i, -1)} disabled={i === 0} title="上移">↑</button>
            <button className="btn sm ghost" data-act="down" onClick={() => move(i, 1)} disabled={i === order.length - 1} title="下移">↓</button>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn sm"
          onClick={async () => {
            await setSetting(settingKey, '');
            setOrder(items.map((x) => x.k));
            toast('已恢复默认顺序');
          }}
        >
          <Icon name="reset" size={13} />恢复默认
        </button>
        {hint ? <span className="small muted">{hint}</span> : null}
      </div>
    </div>
  );
}

/** 把「已保存的顺序」和「当前实际项」对齐：没存过用默认，存过但缺项就补在末尾 */
export function normalize(raw: unknown, items: OrderItem[]): string[] {
  let saved: string[] = [];
  if (typeof raw === 'string' && raw) {
    try { saved = JSON.parse(raw); } catch { saved = []; }
  }
  if (!Array.isArray(saved) || !saved.length) return items.map((x) => x.k);
  const known = new Set(items.map((x) => x.k));
  const out = saved.filter((k) => known.has(k));
  items.forEach((x) => { if (!out.includes(x.k)) out.push(x.k); });
  return out;
}
