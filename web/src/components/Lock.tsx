import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Dialog, askText, askConfirm } from './ui';
import { Icon } from './Icons';
import type { VaultQa } from '../types';

/** 带显示/隐藏的密码输入 */
export function PasswordField({
  value, onChange, onEnter, placeholder = '输入密码', autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="pwfield">
      <Icon name="lock" size={15} />
      <input
        type={show ? 'text' : 'password'}
        className="inp"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
      />
      {/* 只留一个眼睛图标（以前图标 +「显示」文字重复），且不参与 Tab ——
          否则输完第一个框按 Tab 会先跳到眼睛上，用户以为跳不过去 */}
      <button
        type="button"
        className="pweye"
        tabIndex={-1}
        onClick={() => setShow(!show)}
        title={show ? '隐藏密码' : '显示密码'}
        aria-label={show ? '隐藏密码' : '显示密码'}
      >
        <Icon name="eye-off" size={15} />
      </button>
    </div>
  );
}

/** 解锁面板：失败会标红抖动，成功回调 */
export function UnlockBox({
  scope, target, label, onOk,
}: {
  scope: string;
  target?: string;
  label?: string;
  onOk: () => void;
}) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [forgot, setForgot] = useState(false);
  const vault = useStore((s) => s.vault);
  const reloadVault = useStore((s) => s.reloadVault);
  const toast = useStore((s) => s.toast);

  // 提示和密保数量自己拉一次：锁屏出现的时机不一定紧跟在「设置 → 安全」之后，
  // 只依赖 store 里那份可能有缓存，用户会看到「提示为空、也没有找回入口」。
  const [meta, setMeta] = useState<{ hint: string; qa: number }>({
    hint: vault?.hint || '', qa: vault?.qaCount || 0,
  });
  useEffect(() => {
    void api.vault.status()
      .then((v) => setMeta({ hint: v.hint || '', qa: v.qaCount || 0 }))
      .catch(() => null);
  }, []);

  const hint = meta.hint.trim();
  const qaCount = meta.qa;

  const submit = async () => {
    if (!pw) { setErr('请输入密码'); return; }
    setBusy(true);
    setErr('');
    const r = await api.vault.unlock(scope, target ?? '', pw).catch((e) => ({ ok: false, err: (e as Error).message }));
    setBusy(false);
    if (r.ok) { setPw(''); onOk(); }
    else { setErr(r.err || '密码不正确'); setShake((n) => n + 1); }
  };

  return (
    <div className="unlock" key={shake}>
      <div className="unlock-ic"><Icon name="lock" size={22} /></div>
      <div className="unlock-t">这一块被保护了</div>
      <div className="unlock-s">{label || '需要密码才能查看'}</div>
      <PasswordField value={pw} onChange={setPw} onEnter={() => void submit()} autoFocus />
      {err ? <div className="unlock-err">{err}</div> : null}
      <button className="btn primary" disabled={busy} onClick={() => void submit()}>
        {busy ? '验证中…' : '解锁'}
      </button>
      {hint ? <div className="unlock-hint">提示：{hint}</div> : null}
      <div className="unlock-links">
        {qaCount > 0 ? (
          <button className="linkbtn" onClick={() => setForgot(true)}>忘记密码？用密保问题找回</button>
        ) : null}
        <button
          className="linkbtn"
          onClick={async () => {
            if (!(await askConfirm('清掉全部密码保护？', {
              body: '会删除主密码、所有加锁规则与密保问题。\n\n日记、待办、笔记等内容一条都不会删，但之后任何人都能直接打开。',
              ok: '清掉',
            }))) return;
            const v = await askText('输入主密码确认（没有主密码就留空）', '', '清空保护需要确认');
            if (v === null) return;
            const r = await api.vault.clearMain(v).catch((e) => ({ ok: false, err: (e as Error).message }));
            if (!r.ok) { toast(r.err || '密码不正确'); return; }
            await reloadVault();
            toast('密码保护已关闭');
            onOk();
          }}
        >实在想不起来：清掉保护</button>
      </div>
      <div className="unlock-note">密码只存在这台电脑上；数据文件本身不加密</div>

      {forgot ? <ForgotDialog scope={scope} target={target} onClose={() => setForgot(false)} onOk={onOk} /> : null}
    </div>
  );
}

/**
 * 忘记密码：提示 → 密保问题 → 重设主密码 / 清掉保护。
 * 安全边界写清楚：独立密码的规则不能被密保绕过（那是另一把钥匙）。
 */
