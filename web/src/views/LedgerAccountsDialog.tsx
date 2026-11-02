import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog, askConfirm } from '../components/ui';
import { Icon } from '../components/Icons';
import { useDragSort } from '../components/DragSort';
import type { AccountItem } from '../types';

/**
 * 账户管理弹窗。
 *
 * 这是从 `LedgerView`（原 1516 行）里剥出来的最大一块：2 个 state
 * （accOpen / accDraft）+ 5 个操作（openAcc / patchAcc / saveAccRow / delAccRow / toggleAcc）
 * + 一个拖动排序 + 约 190 行 JSX。
 *
 * 拆的依据还是「状态闭合」：这些变量除了这一个弹窗外，主组件只在
 * `accountId` 那一处（记账时选归属）用到账户列表，而那是**另一份** accounts，
 * 由主组件自己维护。弹窗的草稿 accDraft 从来没被主组件读过一行。
 *
 * 一个刻意的改动：弹窗现在自己 `onChanged` 通知外面刷新，而不是让外面
 * 把 `loadAccounts` 传进来当回调。原因是账户余额影响「总资产」「本月流入/流出」
 * 好几处显示，漏刷一处就会出现「账户改完了、上面的总资产还是旧的」。
 * 现在统一走一个出口，外面只做一件事：重取一次。
 */

const ACC_KINDS = ['现金', '银行卡', '信用卡', '支付宝', '微信', '花呗', '公积金', '其他'];

/** 常用币种。手动输入也允许，这里只是省打字 */
const CURRENCIES = [
  { c: 'CNY', s: '¥', n: '人民币' },
  { c: 'USD', s: '$', n: '美元' },
  { c: 'EUR', s: '€', n: '欧元' },
  { c: 'JPY', s: '¥', n: '日元' },
  { c: 'HKD', s: 'HK$', n: '港币' },
  { c: 'GBP', s: '£', n: '英镑' },
];

interface AccDraft {
  id: string;
  name: string;
  kind: string;
  init: string;
  /** 第 221 条：币种 / 备注 */
  currency: string;
  note: string;
  enabled: number;
  /** 展开「更多」那一行设置 */
  open?: boolean;
}

const toAccDraft = (list: AccountItem[]): AccDraft[] =>
  list.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind || '现金',
    init: String(a.init ?? 0),
    currency: a.currency || '',
    note: a.note || '',
    enabled: a.enabled ?? 1,
  }));

const blankAcc = (): AccDraft => ({
  id: '', name: '', kind: '现金', init: '0', currency: '', note: '', enabled: 1, open: true,
});

