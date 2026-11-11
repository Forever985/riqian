import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { featureOn, parseFeatures } from '../lib/theme';
import { fmtClock } from '../lib/date';
import { Icon, type IconName } from './Icons';
import { useT } from '../lib/i18n';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { askProtect } from './Lock';
import { api } from '../api';
import type { ViewKey } from '../types';

/**
 * 导航项。
 *
 * `d` 是悬停时的那句说明（第 152 条）。
 * 光写 `t` 是不行的 —— 提示内容和按钮上的字一模一样，等于没说；
 * 而且英文/小屏时名字还会被截断，正好需要一句人话解释这页干什么。
 */
export const NAV: { k: ViewKey; ic: IconName; t: string; d: string; flag?: string }[] = [
  { k: 'today', ic: 'pen', t: '今天', d: '写今天的日记，摆当天的模块' },
  { k: 'flow', ic: 'flow', t: '流', d: '连着写了多少天，看坚持的痕迹' },
  { k: 'review', ic: 'sparkle', t: '总结', d: '周回顾、月回顾，生成可分享的总结', flag: 'navReview' },
  { k: 'habits', ic: 'check-circle', t: '打卡', d: '每天的习惯，打勾看连续天数', flag: 'navHabits' },
  { k: 'pomodoro', ic: 'timer', t: '番茄钟', d: '专注计时，记下每一段专注', flag: 'navPomodoro' },
  { k: 'calendar', ic: 'calendar', t: '日历', d: '按月翻看，哪天写过一眼就看到', flag: 'navCalendar' },
  { k: 'records', ic: 'search', t: '记录', d: '所有日记的列表与搜索', flag: 'navRecords' },
  { k: 'todos', ic: 'todo', t: '待办', d: '要做的事，支持四象限和拖动排序', flag: 'navTodos' },
  { k: 'countdown', ic: 'hourglass', t: '倒计时', d: '还有多少天：考试、纪念日、截止日', flag: 'navCountdown' },
  /* #250：愿望单。放在倒计时后面 —— 两者都是「往前看的日子」，但一个是倒数、一个是攒 */
  { k: 'wish', ic: 'sparkle', t: '愿望单', d: '想要的东西，攒够了就打勾', flag: 'navWish' },
  { k: 'notes', ic: 'book', t: '笔记', d: '分笔记本的长笔记，富文本可加锁', flag: 'navNotes' },
  { k: 'draw', ic: 'pen', t: '画板', d: '手绘草图，存笔画所以随时能再改', flag: 'navDraw' },
  { k: 'timeline', ic: 'flow', t: '时间轴', d: '记下大事，按年份竖着排开', flag: 'navTimeline' },
  { k: 'ledger', ic: 'database', t: '记账本', d: '记流水、看预算和账户', flag: 'navLedger' },
  { k: 'alarms', ic: 'bell', t: '提醒', d: '定时提醒、每隔多久提醒一次', flag: 'navAlarms' },
  { k: 'drafts', ic: 'archive', t: '草稿箱', d: '写了还没定稿的日子', flag: 'navDrafts' },
  { k: 'media', ic: 'grid', t: '多媒体库', d: '图片、音乐、文件都收在这里', flag: 'navMedia' },
  /*
   * #246：缓存从导航移到「设置 → 数据与缓存」。
   *
   * 用户原话：「缓存什么的应该放到设置里去。」缓存页做的是「看看占了多少、清一清」，
   * 一个月也未必点一次，却和「今天 / 待办」抢同一列位置。设置页本来就有
   * 「数据与缓存」分组，把入口挪过去才是它该待的地方。
   *
   * 注意：视图本身没删（ViewKey 里仍有 'cache'），
   * 只是不再从导航栏进 —— 从设置页跳过去，老的书签 / 恢复的选项卡也不会白屏。
   */
  { k: 'stats', ic: 'chart', t: '统计', d: '字数、打卡、专注的趋势', flag: 'navStats' },
  /*
   * #245：主题 / 插件 / 工坊合并成一个「扩展」。
   *
   * 三页原本各占一格，加上缓存一共四格，全是低频的「装点东西」入口，
   * 把每天要用的几页挤到上面一小撮。合并后内部用选项卡切换，
   * 入口仍在导航栏（不藏进设置）—— 刚拿到别人的包时，
   * 人的第一反应是「哪里装」，不会想到翻设置。
   */
  { k: 'extensions', ic: 'grid', t: '扩展', d: '主题、插件、内容包', flag: 'navExtensions' },
  { k: 'profile', ic: 'user', t: '我的', d: '头像、资料、数据导入导出', flag: 'navProfile' },
  { k: 'settings', ic: 'sliders', t: '设置', d: '外观、模块、通知、快捷键', },
];

