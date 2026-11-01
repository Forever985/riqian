import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons';

/**
 * 第 182 条：年月快跳。
 *
 * 用户原话：「你得要能够让我在日历中快速翻越到几个月前几年前的日历，
 * 而不是让我一个个手点。」
 *
 * 做法跟微软日历一致：
 * - 顶栏月份是个可点的按钮，点开一个面板，左边年份列、右边 12 个月格子；
 * - 年份列按「十年」翻页，点年份就换那一年；
 * - 有记录的月份打点、加粗，一眼看出哪儿写过东西；
 * - 面板里能直接输入年份跳，跨度再大也是两次点击。
 *
 * 这个组件本身不碰数据：有多少个月有记录，由调用方通过 `marks` 传进来，
 * 数据从哪来（日记 / 番茄 / 别的）由调用方决定。
 */

export interface MonthJumpProps {
  /** 当前年月，`yyyy-MM` */
  ym: string;
  /** 选完之后回调，只给 `yyyy-MM`，具体怎么换月由调用方决定 */
  onPick: (ym: string) => void;
  /** 有内容的月份 → 内容量（用于打点和提示）。没有的月份不打点 */
  marks?: Record<string, number>;
  /** 打点提示里的单位，例如「字」「分钟」 */
  unit?: string;
  /** 面板标题，默认「跳到哪个月」 */
  title?: string;
  /** 触发按钮的外观：`btn` 是普通按钮，`title` 是标题那样的大字 */
  variant?: 'btn' | 'title';
  /** 触发按钮里显示的文字，默认「yyyy 年 M 月」 */
  label?: string;
}

const PAD = (n: number) => String(n).padStart(2, '0');

