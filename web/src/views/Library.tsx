import { useState } from 'react';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { MediaManager, kindOf } from '../features/media';
import { MusicLib } from '../features/music';
import { useStore } from '../store';

const noop = () => { /* 独立页面里不需要关闭 */ };

/**
 * 多媒体库：图片 / 音频 / 视频共用一份索引、一个入口。
 *
 * 之前导航里是「图片库」和「音乐库」两个页签，实际是同一张 media 表 ——
 * 用户要在两个页面之间来回找同一批文件。现在合成一个：上面切类型，下面看内容，
 * 「提醒音」作为第二栏（它本质是"音频怎么用"，不是另一批素材）。
 */
export function MediaPage({ initialTab = 'media' }: { initialTab?: 'media' | 'sound' }) {
  const [tab, setTab] = useState<'media' | 'sound'>(initialTab);
  const mediaList = useStore((s) => s.mediaList);
  const n = { image: 0, audio: 0, video: 0 };
  for (const m of mediaList) n[kindOf(m)] += 1;

  return (
    <>
      <Topbar
        title="多媒体库"
        sub={`共 ${mediaList.length} 项 · 图片 ${n.image} · 音频 ${n.audio} · 视频 ${n.video} · 引用按内容哈希走，重名也不会串`}
        right={(
          <button className="btn sm ghost" onClick={() => useStore.getState().goSettings('data')}>
            <Icon name="sliders" size={13} />在设置里管理
          </button>
        )}
        lock={{ scope: 'media', label: '多媒体库' }}
      />
      <div className="wrap">
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={`seg-b ${tab === 'media' ? 'on' : ''}`} onClick={() => setTab('media')}>
            全部媒体
          </button>
          <button className={`seg-b ${tab === 'sound' ? 'on' : ''}`} onClick={() => setTab('sound')}>
            提醒音
          </button>
        </div>

        {tab === 'media' ? <MediaManager onClose={noop} inline /> : (
          <div className="card">
            <div className="small muted" style={{ marginBottom: 10, lineHeight: 1.9 }}>
              提醒音用的是同一个媒体库里的音频。在「全部媒体」里选中一段音频，也能直接设为提醒音。
            </div>
            <MusicLib />
          </div>
        )}
      </div>
    </>
  );
}
