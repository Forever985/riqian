import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Topbar } from '../components/ui';
import { Icon } from '../components/Icons';
import { RELEASES } from '../lib/changelog';
import type { AppFacts } from '../types';

/* ============================ 更新日志 ============================ */

export function ChangelogView() {
  const [open, setOpen] = useState<string>(RELEASES[0]?.v || '');
  const [q, setQ] = useState('');
  const key = q.trim().toLowerCase();
  const list = key
    ? RELEASES
      .map((r) => ({ ...r, items: r.items.filter((x) => (x + r.title + r.v).toLowerCase().includes(key)) }))
      .filter((r) => r.items.length)
    : RELEASES;
  return (
    <>
      <Topbar
        title="更新日志"
        sub={`共 ${RELEASES.length} 个版本`}
        right={
          <div className="searchbox" style={{ maxWidth: 240 }}>
            <Icon name="search" size={14} />
            <input placeholder="搜版本或功能，比如「定稿」" value={q} onChange={(e) => setQ(e.target.value)} />
            {q ? <button className="sb-clear" onClick={() => setQ('')}>✕</button> : null}
          </div>
        }
      />
      <div className="wrap">
        {!list.length ? <div className="card"><div className="empty">没有匹配的条目，换个词试试。</div></div> : null}
        {list.map((r) => (
          <div className={`card rel ${open === r.v || key ? 'open' : ''}`} key={r.v}>
            <button className="rel-head" onClick={() => setOpen(open === r.v ? '' : r.v)}>
              <span className="rel-v">{r.v}</span>
              <span className="rel-t">{r.title}</span>
              <span className="sp" />
              <span className="rel-d">{r.date}</span>
              <span className="rel-x">{open === r.v ? '−' : '+'}</span>
            </button>
            {open === r.v ? (
              <ul className="rel-list">
                {r.items.map((it) => <li key={it}>{it}</li>)}
              </ul>
            ) : null}
          </div>
        ))}
        <div className="small muted" style={{ padding: '4px 2px 20px' }}>
          这个软件没有自动更新，也不会背着你联网。想升级就把新的 exe 覆盖过去，数据目录不用动。
        </div>
      </div>
    </>
  );
}

/* ============================ 使用说明书 ============================ */

interface Chapter { k: string; t: string; p: string[] }

