import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Icon } from '../components/Icons';
import type { DiagStats } from '../types';

/**
 * 诊断日志面板。
 *
 * 放这里的理由很直接：用户报「出错了」，第一件事应该是让他自己能把日志发给我，
 * 而不是让他去 `%LOCALAPPDATA%\Riqian\logs` 里翻文件 —— 大多数人不会翻。
 *
 * 三块功能：
 *  1. 看：按级别筛、按天换、显示最近 N 行
 *  2. 调：日志级别和保留天数（排障时临时调到 Trace，平时留 Info）
 *  3. 取：一键复制/导出，方便发给我
 */
export function DiagPanel() {
  const toast = useStore((s) => s.toast);
  const [stats, setStats] = useState<DiagStats | null>(null);
  const [text, setText] = useState('');
  const [day, setDay] = useState('');
  const [onlyIssue, setOnlyIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState('Info');
  const [keep, setKeep] = useState(14);

  const load = useCallback(async (d: string, lines = 400) => {
    setBusy(true);
    try {
      const r = await api.diagLogs(lines, d);
      setText(r.text || '');
      setStats(r.stats);
      setLevel(r.stats?.minLevel || 'Info');
      setKeep(r.stats?.keepDays ?? 14);
    } catch (e) {
      setText('读取失败：' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(''); }, [load]);

  /** 只看 WRN / ERR / FTL：排障时 95% 的时间都在看这几行 */
  const shown = useMemo(() => {
    if (!text) return '';
    if (!onlyIssue) return text;
    return text
      .split('\n')
      .filter((l) => / (WRN|ERR|FTL) /.test(l) || /^ {2,}|^ {6}/.test(l))
      .join('\n');
  }, [text, onlyIssue]);

  const lineCount = shown ? shown.split('\n').length : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      toast(`已复制 ${lineCount} 行`);
    } catch {
      toast('复制失败，试试下面的「导出」');
    }
  };

  const save = async () => {
    // 前端生成 Blob 走浏览器下载。日志不值得为它开一个宿主 RPC，
    // 而且这样天然支持「在别处粘贴」的用法。
    try {
      const name = `日签日志-${day || new Date().toISOString().slice(0, 10)}.txt`;
      const blob = new Blob([shown], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已导出到下载目录');
    } catch (e) {
      toast('导出失败：' + (e as Error).message);
    }
  };

  const setCfg = async (patch: { level?: string; keepDays?: number }) => {
    try {
      const r = await api.diagConfig(patch);
      setLevel(r.level);
      setKeep(r.keepDays);
      toast(`已设为 ${r.level} · 保留 ${r.keepDays} 天`);
      void load(day);
    } catch (e) {
      toast('设置失败：' + (e as Error).message);
    }
  };

  const ping = async () => {
    await api.diagFrontend({ level: 'info', src: 'selftest', msg: '这是一条测试日志，看到它说明通道正常' });
    await load(day);
    toast('已写入一条测试日志');
  };

  return (
    <div className="diag">
      {/* ---------- 统计 ---------- */}
      <div className="diag-stats">
        <Stat label="错误" v={stats?.error ?? 0} tone={stats?.error ? 'bad' : ''} />
        <Stat label="警告" v={stats?.warn ?? 0} tone={stats?.warn ? 'warn' : ''} />
        <Stat label="信息" v={stats?.info ?? 0} />
        <Stat label="总计" v={stats?.total ?? 0} />
        {stats?.writeFailures ? <Stat label="写盘失败" v={stats.writeFailures} tone="bad" /> : null}
      </div>

      {/* ---------- 工具条 ---------- */}
      <div className="diag-bar">
        <select
          className="inp" style={{ width: 132 }}
          value={day}
          onChange={(e) => { setDay(e.target.value); void load(e.target.value); }}
        >
          <option value="">今天</option>
          {(stats?.files || []).map((f) => (
            <option key={f.name} value={f.name.replace('.log', '')}>
              {f.name.replace('.log', '')}（{Math.round(f.bytes / 1024)}K）
            </option>
          ))}
        </select>
        <button
          className={`chip ${onlyIssue ? 'on' : ''}`}
          onClick={() => setOnlyIssue((v) => !v)}
          title="只显示警告和错误，跳过 INFO 噪音"
        >只看问题</button>
        <button className="chip" onClick={() => void load(day)} disabled={busy}>
          <Icon name="refresh" size={11} />{busy ? '读取中' : '刷新'}
        </button>
        <span className="grow" />
        <button className="chip" onClick={() => void ping()} title="写一条测试日志，确认通道是通的">自检</button>
        <button className="chip" onClick={() => void copy()}>复制</button>
        <button className="chip" onClick={() => void save()}>导出</button>
      </div>

      {/* ---------- 日志正文 ---------- */}
      <pre className="diag-body">{shown || (busy ? '读取中…' : '今天还没有日志。')}</pre>

      {/* ---------- 配置 ---------- */}
      <div className="diag-cfg">
        <label>
          <span>记录级别</span>
          <select
            className="inp" style={{ width: 128 }}
            value={level}
            onChange={(e) => void setCfg({ level: e.target.value })}
          >
            <option value="Trace">Trace（最详细）</option>
            <option value="Info">Info（推荐）</option>
            <option value="Warn">Warn</option>
            <option value="Error">Error</option>
          </select>
        </label>
        <label>
          <span>保留天数</span>
          <input
            className="inp" type="number" min={1} max={365} style={{ width: 74 }}
            value={keep}
            onChange={(e) => setKeep(Number(e.target.value) || 14)}
            onBlur={() => void setCfg({ keepDays: keep })}
          />
        </label>
        <span className="grow" />
        <button className="chip" onClick={() => void api.diagOpenDir()} title="打开日志所在文件夹">打开目录</button>
      </div>

      <div className="small muted" style={{ marginTop: 6, lineHeight: 1.8 }}>
        日志存在 <code>{stats?.dir || '%LOCALAPPDATA%\\Riqian\\logs'}</code>。
        排障时把「记录级别」临时调到 Trace，复现一次再调回 Info ——
        Trace 会连每次调用的参数一起记下来，日志会长得很快。
      </div>

      <AiGateway />
    </div>
  );
}

/* ============================================================================
 * AI 调试网关开关
 * ----------------------------------------------------------------------------
 * 这块是给「让外面的 AI 直接操作日签」用的。默认关着，理由写在 DebugApi.cs 顶上：
 * 私人日记本不该默认对外开端口。但这个开关必须做进界面 ——
 * 只支持命令行启动的话，用户（以及未来的 AI）根本不知道它存在。
 * ========================================================================== */
function AiGateway() {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<{ running: boolean; port: number; token: string; info: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showTok, setShowTok] = useState(false);

  const load = useCallback(async () => {
    try { setSt(await api.diagApi()); } catch { /* 网关没起来时不该弹错 */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const r = await api.diagApi({ on: on ? '1' : '0' });
      if (!r.ok) { toast('开启失败：' + (r.err || '未知原因')); setSt(r); return; }
      setSt(r);
      toast(on ? `已开启，端口 ${r.port}` : '已关闭');
    } catch (e) {
      toast('操作失败：' + (e as Error).message);
    } finally { setBusy(false); }
  };

  const copyTok = async () => {
    try { await navigator.clipboard.writeText(st?.token || ''); toast('token 已复制'); }
    catch { toast('复制失败，手动选中吧'); }
  };

  return (
    <div className="diag-api" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line2)' }}>
      <div className="diag-bar">
        <span className="diag-dot" style={st?.running ? { background: 'var(--ok)' } : undefined} />
        <b style={{ fontSize: 12.5 }}>AI 调试接口</b>
        <span className="small muted">
          {st?.running ? `运行中 · http://127.0.0.1:${st.port}/` : '已关闭'}
        </span>
        <span className="grow" />
        <button
          className={`chip ${st?.running ? 'on' : ''}`}
          disabled={busy}
          onClick={() => void toggle(!st?.running)}
          title="让外部程序（脚本 / AI）通过本机 HTTP 调用日签的接口"
        >{busy ? '处理中' : st?.running ? '关闭' : '开启'}</button>
      </div>

      {st?.running ? (
        <>
          <div className="diag-token">
            <span className="small muted" style={{ flex: '0 0 auto' }}>token</span>
            <code>{showTok ? st.token : '•'.repeat(Math.min(28, st.token.length || 28))}</code>
            <button className="chip" onClick={() => setShowTok((v) => !v)}>{showTok ? '隐藏' : '显示'}</button>
            <button className="chip" onClick={() => void copyTok()}>复制</button>
          </div>
          <div className="small muted" style={{ lineHeight: 1.8 }}>
            说明书在 <code>{st.info}</code>，里面写好了地址、token 和几条调用示例 ——
            把它整份交给 AI 就够了。所有请求除 <code>/health</code> 外都要带 <code>X-Token</code> 头。
          </div>
        </>
      ) : (
        <div className="small muted" style={{ lineHeight: 1.8 }}>
          开启后会在<b>本机回环</b>上开一个 HTTP 端口，外部程序就能读日志、查接口清单、直接调日签的
          230 个方法。默认关闭是有意的：这是私人日记，不该默认对外开端口。
          只绑 <code>127.0.0.1</code>，局域网里别的机器连不上；每次启动 token 随机重生成。
        </div>
      )}
    </div>
  );
}

function Stat({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return (
    <div className={`diag-stat ${tone || ''}`}>
      <b>{v}</b>
      <span>{label}</span>
    </div>
  );
}