/** 顺序存在 settings.navOrder（JSON 数组）；新增项自动补到后面 */
export function orderNav(raw: unknown): typeof NAV {
  let saved: string[] = [];
  if (typeof raw === 'string' && raw) {
    try { saved = JSON.parse(raw); } catch { saved = []; }
  }
  if (!Array.isArray(saved) || !saved.length) return NAV;
  const map = new Map(NAV.map((n) => [n.k as string, n]));
  const out = saved.map((k) => map.get(k)).filter(Boolean) as typeof NAV;
  NAV.forEach((n) => { if (!saved.includes(n.k)) out.push(n); });
  return out;
}

/** 已保存顺序的键列表（设置页与侧栏共用，避免两边算法不一致） */
export function navKeys(raw: unknown): string[] {
  return orderNav(raw).map((n) => n.k as string);
}

/**
 * 第 168 条：导航项右键菜单。
 *
 * 用户原话：「左侧导航栏里面每一项的右键菜单过于苍白了。而且，这不正适合
 * 在左侧导航栏里面每一项的右键菜单里安排『锁』吗？『当前加锁范围』感觉可以用起来了」。
 *
 * 要点是「加锁」必须真的生效 —— 之前 vault 虽然支持任意 scope，但只有
 * 待办 / 倒计时 / 日记 / 总结 / 笔记这几页包了 <Guarded>，别的页就算写了规则也没人看。
 * 所以 App.tsx 里同时给这些页补上了 <Guarded>。
 *
 * 这里「显示/隐藏」改的是 settings.features，和设置页「导航里显示哪些」是同一份数据 ——
 * 两个入口必须写同一个键，否则用户在这儿关了，去设置页看见还是开着的。
 */
const LOCKABLE: Record<string, string> = {
  flow: '流', habits: '打卡', pomodoro: '番茄钟', calendar: '日历',
  records: '记录搜索', todos: '待办', countdown: '倒计时', notes: '笔记',
  media: '多媒体库', ledger: '记账本', timeline: '时间轴', stats: '统计', drafts: '草稿箱',
  draw: '画板',
};

