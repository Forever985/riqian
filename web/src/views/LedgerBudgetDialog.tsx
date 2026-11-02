import { useState } from 'react';
import { useStore } from '../store';
import { Dialog } from '../components/ui';

/**
 * 月度预算编辑弹窗。
 *
 * 从 `Ledger.tsx` 剥出来的第二块。原来 3 个 state（budgetOpen / bTotal / bCats）
 * 和 openBudget / saveBudget 两个函数挤在主组件里，但它们同样只服务于这一个弹窗。
 *
 * 与 RecurDialog 的差别：这里的初值不是从 props 传「一条记录」，
 * 而是从 settings 里读两个字符串（ledgerBudget / ledgerBudgetCats）。
 * 所以初值直接在组件内部读，调用方只需要给一个 `onClose` —— 打开即最新，
 * 不需要外面先把值算好再传进来（少一层传参就少一处能对不上的地方）。
 *
 * 存的时候仍然是写回那两个 settings 键，语义一字未改：
 *   · 总预算留空或 ≤0 → 存空串（= 不设预算）
 *   · 分类预算只存「名字非空且金额>0」的行，其余静默丢弃
 */
export function BudgetDialog({
  currentTotal,
  currentCats,
  categories,
  onClose,
}: {
  /** 已经解析好的总预算（0 表示没设） */
  currentTotal: number;
  /** 已经解析好的分类预算 */
  currentCats: Record<string, number>;
  /** 分类候选，给输入框做 datalist 补全 */
  categories: string[];
  onClose: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const setSetting = useStore((s) => s.setSetting);

  const [total, setTotal] = useState(currentTotal > 0 ? String(currentTotal) : '');
  const [rows, setRows] = useState<{ cat: string; amount: string }[]>(
    () => Object.entries(currentCats).map(([c, n]) => ({ cat: c, amount: String(n) })),
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const t = String(total).trim();
    const tN = Number(t);
    const map: Record<string, number> = {};
    for (const r of rows) {
      const c = r.cat.trim();
      const n = Number(r.amount);
      // 名字空或金额不合理就跳过：不报错、不阻塞，用户可以只填一半
      if (!c || !Number.isFinite(n) || n <= 0) continue;
      map[c] = n;
    }
    setBusy(true);
    try {
      await setSetting('ledgerBudget', t && Number.isFinite(tN) && tN > 0 ? String(tN) : '');
      await setSetting('ledgerBudgetCats', JSON.stringify(map));
      toast('预算已保存');
      onClose();
    } catch {
      toast('没存上，再试一次');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="月度预算"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>取消</button>
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>保存</button>
      </>}
    >
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="small muted" style={{ width: 74 }}>总预算</span>
        <input
          className="inp"
          style={{ width: 160 }}
          type="number"
          step="0.01"
          min="0"
          placeholder="留空 = 不设"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
        <span className="small muted">每月支出上限，超了这里会标红。</span>
      </div>
      <div className="small muted" style={{ marginBottom: 8 }}>分类预算</div>
      <datalist id="lg-cat-list">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
      {rows.map((row, i) => (
        <div className="row" key={i} style={{ marginBottom: 8 }}>
          <input
            className="inp"
            style={{ flex: '1 1 140px', minWidth: 120 }}
            list="lg-cat-list"
            placeholder="分类名"
            value={row.cat}
            onChange={(e) => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, cat: e.target.value } : x)))}
          />
          <input
            className="inp"
            style={{ width: 140, flex: '0 0 auto' }}
            type="number"
            step="0.01"
            min="0"
            placeholder="金额"
            value={row.amount}
            onChange={(e) => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))}
          />
          <button
            className="btn sm danger"
            type="button"
            onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))}
          >删除</button>
        </div>
      ))}
      <button
        className="btn sm"
        type="button"
        onClick={() => setRows((prev) => [...prev, { cat: '', amount: '' }])}
      >加一个分类</button>
    </Dialog>
  );
}