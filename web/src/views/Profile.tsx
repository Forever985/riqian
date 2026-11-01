import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar, Dialog, askText } from '../components/ui';
import { Icon } from '../components/Icons';
import { PasswordField } from '../components/Lock';
import { MediaPicker } from '../features/media';
import { AvatarCrop } from '../features/avatar';
import { ProfileFields, profileSummary } from './ProfileFields';
import { normalize } from '../components/OrderEditor';
import { PROFILE_SECTIONS } from '../lib/const';
import { imgUrl } from '../lib/media';
import { playChime } from '../store';
import type { CacheStats, MusicItem, UserProfile, VaultStatus } from '../types';

function mb(n: number) {
  if (!n) return '0 MB';
  return n > 1024 * 1024 * 1024
    ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const SCOPE_NAME: Record<string, string> = {
  app: '整个软件', todos: '待办', countdown: '倒计时',
  diary: '某篇日记', diaryRange: '一段日期', notebook: '某个笔记本', note: '某篇笔记',
};

/** 用户中心：身份 / 安全 / 缓存 / 音乐库都收在这里，避免设置页过分挤 */
export function ProfileView() {
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const reloadMedia = useStore((s) => s.reloadMedia);
  const reloadVault = useStore((s) => s.reloadVault);
  const vault = useStore((s) => s.vault);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [nick, setNick] = useState('');
  const [sign, setSign] = useState('');
  const [avatar, setAvatar] = useState('');
  const [birthday, setBirthday] = useState('');
  const [lunarBd, setLunarBd] = useState('');

  const [cache, setCache] = useState<CacheStats | null>(null);
  const [pickAvatar, setPickAvatar] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwMain, setPwMain] = useState('');
  const [pwAgain, setPwAgain] = useState('');
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [urlName, setUrlName] = useState('');


  const loadUser = async () => {
    const u = await api.user.get();
    setUser(u);
    setNick(u.nickname || '');
    setSign(u.signature || '');
    setAvatar(u.avatar || '');
    setBirthday(u.birthday || '');
    setLunarBd(u.lunarBirthday || '');
  };
  const loadCache = async () => setCache(await api.cache.stats());

  useEffect(() => {
    void loadUser();
    void loadCache();
    void reloadVault();
    void reloadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveUser = async () => {
    await api.user.save({ nickname: nick, signature: sign, avatar, birthday, lunarBirthday: lunarBd });
    toast('已保存');
    await loadUser();
  };

  const rules = vault?.rules ?? [];
  /** 第 53 条：模块顺序由设置里的 profileOrder 决定；这里用 CSS order 生效，不用重排 DOM */
  const order = normalize(settings.profileOrder, PROFILE_SECTIONS);
  /** 当前提醒音是从媒体库里挑的那段音频，显示它的名字（没挑就是内置音） */
  const soundName = (() => {
    const id = String(settings.notifySoundId || '');
    if (!id) return '';
    const m = useStore.getState().mediaList.find((x) => x.id === id);
    return m?.name || '已选音频';
  })();
  const ord = (k: string) => {
    const i = order.indexOf(k);
    return i < 0 ? 99 : i;
  };

  /** 头像：选图 → 裁剪 → 存成一张新图片（内容哈希入库，原图不动） */
  const applyCropped = async (dataUrl: string) => {
    const name = `avatar-${Date.now()}.png`;
    const r = await api.media.saveBase64(name, dataUrl);
    setCropSrc(null);
    if (!r.ok || !r.id) { toast(r.err || '头像保存失败'); return; }
    setAvatar(r.id);
    await api.user.save({ nickname: nick, signature: sign, avatar: r.id, birthday, lunarBirthday: lunarBd });
    await loadUser();
    await reloadMedia();
    toast('头像已更新');
  };

  return (
    <>
      <Topbar title="我的" sub={[user?.nickname || '本机用户', profileSummary(settings.profileFields)].filter(Boolean).join(' · ')} />
      <div className="wrap stack">
        {/* 身份 */}
        <div className="card profile-card" style={{ order: ord('id') }}>
          <button
            className="avatar"
            onClick={async () => {
              if (!avatar) { setPickAvatar(true); return; }
              let src = imgUrl(avatar);
              if (!src) {
                // 图片索引可能是旧的（比如刚在别的页面导入），刷一次再取
                await reloadMedia();
                src = imgUrl(avatar);
              }
              if (src) setCropSrc(src);
              else { setPickAvatar(true); toast('这张头像的源文件找不到了，换一张吧'); }
            }}
            title={avatar ? '点一下调整大小和位置' : '选一张图片当头像'}
          >
            {avatar ? <img src={imgUrl(avatar, true)} alt="" /> : <Icon name="user" size={30} />}
            {/*
              第 180 条：有头像之后，点整块只会打开裁剪框，用户找不到「换一张」的入口了。
              「更换」这一小块单独接管成重新选图，头像本身仍然管裁剪。
            */}
            <span
              className="av-edit"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPickAvatar(true); }}
              title="重新选一张图片"
            >
              {avatar ? '换图' : '选择'}
            </span>
          </button>
          <div className="pf-main">
            <input className="pf-nick" value={nick} placeholder="起个名字" onChange={(e) => setNick(e.target.value)} />
            <input className="pf-sign" value={sign} placeholder="写一句个性签名" onChange={(e) => setSign(e.target.value)} />
            <div className="pf-row">
              <label>生日<input type="date" className="inp" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></label>
              <label>农历生日<input className="inp" placeholder="如 8-15" value={lunarBd} onChange={(e) => setLunarBd(e.target.value)} /></label>
              <button className="btn primary" onClick={() => void saveUser()}>保存</button>
            </div>
          </div>
        </div>

        {/* 更多资料 */}
        <div style={{ order: ord('fields') }}><ProfileFields /></div>

        {/* 安全 */}
        <div className="card" style={{ order: ord('secure') }}>
          <h3><Icon name="shield" size={14} />密码与隐私</h3>
          {!vault?.hasMain ? (
            <div className="sec-setup">
              <div className="small muted" style={{ marginBottom: 10 }}>
                设置一个主密码后，可以给整天功能、待办、倒计时、某篇日记、某段时间、笔记本和单条笔记分别加锁。
                <b>密码只做本地校验，数据文件本身不加密</b> —— 能拿到 E 盘文件的人仍可绕过，这是本地单机应用的固有限制。
              </div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}><PasswordField value={pwMain} onChange={setPwMain} placeholder="设置主密码（至少 4 位）" /></div>
                <div style={{ flex: 1 }}><PasswordField value={pwAgain} onChange={setPwAgain} placeholder="再输一次" /></div>
                <button
                  className="btn primary"
                  onClick={async () => {
                    if (pwMain.length < 4) { toast('密码太短'); return; }
                    if (pwMain !== pwAgain) { toast('两次输入不一致'); return; }
                    await api.vault.setMain(pwMain);
                    setPwMain(''); setPwAgain('');
                    await reloadVault();
                    toast('主密码已设置');
                  }}
                >设置</button>
              </div>
            </div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="chip on">主密码已设置</span>
                <span className="small muted">解锁后 {settings.vaultTimeout || 30} 分钟内不再询问</span>
                <span className="sp" />
                <button className="btn sm" onClick={async () => { await api.vault.lock(); await reloadVault(); toast('已全部重新上锁'); }}>
                  <Icon name="lock" size={13} />立即锁定
                </button>
                <button className="btn sm" onClick={() => setPwOpen(true)}>修改 / 关闭</button>
              </div>

              <div className="small muted" style={{ margin: '14px 0 6px' }}>已加锁的范围</div>
              {rules.length ? rules.map((r) => (
                <div className="sec-rule" key={r.id}>
                  <Icon name="lock" size={13} />
                  <span className="sc">{SCOPE_NAME[r.scope] || r.scope}</span>
                  <span className="lb">{r.label || r.target || '—'}</span>
                  <span className="small muted">{r.own ? '独立密码' : '主密码'}</span>
                  <button className="btn sm ghost" onClick={async () => { await api.vault.remove(r.id); await reloadVault(); toast('已解锁该范围'); }}>取消</button>
                </div>
              )) : (
                <div className="empty small">
                  还没有单独加锁的范围。可以在「待办 / 倒计时 / 笔记」页里点锁图标，或在这里按范围添加。
                  <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
                    <button className="btn sm" onClick={async () => { await api.vault.add({ scope: 'todos', target: '', label: '待办', password: '' }); await reloadVault(); }}>锁住待办</button>
                    <button className="btn sm" onClick={async () => { await api.vault.add({ scope: 'countdown', target: '', label: '倒计时', password: '' }); await reloadVault(); }}>锁住倒计时</button>
                    {/* 整个软件的上锁挪到「设置 → 安全与密码」：它属于全局行为，不该藏在个人中心 */}
                    <button className="btn sm" onClick={() => useStore.getState().goSettings('security')}>应用锁 → 设置</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 缓存 */}
        <div className="card" style={{ order: ord('cache') }}>
          <h3><Icon name="database" size={14} />存储与缓存</h3>
          {cache ? (
            <>
              <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
                <div className="kpi"><div className="k">数据库</div><div className="v">{mb(cache.db + cache.wal)}</div></div>
                <div className="kpi"><div className="k">图片 / 音频</div><div className="v">{mb(cache.media)}<small>{cache.files} 个</small></div></div>
                <div className="kpi"><div className="k">缩略图</div><div className="v">{mb(cache.thumbs)}</div></div>
                <div className="kpi"><div className="k">备份 + 缓存</div><div className="v">{mb(cache.backup + cache.cache)}</div></div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <span className="small muted">合计 {mb(cache.total)}</span>
                <span className="sp" />
                <button className="btn sm" onClick={() => void api.cache.open()}>打开缓存目录</button>
                <button
                  className="btn sm"
                  onClick={async () => { const r = await api.cache.prune(); toast(`已清理 ${r.removed} 个文件，释放 ${r.freedMB} MB`); await loadCache(); }}
                >按规则清理</button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    const r = await api.cache.clear('all');
                    toast(`已清空 ${r.removed} 个文件，释放 ${r.freedMB} MB`);
                    await loadCache();
                  }}
                >清空可重建缓存</button>
              </div>
            </>
          ) : <div className="empty small">读取中…</div>}
        </div>

        <div className="card" style={{ order: ord('sound') }}>
          <h3><Icon name="music" size={14} />提醒音与试听</h3>
          <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
            当前提醒音：{soundName || '内置提示音'}
            <br />
            音频都在「多媒体库」里，和图片、视频同一个库；这里只是快捷入口。
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => void useStore.getState().go('media')}>
              <Icon name="grid" size={13} />去多媒体库挑
            </button>
            <button className="btn" onClick={() => playChime(1)}>内置提示音 A</button>
            <button className="btn" onClick={() => playChime(2)}>内置提示音 B</button>
            <button className="btn" onClick={() => void api.notify.test()}>测试桌面弹窗</button>
            <span className="small muted">音量在「设置 → 提醒」里调</span>
          </div>
        </div>
      </div>

      {pickAvatar ? (
        <MediaPicker
          onClose={() => setPickAvatar(false)}
          onDone={(ids) => {
            setPickAvatar(false);
            // 选完先进裁剪，别直接拿来用 —— 头像裁圆后构图差很多
            if (ids.length) setCropSrc(imgUrl(ids[0]));
          }}
        />
      ) : null}

      {cropSrc ? (
        <AvatarCrop
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onDone={(d) => void applyCropped(d)}
        />
      ) : null}

      {pwOpen ? (
        <Dialog
          title="修改或关闭主密码"
          onClose={() => setPwOpen(false)}
          footer={<button className="btn" onClick={() => setPwOpen(false)}>关闭</button>}
        >
          <div className="small muted" style={{ marginBottom: 10 }}>需要先验证当前主密码</div>
          <PasswordField value={pwMain} onChange={setPwMain} placeholder="当前主密码" />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn"
              onClick={async () => {
                const r = await api.vault.clearMain(pwMain);
                if (!r.ok) { toast(r.err || '密码不正确'); return; }
                setPwMain(''); setPwOpen(false);
                await reloadVault();
                toast('已关闭密码保护');
              }}
            >关闭全部密码保护</button>
            <span className="small muted">关闭后所有加锁范围一并解除</span>
          </div>
        </Dialog>
      ) : null}

    </>
  );
}
