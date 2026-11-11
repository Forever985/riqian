/**
 * #245：扩展（主题 / 插件 / 工坊）。
 *
 * 用户原话：「导航栏里面创意工坊、主题、插件这种功能应该放到设置里去，
 * 或者不放到设置里去也应该并成一个。」
 *
 * 这三页原本各占导航一格 —— 加上缓存一共四格，全是低频的「装点东西」入口，
 * 把导航撑得很长，而真正每天用的「今天 / 流 / 待办」反被挤到上面一小撮。
 *
 * 为什么并成一页而不是塞进设置：
 *   · 刚拿到别人的包时，人的第一反应是「哪里装」，不会想到翻设置；
 *     藏进设置等于让它凭空消失（这一条在 #241 里已经踩过一次）。
 *   · 三页的结构几乎一样（一列已装项 + 两个动作按钮），本来就是一个功能的三张皮。
 *
 * 用页内选项卡而不是三个并排的长列表：三者是**互斥的选择**（现在要看哪一类），
 * 不是同时要看的并列信息。
 */
import { useState } from 'react';
import { Topbar } from '../components/ui';
import { Icon, type IconName } from '../components/Icons';
import { ThemeCenterView } from './ThemeCenter';
import { PluginCenterView } from './PluginCenter';
import { WorkshopView } from './Workshop';

type Tab = 'theme' | 'plugin' | 'workshop';

const TABS: { k: Tab; n: string; ic: IconName; d: string }[] = [
  { k: 'theme', n: '主题', ic: 'palette', d: '换配色' },
  { k: 'plugin', n: '插件', ic: 'grid', d: '加模块' },
  { k: 'workshop', n: '工坊', ic: 'book', d: '内容包' },
];

export function ExtensionsView() {
  const [tab, setTab] = useState<Tab>('theme');
  const cur = TABS.find((x) => x.k === tab) || TABS[0];

  return (
    <div className="page">
      <Topbar
        title="扩展"
        sub={`主题、插件、内容包 —— 现在看的是${cur.n}`}
        right={
          <div className="seg" role="tablist" aria-label="扩展分类">
            {TABS.map((x) => (
              <button
                key={x.k}
                role="tab"
                aria-selected={tab === x.k}
                className={`seg-b ${tab === x.k ? 'on' : ''}`}
                title={x.d}
                onClick={() => setTab(x.k)}
                data-act={`ext-tab-${x.k}`}
              >
                <Icon name={x.ic} size={13} /> {x.n}
              </button>
            ))}
          </div>
        }
      />
      {/*
       * 内嵌三个中心时，它们各自渲染的 <Topbar> 会被 `embedded` 关掉 ——
       * Topbar 是 portal 到 #topbar-slot 的，两层都渲染会把同一个槽写两遍。
       */}
      {tab === 'theme' ? <ThemeCenterView embedded />
        : tab === 'plugin' ? <PluginCenterView embedded />
          : <WorkshopView embedded />}
    </div>
  );
}