const MANUAL: Chapter[] = [
  {
    k: 'start', t: '五秒钟上手',
    p: [
      '打开就是「今天」页。左边一列是各个功能，顶部是最常用的按钮。',
      '正文区直接打字，停手半秒自动保存，右上角会显示「已保存」。',
      '想回到首页／欢迎页，点左上角的「签」图标。',
      '关掉窗口不会退出，会缩到右下角托盘；要从托盘右键「退出日签」才真的结束。',
    ],
  },
  {
    k: 'write', t: '写日记',
    p: [
      '标题：正文上方那一行就是标题，可留空。标题会出现在流、记录、日历和分享卡片上。',
      '输入方式：正文右上角的「富文本 / MD / BBCode」按钮可以切换。Markdown 是左边写右边预览。',
      '公式：富文本里点「∑」插入 LaTeX，写 $E=mc^2$ 这种行内公式也行；点已插入的公式可以再改。',
      '模板：右上角「模板」可以把一套预置内容填进当天。',
      '背景：「背景」里能选纯色或多媒体库里的照片。',
      '关联：「关联另一天」可以把两天的日记接起来，「引用」会把某段话搬过来并留个来源。',
      '历史版本：「历史版本」能看到每次保存的快照，随时回滚。',
    ],
  },
  {
    k: 'publish', t: '定稿与草稿箱',
    p: [
      '写完点「定稿」，这一天就收工了，之后默认只读，防止手滑改掉。',
      '想改的话点「改回草稿」，改完再定稿。',
      '有内容但还没定稿的日子都会进「草稿箱」，在侧栏「草稿箱」里能看到全部。',
      '定稿不会删任何东西，也不会上传到哪儿，只是给自己一个「这篇写完了」的标记。',
    ],
  },
  {
    k: 'habits', t: '打卡',
    p: [
      '每个习惯支持不同类型：打勾、次数、时长、数值、时间、备注、评分。',
      '习惯卡片下面那行小字是备注，写完按回车或点别处就存。',
      '「打卡」页能看到本月格子与连续天数。',
    ],
  },
  {
    k: 'todos', t: '待办：放弃和回收站不是一回事',
    p: [
      '放弃 = 这件我不打算做了（过期了、不想做了），它不算删除，也不会算进完成率。放弃的任务在「已放弃」里，随时能捡回来。',
      '删除 = 真的不要了。删掉会先进「回收站」，在回收站里还能恢复；再删一次才彻底消失。',
      '简单说：放弃是态度，删除是动作。',
    ],
  },
  {
    k: 'pomo', t: '番茄钟',
    p: [
      '选时长 → 开始。到点会弹窗 + 响铃（可以在设置里关）。',
      '「统计」区有今日 / 本周 / 本月、连续天数、时段分布、任务排行和逐日柱状。',
      '侧栏底部会出现迷你计时条，点一下回到番茄钟页。',
      '番茄钟记录会写进当天的日记统计里。',
    ],
  },
  {
    k: 'search', t: '找回以前写的东西',
    p: [
      '「记录」页支持关键词、日期范围、心情、标签、只看收藏、只看有图。',
      '关键词里直接写「2026年10月1日」这种自然语言，也能被识别成日期。',
      '「流」是把日记按时间铺开的长卷，适合从头翻。',
    ],
  },
  {
    k: 'share', t: '分享',
    p: [
      '「今天」页右上角「分享」会生成一张卡片：4 种版式、3 种尺寸。',
      '可以保存成图片、复制到剪贴板（直接粘到微信）、复制纯文案，或存成一个能发给别人的网页。',
      '图片是在你电脑上画出来的，不上传任何地方。',
    ],
  },
  {
    k: 'keys', t: '快捷键',
    p: [
      'Ctrl+S 立刻保存 · Ctrl+K 命令面板 · Ctrl+Shift+D 写今天的日记 · F1 看全部快捷键。',
      '全局快捷键（唤出 / 老板键 / 快速记录）在「设置 → 快捷键」里改，被别的软件占用时会提示。',
      '老板键会把主窗藏起来，换成一个假的记事本；再按一次回来。',
    ],
  },
  {
    k: 'secure', t: '密码',
    p: [
      '可以设一个主密码，也可以只给某些范围单独加锁（比如待办、某篇日记、某个笔记本）。',
      '密码提示是明文，谁打开软件都能看到 —— 写一句只有你自己懂的。',
      '忘了密码可以用密保问题重设；实在想不起来，可以把保护清掉（数据一条都不删）。',
      '要说清楚：密码只做本地校验，数据文件本身没有加密。要真正保密，请用系统账户或 BitLocker 加密磁盘。',
    ],
  },
  {
    k: 'data', t: '数据、备份与迁移',
    p: [
      '所有内容都在数据目录里（设置 → 数据与缓存 能看到路径，默认 E:\\日签）。',
      '每天第一次打开会自动备份一份到「自动备份」，最多保留若干份。',
      '换电脑：关掉软件，把整个数据目录拷过去，再打开就行。',
      '导出：设置里可以导出 JSON（全量备份）或 HTML（能直接看的日记本）。',
    ],
  },
  {
    k: 'trouble', t: '遇到问题怎么办',
    p: [
      '先看「联系我们」页：那里有本机信息，出了问题把那段一起发过来最快。',
      '界面白屏：关掉软件重开；还不行就把数据目录里的 riqian.db 拷出来备份，再联系。',
      '数据看着不对：先去「自动备份」里找前一天的副本，别急着改。',
    ],
  },
];

export function ManualView() {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return MANUAL;
    return MANUAL.filter((c) => (c.t + c.p.join('')).toLowerCase().includes(k));
  }, [q]);

  return (
    <>
      <Topbar
        title="使用说明书"
        sub={`${MANUAL.length} 节`}
        right={
          <div className="searchbox" style={{ maxWidth: 240 }}>
            <Icon name="search" size={14} />
            <input placeholder={'搜功能，比如「定稿」'} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      />
      <div className="wrap">
        {list.length ? list.map((c) => (
          <div className="card man" key={c.k} id={`man-${c.k}`}>
            <h3>{c.t}</h3>
            {c.p.map((p, i) => <p className="man-p" key={i}>{p}</p>)}
          </div>
        )) : <div className="card"><div className="empty">没找到「{q}」，换个词试试。</div></div>}
      </div>
    </>
  );
}