export function MonthJump({
  ym, onPick, marks, unit = '', title = '跳到哪个月', variant = 'btn', label,
}: MonthJumpProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(ym.slice(0, 4)));
  const [typed, setTyped] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // 每次打开都从当前年月开始，别记住上次翻到哪一年
  useEffect(() => {
    if (!open) return;
    setYear(Number(ym.slice(0, 4)));
    setTyped('');
  }, [open, ym]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && boxRef.current.contains(e.target as Node)) return;
      // 点的是触发按钮本身时交给按钮自己 toggle，别在这里关两次
      if ((e.target as HTMLElement).closest?.('[data-monthjump-trigger]')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const curYear = Number(ym.slice(0, 4));
  const curMonth = Number(ym.slice(5, 7));
  const nowYear = new Date().getFullYear();

  /** 十年为一个跨度，跟微软日历一样 */
  const decadeStart = Math.floor(year / 10) * 10;

  const yearList = useMemo(
    () => Array.from({ length: 12 }, (_, i) => decadeStart - 1 + i),
    [decadeStart],
  );

  /** 这十年里有记录的年份，年份列上给个点 */
  const yearHasData = useMemo(() => {
    const out: Record<number, number> = {};
    if (!marks) return out;
    for (const [k, v] of Object.entries(marks)) out[Number(k.slice(0, 4))] = (out[Number(k.slice(0, 4))] || 0) + v;
    return out;
  }, [marks]);

  const pick = (yy: number, mm: number) => {
    // 月底截断（1/31 选到 2 月）由调用方处理，这里只负责给出合法年月
    onPick(`${yy}-${PAD(mm)}`);
    setOpen(false);
  };

  const gotoTyped = () => {
    const s = typed.trim();
    const m = /^(\d{4})(?:[-/.](\d{1,2}))?$/.exec(s);
    if (!m) return;
    const yy = Number(m[1]);
    const mm = m[2] ? Math.min(12, Math.max(1, Number(m[2]))) : 1;
    if (yy < 1900 || yy > 2999) return;
    pick(yy, mm);
  };

  const trigger = variant === 'title' ? (
    <button
      type="button"
      data-monthjump-trigger
      /*
       * data-ym 是给外部看的「我当前在哪个月」，形如 `2026-11`。
       * 别去解析按钮文字：文字是给人读的（「2026 年 11 月」），随时可能改字眼，
       * 而 data-ym 是契约，测试和外部逻辑都认它。
       */
      data-ym={ym}
      className="mj-title"
      title="点这里快速跳到某年某月"
      onClick={() => setOpen((x) => !x)}
    >
      {label ?? `${ym.slice(0, 4)} 年 ${curMonth} 月`}
      <span style={{ display: 'inline-flex', transform: 'rotate(90deg)', opacity: 0.6 }}>
        <Icon name="right" size={11} />
      </span>
    </button>
  ) : (
    <button
      type="button"
      data-monthjump-trigger
      data-ym={ym}
      className="btn sm"
      title="快速跳到某年某月"
      onClick={() => setOpen((x) => !x)}
    >
      <Icon name="calendar" size={13} />
      {label ?? '跳月'}
    </button>
  );

  return (
    <>
      {trigger}
      {open ? createPortal(
        <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dlg mj" ref={boxRef} onClick={(e) => e.stopPropagation()}>
            <div className="h">
              <h3>{title}</h3>
              <button className="x" title="关闭" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="b">
              <div className="mj-top">
                <button className="btn sm" title="往前十年" onClick={() => setYear(decadeStart - 10)}>
                  <Icon name="left" size={13} />
                </button>
                <span className="mj-decade">{decadeStart} – {decadeStart + 9}</span>
                <button className="btn sm" title="往后十年" onClick={() => setYear(decadeStart + 10)}>
                  <Icon name="right" size={13} />
                </button>
                <span style={{ width: 8 }} />
                <input
                  className="inp"
                  style={{ width: 108 }}
                  placeholder="如 2019 或 2019-6"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') gotoTyped(); }}
                  title="输入年份直接跳（也可以写 2019-6）"
                />
                <button className="btn sm" onClick={gotoTyped} disabled={!typed.trim()}>跳</button>
                <button
                  className="btn sm ghost"
                  style={{ marginLeft: 'auto' }}
                  title="回到今年"
                  onClick={() => { setYear(nowYear); }}
                >
                  今年
                </button>
              </div>

              <div className="mj-body">
                <div className="mj-years">
                  {yearList.map((yy) => {
                    const on = yy === year;
                    const has = yearHasData[yy];
                    const isCur = yy === curYear;
                    return (
                      <button
                        key={yy}
                        data-year={yy}
                        className={`mj-y ${on ? 'on' : ''} ${isCur ? 'cur' : ''}`}
                        title={has ? `${yy} 年有记录` : `${yy} 年`}
                        onClick={() => setYear(yy)}
                      >
                        {yy}
                        {has ? <i className="mj-dot" /> : null}
                      </button>
                    );
                  })}
                </div>

                <div className="mj-months">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => {
                    const key = `${year}-${PAD(mm)}`;
                    const v = marks?.[key];
                    const isSel = year === curYear && mm === curMonth;
                    return (
                      <button
                        key={mm}
                        data-month={key}
                        className={`mj-m ${isSel ? 'on' : ''} ${v ? 'has' : ''}`}
                        title={v ? `${key} · ${v}${unit}` : key}
                        onClick={() => pick(year, mm)}
                      >
                        <span>{mm} 月</span>
                        {v ? <em>{v}{unit}</em> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="small muted" style={{ marginTop: 10 }}>
                点年份换年、点月份跳过去；有记录的年月带小点。
                年份跨度大就直接在上面输入，回车即跳。
              </div>
            </div>
            <div className="f">
              <button
                className="btn sm ghost"
                onClick={() => {
                  const t = new Date();
                  pick(t.getFullYear(), t.getMonth() + 1);
                }}
              >
                回到本月
              </button>
              <button className="btn sm" onClick={() => setOpen(false)}>取消</button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}