export function ForgotDialog({
  scope, target = '', onClose, onOk,
}: {
  scope: string;
  target?: string;
  onClose: () => void;
  onOk: () => void;
}) {
  const vault = useStore((s) => s.vault);
  const reloadVault = useStore((s) => s.reloadVault);
  const toast = useStore((s) => s.toast);

  const [qa, setQa] = useState<VaultQa[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [step, setStep] = useState<'ask' | 'reset'>('ask');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [np, setNp] = useState('');
  const [np2, setNp2] = useState('');
  const [clearMode, setClearMode] = useState(false);

  useEffect(() => {
    void api.vault.qaList().then((list) => {
      setQa(list);
      setAnswers(list.map(() => ''));
    }).catch(() => null);
  }, []);

  const verify = async () => {
    setBusy(true);
    setErr('');
    const r = await api.vault.qaVerify(answers).catch((e) => ({ ok: false, matched: 0, total: qa.length, err: (e as Error).message }));
    setBusy(false);
    if (r.ok) setStep('reset');
    else setErr(r.err || `${r.matched}/${r.total} 个答案正确，全部答对才能重设`);
  };

  const reset = async () => {
    if (!clearMode) {
      if (np.length < 4) { setErr('新密码至少 4 位'); return; }
      if (np !== np2) { setErr('两次输入不一致'); return; }
    }
    setBusy(true);
    const r = await api.vault.qaReset(answers, clearMode ? '' : np).catch((e) => ({ ok: false, err: (e as Error).message }));
    setBusy(false);
    if (!r.ok) { setErr(r.err || '重设失败'); return; }
    await reloadVault();
    if (clearMode) {
      toast('已清掉密码保护，内容都还在');
      onClose();
      onOk();
      return;
    }
    // 用新密码立刻解掉当前这块，省得再输一遍
    const u = await api.vault.unlock(scope, target, np).catch(() => ({ ok: false }));
    toast(u.ok ? '密码已重设，这一块已解锁' : '密码已重设，请用新密码解锁');
    onClose();
    if (u.ok) onOk();
  };

  return (
    <Dialog
      title="找回密码"
      onClose={onClose}
      footer={step === 'ask' ? (
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={() => void verify()}>
            {busy ? '核对中…' : '核对答案'}
          </button>
        </>
      ) : (
        <>
          <button className="btn" onClick={() => setStep('ask')}>上一步</button>
          <span className="sp" />
          <button className="btn primary" disabled={busy} onClick={() => void reset()}>
            {busy ? '处理中…' : (clearMode ? '清掉全部保护' : '重设密码并解锁')}
          </button>
        </>
      )}
    >
      {step === 'ask' ? (
        <>
          <div className="small muted" style={{ lineHeight: 1.9, marginBottom: 10 }}>
            {vault?.hint ? <>密码提示：<b>{vault.hint}</b><br /></> : '没有设置密码提示。<br />'}
            回答下面全部问题后可以重设主密码。答案在当初设置时就只存了哈希，这里同样无法回显。
          </div>
          {qa.length ? qa.map((q, i) => (
            <div key={q.id} style={{ marginBottom: 10 }}>
              <div className="small" style={{ marginBottom: 4 }}>{i + 1}. {q.question}</div>
              <input
                className="inp"
                style={{ width: '100%' }}
                value={answers[i] || ''}
                onChange={(e) => setAnswers((a) => { const n = a.slice(); n[i] = e.target.value; return n; })}
                placeholder="你的答案"
              />
            </div>
          )) : <div className="empty small">还没设置密保问题，没法自助找回。可以回退后用「清掉保护」。</div>}
          {err ? <div className="small" style={{ color: 'var(--bad)' }}>{err}</div> : null}
        </>
      ) : (
        <>
          <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
            答案正确。这里改的是<b>主密码</b>；用独立密码加锁的范围不受影响，仍要各自那把钥匙。
          </div>
          <label className="row" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={clearMode} onChange={(e) => setClearMode(e.target.checked)} />
            <span>不设新密码，直接清掉全部密码保护</span>
          </label>
          {!clearMode ? (
            <>
              <PasswordField value={np} onChange={setNp} placeholder="新主密码（至少 4 位）" autoFocus />
              <div style={{ height: 8 }} />
              <PasswordField value={np2} onChange={setNp2} placeholder="再输一次" />
            </>
          ) : (
            <div className="small" style={{ color: 'var(--bad)', lineHeight: 1.8 }}>
              会删除主密码、所有加锁规则和密保问题。日记等内容一条都不会删，但之后谁也拦不住。
            </div>
          )}
          {err ? <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{err}</div> : null}
        </>
      )}
    </Dialog>
  );
}

/**
 * 从已知的保护规则里同步判断「这个范围需不需要查」。
 * 没配规则就直接放行，连一次 RPC 都不发 —— 否则每次切日期都会闪一下「检查权限…」，
 * 日期栏被短暂卸载，输入到一半的内容也会跟着重挂。
 */
function ruleExists(rules: { scope: string; target: string }[], scope: string, target: string): boolean {
  if (!rules.length) return false;
  const direct = rules.some((r) => r.scope === scope && (r.target === target || r.target === ''));
  if (direct) return true;
  if (scope !== 'diary') return false;
  // 日记还受「一段日期」约束
  return rules.some((r) => {
    if (r.scope !== 'diaryRange') return false;
    const parts = (r.target || '').split('~');
    if (parts.length !== 2) return false;
    return target >= parts[0] && target <= parts[1];
  });
}

/**
 * 受保护区域：进入时先问后端「这块锁着吗」，锁着就显示解锁面板。
 * scope / target 与 vault 规则一一对应（app / todos / diary / diaryRange / notebook / note …）。
 */
export function Guarded({
  scope, target = '', label, children, mode = 'block', onUnlocked,
}: {
  scope: string;
  target?: string;
  label?: string;
  children: ReactNode;
  /** block = 整块替换；overlay = 内容模糊 + 覆盖 */
  mode?: 'block' | 'overlay';
  /**
   * 解锁成功后立刻回调。
   *
   * 为什么必须有这个钩子：数据层现在会**在锁着的时候返回空内容**
   * （#244 衍生：entry.get 也堵上了）。如果解锁后不重新拉一次，
   * 前端手里的草稿还是那份空的 —— 用户看到的是一片空白，
   * 而且一打字就会把空草稿写回库，**把真实内容覆盖掉**。
   * 锁是为了保护内容，不能反过来造成丢失。
   */
  onUnlocked?: () => void;
}) {
  const vault = useStore((s) => s.vault);
  const rules = vault?.rules ?? [];
  const need = ruleExists(rules, scope, target);

  // 没配规则 = 直接渲染，零延迟、零闪烁
  const [state, setState] = useState<'checking' | 'locked' | 'ok'>(need ? 'checking' : 'ok');

  const check = useCallback(async () => {
    if (!need) { setState('ok'); return; }
    try {
      const r = await api.vault.check(scope, target);
      setState(r.locked ? 'locked' : 'ok');
    } catch {
      setState('ok');   // 密码功能异常不应挡住正常使用
    }
  }, [scope, target, need]);

  useEffect(() => { void check(); }, [check, vault]);

  // 规则被删掉后立刻放开，不用等下一次请求
  useEffect(() => { if (!need) setState('ok'); }, [need]);

  if (state === 'checking') return <div className="empty small">检查权限…</div>;
  if (state === 'ok') return <>{children}</>;
  /* 解锁成功：先让外层把数据重新拉回来，再放行内容 */
  const ok = () => { setState('ok'); onUnlocked?.(); };
  if (mode === 'overlay') {
    return (
      <div className="guarded-wrap">
        <div className="guarded-blur">{children}</div>
        <div className="guarded-mask"><UnlockBox scope={scope} target={target} label={label} onOk={ok} /></div>
      </div>
    );
  }
  return <UnlockBox scope={scope} target={target} label={label} onOk={ok} />;
}

/** 全软件锁屏 */
export function AppLockScreen() {
  const setAppLocked = useStore((s) => s.setAppLocked);
  const setDate = useStore((s) => s.setDate);
  const date = useStore((s) => s.date);
  const vault = useStore((s) => s.vault);

  /*
   * 第 146 条的救援出口。
   * 老版本允许在没有主密码的情况下锁定，结果整个软件卡在锁屏上：
   * 没有密码可比对，输什么都提示「主密码不正确」。
   * 这里给一条明确的出路，不然用户只能删数据目录。
   */
  if (!vault?.hasMain) {
    return (
      <div className="lockscreen">
        <div className="lockcard">
          <div className="brand-mark">签</div>
          <div className="lockscreen-t">日签已锁定</div>
          <div className="small muted" style={{ margin: '10px 0 18px', lineHeight: 1.7 }}>
            这台电脑还没设置主密码，所以没有东西需要验证。<br />
            直接进去就行；想用应用锁，去「设置 → 安全与密码」设一个。
          </div>
          <button
            className="btn primary"
            onClick={() => {
              setAppLocked(false);
              void setDate(date);
            }}
          >
            直接进入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lockscreen">
      <div className="lockcard">
        <div className="brand-mark">签</div>
        <div className="lockscreen-t">日签已锁定</div>
        <UnlockBox
          scope="app"
          label="输入全软件密码"
          onOk={() => {
            setAppLocked(false);
            void setDate(date);
          }}
        />
      </div>
    </div>
  );
}

/** 让用户设置/修改某条保护规则 */
export async function askProtect(scope: string, target: string, label: string) {
  const { askText } = await import('./ui');
  const v = await askText(`为「${label}」设置密码`, '', '留空 = 用主密码');
  if (v === null) return false;
  const r = await api.vault.add({ scope, target, label, password: v });
  /*
   * 加完必须把规则的缓存刷一下。
   *
   * <Guarded> 靠 store 里的 vault.rules 判断「这个对象有没有加锁」，
   * 不刷新的话它拿到的还是加锁前的空规则表，于是整块内容照常渲染 ——
   * 用户看到的现象就是「点了加密码，什么也没发生，照样能看」。
   */
  if (r.ok) await useStore.getState().reloadVault().catch(() => null);
  return !!r.ok;
}