/* ============================ 联系我们 ============================ */

/**
 * 第 90 条：开发者的联系方式。
 *
 * 之前这页只教「怎么把反馈发出去」，却没写发到哪儿 —— 用户原话是
 * 「似乎并不能有效的联系到开发者」。
 *
 * 这里不预填任何编造的地址：软件是本地单机的，作者是谁只有你自己知道，
 * 填了才有意义。留空就明确显示「还没填」，而不是显示一个收不到信的假邮箱。
 * `shell.openUrl` 是因为 WebView2 里点 mailto: 一点反应都没有。
 */
const DEV_MAX_LEN = 120;

function clean(v: unknown): string {
  return String(v ?? '').trim().slice(0, DEV_MAX_LEN);
}

function DevCard() {
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const toast = useStore((s) => s.toast);
  const [edit, setEdit] = useState(false);

  // 老字段 contactEmail 兜一下：填过的人别因为改字段名就丢了
  const email = clean(settings.devEmail) || clean(settings.contactEmail);
  const site = clean(settings.devSite);
  const name = clean(settings.devName);

  const anyEmpty = !name && !email && !site;

  const open = async (url: string, label: string) => {
    const r = await api.shell.openUrl(url).catch((e) => ({ ok: false, err: (e as Error).message }));
    if (!r.ok) toast(r.err || `打不开${label}`);
  };

  return (
    <div className="card">
      <h3>
        <Icon name="user" size={14} />开发者联系方式
        <span className="sp" />
        <button className="btn sm ghost" onClick={() => setEdit(!edit)}>{edit ? '收起' : '填/改'}</button>
      </h3>

      {anyEmpty && !edit ? (
        <div className="empty small">
          还没填。这不是漏做 —— 软件不联网，作者的联系方式只能由你自己写进来，
          预填一个地址反而是骗人的。点右上角「填/改」，把邮箱或主页填上，
          以后想反馈就一键发出去。
        </div>
      ) : null}

      {name || email || site ? (
        <>
          <div className="kv"><span>作者</span><b>{name || '未填'}</b></div>
          <div className="kv">
            <span>邮箱</span>
            <b>
              {email ? (
                <button
                  className="btn sm ghost"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => void open(`mailto:${email}?subject=${encodeURIComponent('日签反馈')}`, '邮件客户端')}
                >{email}</button>
              ) : <span className="muted">未填</span>}
            </b>
          </div>
          <div className="kv">
            <span>主页</span>
            <b>
              {site ? (
                <button
                  className="btn sm ghost"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => void open(site, '浏览器')}
                >{site.replace(/^https?:\/\//, '')}</button>
              ) : <span className="muted">未填</span>}
            </b>
          </div>
          <div className="small muted" style={{ marginTop: 8, lineHeight: 1.9 }}>
            点邮箱会用系统邮件客户端写信，点主页会用默认浏览器打开 —— 都走你自己的程序，日签本身不联网。
          </div>
        </>
      ) : null}

      {edit ? (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          <div className="row">
            <span className="small muted" style={{ width: 44 }}>作者</span>
            <input
              className="inp" style={{ width: 220 }} value={name} placeholder="怎么称呼"
              onChange={(e) => void setSetting('devName', e.target.value)}
            />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 44 }}>邮箱</span>
            <input
              className="inp" style={{ width: 220 }} value={email} placeholder="someone@example.com"
              onChange={(e) => void setSetting('devEmail', e.target.value)}
            />
          </div>
          <div className="row">
            <span className="small muted" style={{ width: 44 }}>主页</span>
            <input
              className="inp" style={{ width: 220 }} value={site} placeholder="https://…（可留空）"
              onChange={(e) => void setSetting('devSite', e.target.value)}
            />
          </div>
          <div className="small muted">
            只存在本机的 settings 表里，不上传、不校验、不联网确认。填错了直接改。
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ContactView() {
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const [facts, setFacts] = useState<AppFacts | null>(null);
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void api.facts().then(setFacts).catch(() => null); }, []);

  /* 第 90 条：收件人取「开发者联系方式」里的邮箱，不再是原来那个
     语义含糊的 contactEmail（那个字段的占位文案写的是「你的收件邮箱」，
     却当成收件人在用，填了等于发给自己）。老值仍然兼容。 */
  const email = clean(settings.devEmail) || clean(settings.contactEmail);

  const template = () => [
    '【遇到什么问题】',
    '',
    '【怎么复现】',
    '1.',
    '2.',
    '',
    '【期望的结果】',
    '',
    `【本机信息】日签 v9 · ${facts?.os || ''} · 数据目录 ${facts?.root || ''}`,
  ].join('\n');

  const copyAll = async () => {
    const body = [
      text.trim() || '（这里写问题）',
      '',
      `联系方式：${contact.trim() || '（未填）'}`,
      `日签 v9 · ${facts?.os || ''}`,
      `数据目录：${facts?.root || ''}`,
      `已有日记 ${facts?.entries ?? 0} 天 / 约 ${facts?.words ?? 0} 字`,
    ].join('\n');
    await api.share.copyText(body);
    toast('已复制，粘到聊天窗口发给就行');
  };

  const save = async () => {
    if (!text.trim()) { toast('先把遇到的问题写两句'); return; }
    setBusy(true);
    const r: { ok: boolean; path?: string; err?: string } = await api.feedback(text, contact)
      .catch((e) => ({ ok: false, err: (e as Error).message }));
    setBusy(false);
    if (r.ok) toast(`已保存到 导出/反馈/${(r.path || '').split(/[\\/]/).pop() || ''}`);
    else toast(r.err || '保存失败');
  };

  return (
    <>
      <Topbar title="联系我们" sub="没有服务器：反馈存在你自己电脑上，由你决定发给谁" />
      <div className="wrap">
        <DevCard />

        <div className="card">
          <h3><Icon name="sparkle" size={14} />先说清楚</h3>
          <p className="man-p">
            日签不联网、不收集任何数据，所以没有「提交」这种把内容送到云端的按钮。
            下面这几种方式都是本地的，你确认过再发，发不发、发给谁由你决定。
          </p>
        </div>

        <div className="card">
          <h3>写反馈</h3>
          <textarea
            className="inp"
            style={{ width: '100%', minHeight: 150, lineHeight: 1.8, fontFamily: 'inherit' }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="遇到什么问题？什么操作之后出现的？希望它变成什么样？"
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm ghost" onClick={() => setText(template())}>用模板</button>
            <span className="sp" />
            <input
              className="inp"
              style={{ width: 200 }}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="怎么联系你（可留空）"
            />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存到「导出/反馈」'}</button>
            <button className="btn" onClick={() => void copyAll()}>复制全文</button>
            <button className="btn" onClick={() => void api.app.openExport()}>打开导出目录</button>
            {email ? (
              <button
                className="btn"
                onClick={() => void api.shell.openUrl(
                  `mailto:${email}?subject=${encodeURIComponent('日签反馈')}&body=${encodeURIComponent(text)}`,
                ).catch(() => null)}
              >
                用邮件发出去
              </button>
            ) : null}
          </div>
          <div className="small muted" style={{ marginTop: 8, lineHeight: 1.9 }}>
            保存下来的每个反馈是一个 txt，里面带时间和本机信息，方便排查。
            {email ? '' : '想一键用邮件发，把上面「开发者联系方式」里的邮箱填上就行。'}
          </div>
          {!email ? (
            <div className="row" style={{ marginTop: 6 }}>
              <input
                className="inp"
                style={{ width: 260 }}
                placeholder="填一个收件人邮箱（只存在本机）"
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter') return;
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (!v) return;
                  await setSetting('devEmail', v);
                  toast('已记住这个邮箱');
                }}
              />
              <span className="small muted">填完按回车；邮件由系统邮件客户端发，不经第三方</span>
            </div>
          ) : null}
        </div>

        <div className="card">
          <h3>本机信息</h3>
          <div className="kv"><span>版本</span><b>日签 v9</b></div>
          <div className="kv"><span>系统</span><b>{facts?.os || '读取中…'}</b></div>
          <div className="kv"><span>数据目录</span><b>{facts?.root || '—'}</b></div>
          <div className="kv"><span>已写日记</span><b>{facts?.entries ?? 0} 天 · 约 {facts?.words ?? 0} 字</b></div>
          <div className="kv"><span>番茄记录</span><b>{facts?.pomoDays ?? 0} 天</b></div>
          <div className="small muted" style={{ marginTop: 8 }}>
            反馈时贴上面这几行，定位问题会快很多。
          </div>
        </div>
      </div>
    </>
  );
}
