/**
 * #241 创意工坊（内容包）。
 *
 * 和另外两个中心的分别：主题改长相、插件改结构，工坊是**搬内容**——
 * 一套日记模板、一批倒计时、一组整理好的标签。
 *
 * 这里刻意不做「作品热度 / 下载量 / 评分」：本地日记本没有服务端，
 * 拿不到也造不出真实的社区数据。做一个假的排行榜不如老实说
 * 「你把文件发给谁，谁就能装」。
 */
import { useCallback, useMemo, useState } from 'react';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { useStore } from '../store';
import { readRegistry, installWorkshop, type InstalledWorkshop } from '../lib/extensions';
import type { WorkshopPack } from '../lib/pack';
import { InstallDialog, InstalledList, MakePackDialog } from '../features/PackUI';

/** 工坊作品的四个类别。顺序按「用户最可能想要的」排，不是按字母 */
const WORKS: { k: string; n: string; d: string; ok: boolean }[] = [
  {
    k: 'templates',
    n: '日记模板',
    d: '一套现成的写作骨架：晨间三问、读书笔记、会议纪要。装完在写日记时可直接套用。',
    ok: true,
  },
  {
    k: 'countdowns',
    n: '倒计时清单',
    d: '打包一批纪念日 / 截止日，比如「二十四节气」「考研倒计时」。',
    ok: true,
  },
  {
    k: 'tags',
    n: '标签体系',
    d: '别人整理好的一套标签（如「情绪 / 工作 / 健康」三类），装进来就能用。',
    ok: true,
  },
  {
    k: 'ledgerCats',
    n: '记账分类',
    d: '一套记账分类模板。注意：分类在库里不是独立数据，必须有记账记录才存在。',
    ok: false,
  },
];

/** #245：`embedded` = 被「扩展」页内嵌，不自己渲染顶栏，见 ThemeCenter 开头的说明 */
export function WorkshopView({ embedded = false }: { embedded?: boolean } = {}) {
  const settings = useStore((s) => s.settings) as Record<string, unknown>;
  const toast = useStore((s) => s.toast);

  const [installing, setInstalling] = useState(false);
  const [making, setMaking] = useState(false);
  const [tick, setTick] = useState(0);

  const reg = useMemo(() => readRegistry(settings), [settings, tick]);
  const works = reg.items.filter((x): x is InstalledWorkshop => x.kind === 'workshop');

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const nameOf = (k: string) => WORKS.find((w) => w.k === k)?.n || k;

  const actions = (
    <>
      <button className="btn" onClick={() => setMaking(true)} data-act="workshop-make">
        <Icon name="share" /> 打包我的内容
      </button>
      <button className="btn primary" onClick={() => setInstalling(true)} data-act="workshop-install-open">
        <Icon name="plus" /> 安装作品
      </button>
    </>
  );

  return (
    <div className={embedded ? '' : 'page'}>
      {embedded ? (
        <div className="row" style={{ marginBottom: 12 }}>{actions}</div>
      ) : (
        <Topbar
          title="创意工坊"
          sub={`${works.length} 件作品已装`}
          right={actions}
        />
      )}

      <div className="hint" style={{ marginBottom: 14, lineHeight: 1.7 }}>
        创意工坊装的是<b>内容</b>：模板、倒计时、标签。别人把整理好的东西打成一个
        <code> .json </code>文件发给你，装进来就能用，卸载时也只撤掉它带来的那些。
      </div>

      <h3 style={{ fontSize: 14, margin: '4px 0 10px' }}>作品类别</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
        {WORKS.map((w) => {
          const n = works.filter((x) => x.work === w.k).length;
          return (
            <div
              key={w.k}
              className="card"
              style={{ padding: 14, opacity: w.ok ? 1 : 0.72 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <b style={{ fontSize: 13.5 }}>{w.n}</b>
                {n > 0 && <span className="small muted">已装 {n}</span>}
                {!w.ok && (
                  <span
                    className="small"
                    style={{
                      padding: '1px 6px', borderRadius: 5,
                      background: 'var(--panel2)', border: '1px solid var(--line)',
                      color: 'var(--ink3)',
                    }}
                  >
                    仅可导出
                  </span>
                )}
              </div>
              <div className="small muted" style={{ lineHeight: 1.65 }}>{w.d}</div>
            </div>
          );
        })}
      </div>

      <h3 style={{ fontSize: 14, margin: '22px 0 10px' }}>已装的作品</h3>
      {works.length === 0 ? (
        <div className="card" style={{ padding: 18, textAlign: 'center' }}>
          <div style={{ marginBottom: 6 }}>还没有装过别人的作品</div>
          <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.7 }}>
            拿到一个 <code>.json</code> 内容包，点「安装作品」拖进去。
            <br />
            你自己整理的一套标签，也能打包发给别人。
          </div>
          <button className="btn" onClick={() => setInstalling(true)} data-act="workshop-install-empty">
            安装一个
          </button>
        </div>
      ) : (
        <InstalledList
          kind="workshop"
          emptyText="还没有装过作品"
          onRefresh={refresh}
          slotExtra={(rec) => {
            const w = rec as InstalledWorkshop;
            const n = w.itemIds.length + w.createdTags.length;
            return (
              <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
                {nameOf(w.work)} · {n} 项
              </span>
            );
          }}
        />
      )}

      <h3 style={{ fontSize: 14, margin: '22px 0 10px' }}>注意事项</h3>
      <div className="card" style={{ padding: 14 }}>
        <div className="small" style={{ lineHeight: 1.9 }}>
          · <b>标签作品</b>需要你已经有至少一篇日记当落脚点。空库时会提示跳过了几个，
          而不是凭空给你造一篇没写过的日记。
          <br />
          · <b>记账分类作品</b>目前只能导出，不能导入 —— 分类在库中不是独立数据，
          没有记账记录就没有分类。伪造 0 元记录来撑起分类，比不支持更糟。
          <br />
          · 装模板不会改你已有的模板，只会新增；同名也不会覆盖。
          <br />
          · 卸载按 id 精确删，你后来自己改过内容的条目如果 id 变了就不会被误删。
        </div>
      </div>

      {installing && (
        <InstallDialog
          kind="workshop"
          title="安装作品"
          onClose={() => setInstalling(false)}
          onInstall={async (p) => {
            const r = await installWorkshop(p as WorkshopPack);
            if (!r.ok) throw new Error(r.err || '安装失败');
            refresh();
            toast(`已装上「${p.name}」`);
            return `已装上「${p.name}」，共 ${r.count ?? 0} 项`;
          }}
        />
      )}
      {making && <MakePackDialog kind="workshop" onClose={() => setMaking(false)} />}
    </div>
  );
}