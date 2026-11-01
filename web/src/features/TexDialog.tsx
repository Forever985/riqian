import { useState } from 'react';
import { Dialog } from '../components/ui';
import { texHtml } from '../lib/latex';

/** 公式编辑：左边写 TeX，右边立刻出图。不联网、不转圈。 */
export function TexDialog({
  initial = '', block = false, onClose, onOk,
}: {
  initial?: string;
  block?: boolean;
  onClose: () => void;
  onOk: (tex: string, block: boolean) => void;
}) {
  const [tex, setTex] = useState(initial);
  const [disp, setDisp] = useState(block);

  const preview = tex.trim() ? texHtml(tex, disp) : '';
  const bad = /tex-bad/.test(preview);

  return (
    <Dialog
      title="LaTeX 公式"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>取消</button>
        <button
          className="btn primary"
          disabled={!tex.trim() || bad}
          onClick={() => { onOk(tex.trim(), disp); onClose(); }}
        >插入</button>
      </>}
    >
      <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.8 }}>
        直接写 TeX，不用加 <code>$</code>。<br />
        常用：<code>\frac&#123;a&#125;&#123;b&#125;</code> 分数 ·
        <code>x^2</code> 上标 · <code>\sqrt&#123;x&#125;</code> 根号 ·
        <code>\sum_&#123;i=1&#125;^n</code> 求和 · <code>\alpha \pi \infty</code> 符号
      </div>
      <textarea
        className="inp"
        autoFocus
        style={{ width: '100%', minHeight: 92, fontFamily: 'ui-monospace,Consolas,monospace', fontSize: 13 }}
        value={tex}
        placeholder="E = mc^2"
        onChange={(e) => setTex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && tex.trim() && !bad) { onOk(tex.trim(), disp); onClose(); }
        }}
      />
      <div className="row" style={{ margin: '10px 0 4px' }}>
        <button className={`chip ${disp ? '' : 'on'}`} onClick={() => setDisp(false)}>行内（随文字走）</button>
        <button className={`chip ${disp ? 'on' : ''}`} onClick={() => setDisp(true)}>独立成行</button>
        <span className="sp" />
        <span className="small muted">Ctrl+Enter 直接插入</span>
      </div>
      <div className={`tex-preview ${bad ? 'bad' : ''}`}>
        {tex.trim() ? <span dangerouslySetInnerHTML={{ __html: preview }} /> : <span className="small muted">上面写点什么，这里能看到效果</span>}
      </div>
      {bad ? <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>这个写法 KaTeX 看不懂，检查一下括号和反斜杠</div> : null}
    </Dialog>
  );
}
