import type { Habit, HabitValue } from '../types';
import { Icon } from '../components/Icons';

export function habitIsDone(h: Habit, val: HabitValue | undefined): boolean {
  if (val == null) return false;
  if (h.type === 'bool') return !!val && val !== 0 && val !== '';
  if (h.type === 'number' || h.type === 'duration') return Number(val) > 0;
  if (h.type === 'choice') return Array.isArray(val) ? val.length > 0 : !!val;
  return val !== '' && val != null;
}

export function habitValueText(h: Habit, val: HabitValue | undefined): string {
  if (val == null || val === '') return '';
  if (h.type === 'bool') return '已打卡';
  if (h.type === 'time') return String(val);
  if (h.type === 'number') return `${val}${h.unit || ''}`;
  if (h.type === 'duration') return `${val}${h.unit || '分钟'}`;
  if (h.type === 'choice') return Array.isArray(val) ? val.join('、') : String(val);
  return String(val);
}

/** 按习惯的数据类型渲染对应控件：打卡 / 时间 / 数值 / 时长 / 多选 / 备注 */
export function HabitWidget({
  habit: h, value, compact, onCommit, note, onNote,
}: {
  habit: Habit;
  value: HabitValue | undefined;
  compact?: boolean;
  onCommit: (v: HabitValue) => void;
  /** 备注（独立于数据类型，任何习惯都能写） */
  note?: string;
  onNote?: (v: string) => void;
}) {
  const t = h.type || 'bool';
  const noteNode = onNote ? (
    <div className={`hnote ${note ? 'filled' : ''}`}>
      <Icon name="note" size={13} />
      <input
        key={note || 'empty'}
        defaultValue={note || ''}
        placeholder="写一句记录：今天几点起、跑了多远、感觉如何…"
        onBlur={(e) => { if (e.target.value !== (note || '')) onNote(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  ) : null;

  const wrap = (node: React.ReactNode) => (
    <>
      {node}
      {noteNode}
      {!onNote && note ? <div className="hnote filled"><Icon name="note" size={13} /><input readOnly value={note} /></div> : null}
    </>
  );

  const body = (() => {
  if (t === 'bool') {
    const on = !!value && value !== 0 && value !== '';
    return (
      <div className={`hchk ${on ? 'on' : ''}`} onClick={() => onCommit(on ? null : 1)}>
        {on ? '✓' : ''}
      </div>
    );
  }

  if (t === 'time') {
    return (
      <input
        type="time"
        defaultValue={(value as string) || ''}
        onChange={(e) => onCommit(e.target.value || null)}
      />
    );
  }

  if (t === 'number') {
    const n = Number(value) || 0;
    const goal = Number(h.goal) || 0;
    return (
      <div className="step">
        <button onClick={() => onCommit(Math.max(0, n - 1) || null)}>−</button>
        <input
          type="number"
          key={`n-${n}`}
          defaultValue={n || ''}
          placeholder="0"
          onBlur={(e) => onCommit(Number(e.target.value) || null)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <button onClick={() => onCommit(n + 1)}>+</button>
        <span className="val">{h.unit || ''}{goal ? ` / 目标 ${goal}` : ''}</span>
      </div>
    );
  }

  if (t === 'duration') {
    const n = Number(value) || 0;
    const presets = compact ? [15, 30, 60] : [10, 15, 30, 45, 60, 90];
    return (
      <div className="mini-chips">
        {presets.map((p) => (
          <button key={p} className={n === p ? 'on' : ''} onClick={() => onCommit(n === p ? null : p)}>
            {p}{h.unit || '分'}
          </button>
        ))}
        <input
          type="number"
          key={`d-${n}`}
          defaultValue={n || ''}
          placeholder="自定义"
          style={{ width: 72, border: '1px solid var(--line)', borderRadius: 7, background: 'var(--panel)', padding: '2px 7px', fontSize: 12.5 }}
          onBlur={(e) => onCommit(Number(e.target.value) || null)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>
    );
  }

  if (t === 'choice') {
    const opts = Array.isArray(h.options) ? h.options : [];
    const cur = Array.isArray(value) ? value : (value ? [String(value)] : []);
    return (
      <div className="mini-chips">
        {opts.map((o) => (
          <button
            key={o}
            className={cur.includes(o) ? 'on' : ''}
            onClick={() => {
              const next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o];
              onCommit(next.length ? next : null);
            }}
          >
            {o}
          </button>
        ))}
      </div>
    );
  }

  return (
    <input
      className="inp"
      style={{ padding: '4px 9px', fontSize: 13 }}
      defaultValue={(value as string) || ''}
      placeholder="记一句…"
      onBlur={(e) => onCommit(e.target.value.trim() || null)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
  })();

  return wrap(body);
}

/** 近 14 天迷你柱：柱高按完成度/数值相对目标缩放 */
export function HabitSpark({ habit: h }: { habit: Habit }) {
  const arr = h.last14 || [];
  return (
    <div className="hspark">
      {arr.map((x) => {
        const on = habitIsDone(h, x.v);
        let hgt = 6;
        if (h.type === 'number' || h.type === 'duration') {
          const n = Number(x.v) || 0;
          const goal = Number(h.goal) || n || 1;
          hgt = Math.max(6, Math.min(26, 6 + (n / goal) * 18));
        } else if (on) hgt = 26;
        return <i key={x.date} title={x.date} style={{ height: hgt, background: on ? h.color : 'var(--line)' }} />;
      })}
    </div>
  );
}
