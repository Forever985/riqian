// 必须第一个：补丁要早于任何用到被补 API 的模块求值
import './polyfills';
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installGlobalHandlers, report } from './lib/diag';
import './styles.css';

// 全局钩子要赶在 React 之前装：启动期（首屏渲染之前）的错误一旦错过，
// 日志里就只剩「界面没出来」这一句，什么线索都没有。
installGlobalHandlers();

/**
 * 兜底边界。
 *
 * 没有它的时候，任何一个组件在渲染里抛异常，整棵树直接卸载 ——
 * 用户看到的是**一片空白**，而 console 里那条错在 Release 版没人看得见。
 * 现在至少能：写进日志、原地留一句看得懂的话、给一个「重新加载」的出口。
 */
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    report(
      'error', 'react.boundary',
      `${err.name}: ${err.message}`,
      `${err.stack || ''}\n--- 组件栈 ---\n${info.componentStack || ''}`,
    );
  }

  render() {
    if (!this.state.err) return this.props.children;
    const btn: React.CSSProperties = {
      padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
    };
    return (
      <div style={{
        padding: '48px 32px', maxWidth: 640, margin: '0 auto',
        fontFamily: 'var(--font, system-ui)', color: 'var(--ink, #2b2b28)',
      }}>
        <h2 style={{ fontSize: 18, margin: '0 0 10px' }}>这个页面出了点问题</h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.8, color: 'var(--ink2, #666)' }}>
          你写过的东西都还在，没有丢。这个错误已经记进日志了。
        </p>
        <pre style={{
          fontSize: 12, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8,
          background: 'var(--panel2, #f4f2ec)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 180, overflow: 'auto', margin: '12px 0 18px',
        }}>{this.state.err.message}</pre>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { this.setState({ err: null }); }}
            style={{
              ...btn, border: '1px solid var(--line, #ddd)',
              background: 'var(--panel, #fff)', color: 'var(--ink, #2b2b28)',
            }}
          >再试一次</button>
          <button
            onClick={() => { location.reload(); }}
            style={{ ...btn, border: 0, background: 'var(--accent, #b8623a)', color: '#fff' }}
          >重新加载界面</button>
        </div>
      </div>
    );
  }
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Boundary>
        <App />
      </Boundary>
    </StrictMode>,
  );
}