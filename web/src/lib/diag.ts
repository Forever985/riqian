/**
 * 前端诊断通道。
 *
 * 解决的问题：以前界面上的报错只进浏览器 console，用户把窗口一关就没了；
 * 我们收到的反馈永远只有一句「点了没反应」。现在所有前端异常都经宿主写进
 * 同一个日志文件（%LOCALAPPDATA%\Riqian\logs\），和后端异常放在一起看。
 *
 * 几条原则：
 *  - **绝不因为日志再崩一次**。上报本身全程 try/catch，失败就安静放弃。
 *  - **不刷屏**。同一条消息 5 秒内只报一次，否则一个渲染循环里的错误能把日志写爆。
 *  - **带上现场**。报错时附上当前页面、用户做了什么，不然只有一句 msg 没法复现。
 */
import { api } from '../api';

type Level = 'info' | 'warn' | 'error';

/** 最近一次用户动作，崩溃时靠它还原「他在干什么」。 */
let lastAction = '';
let currentView = '';

/** 去重：同一条消息在窗口内只报一次 */
const recent = new Map<string, number>();
const DEDUP_MS = 5000;

function shouldReport(key: string): boolean {
  const now = Date.now();
  const prev = recent.get(key);
  if (prev && now - prev < DEDUP_MS) return false;
  recent.set(key, now);
  // 顺手清掉过期项，别让 Map 无限长
  if (recent.size > 200) {
    for (const [k, t] of recent) if (now - t > DEDUP_MS * 4) recent.delete(k);
  }
  return true;
}

/** 把任意 throw 出来的东西压成能读的一行 */
function describe(v: unknown): string {
  if (v == null) return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

function stackOf(v: unknown): string {
  if (v instanceof Error && v.stack) return v.stack;
  return '';
}

/** 真正的上报出口 */
export function report(level: Level, src: string, msg: string, stack = '') {
  try {
    if (!shouldReport(src + '|' + msg)) return;
    void api.diagFrontend({ level, src, msg, stack: stack.slice(0, 4000) });
  } catch {
    /* 通道本身挂了就算了，不能因为记日志把界面搞崩 */
  }
}

/** 记录用户动作（点了个什么、切到哪个页面） */
export function action(what: string) {
  lastAction = what;
  try {
    void api.diagAction(what);
  } catch { /* 同上 */ }
}

/** 记录当前页面，报错时带上 */
export function setView(v: string) {
  currentView = v;
}

export function getContext(): string {
  return `页面=${currentView || '?'} 最近动作=${lastAction || '无'}`;
}

/**
 * 装全局钩子。要在 React 挂载之前调，否则启动期的错误抓不到。
 */
export function installGlobalHandlers() {
  // 同步错误
  window.addEventListener('error', (e) => {
    // 资源加载失败（img/script）也会走这里，但 e.error 是空的，单独标一下
    if (!e.error) {
      report('warn', 'resource', `资源加载失败: ${(e.target as HTMLElement)?.tagName || '?'} ${e.message || ''}`);
      return;
    }
    report('error', 'window.onerror', `${describe(e.error)} @ ${e.filename}:${e.lineno}`, stackOf(e.error));
  });

  // Promise 里漏掉的异常。这类最容易静默 —— 调用方没 await，错误就沉底了。
  window.addEventListener('unhandledrejection', (e) => {
    report('error', 'unhandledrejection', describe(e.reason), stackOf(e.reason));
  });

  // React 的渲染错误会在这里冒出来（ErrorBoundary 装好之前）
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    origError.apply(console, args as []);
    // React 的 key 警告之类不算错误，只挑真正的报错
    const text = args.map(describe).join(' ');
    if (/Warning:/.test(text)) return;
    report('error', 'console', text);
  };

  // 记一笔「界面起来了」，方便和崩溃时间对齐
  report('info', 'boot', `界面已加载 ${getContext()}`);
}