export function LedgerAccountsDialog({
  accounts,
  jarTotal,
  amt,
  startWithNew,
  onClose,
  onChanged,
  onAccountRemoved,
}: {
  accounts: AccountItem[];
  /** 罐子余额。总资产 = 账户余额 + 罐子余额，少的这一半要补上 */
  jarTotal: number;
  amt: (n: number) => string;
  /** true = 打开就带一行空账户（「新增账户」按钮进来的） */
  startWithNew: boolean;
  onClose: () => void;
  /** 数据变了（保存 / 删除 / 停用 / 重排），外面重取一次 */
  onChanged: () => void;
  /** 当前记账选中的账户被删或被停用了，外面要把选择清掉 */
  onAccountRemoved: (id: string) => void;
}) {
  const toast = useStore((s) => s.toast);

  const [draft, setDraft] = useState<AccDraft[]>(() => []);

  /*
   * 初值从 props 里那份 accounts 铺开，只铺一次 ——
   * 之后 draft 是唯一事实。父组件刷新 accounts 时不能跟着覆盖，
   * 否则用户改到一半（还没点保存）就被打回去了。
   */
  useEffect(() => {
    setDraft((prev) => (prev.length ? prev : (startWithNew ? [...toAccDraft(accounts), blankAcc()] : toAccDraft(accounts))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = useCallback((i: number, p: Partial<AccDraft>) => {
    setDraft((prev) => prev.map((x, k) => (k === i ? { ...x, ...p } : x)));
  }, []);

  const addRow = () => setDraft((prev) => [...prev, blankAcc()]);

  const saveRow = async (i: number) => {
    const row = draft[i];
    const name = row.name.trim();
    if (!name) { toast('账户要有个名字'); return; }
    const init = Number(row.init);
    if (!Number.isFinite(init)) { toast('初始金额要填数字'); return; }
    try {
      const r = await api.accountSave({
        id: row.id || undefined,
        name,
        kind: row.kind || '现金',
        init,
        /* 第 221 条：传空串表示「明确清掉」，传 undefined 才是「不改」 */
        currency: row.currency.trim(),
        note: row.note.trim(),
      });
      setDraft((prev) => prev.map((x, k) => (k === i ? { ...x, name, id: r.id || x.id, open: false } : x)));
      onChanged();
      toast('账户已保存');
    } catch {
      toast('没存上，再试一次');
    }
  };

  const delRow = async (i: number) => {
    const row = draft[i];
    if (!row.id) { setDraft((prev) => prev.filter((_, k) => k !== i)); return; }
    const yes = await askConfirm(`删除账户「${row.name || '未命名'}」？`, {
      body: '已经记下的流水会保留，只是不再归属这个账户。',
      ok: '删除',
    });
    if (!yes) return;
    try {
      await api.accountDelete(row.id);
      setDraft((prev) => prev.filter((_, k) => k !== i));
      onAccountRemoved(row.id);
      onChanged();
      toast('账户已删除');
    } catch {
      toast('没删掉，再试一次');
    }
  };

  const toggleEnabled = async (row: AccDraft) => {
    if (!row.id) return;
    const next = row.enabled ? 0 : 1;
    try {
      await api.accountToggle(row.id, next);
      setDraft((prev) => prev.map((x) => (x.id === row.id ? { ...x, enabled: next } : x)));
      if (!next) onAccountRemoved(row.id);
      onChanged();
      toast(next ? `「${row.name}」已启用` : `「${row.name}」已停用，记账时不再出现`);
    } catch {
      toast('没改成功，再试一次');
    }
  };

  /* 第 221 条：顺序可拖，拖完立刻落库 */
  const keys = useMemo(() => draft.map((r) => r.id).filter(Boolean), [draft]);
  const drag = useDragSort({
    keys,
    onReorder: async (from, to) => {
      const ids = [...keys];
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      // 草稿里也同步挪（含还没保存的新账户，它们不在 keys 里）
      setDraft((prev) => {
        const saved = prev.filter((x) => x.id);
        const news = prev.filter((x) => !x.id);
        const byId = new Map(saved.map((x) => [x.id, x]));
        return [...ids.map((id) => byId.get(id)!).filter(Boolean), ...news];
      });
      try {
        await api.accountReorder(ids);
        onChanged();
        toast('账户顺序已保存');
      } catch {
        toast('顺序没存上，再拖一次');
      }
    },
  });

  /* 总资产 = 账户余额 + 罐子余额。罐子为 0 时不多显示一行，免得老用户看到没见过的数字 */
  const accSum = accounts.reduce((n, a) => n + (a.balance || 0), 0);

  return (
    <Dialog
      title="账户管理"
      wide
      onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>关闭</button>
        <button className="btn primary" type="button" onClick={addRow}>新增账户</button>
      </>}
    >
      <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
        余额 = 初始金额 + 收入 − 支出。删掉账户不会删流水，那些流水只是不再归属账户。
        <br />
        拖左边的把手可以换顺序；停用的账户不进记账下拉，但余额和历史都还在。
      </div>

      {/* 第 162 条：先给一张总览，再给可编辑的明细 */}
      {accounts.length ? (
        <div className="lg-acc-sum">
          <div>
            <span className="k">总资产</span>
            <b>{amt(accSum + jarTotal)}</b>
            {Math.abs(jarTotal) > 0.004 ? (
              <span className="small muted" style={{ marginLeft: 6 }}>
                （账户 {amt(accSum)} · 罐子 {amt(jarTotal)}）
              </span>
            ) : null}
          </div>
          <div>
            <span className="k">本月流入</span>
            <b className="in">{amt(accounts.reduce((n, a) => n + (a.monthIn || 0), 0))}</b>
          </div>
          <div>
            <span className="k">本月流出</span>
            <b className="out">{amt(accounts.reduce((n, a) => n + (a.monthOut || 0), 0))}</b>
          </div>
        </div>
      ) : null}

      <div ref={drag.boxRef} className="lg-acclist">
        {draft.length ? draft.map((row, i) => {
          const saved = !!row.id;
          // 拖动的 key 只认已保存的账户；新行还没 id，让它留在原位
          const dragProps = saved ? drag.props(keys.indexOf(row.id)) : null;
          const bal = saved ? accounts.find((a) => a.id === row.id)?.balance ?? 0 : 0;
          const off = !row.enabled;
          return (
            <div
              className={`lg-acc-block ${off ? 'off' : ''} ${dragProps?.className || ''}`}
              key={row.id || `new-${i}`}
              data-dragkey={dragProps?.['data-dragkey']}
              draggable={dragProps?.draggable}
              onDragStart={dragProps?.onDragStart}
              onDragOver={dragProps?.onDragOver}
              onDragLeave={dragProps?.onDragLeave}
              onDrop={dragProps?.onDrop}
              onDragEnd={dragProps?.onDragEnd}
              data-acc={row.id || 'new'}
            >
              <div className="row lg-accrow">
                {/* 把手：只有已保存的能拖，新行拖了也存不下去 */}
                <span className={`lg-grip ${saved ? '' : 'off'}`} title={saved ? '按住拖动换顺序' : '先保存再拖'}>
                  <Icon name="grip" size={13} />
                </span>
                <input
                  className="inp"
                  style={{ flex: '1 1 110px', minWidth: 90 }}
                  placeholder="账户名"
                  value={row.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
                {/* 第 221 条：类型可自定义 —— 用 datalist 而不是 select */}
                <input
                  className="inp"
                  list="lg-acckind-list"
                  style={{ width: 100, flex: '0 0 auto' }}
                  placeholder="类型"
                  value={row.kind}
                  onChange={(e) => patch(i, { kind: e.target.value })}
                  title="可以选预设，也可以自己填一个"
                />
                <input
                  className="inp"
                  style={{ width: 110, flex: '0 0 auto' }}
                  type="number"
                  step="0.01"
                  placeholder="初始金额"
                  value={row.init}
                  onChange={(e) => patch(i, { init: e.target.value })}
                />
                <span className="small muted" style={{ width: 56, textAlign: 'right' }}>
                  {saved ? amt(bal) : '新账户'}
                </span>
                <button
                  className="btn sm ghost"
                  type="button"
                  title="币种 / 备注"
                  onClick={() => patch(i, { open: !row.open })}
                ><Icon name={row.open ? 'up' : 'down'} size={12} /></button>
                <button className="btn sm primary" type="button" onClick={() => void saveRow(i)}>保存</button>
                <button className="btn sm danger" type="button" onClick={() => void delRow(i)}>
                  {saved ? '删除' : '移除'}
                </button>
              </div>

              {/* 第 221 条：币种 + 备注，平时折起来不占地方 */}
              {row.open ? (
                <div className="row lg-accmore">
                  <span className="small muted" style={{ width: 40 }}>币种</span>
                  <input
                    className="inp"
                    list="lg-cur-list"
                    style={{ width: 96, flex: '0 0 auto' }}
                    placeholder="CNY"
                    value={row.currency}
                    onChange={(e) => patch(i, { currency: e.target.value.toUpperCase() })}
                    maxLength={6}
                  />
                  <span className="small muted" style={{ width: 40 }}>备注</span>
                  <input
                    className="inp"
                    style={{ flex: '1 1 140px', minWidth: 100 }}
                    placeholder="这张卡是干什么用的（可空）"
                    value={row.note}
                    onChange={(e) => patch(i, { note: e.target.value })}
                  />
                  {saved ? (
                    <button
                      className={`switch ${row.enabled ? 'on' : ''}`}
                      type="button"
                      aria-pressed={!!row.enabled}
                      title={row.enabled ? '停用（记账时不出现）' : '启用'}
                      onClick={() => void toggleEnabled(row)}
                    />
                  ) : null}
                </div>
              ) : null}

              {saved ? (() => {
                const a = accounts.find((x) => x.id === row.id);
                if (!a) return null;
                return (
                  <div className="lg-acc-sub">
                    <span>余额 <b>{amt(a.balance || 0)}</b></span>
                    <span className="in">本月 +{amt(a.monthIn || 0)}</span>
                    <span className="out">−{amt(a.monthOut || 0)}</span>
                    {a.currency ? <span className="lg-acc-cur">{a.currency}</span> : null}
                    {a.note ? <span className="lg-acc-note">{a.note}</span> : null}
                    {off ? <span className="lg-acc-off">已停用</span> : null}
                  </div>
                );
              })() : null}
            </div>
          );
        }) : <div className="empty small">还没有账户，点右下角「新增账户」加一个。设了账户以后，记账时能选归属，余额会自动跟着流水走。</div>}
      </div>

      <datalist id="lg-acckind-list">
        {ACC_KINDS.map((k) => <option key={k} value={k} />)}
      </datalist>
      <datalist id="lg-cur-list">
        {CURRENCIES.map((c) => <option key={c.c} value={c.c}>{`${c.n} ${c.s}`}</option>)}
      </datalist>
    </Dialog>
  );
}