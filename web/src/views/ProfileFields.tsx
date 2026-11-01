import { useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../components/Icons';
import { REGIONS, INTERESTS } from '../lib/const';

export interface ProfileFieldsData {
  region: string;
  city: string;
  job: string;
  school: string;
  interests: string[];
  bio: string;
}

const EMPTY: ProfileFieldsData = { region: 'CN-11', city: '', job: '', school: '', interests: [], bio: '' };

export function parseFields(raw: unknown): ProfileFieldsData {
  if (typeof raw === 'string' && raw) {
    try {
      const o = JSON.parse(raw);
      return { ...EMPTY, ...o, interests: Array.isArray(o.interests) ? o.interests : [] };
    } catch { /* 用默认 */ }
  }
  return EMPTY;
}

/**
 * 第 58 条：更多资料。
 * 参考国内主流社交产品的资料页（微博 / 小红书 / 豆瓣），常见字段就是
 * 地区、城市、职业、学校、生日、兴趣标签、一句话简介 —— 这里按这个来，不多塞。
 * 全部存在本机，不上传。
 */
export function ProfileFields() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const [d, setD] = useState<ProfileFieldsData>(() => parseFields(settings.profileFields));
  const [custom, setCustom] = useState('');

  const patch = (p: Partial<ProfileFieldsData>) => setD((x) => ({ ...x, ...p }));

  const save = async () => {
    await setSetting('profileFields', JSON.stringify({ ...d, interests: d.interests.slice(0, 12) }));
    toast('资料已保存（只存在这台电脑上）');
  };

  const toggleInterest = (t: string) => {
    const has = d.interests.includes(t);
    if (has) patch({ interests: d.interests.filter((x) => x !== t) });
    else if (d.interests.length >= 12) toast('最多 12 个标签');
    else patch({ interests: [...d.interests, t] });
  };

  const addCustom = () => {
    const t = custom.trim();
    if (!t) return;
    if (d.interests.includes(t)) { setCustom(''); return; }
    if (d.interests.length >= 12) { toast('最多 12 个标签'); return; }
    patch({ interests: [...d.interests, t] });
    setCustom('');
  };

  return (
    <div className="card">
      <h3><Icon name="user" size={14} />更多资料 <span className="muted">只存本机，不上传</span></h3>

      <div className="pf-grid">
        <label className="pf-f">
          <span>地区</span>
          <select className="inp" value={d.region} onChange={(e) => patch({ region: e.target.value })}>
            {REGIONS.map((r) => <option key={r.k} value={r.k}>{r.n}</option>)}
          </select>
        </label>
        <label className="pf-f">
          <span>城市</span>
          <input className="inp" value={d.city} placeholder="如 杭州" onChange={(e) => patch({ city: e.target.value })} />
        </label>
        <label className="pf-f">
          <span>职业</span>
          <input className="inp" value={d.job} placeholder="如 产品经理 / 学生" onChange={(e) => patch({ job: e.target.value })} />
        </label>
        <label className="pf-f">
          <span>学校 / 单位</span>
          <input className="inp" value={d.school} placeholder="可留空" onChange={(e) => patch({ school: e.target.value })} />
        </label>
      </div>

      <div className="pf-block">
        <div className="pf-lab">兴趣爱好 <span className="muted">选几个，最多 12 个</span></div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {INTERESTS.map((t) => (
            <button key={t} className={`chip ${d.interests.includes(t) ? 'on' : ''}`} onClick={() => toggleInterest(t)}>{t}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="inp" style={{ width: 160 }}
            value={custom}
            placeholder="自己加一个"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          />
          <button className="btn sm" onClick={addCustom}>加上</button>
          {d.interests.filter((t) => !INTERESTS.includes(t)).length ? (
            <span className="small muted">
              自定：{d.interests.filter((t) => !INTERESTS.includes(t)).map((t) => (
                <button key={t} className="chip" style={{ marginLeft: 4 }} onClick={() => toggleInterest(t)}>{t} ✕</button>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      <div className="pf-block">
        <div className="pf-lab">一句话简介</div>
        <textarea
          className="inp"
          style={{ width: '100%', minHeight: 64, lineHeight: 1.8, fontFamily: 'inherit' }}
          value={d.bio}
          maxLength={160}
          placeholder="想让人一眼知道的，比如：白天写代码，晚上写日记。"
          onChange={(e) => patch({ bio: e.target.value })}
        />
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={() => void save()}>保存资料</button>
        <span className="small muted">地区包含港澳台，均标注为中国的一部分</span>
      </div>
    </div>
  );
}

/** 给「我的」页顶部做一行摘要用 */
export function profileSummary(raw: unknown): string {
  const d = parseFields(raw);
  const region = REGIONS.find((r) => r.k === d.region)?.n || '';
  return [region, d.city, d.job].filter(Boolean).join(' · ');
}
