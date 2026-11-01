import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog, Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { pad, shiftMonth, todayKey } from '../lib/date';
import { useDragSort } from '../components/DragSort';
import type { AccountItem, LedgerData, LedgerInsight, LedgerItem, RecurItem } from '../types';
import {
  Donut, CatBars, Trend, Bars, WeekdayRadar, Heatmap, TopList, BalanceSplit, DailyCompare,
  /* 第 239 条 */
  AmountBuckets, CatTrend, StackedMonths, WeekdayAvg, HourBars, FreqList,
} from './LedgerCharts';

const CATS = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '学习', '其他'];
/*
 * 第 221 条：账户类型不再写死。预设只是**候选**，用户可以自己填一个 ——
 * 「公积金」「股票」「饭卡」这些都不在名单里，但都是真实存在的账户。
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

/** 一个月的第一天与最后一天 */
function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${ym}-01`, `${ym}-${pad(last)}`];
}

const money = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WD = ['日', '一', '二', '三', '四', '五', '六'];

function dayLabel(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, day).getDay()];
  return `${m} 月 ${day} 日 · 星期${wd}`;
}

interface AccDraft {
  id: string;
  name: string;
  kind: string;
  init: string;
  /* 第 221 条 */
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

/** 记账本：一个月一屏，上面看数，下面记一笔 */
export function LedgerView() {
  const toast = useStore((s) => s.toast);
  const setSetting = useStore((s) => s.setSetting);
  const settings = useStore((s) => s.settings);
  const sym = String(settings.ledgerCurrency || '¥');
  const amt = (n: number) => `${sym}${money(n)}`;

  const cur = todayKey().slice(0, 7);
  const [ym, setYm] = useState(cur);
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  /* 第 159 条：筛选 / 排序 / 改一笔 / 分类管理 */
  const [fKind, setFKind] = useState<'all' | 'out' | 'in'>('all');
  const [fCat, setFCat] = useState('');
  const [fKw, setFKw] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [editItem, setEditItem] = useState<LedgerItem | null>(null);
  const [catMgr, setCatMgr] = useState(false);

  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [recurs, setRecurs] = useState<RecurItem[]>([]);

  /* ---------- 图表（第 205 条） ---------- */
  const [insight, setInsight] = useState<LedgerInsight | null>(null);
  const [chartOpen, setChartOpen] = useState(true);
  /*
   * 九张图默认只展开前四张 —— 一次全铺开，屏幅马上变成"一张接一张的图"，
   * 反而找不到账目明细。剩下的点开看。
   */
  const [chartMore, setChartMore] = useState(false);

  const [kind, setKind] = useState<'out' | 'in'>('out');
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('餐饮');
  const [customCat, setCustomCat] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');

  /* ---------- 账户管理 ---------- */
  const [accOpen, setAccOpen] = useState(false);
  const [accDraft, setAccDraft] = useState<AccDraft[]>([]);

  /* ---------- 预算 ---------- */
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [bTotal, setBTotal] = useState('');
  const [bCats, setBCats] = useState<{ cat: string; amount: string }[]>([]);

  /* ---------- 周期账单 ---------- */
  const [recOpen, setRecOpen] = useState(false);
  const [recId, setRecId] = useState<string | null>(null);
  const [rKind, setRKind] = useState<'out' | 'in'>('out');
  const [rAmount, setRAmount] = useState('');
  const [rCat, setRCat] = useState('居住');
  const [rDay, setRDay] = useState('1');
  const [rNote, setRNote] = useState('');
  const [rAcc, setRAcc] = useState('');
  const [rEnabled, setREnabled] = useState(true);

  /*
   * 筛选条件下推给后端：合计、分类小计、按天小计全部由 SQL 算好（§2.6）。
   * 前端不再对 items 做 filter/reduce —— 少搬一遍数据，也不会出现
   * 「列表看着是筛过的，合计还是全月」这种对不上的情况。
   */
  const load = useCallback(async (m: string, f?: { kind?: string; cat?: string; kw?: string }) => {
    setLoading(true);
    try {
      const [from, to] = monthRange(m);
      setData(await api.ledgerList(from, to, f));
    } catch {
      setData(null);
      toast('账目没读出来，稍后再试');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await api.ledgerAccounts());
    } catch { /* 账户读不出来也不耽误记账 */ }
  }, []);

  const loadRecur = useCallback(async () => {
    try {
      setRecurs(await api.ledgerRecurList());
    } catch { setRecurs([]); }
  }, []);

  /** 图表数据：只跟月份走，不吃筛选条件（否则筛一个分类，饼图只剩一块） */
  const loadInsight = useCallback(async (m: string) => {
    try {
      setInsight(await api.ledgerInsight(m));
    } catch { setInsight(null); }
  }, []);

  /*
   * 月份变化、筛选变化都走这里。搜索框每敲一个字就发一次请求太吵，
   * 压 220ms；本地 SQLite 很快，体感是即时的。
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(ym, { kind: fKind === 'all' ? '' : fKind, cat: fCat, kw: fKw.trim() });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [ym, fKind, fCat, fKw, load]);

  // 图表跟着月份重取（和筛选无关，所以单独一条）
  useEffect(() => { void loadInsight(ym); }, [ym, loadInsight]);

  // 进入页面时跑一次：把本月该记的固定支出补齐（后端幂等，重复进也不会记两遍）
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      await loadAccounts();
      await loadRecur();
      try {
        const r = await api.ledgerRecurRun(todayKey().slice(0, 7));
        if (r && r.made > 0) {
          toast(`已自动记入 ${r.made} 笔固定支出`);
          await load(ym);
          await loadAccounts();
        }
      } catch { /* 没有规则或后端没开这块，都当无事发生 */ }
    })();
  }, [load, loadAccounts, loadRecur, toast, ym]);

  const cats = useMemo(() => {
    // 用后端给的全量分类（不受当前筛选影响，否则选完只剩它自己）
    const list = [...CATS];
    for (const c of data?.allCats || []) {
      if (c && !list.includes(c)) list.push(c);
    }
    for (const c of data?.byCat || []) {
      if (c.cat && !list.includes(c.cat)) list.push(c.cat);
    }
    for (const r of recurs) {
      if (r.cat && !list.includes(r.cat)) list.push(r.cat);
    }
    // 第 202 条：用户排过序的优先按那个顺序走，没排过的保持原样
    let saved: string[] = [];
    try {
      const raw = JSON.parse(String(settings.ledgerCatOrder || '[]')) as unknown;
      if (Array.isArray(raw)) saved = raw.filter((x): x is string => typeof x === 'string');
    } catch { /* 忽略 */ }
    if (!saved.length) return list;
    const inOrder = saved.filter((c) => list.includes(c));
    return [...inOrder, ...list.filter((c) => !inOrder.includes(c))];
  }, [data, recurs, settings.ledgerCatOrder]);

  /** 后端已经筛过了，这里拿到的就是要显示的那批 */
  const shownItems = data?.items || [];

  /** 真的用过的分类（用来做分类管理；预设但没用过的不列出来） */
  const usedCats = useMemo(() => {
    const set = new Set<string>();
    for (const c of data?.byCat || []) if (c.cat) set.add(c.cat);
    for (const r of recurs) if (r.cat) set.add(r.cat);
    return [...set];
  }, [data, recurs]);

  /*
   * 第 202 条：分类顺序。
   * 存 settings.ledgerCatOrder（JSON 数组）。用过的分类里没出现在顺序表里的，
   * 按原顺序接在后面 —— 新分类不用手动加进表就有位置。
   */
  const catOrder = useMemo(() => {
    let saved: string[] = [];
    try {
      const raw = JSON.parse(String(settings.ledgerCatOrder || '[]')) as unknown;
      if (Array.isArray(raw)) saved = raw.filter((x): x is string => typeof x === 'string');
    } catch { /* 存坏了就当没排过 */ }
    const seen = new Set(saved);
    return [...saved.filter((c) => usedCats.includes(c)), ...usedCats.filter((c) => !seen.has(c))];
  }, [settings.ledgerCatOrder, usedCats]);

  const catDrag = useDragSort({
    keys: catOrder,
    onReorder: async (from, to) => {
      const next = [...catOrder];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      await setSetting('ledgerCatOrder', JSON.stringify(next));
    },
  });

  const groups = useMemo(() => {
    type G = { date: string; items: LedgerItem[]; inSum: number; outSum: number; inN: number; outN: number };

    /*
     * 按金额看的时候不按日期分组 —— 分组会把大小顺序拆散，直接铺一张表。
     * 这里只是**显示顺序**，金额本身已经是后端算好的，不再累加。
     */
    if (sortBy === 'amount') {
      const items = [...shownItems].sort((a, b) => (b.amount || 0) - (a.amount || 0));
      return items.length
        ? [{ date: '', items, inSum: 0, outSum: 0, inN: 0, outN: 0 } as G]
        : [];
    }

    /*
     * 抬头的小计（收入/支出/笔数）直接用 SQL 的 GROUP BY 结果，
     * 前端只按日期把明细挂上去，不再自己 reduce。
     */
    const bucket = new Map<string, LedgerItem[]>();
    for (const it of shownItems) {
      const arr = bucket.get(it.date);
      if (arr) arr.push(it);
      else bucket.set(it.date, [it]);
    }
    return (data?.days || []).map((d) => ({
      date: d.date,
      items: bucket.get(d.date) || [],
      inSum: d.inSum,
      outSum: d.outSum,
      inN: d.inN,
      outN: d.outN,
    }));
  }, [data, shownItems, sortBy]);

  const expense = data?.expense || 0;
  const inN = data?.inN || 0;
  const outN = data?.outN || 0;

  const accName = (id?: string) => accounts.find((a) => a.id === id)?.name || '';

  /*
   * 预算要有"时间维度"才不是摆设：
   * 光看"花了 800 / 预算 2000"没感觉，得知道"这个月过了 60%，我才花 40%"。
   */
  const monthMeta = useMemo(() => {
    const [y, m] = ym.split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    const isCur = ym === cur;
    const passed = isCur ? new Date().getDate() : total;
    return { total, passed, left: Math.max(0, total - passed), isCur };
  }, [ym, cur]);

  const budgetTotal = useMemo(() => {
    const n = Number(String(settings.ledgerBudget ?? '').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [settings.ledgerBudget]);

  const catBudget = useMemo(() => {
    const out: Record<string, number> = {};
    try {
      const raw = JSON.parse(String(settings.ledgerBudgetCats || '{}')) as unknown;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          const n = Number(v);
          if (k && Number.isFinite(n) && n > 0) out[k] = n;
        }
      }
    } catch { /* 存坏了就当没设 */ }
    return out;
  }, [settings.ledgerBudgetCats]);

  const catUsed = (name: string) => (data?.byCat || []).find((c) => c.cat === name)?.outSum || 0;

  /* ---------- 记一笔 ---------- */

  const save = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { toast('金额要填一个大于 0 的数'); return; }
    const finalCat = customOpen
      ? (customCat.trim() || cat.trim() || '其他')
      : (cat.trim() || '其他');
    const d = date || todayKey();
    try {
      await api.ledgerAdd({
        date: d, kind, amount: n, cat: finalCat, note: note.trim(),
        accountId: accountId || undefined,
      });
      setAmount('');
      setNote('');
      await loadAccounts();
      if (d.slice(0, 7) !== ym) setYm(d.slice(0, 7));
      else await load(ym);
      toast(`已记一笔：${kind === 'out' ? '支出' : '收入'} ${amt(n)}`);
    } catch {
      toast('没存上，再试一次');
    }
  };

  const remove = async (it: LedgerItem) => {
    if (!window.confirm(`删除这笔「${it.cat || '未分类'} ${amt(Number(it.amount) || 0)}」？删掉就找不回来了。`)) return;
    try {
      await api.ledgerDelete(it.id);
      await load(ym);
      await loadAccounts();
      toast('已删除');
    } catch {
      toast('没删掉，再试一次');
    }
  };

  /* ---------- 账户 ---------- */

  const openAcc = async (addNew = false) => {
    setAccOpen(true);
    try {
      const list = await api.ledgerAccounts();
      setAccounts(list);
      const draft = toAccDraft(list);
      const blank: AccDraft = { id: '', name: '', kind: '现金', init: '0', currency: '', note: '', enabled: 1 };
      setAccDraft(addNew ? [...draft, blank] : draft);
    } catch {
      setAccDraft(addNew ? [{ id: '', name: '', kind: '现金', init: '0', currency: '', note: '', enabled: 1 }] : []);
      toast('账户没读出来，稍后再试');
    }
  };

  const patchAcc = (i: number, p: Partial<AccDraft>) => {
    setAccDraft((prev) => prev.map((x, k) => (k === i ? { ...x, ...p } : x)));
  };

  const saveAccRow = async (i: number) => {
    const row = accDraft[i];
    const name = row.name.trim();
    if (!name) { toast('账户要有个名字'); return; }
    const init = Number(row.init);
    if (!Number.isFinite(init)) { toast('初始金额要填数字'); return; }
    try {
      const r = await api.accountSave({
        id: row.id || undefined, name, kind: row.kind || '现金', init,
        // 第 221 条：币种 / 备注一起存。传空串表示「明确清掉」，传 undefined 才是「不改」
        currency: row.currency.trim(), note: row.note.trim(),
      });
      setAccDraft((prev) => prev.map((x, k) => (k === i ? { ...x, name, id: r.id || x.id, open: false } : x)));
      await loadAccounts();
      toast('账户已保存');
    } catch {
      toast('没存上，再试一次');
    }
  };

  const delAccRow = async (i: number) => {
    const row = accDraft[i];
    if (!row.id) { setAccDraft((prev) => prev.filter((_, k) => k !== i)); return; }
    if (!window.confirm(`删除账户「${row.name || '未命名'}」？已经记下的流水会保留，只是不再归属这个账户。`)) return;
    try {
      await api.accountDelete(row.id);
      setAccDraft((prev) => prev.filter((_, k) => k !== i));
      if (accountId === row.id) setAccountId('');
      await loadAccounts();
      toast('账户已删除');
    } catch {
      toast('没删掉，再试一次');
    }
  };

  /* 第 221 条：账户顺序可拖，拖完立刻落库 */
  const accKeys = useMemo(() => accDraft.map((r) => r.id).filter(Boolean), [accDraft]);
  const accDrag = useDragSort({
    keys: accKeys,
    onReorder: async (from, to) => {
      const ids = [...accKeys];
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      // 草稿里也同步挪（含还没保存的新账户，它们不在 accKeys 里）
      setAccDraft((prev) => {
        const saved = prev.filter((x) => x.id);
        const news = prev.filter((x) => !x.id);
        const byId = new Map(saved.map((x) => [x.id, x]));
        return [...ids.map((id) => byId.get(id)!).filter(Boolean), ...news];
      });
      try {
        await api.accountReorder(ids);
        await loadAccounts();
        toast('账户顺序已保存');
      } catch {
        toast('顺序没存上，再拖一次');
      }
    },
  });

  /** 停用 / 启用。停用后不进记账下拉，但历史流水和余额都还在 */
  const toggleAcc = async (row: AccDraft) => {
    if (!row.id) return;
    const next = row.enabled ? 0 : 1;
    try {
      await api.accountToggle(row.id, next);
      setAccDraft((prev) => prev.map((x) => (x.id === row.id ? { ...x, enabled: next } : x)));
      await loadAccounts();
      if (!next && accountId === row.id) setAccountId('');
      toast(next ? `「${row.name}」已启用` : `「${row.name}」已停用，记账时不再出现`);
    } catch {
      toast('没改成功，再试一次');
    }
  };

  /* ---------- 预算 ---------- */

  const openBudget = () => {
    setBTotal(budgetTotal > 0 ? String(budgetTotal) : '');
    setBCats(Object.entries(catBudget).map(([c, n]) => ({ cat: c, amount: String(n) })));
    setBudgetOpen(true);
  };

  const saveBudget = async () => {
    const total = String(bTotal).trim();
    const totalN = Number(total);
    const map: Record<string, number> = {};
    for (const r of bCats) {
      const c = r.cat.trim();
      const n = Number(r.amount);
      if (!c || !Number.isFinite(n) || n <= 0) continue;
      map[c] = n;
    }
    try {
      await setSetting('ledgerBudget', total && Number.isFinite(totalN) && totalN > 0 ? String(totalN) : '');
      await setSetting('ledgerBudgetCats', JSON.stringify(map));
      setBudgetOpen(false);
      toast('预算已保存');
    } catch {
      toast('没存上，再试一次');
    }
  };

  /* ---------- 周期账单 ---------- */

  const openRecurNew = () => {
    setRecId(null);
    setRKind('out');
    setRAmount('');
    setRCat('居住');
    setRDay('1');
    setRNote('');
    setRAcc('');
    setREnabled(true);
    setRecOpen(true);
  };

  const openRecurEdit = (r: RecurItem) => {
    setRecId(r.id);
    setRKind(r.kind === 'in' ? 'in' : 'out');
    setRAmount(String(r.amount ?? ''));
    setRCat(r.cat || '其他');
    setRDay(String(r.day || 1));
    setRNote(r.note || '');
    setRAcc(r.accountId || '');
    setREnabled(!!r.enabled);
    setRecOpen(true);
  };

  const saveRecur = async () => {
    const n = Number(rAmount);
    if (!Number.isFinite(n) || n <= 0) { toast('金额要填一个大于 0 的数'); return; }
    const day = Math.round(Number(rDay));
    // 第 160 条：允许到 31；当月没有那一天就自动落到月末（后端也一样处理）
    if (!Number.isFinite(day) || day < 1 || day > 31) { toast('每月几号请填 1 到 31'); return; }
    try {
      await api.ledgerRecurSave({
        id: recId ?? undefined,
        kind: rKind,
        amount: n,
        cat: (rCat || '其他').trim() || '其他',
        note: rNote.trim(),
        accountId: rAcc || undefined,
        day,
        enabled: rEnabled ? 1 : 0,
      });
      setRecOpen(false);
      setRecId(null);
      await loadRecur();
      toast(recId ? '规则已保存' : '规则加好了');
    } catch {
      toast('没存上，再试一次');
    }
  };

  const toggleRecur = async (r: RecurItem) => {
    try {
      await api.ledgerRecurSave({
        id: r.id, kind: r.kind, amount: Number(r.amount) || 0, cat: r.cat, note: r.note,
        accountId: r.accountId || undefined, day: r.day, enabled: r.enabled ? 0 : 1,
      });
      await loadRecur();
      toast(r.enabled ? '已停用' : '已启用');
    } catch {
      toast('没能改动，再试一次');
    }
  };

  const removeRecur = async (r: RecurItem) => {
    if (!window.confirm(`删除「${r.cat || '未分类'} ${amt(Number(r.amount) || 0)}」这条固定支出规则？已经记下的流水不会删。`)) return;
    try {
      await api.ledgerRecurDelete(r.id);
      await loadRecur();
      toast('已删除');
    } catch {
      toast('没删掉，再试一次');
    }
  };

  const [y, m] = ym.split('-');

  return (
    <>
      <Topbar
        title="记账本"
        sub={`${y} 年 ${Number(m)} 月 · 共 ${data?.items.length || 0} 笔`}
        right={
          <div className="seg">
            <button className={`seg-b ${ym === cur ? 'on' : ''}`} onClick={() => setYm(cur)}>本月</button>
            <button className={`seg-b ${ym === shiftMonth(cur, -1) ? 'on' : ''}`} onClick={() => setYm(shiftMonth(cur, -1))}>上月</button>
          </div>
        }
      />
      <div className="wrap">
        <div className="card">
          <h3>
            <Icon name="database" size={14} />账户
            <span className="muted">{accounts.length} 个</span>
            <button className="btn sm" type="button" onClick={() => void openAcc(true)}>新增账户</button>
            <button className="btn sm ghost" type="button" onClick={() => void openAcc(false)}>管理</button>
          </h3>
          {accounts.length ? (
            <div className="lg-accs">
              {accounts.map((a) => (
                <div className="lg-acc" key={a.id}>
                  <div className="lg-acc-n">{a.name}</div>
                  <div className="lg-acc-v" style={{ color: a.balance < 0 ? 'var(--bad)' : undefined }}>{amt(a.balance)}</div>
                  <div className="lg-acc-k">{a.kind || '账户'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty small">还没有账户。加一个「现金」「银行卡」，记账时就能看出每个账户还剩多少。</div>
          )}
        </div>

        <div className="card">
          <h3>
            <Icon name="chart" size={14} />预算
            <span className="muted">{ym === cur ? '本月' : `${Number(m)} 月`}已花 {amt(expense)}</span>
            <button className="btn sm" type="button" onClick={openBudget}>编辑预算</button>
          </h3>
          {budgetTotal > 0 ? (() => {
            const over = expense > budgetTotal;
            const spent = budgetTotal > 0 ? (expense / budgetTotal) * 100 : 0;
            const pace = monthMeta.total > 0 ? (monthMeta.passed / monthMeta.total) * 100 : 0;
            // 花得比时间快 8 个百分点以上就提醒一句，别等超了才知道
            const fast = !over && spent > pace + 8;
            const remain = budgetTotal - expense;
            const perDay = monthMeta.left > 0 ? remain / monthMeta.left : remain;
            return (
              <div className="lg-bar" style={{ marginBottom: 12 }}>
                <div className="lg-bar-h">
                  <span className="lg-bar-c">总预算</span>
                  <span className="lg-bar-n">{amt(expense)} / {amt(budgetTotal)}</span>
                </div>
                <div className="lg-bar-t" data-pace={pace.toFixed(0)}>
                  <i style={{
                    width: `${Math.min(spent, 100)}%`,
                    background: over ? 'var(--bad)' : fast ? 'var(--warn)' : 'var(--accent)',
                    opacity: 1,
                  }} />
                  {monthMeta.isCur ? (
                    <b
                      className="lg-bar-pace"
                      style={{ left: `${Math.min(pace, 100)}%` }}
                      title={`这个月过了 ${Math.round(pace)}%`}
                    />
                  ) : null}
                </div>
                <div className="lg-bar-s" style={{ color: over ? 'var(--bad)' : fast ? 'var(--warn)' : 'var(--ink3)' }}>
                  {over
                    ? `已超出 ${amt(expense - budgetTotal)}`
                    : (
                      <>
                        还剩 <b>{amt(remain)}</b> · 用了 {spent.toFixed(0)}%
                        {monthMeta.isCur
                          ? <> · 剩下 {monthMeta.left} 天，每天可花 <b>{amt(Math.max(0, perDay))}</b></>
                          : null}
                        {fast ? <> · 比时间进度快（已过 {Math.round(pace)}%）</> : null}
                      </>
                    )}
                </div>
              </div>
            );
          })() : null}
          {Object.keys(catBudget).length ? (
            <div className="lg-bars">
              {Object.entries(catBudget).map(([name, bud]) => {
                const used = catUsed(name);
                const over = used > bud;
                const pct = bud > 0 ? (used / bud) * 100 : 0;
                return (
                  <div className="lg-bar" key={name}>
                    <div className="lg-bar-h">
                      <span className="lg-bar-c">{name}</span>
                      <span className="lg-bar-n" style={{ color: over ? 'var(--bad)' : undefined }}>
                        {amt(used)} / {amt(bud)}
                        {over ? <small> · 超 {amt(used - bud)}</small> : <small> · 剩 {amt(bud - used)}</small>}
                      </span>
                    </div>
                    <div className="lg-bar-t">
                      <i style={{ width: `${Math.min(pct, 100)}%`, background: over ? 'var(--bad)' : 'var(--accent)', opacity: 1 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {budgetTotal <= 0 && Object.keys(catBudget).length === 0 ? (
            <div className="empty small">还没设预算。定一个月度总额，或者给餐饮、交通各自定额，超了会标红。</div>
          ) : null}
        </div>

        <div className="card">
          <div className="kpi-grid">
            <div className="kpi">
              <div className="k">收入合计</div>
              <div className="v" style={{ color: 'var(--ok)' }}>{amt(data?.income || 0)}</div>
              <div className="s">进账 {inN} 笔</div>
            </div>
            <div className="kpi">
              <div className="k">支出合计</div>
              <div className="v" style={{ color: 'var(--bad)' }}>{amt(expense)}</div>
              <div className="s">花掉 {outN} 笔</div>
            </div>
            <div className="kpi">
              <div className="k">结余</div>
              <div className="v" style={{ color: (data?.balance || 0) < 0 ? 'var(--bad)' : undefined }}>
                {amt(data?.balance || 0)}
              </div>
              <div className="s">收入减支出</div>
            </div>
            <div className="kpi">
              <div className="k">笔数</div>
              <div className="v">{data?.items.length || 0}<small> 笔</small></div>
              <div className="s">{ym === cur ? '本月至今' : '整月'}</div>
            </div>
          </div>
        </div>

        {/* 第 205 条：九张图。默认展开四张，其余点「看更多」 */}
        <div className="card lg-charts">
          <h3>
            <Icon name="chart" size={14} />账目概览
            <span className="muted">{ym} · 九张图</span>
            <button
              className="btn sm ghost"
              type="button"
              onClick={() => setChartOpen((v) => !v)}
              style={{ marginLeft: 'auto' }}
            >{chartOpen ? '收起' : '展开'}</button>
          </h3>
          {!insight ? (
            <div className="empty small">正在算图…</div>
          ) : !chartOpen ? (
            <div className="small muted">图表已收起。点右上角「展开」回来。</div>
          ) : (
            <>
              <div className="lg-chart-one">
                <div className="lg-chart-title">
                  支出构成
                  <span className="muted">{insight.byCat.length} 个分类 · 合计 {amt(insight.totalOut)}</span>
                </div>
                <Donut items={insight.byCat} total={insight.totalOut} sym={sym} />
              </div>

              <div className="lg-chart-two">
                <div>
                  <div className="lg-chart-title">
                    近十二个月走势
                    <span className="muted">点柱子可以跳到那个月</span>
                  </div>
                  <Trend
                    months={insight.months}
                    sym={sym}
                    active={ym}
                    onPick={(m) => setYm(m)}
                  />
                </div>
                <div>
                  <div className="lg-chart-title">
                    星期分布
                    <span className="muted">一周里哪天最费钱</span>
                  </div>
                  <WeekdayRadar data={insight.weekday} sym={sym} />
                </div>
              </div>

              <div className="lg-chart-two">
                <div>
                  <div className="lg-chart-title">
                    每日支出
                    <span className="muted">{insight.byDay.filter((d) => d.outSum > 0).length} 天有支出</span>
                  </div>
                  <Bars
                    data={insight.byDay.map((d) => ({
                      key: d.date, label: String(d.day), value: d.outSum, tip: d.date,
                    }))}
                    sym={sym}
                  />
                </div>
                <div>
                  <div className="lg-chart-title">
                    按周
                    <span className="muted">当月每周支出</span>
                  </div>
                  <Bars
                    data={insight.byWeek.map((w) => ({
                      key: String(w.week), label: `第${w.week}周`, value: w.outSum,
                      tip: `${w.from} → ${w.to}`,
                    }))}
                    sym={sym}
                  />
                </div>
              </div>

              {chartMore ? (
                <>
                  <div className="lg-chart-two">
                    <div>
                      <div className="lg-chart-title">
                        分类明细
                        <span className="muted">条形长度看金额，右侧看占比</span>
                      </div>
                      <CatBars items={insight.byCat} total={insight.totalOut} sym={sym} />
                    </div>
                    <div>
                      <div className="lg-chart-title">
                        金额最大的几笔
                        <span className="muted">点一行去改它</span>
                      </div>
                      <TopList
                        items={insight.top}
                        sym={sym}
                        onEdit={(id) => {
                          const it = shownItems.find((x) => x.id === id);
                          if (it) setEditItem(it);
                        }}
                      />
                    </div>
                  </div>

                  <div className="lg-chart-one">
                    <div className="lg-chart-title">
                      每日收支对比
                      <span className="muted">红是支出、绿是收入，同一天叠着看</span>
                    </div>
                    <DailyCompare days={insight.byDay} sym={sym} />
                  </div>

                  <div className="lg-chart-two">
                    <div>
                      <div className="lg-chart-title">
                        支出热力图
                        <span className="muted">近 24 周，一格一天</span>
                      </div>
                      <Heatmap cells={insight.heat} sym={sym} from={insight.heatFrom} to={insight.heatTo} />
                    </div>
                    <div>
                      <div className="lg-chart-title">
                        账户余额分布
                        <span className="muted">{insight.accounts.length} 个启用账户</span>
                      </div>
                      <BalanceSplit accounts={insight.accounts} sym={sym} />
                    </div>
                  </div>

                  {/* ================= 第 239 条：再补六张 ================= */}
                  <div className="lg-chart-two">
                    <div>
                      <div className="lg-chart-title">
                        金额分档
                        <span className="muted">按当月分位数切，不是写死的阈值</span>
                      </div>
                      <AmountBuckets data={insight.quart} total={insight.totalOut} sym={sym} />
                    </div>
                    <div>
                      <div className="lg-chart-title">
                        高频小额
                        <span className="muted">笔数最多的分类 —— 单笔小但架不住天天买</span>
                      </div>
                      <FreqList data={insight.catByCount} sym={sym} />
                    </div>
                  </div>

                  <div className="lg-chart-one">
                    <div className="lg-chart-title">
                      分类环比
                      <span className="muted">和上个月比，哪一类悄悄变贵了</span>
                    </div>
                    <CatTrend data={insight.catTrend} sym={sym} />
                  </div>

                  <div className="lg-chart-one">
                    <div className="lg-chart-title">
                      近十二个月 × 分类堆叠
                      <span className="muted">看结构在怎么漂移，鼠标悬停看明细</span>
                    </div>
                    <StackedMonths
                      data={insight.catMonth}
                      topCats={insight.byCat.slice(0, 6).map((c) => c.cat)}
                      sym={sym}
                    />
                  </div>

                  <div className="lg-chart-two">
                    <div>
                      <div className="lg-chart-title">
                        星期场均
                        <span className="muted">平均每笔，不受单笔大额干扰</span>
                      </div>
                      <WeekdayAvg data={insight.weekdayAvg} sym={sym} />
                    </div>
                    <div>
                      <div className="lg-chart-title">
                        一天里什么时候花钱
                        <span className="muted">
                          {insight.hourly.length ? '只有记了时间的账才进得来' : '这个月的账没记时间'}
                        </span>
                      </div>
                      <HourBars data={insight.hourly} sym={sym} />
                    </div>
                  </div>
                </>
              ) : null}

              <button
                className="btn sm"
                type="button"
                onClick={() => setChartMore((v) => !v)}
                style={{ marginTop: 4 }}
              >{chartMore ? '收起后五张' : '看更多图（分类明细 / 最大的几笔 / 收支对比 / 热力图 / 账户分布）'}</button>
            </>
          )}
        </div>

        <div className="card">
          <h3>
            <Icon name="refresh" size={14} />每月固定支出
            <span className="muted">{recurs.filter((r) => r.enabled).length} / {recurs.length} 条启用</span>
            <button className="btn sm" type="button" onClick={openRecurNew}>新增规则</button>
          </h3>
          {recurs.length ? (
            <div>
              {recurs.map((r) => (
                <div className={`lg-rec ${r.enabled ? '' : 'off'}`} key={r.id}>
                  <span className="lg-cat">{r.cat || '未分类'}</span>
                  <span className="lg-rec-note">
                    {r.note || '每月固定'}
                    {r.accountId && accName(r.accountId) ? ` · ${accName(r.accountId)}` : ''}
                  </span>
                  <span className="small muted">每月 {r.day} 号</span>
                  <span className={`lg-amt ${r.kind === 'in' ? 'in' : 'out'}`}>
                    {r.kind === 'in' ? '+' : '-'}{amt(Number(r.amount) || 0)}
                  </span>
                  <button
                    className={`switch ${r.enabled ? 'on' : ''}`}
                    type="button"
                    aria-pressed={!!r.enabled}
                    title={r.enabled ? '停用' : '启用'}
                    onClick={() => void toggleRecur(r)}
                  />
                  <button className="btn sm" type="button" onClick={() => openRecurEdit(r)}>编辑</button>
                  <button className="btn sm danger" type="button" onClick={() => void removeRecur(r)}>删除</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty small">没有固定支出规则。房租、话费、订阅这类每月都一样的，加一条就会自动记进来。</div>
          )}
        </div>

        <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <h3><Icon name="plus" size={14} />记一笔 <span className="muted">填完按回车就能存</span></h3>

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
              inputMode="decimal"
              placeholder="金额"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="inp"
              type="date"
              style={{ width: 160, flex: '0 0 auto' }}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayKey()}
            />
            <select
              className="inp"
              style={{ width: 132, flex: '0 0 auto' }}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              title="归属账户（可空）"
            >
              <option value="">不归属账户</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input
              className="inp"
              style={{ flex: 1, minWidth: 140 }}
              placeholder="备注（可空）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="row lg-cats">
            {cats.map((c) => (
              <button
                type="button"
                key={c}
                className={`chip ${!customOpen && cat === c ? 'on' : ''}`}
                onClick={() => { setCat(c); setCustomOpen(false); }}
              >{c}</button>
            ))}
            <button
              type="button"
              className={`chip ${customOpen ? 'on' : ''}`}
              onClick={() => setCustomOpen(!customOpen)}
              title="自己起一个分类名"
            >自定义</button>
            {customOpen ? (
              <input
                className="inp"
                style={{ width: 130, flex: '0 0 auto' }}
                placeholder="分类名"
                value={customCat}
                onChange={(e) => setCustomCat(e.target.value)}
              />
            ) : null}
            <div style={{ flex: 1 }} />
            <button className="btn primary" type="submit">存下来</button>
          </div>
        </form>

        {/* 第 159 条：账单多了以后总得能筛能排 */}
        <div className="card lg-filter">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="seg">
              <button type="button" className={`seg-b ${fKind === 'all' ? 'on' : ''}`} onClick={() => setFKind('all')}>全部</button>
              <button type="button" className={`seg-b ${fKind === 'out' ? 'on' : ''}`} onClick={() => setFKind('out')}>支出</button>
              <button type="button" className={`seg-b ${fKind === 'in' ? 'on' : ''}`} onClick={() => setFKind('in')}>收入</button>
            </div>
            <select className="inp" style={{ width: 130, flex: '0 0 auto' }} value={fCat} onChange={(e) => setFCat(e.target.value)}>
              <option value="">全部分类</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="searchbox" style={{ flex: '1 1 150px', minWidth: 130, padding: '5px 10px' }}>
              <Icon name="search" size={13} />
              <input placeholder="搜备注或分类" value={fKw} onChange={(e) => setFKw(e.target.value)} />
              {fKw ? <button className="sb-clear" onClick={() => setFKw('')}>✕</button> : null}
            </div>
            <div className="seg">
              <button type="button" className={`seg-b ${sortBy === 'date' ? 'on' : ''}`} onClick={() => setSortBy('date')} data-tip="按日期，新的在前">按日期</button>
              <button type="button" className={`seg-b ${sortBy === 'amount' ? 'on' : ''}`} onClick={() => setSortBy('amount')} data-tip="按金额，大的在前">按金额</button>
            </div>
            <button type="button" className="btn sm" onClick={() => setCatMgr(true)} data-tip="改名或删掉用不上的分类">
              <Icon name="sliders" size={12} />分类
            </button>
            <span className="small muted" style={{ marginLeft: 'auto' }}>{shownItems.length} 笔</span>
          </div>
        </div>

        {groups.length ? (
          groups.map((g) => (
            <div className="card lg-day" key={g.date}>
              <div className="lg-day-h">
                <span className="lg-day-d">{g.date ? dayLabel(g.date) : '按金额从大到小'}</span>
                <span className="small muted">
                  {g.outSum > 0 ? `支出 ${amt(g.outSum)}` : ''}
                  {g.outSum > 0 && g.inSum > 0 ? ' · ' : ''}
                  {g.inSum > 0 ? `收入 ${amt(g.inSum)}` : ''}
                </span>
              </div>
              {g.items.map((it) => (
                <div className="lg-item" key={it.id}>
                  <span className="lg-cat">{it.cat || '未分类'}</span>
                  <span className="lg-note">{it.note || '—'}</span>
                  {it.accountId && accName(it.accountId) ? <span className="lg-acc-tag">{accName(it.accountId)}</span> : null}
                  <span className={`lg-amt ${it.kind === 'in' ? 'in' : 'out'}`}>
                    {it.kind === 'in' ? '+' : '-'}{amt(Number(it.amount) || 0)}
                  </span>
                  <button
                    className="btn sm ghost lg-edit"
                    type="button"
                    onClick={() => setEditItem(it)}
                  >改</button>
                  <button
                    className="btn sm ghost lg-del"
                    type="button"
                    title="删除这一笔"
                    onClick={() => void remove(it)}
                  >删除</button>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="card">
            <div className="empty">
              {loading ? '正在读账目…'
                : (data?.items || []).length
                  ? '没有符合筛选条件的账。把条件放宽一点试试。'
                  : '这个月还一笔没记。先在上面填个金额按回车，餐饮、交通、房租这些都能单独看占比。'}
            </div>
          </div>
        )}
      </div>

      {editItem ? (
        <LedgerEdit
          it={editItem}
          cats={cats}
          accounts={accounts}
          onClose={() => setEditItem(null)}
          onDone={async () => { setEditItem(null); await load(ym); await loadAccounts(); toast('已保存'); }}
        />
      ) : null}

      {catMgr ? (
        <Dialog
          title="分类管理"
          onClose={() => setCatMgr(false)}
          footer={<button className="btn" type="button" onClick={() => setCatMgr(false)}>关闭</button>}
        >
          <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.7 }}>
            改名会把这个分类下的所有流水一起改；删掉会把它们归到「其他」，账本身不会消失。
          </div>
          <div ref={catDrag.boxRef}>
          {catOrder.length ? catOrder.map((c, ci) => (
            <CatRow
              key={c}
              name={c}
              drag={catDrag.props(ci)}
              onRename={async (to) => {
                const v = to.trim();
                if (!v || v === c) return;
                await api.ledgerCatRename(c, v);
                await load(ym);
                await loadRecur();
                toast(`「${c}」已改名为「${v}」`);
              }}
              onDrop={async () => {
                await api.ledgerCatDrop(c, '其他');
                await load(ym);
                await loadRecur();
                toast(`「${c}」已并入「其他」`);
              }}
            />
          )) : <div className="empty small">这个月还没有带分类的账。</div>}
          </div>
        </Dialog>
      ) : null}

      {accOpen ? (
        <Dialog
          title="账户管理"
          wide
          onClose={() => setAccOpen(false)}
          footer={<>
            <button className="btn" type="button" onClick={() => setAccOpen(false)}>关闭</button>
            <button
              className="btn primary"
              type="button"
              onClick={() => setAccDraft((prev) => [
                ...prev, { id: '', name: '', kind: '现金', init: '0', currency: '', note: '', enabled: 1, open: true },
              ])}
            >新增账户</button>
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
                <b>{amt(accounts.reduce((n, a) => n + (a.balance || 0), 0))}</b>
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

          <div ref={accDrag.boxRef} className="lg-acclist">
          {accDraft.length ? accDraft.map((row, i) => {
            const saved = !!row.id;
            // 拖动的 key 只认已保存的账户；新行还没 id，让它留在原位
            const dragProps = saved ? accDrag.props(accKeys.indexOf(row.id)) : null;
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
                    onChange={(e) => patchAcc(i, { name: e.target.value })}
                  />
                  {/* 第 221 条：类型可自定义 —— 用 datalist 而不是 select */}
                  <input
                    className="inp"
                    list="lg-acckind-list"
                    style={{ width: 100, flex: '0 0 auto' }}
                    placeholder="类型"
                    value={row.kind}
                    onChange={(e) => patchAcc(i, { kind: e.target.value })}
                    title="可以选预设，也可以自己填一个"
                  />
                  <input
                    className="inp"
                    style={{ width: 110, flex: '0 0 auto' }}
                    type="number"
                    step="0.01"
                    placeholder="初始金额"
                    value={row.init}
                    onChange={(e) => patchAcc(i, { init: e.target.value })}
                  />
                  <span className="small muted" style={{ width: 56, textAlign: 'right' }}>
                    {saved ? amt(bal) : '新账户'}
                  </span>
                  <button
                    className="btn sm ghost"
                    type="button"
                    title="币种 / 备注"
                    onClick={() => patchAcc(i, { open: !row.open })}
                  ><Icon name={row.open ? 'up' : 'down'} size={12} /></button>
                  <button className="btn sm primary" type="button" onClick={() => void saveAccRow(i)}>保存</button>
                  <button className="btn sm danger" type="button" onClick={() => void delAccRow(i)}>
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
                      onChange={(e) => patchAcc(i, { currency: e.target.value.toUpperCase() })}
                      maxLength={6}
                    />
                    <span className="small muted" style={{ width: 40 }}>备注</span>
                    <input
                      className="inp"
                      style={{ flex: '1 1 140px', minWidth: 100 }}
                      placeholder="这张卡是干什么用的（可空）"
                      value={row.note}
                      onChange={(e) => patchAcc(i, { note: e.target.value })}
                    />
                    {saved ? (
                      <button
                        className={`switch ${row.enabled ? 'on' : ''}`}
                        type="button"
                        aria-pressed={!!row.enabled}
                        title={row.enabled ? '停用（记账时不出现）' : '启用'}
                        onClick={() => void toggleAcc(row)}
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
      ) : null}

      {budgetOpen ? (
        <Dialog
          title="月度预算"
          wide
          onClose={() => setBudgetOpen(false)}
          footer={<>
            <button className="btn" type="button" onClick={() => setBudgetOpen(false)}>取消</button>
            <button className="btn primary" type="button" onClick={() => void saveBudget()}>保存</button>
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
              value={bTotal}
              onChange={(e) => setBTotal(e.target.value)}
            />
            <span className="small muted">每月支出上限，超了这里会标红。</span>
          </div>
          <div className="small muted" style={{ marginBottom: 8 }}>分类预算</div>
          <datalist id="lg-cat-list">
            {cats.map((c) => <option key={c} value={c} />)}
          </datalist>
          {bCats.map((row, i) => (
            <div className="row" key={i} style={{ marginBottom: 8 }}>
              <input
                className="inp"
                style={{ flex: '1 1 140px', minWidth: 120 }}
                list="lg-cat-list"
                placeholder="分类名"
                value={row.cat}
                onChange={(e) => setBCats((prev) => prev.map((x, k) => (k === i ? { ...x, cat: e.target.value } : x)))}
              />
              <input
                className="inp"
                style={{ width: 140, flex: '0 0 auto' }}
                type="number"
                step="0.01"
                min="0"
                placeholder="金额"
                value={row.amount}
                onChange={(e) => setBCats((prev) => prev.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))}
              />
              <button
                className="btn sm danger"
                type="button"
                onClick={() => setBCats((prev) => prev.filter((_, k) => k !== i))}
              >删除</button>
            </div>
          ))}
          <button
            className="btn sm"
            type="button"
            onClick={() => setBCats((prev) => [...prev, { cat: '', amount: '' }])}
          >加一个分类</button>
        </Dialog>
      ) : null}

      {recOpen ? (
        <Dialog
          title={recId ? '改固定支出' : '新增固定支出'}
          wide
          onClose={() => { setRecOpen(false); setRecId(null); }}
          footer={<>
            <button className="btn" type="button" onClick={() => { setRecOpen(false); setRecId(null); }}>取消</button>
            <button className="btn primary" type="button" onClick={() => void saveRecur()}>{recId ? '保存' : '添加'}</button>
          </>}
        >
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="seg">
              <button type="button" className={`seg-b ${rKind === 'out' ? 'on' : ''}`} onClick={() => setRKind('out')}>支出</button>
              <button type="button" className={`seg-b ${rKind === 'in' ? 'on' : ''}`} onClick={() => setRKind('in')}>收入</button>
            </div>
            <input
              className="inp lg-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="金额"
              value={rAmount}
              onChange={(e) => setRAmount(e.target.value)}
            />
            <input
              className="inp"
              style={{ flex: 1, minWidth: 140 }}
              placeholder="备注（可空）"
              value={rNote}
              onChange={(e) => setRNote(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="small muted" style={{ width: 34 }}>分类</span>
            {cats.map((c) => (
              <button
                type="button"
                key={c}
                className={`chip ${rCat === c ? 'on' : ''}`}
                onClick={() => setRCat(c)}
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
              value={rDay}
              onChange={(e) => setRDay(e.target.value)}
            />
            <span className="small muted">1 到 31；当月没这一天就记在月末（比如 31 号在 2 月就是 28 号）</span>
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 62 }}>账户</span>
            <select
              className="inp"
              style={{ width: 150, flex: '0 0 auto' }}
              value={rAcc}
              onChange={(e) => setRAcc(e.target.value)}
            >
              <option value="">不归属账户</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className={`switch ${rEnabled ? 'on' : ''}`}
              aria-pressed={rEnabled}
              onClick={() => setREnabled(!rEnabled)}
              title={rEnabled ? '启用中' : '已停用'}
            />
            <span className="small">{rEnabled ? '每月自动记入' : '先存着，不自动记'}</span>
          </div>
        </Dialog>
      ) : null}

      <style>{`
        .lg-amount{width:130px;flex:0 0 auto;font-size:16px;font-variant-numeric:tabular-nums}
        .lg-cats{gap:6px}
        .lg-bars{display:flex;flex-direction:column;gap:9px}
        .lg-bar-h{display:flex;align-items:baseline;gap:8px;margin-bottom:4px}
        .lg-bar-c{font-size:12.5px;color:var(--ink2)}
        .lg-bar-n{margin-left:auto;font-size:12px;color:var(--ink3);font-variant-numeric:tabular-nums}
        .lg-bar-t{height:7px;border-radius:4px;background:var(--panel2);overflow:hidden}
        .lg-bar-t i{display:block;height:100%;border-radius:4px;background:var(--accent);opacity:.75;transition:width .2s}
        .lg-bar-s{font-size:11.5px;margin-top:4px}
        .lg-accs{display:flex;gap:10px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin}
        .lg-acc{flex:0 0 auto;min-width:132px;padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:var(--panel2)}
        .lg-acc-n{font-size:12px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .lg-acc-v{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:3px}
        .lg-acc-k{font-size:10.5px;color:var(--ink3);margin-top:2px}
        .lg-accrow{margin-bottom:8px;flex-wrap:nowrap}
        .lg-rec{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line2)}
        .lg-rec:last-child{border-bottom:0}
        .lg-rec.off{opacity:.5}
        .lg-rec-note{font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
        .lg-acc-tag{font-size:10.5px;padding:1px 6px;border-radius:5px;border:1px solid var(--line);color:var(--ink3);flex:0 0 auto}
        .lg-day{padding:12px 16px}
        .lg-day-h{display:flex;align-items:baseline;gap:10px;padding-bottom:7px;border-bottom:1px dashed var(--line2);margin-bottom:2px}
        .lg-day-d{font-size:12.5px;color:var(--ink2);letter-spacing:.04em}
        .lg-item{display:flex;align-items:center;gap:10px;padding:7px 0}
        .lg-item + .lg-item{border-top:1px solid var(--line2)}
        .lg-cat{font-size:12px;padding:1px 7px;border-radius:6px;background:var(--panel2);color:var(--ink2);flex:0 0 auto}
        .lg-note{font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
        .lg-amt{font-size:14px;font-variant-numeric:tabular-nums;font-weight:600;flex:0 0 auto}
        .lg-amt.out{color:var(--bad)}
        .lg-amt.in{color:var(--ok)}
        .lg-del{opacity:.45;transition:.12s}
        .lg-item:hover .lg-del{opacity:1}
      `}</style>
    </>
  );
}

/* ---------------- 改一笔（第 159 条） ---------------- */

function LedgerEdit({
  it, cats, accounts, onClose, onDone,
}: {
  it: LedgerItem;
  cats: string[];
  accounts: AccountItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<'in' | 'out'>(it.kind === 'in' ? 'in' : 'out');
  const [amount, setAmount] = useState(String(Number(it.amount) || ''));
  const [date, setDate] = useState(it.date);
  const [cat, setCat] = useState(it.cat || '其他');
  const [note, setNote] = useState(it.note || '');
  const [accountId, setAccountId] = useState(it.accountId || '');

  const save = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { toast('金额要大于 0'); return; }
    if (!date) { toast('挑个日期'); return; }
    await api.ledgerUpdate({ id: it.id, kind, amount: n, date, cat: cat.trim() || '其他', note, accountId });
    onDone();
  };

  return (
    <Dialog
      title="改这一笔"
      onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>取消</button>
        <button className="btn primary" type="button" onClick={() => void save()}>保存</button>
      </>}
    >
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="seg">
          <button type="button" className={`seg-b ${kind === 'out' ? 'on' : ''}`} onClick={() => setKind('out')}>支出</button>
          <button type="button" className={`seg-b ${kind === 'in' ? 'on' : ''}`} onClick={() => setKind('in')}>收入</button>
        </div>
        <input
          className="inp lg-amount"
          type="number" step="0.01" min="0" inputMode="decimal"
          value={amount} onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>日期</label>
          <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>分类</label>
          <input
            className="inp" list="lg-edit-cats" value={cat}
            onChange={(e) => setCat(e.target.value)}
          />
          <datalist id="lg-edit-cats">
            {cats.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      <div className="field">
        <label>账户（可不选）</label>
        <select className="inp" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">不归属账户</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>备注</label>
        <input className="inp" value={note} placeholder="可空" onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ---------------- 分类管理的一行 ---------------- */

function CatRow({ name, onRename, onDrop, drag }: {
  name: string;
  onRename: (to: string) => Promise<void>;
  onDrop: () => Promise<void>;
  /** 第 202 条：分类也能拖着换顺序 */
  drag?: {
    className: string;
    draggable: boolean;
    'data-dragkey': string;
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(name);
  return (
    <div
      className={`row lg-catrow ${drag?.className || ''}`}
      data-dragkey={drag?.['data-dragkey']}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      data-cat={name}
    >
      <span className="lg-grip" title="按住拖动换顺序"><Icon name="grip" size={13} /></span>
      {editing ? (
        <>
          <input className="inp" style={{ flex: 1 }} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
          <button className="btn sm primary" type="button" onClick={async () => { setEditing(false); await onRename(v); }}>存</button>
          <button className="btn sm" type="button" onClick={() => { setEditing(false); setV(name); }}>算了</button>
        </>
      ) : (
        <>
          <span className="n">{name}</span>
          <button className="btn sm" type="button" onClick={() => setEditing(true)}>改名</button>
          <button
            className="btn sm danger"
            type="button"
            onClick={async () => {
              if (!window.confirm(`把「${name}」并进「其他」？账不会丢，只是换个分类。`)) return;
              await onDrop();
            }}
          >删掉</button>
        </>
      )}
    </div>
  );
}
