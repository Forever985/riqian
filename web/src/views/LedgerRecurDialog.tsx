import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog } from '../components/ui';
import type { AccountItem, RecurItem } from '../types';

/**
 * 周期账单（固定支出）的编辑弹窗。
 *
 * 从 `Ledger.tsx` 里剥出来的。原来这 9 个 state（recOpen / recId / rKind /
 * rAmount / rCat / rDay / rNote / rAcc / rEnabled）和对应的四个操作函数
 * 全都挤在 1516 行的 `LedgerView` 里，但它们的**使用范围完全闭合在这一个弹窗内** ——
 * 主组件只是「打开它 / 关掉它」，一个字段都不读。
 *
 * 判断依据是逐行 grep：这 9 个变量除声明外只出现在 openRecurNew / openRecurEdit /
 * saveRecur / toggleRecur / removeRecur 和这一段 JSX 里，没有一处外溢。
 * 这种「状态闭合 + 单向依赖（外部数据从 props 进来）」是拆分风险最低的形态。
 *
 * 拆完之后删掉了 4 个 state + 1 个 useState，主组件的 return 少了一块，
 * 而弹窗内部的状态变化不再触发整个账本页重渲染。
 */
export interface RecurDialogProps {
  /** 传 null 表示新增；传某条规则表示编辑 */
  editing: RecurItem | null;
  categories: string[];
  accounts: AccountItem[];
  onClose: () => void;
  /** 保存/删除成功后通知调用方刷新规则列表 */
  onSaved: (msg: string) => void;
}

const DEFAULT_CAT = '居住';

/** 把一条规则铺成表单初值。新增时走空值分支，避免「上一次编辑的内容还留着」 */
function initial(editing: RecurItem | null) {
  if (!editing) {
    return {
      kind: 'out' as 'out' | 'in',
      amount: '',
      cat: DEFAULT_CAT,
      day: '1',
      note: '',
      accountId: '',
      enabled: true,
    };
  }
  return {
    kind: (editing.kind === 'in' ? 'in' : 'out') as 'out' | 'in',
    amount: String(editing.amount ?? ''),
    cat: editing.cat || '其他',
    day: String(editing.day || 1),
    note: editing.note || '',
    accountId: editing.accountId || '',
    enabled: !!editing.enabled,
  };
}

export function RecurDialog({ editing, categories, accounts, onClose, onSaved }: RecurDialogProps) {
  const toast = useStore((s) => s.toast);
  const [init] = useState(() => initial(editing));
  const [kind, setKind] = useState<'out' | 'in'>(init.kind);
  const [amount, setAmount] = useState(init.amount);
  const [cat, setCat] = useState(init.cat);
  const [day, setDay] = useState(init.day);
  const [note, setNote] = useState(init.note);
  const [accountId, setAccountId] = useState(init.accountId);
  const [enabled, setEnabled] = useState(init.enabled);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { toast('金额要填一个大于 0 的数'); return; }
    const dayN = Math.round(Number(day));
    /*
     * 第 160 条：允许填到 31。当月没有那一天就自动落到月末（后端同样处理），
     * 所以这里只校验范围，不按「这个月有没有 31 号」提前拦。
     */
    if (!Number.isFinite(dayN) || dayN < 1 || dayN > 31) { toast('每月几号请填 1 到 31'); return; }

    setBusy(true);
    try {
      await api.ledgerRecurSave({
        id: editing?.id || undefined,
        kind,
        amount: n,
        cat: (cat || '其他').trim() || '其他',
        note: note.trim(),
        accountId: accountId || undefined,
        day: dayN,
        enabled: enabled ? 1 : 0,
      });
      onSaved(editing ? '规则已保存' : '规则加好了');
    } catch {
      toast('没存上，再试一次');
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={editing ? '改固定支出' : '新增固定支出'}
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>取消</button>
        <button className="btn primary" type="button" disabled={busy} onClick={() => void save()}>
          {editing ? '保存' : '添加'}
        </button>
      </>}
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="seg">
          <button type="button" className={`seg-b ${kind === 'out' ? 'on' : ''}`} onClick={() => setKind('out')}>支出</button>
          <button type="button" className={`seg-b ${kind === 'in' ? 'on' : ''}`} onClick={() => setKind('in')}>收入</button>
        </div>
        <input
          className="inp lg-amount"
          type="number"
          step="0.01"
          min="0"
          placeholder="金额"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className="inp"
          style={{ flex: 1, minWidth: 140 }}
          placeholder="备注（可空）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="small muted" style={{ width: 34 }}>分类</span>
        {categories.map((c) => (
          <button
            type="button"
            key={c}
            className={`chip ${cat === c ? 'on' : ''}`}
            onClick={() => setCat(c)}
          >{c}</button>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="small muted" style={{ width: 62 }}>每月几号</span>
        <input
          className="inp"
          style={{ width: 90, flex: '0 0 auto' }}
          type="number"
          min="1"
          max="31"
          step="1"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <span className="small muted">1 到 31；当月没这一天就记在月末（比如 31 号在 2 月就是 28 号）</span>
      </div>
      <div className="row">
        <span className="small muted" style={{ width: 62 }}>账户</span>
        <select
          className="inp"
          style={{ width: 150, flex: '0 0 auto' }}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">不归属账户</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className={`switch ${enabled ? 'on' : ''}`}
          aria-pressed={enabled}
          onClick={() => setEnabled(!enabled)}
          title={enabled ? '启用中' : '已停用'}
        />
        <span className="small">{enabled ? '每月自动记入' : '先存着，不自动记'}</span>
      </div>
    </Dialog>
  );
}