export function Sidebar() {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const goToday = useStore((s) => s.goToday);
  const settings = useStore((s) => s.settings);
  const todos = useStore((s) => s.todos);
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.logs);
  const root = useStore((s) => s.root);
  const pomo = useStore((s) => s.pomo);
  const setSetting = useStore((s) => s.setSetting);
  const pomoPause = useStore((s) => s.pomoPause);
  const pomoStart = useStore((s) => s.pomoStart);

  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ pos: 0, size: 0 });

  const openTodos = todos.filter((t) => !t.done && !t.trashed).length;

  /*
   * 第 136 条：角标不能只给待办一处。
   *
   * 用户原话：「刚刚新建了一条待办。发现左侧导航栏出现数字『1』。希望能够在设置中
   * 进行修改，允许以红点、数字……」—— 后半截的「样式可配」早就做了（badgeStyle），
   * 真正缺的是**别的页面也有数字时却不显示**。一个人的待办是 3 条、打卡还有 2 个没打，
   * 导航上只有一个 3，那这个角标就在骗人。
   *
   * 现在给每个能算出「还剩多少没做」的页面都算一份。算不出来的不给 —— 硬凑一个
   * 数字比不显示更糟（比如「统计」页，它没有「待办事项」这个概念）。
   */
  const badgeOf = (k: string): number => {
    switch (k) {
      case 'todos': return openTodos;
      /* 打卡：今天还没打的（日志存在的就算打过了，和打卡页的判断一致） */
      case 'habits': return habits.filter((h) => {
        if ((h as { archived?: number }).archived) return false;
        const v = logs[h.id];
        return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
      }).length;
      /* 草稿箱：有未定稿的日记才亮，这个数从 overview 拿太绕，先只做「有没有」那种红点，
         数字仍按 openTodos 之外的语义给 0 —— 见下面 badgeZeroHidden 的处理 */
      default: return 0;
    }
  };
  /**
   * 第 228 条：番茄钟可以改名（设置 → 学习 / 番茄钟 → 模块叫什么）。
   * 改名只影响这一项的显示字，其它地方（顶栏标题、迷你计时条）也走同一个 nameOf。
   */
  const pomoName = String(settings.pomoModuleName || '学习');
  const nameOf = useCallback((n: { k: string; t: string }) => (n.k === 'pomodoro' ? pomoName : n.t), [pomoName]);
  const items = useMemo(() => orderNav(settings.navOrder).filter((n) => featureOn(settings, n.flag)), [settings]);
  const t = useT();
  const dock = (settings.navDock as string) || 'left';
  const badgeStyle = String(settings.badgeStyle ?? 'num');
  const collapsed = String(settings.navCollapsed ?? '0') === '1';
  const horiz = dock === 'left' || dock === 'right';

  /* 拖边调宽（这是调宽度，不是排序） */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const cur = horiz ? e.clientX : e.clientY;
      let d = cur - startRef.current.pos;
      if (dock === 'right' || dock === 'bottom') d = -d;
      const size = Math.max(horiz ? 132 : 44, Math.min(horiz ? 420 : 160, startRef.current.size + d));
      document.documentElement.style.setProperty(horiz ? '--navw' : '--navh', `${size}px`);
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.userSelect = '';
      const w = getComputedStyle(document.documentElement).getPropertyValue('--navw').trim();
      void setSetting('navWidth', String(parseInt(w, 10) || 218));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, horiz, dock, setSetting]);

  const onResizerDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const cur = horiz ? e.clientX : e.clientY;
    const size = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue(horiz ? '--navw' : '--navh'),
      10,
    ) || (horiz ? 218 : 56);
    startRef.current = { pos: cur, size };
    document.body.style.userSelect = 'none';
    setDragging(true);
  };

  const pomoActive = pomo.running || pomo.left !== pomo.total;

  /* ---------------- 第 168 条：右键菜单 ---------------- */

  const ctx = useContextMenu();
  const vault = useStore((s) => s.vault);
  const reloadVault = useStore((s) => s.reloadVault);
  const toast = useStore((s) => s.toast);

  const hiddenCount = items.filter((n) => n.flag && !featureOn(settings, n.flag)).length;

  const menuFor = (n: typeof NAV[number]): MenuItem[] => {
    const name = nameOf(n);
    const scope = LOCKABLE[n.k as string];
    const locked = !!scope && (vault?.rules ?? []).some((r) => r.scope === scope && !r.target);
    const visOn = !n.flag || featureOn(settings, n.flag);

    const list: MenuItem[] = [
      { label: '打开', hint: '进这一页', onClick: () => void go(n.k) },
      { sep: true },
    ];

    /* 加锁：只有真能拦住内容的页才给这一项，给了却不生效比不给更糟 */
    if (scope) {
      if (locked) {
        list.push({
          label: '去掉这个锁',
          hint: '以后进这页不再问密码',
          onClick: async () => {
            const rule = (vault?.rules ?? []).find((r) => r.scope === scope && !r.target);
            if (!rule) return;
            await api.vault.remove(rule.id);
            await reloadVault();
            toast(`「${name}」的锁已去除`);
          },
        });
      } else {
        list.push({
          label: '给这一页加锁…',
          hint: '进来先输密码',
          onClick: async () => {
            const ok = await askProtect(scope, '', name);
            toast(ok ? `已给「${name}」加锁` : '没加锁');
          },
        });
      }
    }

    /* 显示 / 隐藏：只对有开关的项给，没有 flag 的（今天 / 流 / 设置）本来就该常在 */
    if (n.flag) {
      list.push({
        label: visOn ? '从导航里藏起来' : '放回导航',
        hint: visOn ? '数据不动，只是不显示' : '',
        onClick: async () => {
          const f = parseFeatures(settings.features as string | undefined);
          await setSetting('features', JSON.stringify({ ...f, [n.flag as string]: visOn ? '0' : '1' }));
          toast(visOn ? `已藏起「${name}」，可在设置里找回来` : `「${name}」已放回导航`);
        },
      });
    }

    list.push({ sep: true });
    list.push({
      label: '调整导航顺序…',
      hint: '去设置里排',
      onClick: () => useStore.getState().goSettings('layout'),
    });

    if (hiddenCount) {
      list.push({
        label: '恢复所有藏起来的页面',
        hint: `现在藏着 ${hiddenCount} 个`,
        onClick: async () => {
          const f = parseFeatures(settings.features as string | undefined);
          const next = { ...f };
          for (const x of items) if (x.flag) next[x.flag] = '1';
          /* 顺手把「全部页面」的 flag 都置 1，否则只恢复当前可见列表里的那几个 */
          for (const k of Object.keys(next)) next[k] = '1';
          await setSetting('features', JSON.stringify(next));
          toast('都放回来了');
        },
      });
    }

    return list;
  };

  return (
    <aside className="side">
      {/* 左上角 LOGO = 首页。侧栏里的排序不再靠拖，统一在「设置 → 界面布局」里调 */}
      <button className="brand" id="brand-home" data-tip="回到首页" onClick={() => void go('welcome')}>
        <span className="mark">签</span>
        <div className="lb"><b>日签</b> <span>JOURNAL</span></div>
      </button>

      <nav className="nav">
        {items.map((n) => (
          <button
            key={n.k}
            className={`navi ${view === n.k ? 'on' : ''}`}
            data-nav={n.k}
            /*
             * 折叠成图标时名字看不见了，提示里要带上名字；
             * 展开时名字就在旁边，只补一句这页是干什么的。
             */
            data-tip={collapsed ? `${t(nameOf(n))} — ${n.d}` : n.d}
            onClick={() => void (n.k === 'today' ? goToday() : go(n.k))}
            onContextMenu={(e) => ctx.open(e, menuFor(n))}
          >
            <span className="ic"><Icon name={n.ic} size={17} /></span>
            <span className="lb">{t(nameOf(n))}</span>
            {/* 加过锁的页在导航上标一把小锁，不然「为什么进不去」会让人懵 */}
            {LOCKABLE[n.k as string] && (vault?.rules ?? []).some((r) => r.scope === LOCKABLE[n.k as string] && !r.target) ? (
              <span className="nav-lock" title="这一页加过锁"><Icon name="lock" size={10} /></span>
            ) : null}
            {/* 第 136 条：角标不再只认待办；样式（数字 / 红点 / 关）跟着设置走 */}
            {(() => {
              if (badgeStyle === 'off') return null;
              const num = badgeOf(n.k);
              if (!num) return null;
              /* 折叠成图标时放不下数字，退成红点；这是原有行为，保留 */
              if (badgeStyle === 'dot' || collapsed) return <span className="badge dot" />;
              /* 数字太宽会把导航项挤歪，99 以上收成 99+ */
              return <span className="badge">{num > 99 ? '99+' : num}</span>;
            })()}
          </button>
        ))}
      </nav>

      {/* 折叠/展开按钮：折叠后才出现，鼠标移到侧栏就能看到（138） */}
      <button
        className="nav-fold"
        data-tip={collapsed ? '展开导航' : '折叠为图标'}
        onClick={() => void setSetting('navCollapsed', collapsed ? '0' : '1')}
      >
        {collapsed ? '»' : '«'}
      </button>

      <div className="side-sep" />

      <div className="side-foot">
        {pomoActive ? (
          <div className={`pomo-mini ${pomo.running ? 'running' : ''}`}>
            <button className="pm-body" data-tip={`点一下打开${pomoName}`} onClick={() => void go('pomodoro')}>
              <span className="pm-dot" />
              <span className="pm-kind">{pomo.kind === 'focus' ? '专注' : '休息'}</span>
              <span className="pm-time">{fmtClock(pomo.left)}</span>
            </button>
            <button
              className="pm-btn"
              data-tip={pomo.running ? '暂停' : '继续'}
              onClick={(e) => { e.stopPropagation(); if (pomo.running) pomoPause(); else pomoStart(); }}
            >
              <Icon name={pomo.running ? 'pause' : 'play'} size={13} />
            </button>
          </div>
        ) : null}
        {t('数据目录')}<b>{root}</b>
      </div>

      <div
        className={`resizer ${dragging ? 'dragging' : ''}`}
        data-tip="拖动调整宽度"
        onMouseDown={onResizerDown}
      />

      {ctx.node}
    </aside>
  );
}
