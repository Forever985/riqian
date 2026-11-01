import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PomoDay } from '../types';

/**
 * 第 186 条：某一天到底专注了哪些事。
 *
 * 用户原话：「最好每个都是可以点的，比如我可以知道我哪一天专注了哪些。」
 * 所以这里给的是**明细**：几点开始、做了多久、写的是什么任务，
 * 以及按任务合并后的小计 —— 光给一个总数他已经有了，再给一次没意义。
 *
 * 用法：`<PomoDayDialog date={d} onClose={() => setD(null)} />`，date 为 null 时不渲染。
 *
 * 第 186 条配套：每颗可以删。以前番茄只能加不能删，记错一颗就永久多出来，
 * 「今天合计」也跟着错 —— 明细页是唯一能看见单颗的地方，删除入口放这儿最合理。
 */
export function PomoDayDialog({ date, onClose }: { date: string | null; onClose: () => void }) {
  const [d, setD] = useState<PomoDay | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!date) { setD(null); setErr(''); return; }
    let alive = true;
    void api.pomoDay(date)
      .then((x) => { if (alive) setD(x); })
      .catch((e) => { if (alive) setErr((e as Error).message); });
    return () => { alive = false; };
  }, [date]);

  useEffect(() => {
    if (!date) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, onClose]);

  if (!date) return null;

  /* 删完重新拉一遍，不本地删数组 —— 以库里的结果为准，合计和按任务小计才会一起对 */
  const removeOne = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await api.pomodoro.remove(id);
      const fresh = await api.pomoDay(date);
      setD(fresh);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const mins = d?.totalMinutes ?? 0;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  const total = mins ? `${hh ? `${hh} 小时 ` : ''}${mm ? `${mm} 分钟` : ''}`.trim() : '没专注';

  return (
    <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg" style={{ width: 'min(520px,92vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="h">
          <h3>专注明细 · {date}</h3>
          <button className="x" title="关闭" onClick={onClose}>✕</button>
        </div>
        <div className="b">
          {err ? <div className="empty small">没读到：{err}</div> : null}

          {!err && !d ? <div className="empty small">读取中…</div> : null}

          {d ? (
            <>
              <div className="pdd-sum">
                <div>
                  <div className="k">合计</div>
                  <div className="v">{total}</div>
                </div>
                <div>
                  <div className="k">番茄</div>
                  <div className="v">{d.count}<small>颗</small></div>
                </div>
                <div>
                  <div className="k">平均单颗</div>
                  <div className="v">{d.count ? Math.round(mins / d.count) : 0}<small>分钟</small></div>
                </div>
              </div>

              {d.byTask.length > 1 ? (
                <div style={{ marginTop: 14 }}>
                  <div className="lbl" style={{ marginBottom: 6 }}>按任务</div>
                  {d.byTask.map((t) => {
                    const max = Math.max(...d.byTask.map((x) => x.minutes), 1);
                    return (
                      <div className="pdd-bar" key={t.name}>
                        <span className="nm" title={t.name}>{t.name}</span>
                        <span className="bar"><i style={{ width: `${(t.minutes / max) * 100}%` }} /></span>
                        <span className="mm">{t.minutes}′</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div style={{ marginTop: 14 }}>
                <div className="lbl" style={{ marginBottom: 6 }}>
                  每颗的时间{d.items.length ? `（${d.items.length} 颗）` : ''}
                </div>
                {d.items.length ? (
                  <div className="pdd-list">
                    {d.items.map((x, i) => (
                      <div className="pdd-row" key={`${x.ts}-${i}`}>
                        <span className="t">{x.hm || '--:--'}</span>
                        <span className="n">{x.task}</span>
                        <b>{x.minutes}′</b>
                        {x.id ? (
                          <button
                            className="pdd-del"
                            data-act="pomo-del"
                            data-pomo-id={x.id}
                            title="这颗记错了？删掉"
                            disabled={!!busy}
                            onClick={() => void removeOne(String(x.id))}
                          >
                            {busy === x.id ? '…' : '✕'}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty small">这天没有番茄记录。</div>
                )}
              </div>
            </>
          ) : null}
        </div>
        <div className="f">
          <button className="btn sm" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}