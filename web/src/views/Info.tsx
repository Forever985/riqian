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
    k: 'notes', t: '笔记',
    p: [
      '笔记和日记是两套东西：日记按天走，一页一天；笔记是「想到就写」的长文，不占日期。',
      '左边是笔记本树，可以无限嵌套（旅行 → 2024 → 京都 这样一层层下去）。拖动笔记本能改顺序，拖到别的本子身上就变成它的子本。',
      '新建笔记本时注意：在当前选中的本子里点「新建」，建出来的是**子本**，不是同级。',
      '每篇笔记可以单独设一个色点和图标，右键「颜色与图标」就地改；不改就跟着笔记本的颜色走（这时色点是虚线）。',
      '右键「钉到桌面」会把这篇笔记变成一张常驻便签贴在你屏幕上 —— 拖动标题栏挪位置，双击标题栏切换大中小，位置会记住。',
      '便签里写的是纯文本，写两笔就自动存回这篇笔记，和笔记页是同一份数据，不是复制品。',
      '笔记支持富文本、Markdown、BBCode 三种写法，而且可以混着写：一段 Markdown 里插一句 [b]加粗[/b] 也能正常显示。',
      '整篇笔记或单个笔记本都能单独加密码，别人翻到这一篇会先要密码。',
    ],
  },
  {
    k: 'draw', t: '画板',
    p: [
      '画板存的是笔画而不是图片，所以随时能再改、能换颜色、能撤销重做。',
      '有拾色器：色相条 + 明暗面，拖着调的时候画布实时跟着变，也能直接填 hex 值；最近用过的颜色会自动记住。',
      '画好的板子可以导出成图片，也能放进多媒体库当素材，日记里引用它。',
      '手写笔和鼠标都能画；触屏设备上直接用手写。',
    ],
  },
  {
    k: 'countdown', t: '倒计时',
    p: [
      '建一条倒计时只要三样：名字、目标日期、有没有颜色。纪念日、考试、截止日都放得下。',
      '支持重复：每年、每月、每周、每月第几个周几（比如「每月最后一个周四」）都能设。',
      '点星标可以把它标成「重要」；按「四象限」看时，星标 = 重要，7 天内到期 = 紧急，自动分到四个格子里。',
      '在四象限里把卡片拖到别的格子，只会改星标，不会偷偷改你的真实日期 —— 拖的时候会告诉你差了几天。',
      '过完的日子不会消失，会进「已完成」，也能恢复。',
    ],
  },
  {
    k: 'ledger', t: '记账本',
    p: [
      '先建账户（现金、银行卡、某张卡都行），再记流水。一条流水就是「哪天、哪个账户、进了还是出了、多少、什么类目」。',
      '「总览」看这个月花了多少、剩下多少；「明细」按天列出来，点一条能改。',
      '可以设预算，超了会在总览上标出来。',
      '周期账单（房租、会员费）设好之后，到那个月点一下就能整批入账，不用一条条敲。',
      '类目可以改名、可以删，改名时历史流水跟着走。',
    ],
  },
  {
    k: 'timeline', t: '时间轴两处',
    p: [
      '「记录」页里的时间轴是把**日记**铺开：按年 / 按月 / 按日三种粒度，四个方向（纵向、纵向往上、横向、横向倒着）。',
      '粒度选「按年」时点某个年份，会钻进那一年的月份；再点月份，钻进那个月的每一天；点某一天才打开日记。顶上一直有一条面包屑能退回去。',
      '侧栏「时间轴」是**大事时间轴**，记的是「什么时候发生了什么」，和日记不是一份数据 —— 搬家、入职、第一次见面这类节点放这里。',
    ],
  },
  {
    k: 'alarms', t: '提醒',
    p: [
      '提醒有固定时刻的（每天 9:00），也有按间隔的（每隔两小时提醒一次喝水）。',
      '方式可以选：弹窗、系统通知、响铃，三样能单独开关。',
      '贪睡默认 5 分钟，可以改。',
      '错过的提醒不会突然一股脑全弹出来，会在下次打开时问你要不要补。',
      '打卡提醒可以指定「提前多久提醒」和「没打卡时隔多久再提醒一次」，不是只能定一个点。',
    ],
  },
  {
    k: 'stats', t: '统计',
    p: [
      '顶上有一条「时间区间」：全部 / 近 7 天 / 近 30 天 / 近 90 天 / 今年 / 去年，也可以自己选起止日期。',
      '日记条数、字数、打卡次数、番茄时长、标签、心情分布都跟着区间走。',
      '「当前连续」和「最长连续」不跟区间 —— 它们天生是跨全历史的指标，切了区间就没意义了，缩短了反而会让人以为坚持断了。',
      '每张卡片都能拖动排序：点右上角「排序」，按住卡片上的 ⠿ 拖，松手自动记住。',
      '想从头算起可以「重置统计」，但会先弹一次警告让你确认 —— 它只清番茄和打卡记录，日记一个字都不动。',
    ],
  },
  {
    k: 'media', t: '多媒体库与缓存',
    p: [
      '图片、音频、视频、文件都收在「多媒体库」里，共用一份索引。引用按内容哈希走，两个同名文件不会串。',
      '文件夹可以无限嵌套：点中一个文件夹再「新建子文件夹」就建在它里面；移动文件时也能直接写「旅行/2024/京都」这种路径。',
      '点父文件夹会看到所有子文件夹里的文件。右键文件夹改名，子文件夹会一起跟着改。',
      '视图有好几种：超大图标 / 标准 / 列表 / 详细信息 / 按月。选过之后会记住。',
      '「整理」模式可以勾选多个文件，批量移文件夹、批量打标签、批量删。',
      '链接音频（粘一个 mp3 地址进来的那种）可以「缓存到本地」，缓存之后断网也能放。设置里能限制缓存哪些后缀、总共占多大。',
      '侧栏最下面有独立的「缓存」页：一眼看清媒体、缩略图、备份、临时文件各占多少，能按策略清，也能单独清某一类。媒体原文件不提供单清 —— 那是你自己的照片和录音。',
    ],
  },
  {
    k: 'extensions', t: '主题、插件、工坊',
    p: [
      '「主题」：内置多套配色之外，别人做的配色包存成 .json 拖进来就能装，装完立刻切过去。',
      '「插件」：插件能给日记加模块（比如「今日三件好事」），也能加一组标签、一张待办清单。',
      '「工坊」：模板、倒计时清单、标签体系这类内容包。',
      '三个中心都能反向导出 —— 把你调好的配色、配好的模块、整理好的标签打包发给别人。',
      '装之前一定会先给你看这个包会做什么：改哪些颜色、加哪些模块。不点安装不会动任何东西。',
      '卸载会把它自己加的东西撤干净，不会留一堆孤儿数据。',
    ],
  },
  {
    k: 'tray', t: '托盘、悬浮球与热键',
    p: [
      '关窗口默认缩到托盘，不会退出。真要退出：托盘右键「退出日签」。',
      '托盘右键菜单里放什么，可以在「设置 → 托盘」里勾选；「退出」永远留最后一项。',
      '托盘图标可以设成「不显示」，这时只能靠热键或悬浮球把窗口找回来。',
      '开了「锁定后图标带小锁」之后，软件锁上时托盘图标右下角会叠一个红色小锁，解锁就恢复 —— 离开工位瞟一眼就知道锁了没。',
      '右下角可以开一个悬浮小 logo：点一下唤出主窗，拖着能挪位置。',
      '全局热键在「设置 → 快捷键」里改，被别的软件占用时会直接告诉你哪一条没注册上。',
    ],
  },
  {
    k: 'quad', t: '四象限怎么用',
    p: [
      '重要 × 紧急分成四格：马上做（重要且紧急）、计划做（重要不紧急）、有空做（紧急不重要）、别做（都不）。',
      '待办、倒计时、番茄钟挑任务都用同一套四象限，格子颜色和顺序在哪儿都一样，学一次就到处能用。',
      '最重要的一格永远是「重要不紧急」—— 那才是长期来看真正决定结果的事，也是最容易被挤掉的。',
    ],
  },
  {
    k: 'secure', t: '密码',
    p: [
      '可以设一个主密码，也可以只给某些范围单独加锁（比如待办、某篇日记、某个笔记本）。',
      '顶栏右上角有一个小锁按钮，在哪一页点它就给哪一页加锁，不用跑到设置里找。',
      '左侧导航每一项右键也能直接加锁。',
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
      '软件自己会记日志：设置 → 诊断里能直接看最近的日志，也能把日志导出发过来。',
      '真的崩了会在数据目录的「日志」里留一份崩溃记录，里面有时间、位置和当时在做什么。',
    ],
  },
  {
    k: 'philosophy', t: '几条它坚持的原则',
    p: [
      '数据是纯本地的一个 SQLite 文件。没有账号、没有云、不会背着你联网。',
      '不自动更新。想升级就把新 exe 覆盖过去，数据目录不用动；想留在旧版也没人拦你。',
      '不删你的东西。待办有「放弃」和「删除」两级，笔记和日记都有回收站，删了还能捞回来。',
      '破坏性操作一定要你确认两次。重置统计、清空缓存这种，第一下只是展开警告。',
      '所有导出都在本机完成，图片是本地画的，不经过任何服务器。',
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
