import { useEffect } from 'react';
import { playAlarmSound, playChime, useStore, installFlushHook } from './store';
import { api } from './api';
import { bgLayerStyle, parseBg } from './features/mediaTone';
import { useBgRotate } from './features/bgRotate';
import { imgUrl } from './lib/media';
import { Sidebar } from './components/Sidebar';
import { Tabs } from './components/Tabs';
import { AppLockScreen, Guarded } from './components/Lock';
import { ConfirmHost, PromptHost, Toast } from './components/ui';
import { TooltipLayer } from './components/Tooltip';
import { installContextMenuGuard } from './components/ContextMenu';
import { TodayView } from './views/Today';
import { FlowView } from './views/Flow';
import { HabitsView } from './views/Habits';
import { PomodoroView } from './views/Pomodoro';
import { CalendarView } from './views/CalendarView';
import { RecordsView } from './views/Records';
import { TodosView } from './views/Todos';
import { CountdownView } from './views/Countdown';
import { StatsView } from './views/Stats';
import { SettingsView } from './views/Settings';
import { WelcomeView } from './views/Welcome';
import { NotesView } from './views/Notes';
import { ProfileView } from './views/Profile';
import { ReviewView } from './views/Review';
import { ChangelogView, ContactView, ManualView } from './views/Info';
import { DraftsView } from './views/Drafts';
import { MediaPage } from './views/Library';
/* 第 55 条：缓存单独一个页面 */
import { CacheCenterView } from './views/CacheCenter';
import { LedgerView } from './views/Ledger';
import { AlarmsView } from './views/Alarms';
import { MilestonesView } from './views/Milestones';
import { DrawView } from './views/Draw';
import { ThemeCenterView } from './views/ThemeCenter';
import { PluginCenterView } from './views/PluginCenter';
import { WorkshopView } from './views/Workshop';
import { CommandPalette, QuickPanel, ShortcutHelp } from './features/quick';
import { applyAppearance } from './lib/theme';
import { importImageFiles, imageFilesFromDataTransfer } from './lib/upload';

/**
 * 判断这次拖放是不是「导入文件」。
 *
 * 为什么光看 defaultPrevented 不够（第 225 条的根因）：
 * 页面里拖一张**已有的图**（<img> 或背景图之间的拖拽）时，浏览器自己发起的是
 * 一次原生 text/uri-list 拖放，页面里没有任何处理器去 preventDefault，
 * 事件一路冒到 window —— 于是被当成「从资源管理器拖了个文件进来」，
 * 弹出「已导入 1 张」，而且因为 handle() 会 toast 两次（先「正在导入…」再「已导入」），
 * 用户看到的就是两个气泡一闪而过。
 *
 * 所以判据要再加一层：必须真的带着 **Files** 才算导入。
 * 原生拖图只有 text/uri-list / text/plain，没有 files，一眼能分开。
 */
function hasRealFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  // types 里有 'Files' 才是从系统拖进来的文件；页面内拖图只有 text/*
  const types = Array.from(dt.types || []);
  if (!types.includes('Files')) return false;
  return !!(dt.files && dt.files.length);
}

/** 任意位置拖入 / 粘贴图片 → 进图片库；今天有图片模块就顺手挂上 */
function useGlobalImageIntake() {
  useEffect(() => {
    const handle = async (files: File[], target: 'images' | 'media') => {
      if (!files.length) return;
      const st = useStore.getState();
      st.toast('正在导入图片…');
      const ids = await importImageFiles(files);
      await st.reloadMedia();
      if (!ids.length) { st.toast('没有可导入的图片'); return; }
      /*
       * 第 225 条：只有「拖到图片模块里」才自动挂到今天的图片模块。
       * 以前不管拖到哪儿都挂上去 —— 用户在设置页拖张图当背景，
       * 结果今天的日记里莫名其妙多了一堆图。
       */
      if (target !== 'images') {
        st.toast(`已导入 ${ids.length} 张到多媒体库`);
        return;
      }
      const imgMod = st.modules.filter((m) => m.enabled === 1).find((m) => m.type === 'images');
      if (!imgMod) { st.toast(`已导入 ${ids.length} 张到多媒体库`); return; }
      const cur = Array.isArray(st.draft.values[imgMod.id]) ? (st.draft.values[imgMod.id] as string[]) : [];
      const next = [...cur];
      ids.forEach((id) => { if (!next.includes(id)) next.push(id); });
      st.setValue(imgMod.id, next);
      st.scheduleSave();
      st.toast(`已导入 ${ids.length} 张，并放进今天的图片模块`);
    };

    const onDragOver = (e: DragEvent) => {
      // 只有真的带文件时才拦截，否则页面内拖图的光标会变成「禁止」
      if (hasRealFiles(e.dataTransfer)) e.preventDefault();
    };

    const onDrop = (e: DragEvent) => {
      if (e.defaultPrevented) return;
      if (!hasRealFiles(e.dataTransfer)) return;      // 页面内拖图 / 拖文字，一律不管
      e.preventDefault();
      const files = imageFilesFromDataTransfer(e.dataTransfer);
      if (!files.length) return;
      // 落在图片模块里才算「进今天的图」，否则只进多媒体库
      const el = e.target instanceof Element ? e.target.closest('.imgs') : null;
      void handle(files, el ? 'images' : 'media');
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFromDataTransfer(e.clipboardData);
      if (!files.length) return;                                     // 普通文字粘贴不受影响
      e.preventDefault();
      void handle(files, 'media');
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

/**
 * 软件背景（第 113 条）：铺在最底层的固定图，和日记卡片的背景是同一套调色参数。
 * 单独一层，不写在 .app 上 —— 换图/调色时不会引起整个应用重排。
 */
function GlobalBg() {
  const bg = useStore((s) => String(s.settings.bgGlobal || ''));
  const tone = useStore((s) => String(s.settings.bgGlobalTone || ''));
  /* 第 179 条：轮换。间隔和图池都在一个 hook 里，换图只改 DOM 不重渲染。 */
  useBgRotate();
  if (!bg || bg.startsWith('#')) return null;
  const src = imgUrl(bg);
  if (!src) return null;
  return <div className="gbg" style={bgLayerStyle(src, parseBg(tone))} aria-hidden />;
}

/** 宿主每 30 秒推一次"该响的提醒"。装在 App 上，保证任何页面都能收到。 */
function installAlarmHook() {
  const w = window as unknown as { __ALARMS__?: (list: unknown) => void };
  const prev = w.__ALARMS__;
  w.__ALARMS__ = (list) => {
    try {
      const arr = Array.isArray(list)
        ? list as { id?: string; title?: string; kind?: string; mode?: string; sound?: string }[]
        : [];
      if (arr.length) {
        const names = arr.map((x) => x.title || x.kind || '提醒').join('、');
        // 静默的提醒「只记一笔」，不该再冒一条界面提示条；全静默时干脆不出声不弹条
        const noisy = arr.some((x) => String(x.mode || '') !== 'silent');
        if (noisy) useStore.getState().toast('提醒：' + names);
        // 第 143 条：方式 / 声音是按条配的，逐条处理。
        //   ''      跟随全局设置（老数据都走这条，行为和以前一样）
        //   popup   只弹窗，不出声
        //   sound   只响铃，不弹窗
        //   both    两个都来
        //   silent  只记一笔，什么都不做
        for (const f of arr) {
          const mode = String(f.mode || '');
          const wantPopup = mode !== 'sound' && mode !== 'silent';
          const wantSound = mode !== 'popup' && mode !== 'silent';
          if (wantPopup) {
            void api.notify.push({
              title: f.title || '提醒',
              body: '到点了，点这里看看',
              kind: 'alarm',
              // 单条覆盖全局：明确选了弹窗的（只弹窗 / 弹窗+响铃）强制开，
              // 跟随设置的（老数据 mode 为空）传 -1 交给 notifyDesktop 决定
              desktop: mode === 'popup' || mode === 'both' ? 1 : -1,
            }).catch(() => null);
          }
          // 声音：用户明确选了方式（非「跟随设置」）就该真的响；跟随设置时交给 notifySound 决定
          if (wantSound) playAlarmSound(String(f.sound || ''), mode !== '');
        }
      }
    } catch { /* 响铃失败不影响别的 */ }
    if (typeof prev === 'function') prev(list);
  };
}

/**
 * 第 140 条：打卡提醒。
 *
 * 该不该发（开关、时间、提前量、间隔、今天发过几次、是不是全打完了）
 * 都由宿主判断，这边只负责喊一声 + 给个「去打卡」的入口，
 * 免得两处各记一套状态、迟早对不上。
 *
 * 第 98 条补的两件事都在这一层：
 *   ① 提醒方式为静音时不响铃（但要留角标，不能完全没痕迹）
 *   ② 第二次开始换语气 —— 原来说完就完了，一律同一句话，
 *      用户很难意识到"这已经是第三次催了"。
 */
function installHabitRemindHook() {
  const w = window as unknown as {
    __HABIT_REMIND__?: (p: {
      count?: number; names?: string[]; nth?: number; max?: number; how?: string;
    }) => void;
  };
  w.__HABIT_REMIND__ = (p) => {
    try {
      const n = Number(p?.count) || 0;
      if (n <= 0) return;
      const names = (p?.names || []).filter(Boolean);
      const nth = Number(p?.nth) || 1;
      const list = names.length ? names.join('、') : '';
      const tail = names.length && n > names.length ? ` 等 ${n} 项` : '';

      // 第一次只是告知；越往后越直接，但别骂人 —— 这是提醒不是训话
      const head = nth <= 1
        ? (list ? `还没打卡：${list}${tail}` : `今天的卡还没打（${n} 项）`)
        : nth === 2
          ? (list ? `还差 ${n} 项：${list}${tail}` : `还有 ${n} 项没打卡`)
          : (list ? `第 ${nth} 次提醒 · 还差 ${n} 项：${list}${tail}` : `第 ${nth} 次提醒 · 还有 ${n} 项`);

      useStore.getState().toast(head);

      /* how: sound 正常响 / silent 完全不出声 / badge 只发通知不响铃。
         深夜被铃声吵醒比漏一次打卡更让人恼火，所以这个必须听用户的。 */
      if ((p?.how || 'sound') === 'sound') playChime(1, true);
    } catch { /* 提醒失败不能影响别的 */ }
  };
}

/**
 * 第 21 条：节日提醒。
 *
 * 原来节日只在日历和欢迎页**展示**，不主动说一声，节日当天不打开软件就永远错过。
 * 判断（该不该发、今天发过没有、提前几天）都在宿主里做，这边只管说什么。
 */
function installFestivalRemindHook() {
  const w = window as unknown as {
    __FESTIVAL_REMIND__?: (p: { count?: number; names?: string[]; days?: number[]; todayNames?: string[] }) => void;
  };
  w.__FESTIVAL_REMIND__ = (p) => {
    try {
      const names = (p?.names || []).filter(Boolean);
      if (!names.length) return;
      const todayNames = (p?.todayNames || []).filter(Boolean);
      const days = p?.days || [];
      let msg: string;
      if (todayNames.length) {
        // 今天的节日优先 —— 说「今天中秋」比「中秋还有 0 天」像人话
        msg = `今天是${todayNames.join('、')}`;
      } else {
        const first = names[0];
        const d = Number(days[0]);
        msg = d === 1 ? `明天是${first}` : `${d} 天后是${first}`;
        if (names.length > 1) msg += `（还有 ${names.slice(1).join('、')}）`;
      }
      useStore.getState().toast(msg);
      // 只在「今天就是」的时候响一下，提前预告不打扰人
      if (todayNames.length) playChime(1, true);
    } catch { /* 提醒失败不能影响别的 */ }
  };
}

export default function App() {
  const ready = useStore((s) => s.ready);
  useEffect(() => { installAlarmHook(); installHabitRemindHook(); installFestivalRemindHook(); }, []);

  /*
   * 第 194 条：把 DevTools 的键盘入口也堵上。
   * 宿主已经关掉了默认右键菜单，这里补 F12 / Ctrl+Shift+I 这些快捷键 ——
   * 一个日记软件不该让用户随手按出控制台。
   */
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.key === 'F12') { e.preventDefault(); e.stopPropagation(); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && ['i', 'I', 'j', 'J', 'c', 'C'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, []);
  const bootError = useStore((s) => s.bootError);
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const init = useStore((s) => s.init);
  const pomoTick = useStore((s) => s.pomoTick);
  const appLocked = useStore((s) => s.appLocked);
  const date = useStore((s) => s.date);

  useEffect(() => {
    installFlushHook();
    void init();
  }, [init]);

  // 番茄钟的节拍放在最外层，切到别的页面也不停
  useEffect(() => {
    const t = setInterval(() => pomoTick(), 1000);
    return () => clearInterval(t);
  }, [pomoTick]);

  useEffect(() => { applyAppearance(settings); }, [settings]);

  // 跨过日界线（或半夜没关软件）时自动把「今天」推到新的一天，不用手动刷新
  useEffect(() => {
    const tick = () => {
      const st = useStore.getState();
      const now = (() => {
        const d = new Date();
        const ds = st.dayStart;
        if (ds > 0 && d.getHours() < ds) d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();
      if (now !== st.date && st.view === 'today') void st.setDate(now);
    };
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  useGlobalImageIntake();

  /*
   * 第 235 条：右键菜单别一刀切全禁。
   *
   * 宿主那边关掉的是 WebView2 的**原生浏览器菜单**（里面有「检查」「另存为」这种
   * 对用户毫无意义、还把 DevTools 摊出来的东西），那个该关。
   * 但用户说的是「应用自己的右键菜单不该被封死」—— 这俩不是一回事。
   *
   * 这里统一装一个兜底：没自己挂菜单的地方，右键静默无事；
   * 已经挂了的（日历、笔记、多媒体、选项卡……）走各自那份。
   * 输入框里例外，交回浏览器，系统的拼写检查和复制粘贴还能用。
   */
  useEffect(() => installContextMenuGuard(), []);

  // 窗口内快捷键：只在日签有焦点时生效，跟宿主注册的全局热键分工明确
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (st.dirty) void st.flushSave().then(() => st.toast('已保存'));
        else st.toast('已经是最新的了');
        return;
      }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); st.setPalette(!st.palette); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); st.setQuick('diary'); return; }
      if (e.key === 'F1') { e.preventDefault(); st.setHelp(!st.help); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dock = (settings.navDock as string) || 'left';
  const collapsed = String(settings.navCollapsed) === '1';
  /* 第 5 条：折叠后悬停能不能展开，由设置决定（默认开）。
     没这一项时折叠就是个单向门 —— 想找页面只能先取消折叠。 */
  const hoverExpand = String(settings.navHoverExpand ?? '1') !== '0';

  const body = (() => {
    switch (view) {
      case 'welcome': return <WelcomeView />;
      case 'flow': return <Guarded scope="flow" label="流（这条线上全是日记日期）"><FlowView /></Guarded>;
      case 'habits': return <Guarded scope="habits" label="打卡记录"><HabitsView /></Guarded>;
      case 'pomodoro': return <Guarded scope="pomodoro" label="番茄钟记录"><PomodoroView /></Guarded>;
      case 'calendar': return <Guarded scope="calendar" label="日历（每个点都能看出那天写没写）"><CalendarView /></Guarded>;
      case 'records': return <Guarded scope="records" label="记录搜索（能翻到所有日记）"><RecordsView /></Guarded>;
      // 加过密码的范围在进入页面时先问一次（没配规则就直接放行，无感）
      case 'todos': return <Guarded scope="todos" label="待办清单"><TodosView /></Guarded>;
      case 'countdown': return <Guarded scope="countdown" label="倒计时"><CountdownView /></Guarded>;
      case 'notes': return <NotesView />;
      // 总结会把日记正文摘出来，所以它跟日记共用同一道锁，不能成了绕过密码的后门
      case 'review': return <Guarded scope="diary" label="总结（里面摘了日记原文）"><ReviewView /></Guarded>;
      case 'drafts': return <Guarded scope="drafts" label="草稿箱（里面是没定稿的日记）"><DraftsView /></Guarded>;
      case 'changelog': return <ChangelogView />;
      case 'manual': return <ManualView />;
      case 'contact': return <ContactView />;
      case 'media': return <Guarded scope="media" label="多媒体库"><MediaPage /></Guarded>;
      // 旧的 music 路由保留，直接落在多媒体库的「提醒音」栏，老入口不会 404
      case 'music': return <Guarded scope="media" label="多媒体库"><MediaPage initialTab="sound" /></Guarded>;
      case 'ledger': return <Guarded scope="ledger" label="记账本"><LedgerView /></Guarded>;
      case 'alarms': return <AlarmsView />;
      case 'timeline': return <Guarded scope="timeline" label="时间轴"><MilestonesView /></Guarded>;
      case 'draw': return <Guarded scope="draw" label="画板"><DrawView /></Guarded>;
      case 'profile': return <ProfileView />;
      case 'stats': return <Guarded scope="stats" label="统计（能推断出你写了多少）"><StatsView /></Guarded>;
      /*
       * #241 三个中心不加 <Guarded>：这里没有用户的内容，
       * 只有「装过哪些包」和公开的包元信息。锁上它只会挡住
       * 用户自己给别人装东西，防不住任何泄露。
       */
      case 'themeCenter': return <ThemeCenterView />;
      case 'pluginCenter': return <PluginCenterView />;
      case 'workshop': return <WorkshopView />;
      /* 第 55 条：缓存独立入口。里面全是本地文件统计，没有隐私内容，不加锁 */
      case 'cache': return <CacheCenterView />;
      case 'settings': return <SettingsView />;
      case 'today': return <Guarded scope="diary" target={date} label="这一天的日记"><TodayView /></Guarded>;
      default: return <TodayView />;
    }
  })();

  // 全软件密码：锁着的时候只显示锁屏，不加载任何业务内容
  if (appLocked) {
    return (
      <div className={`app ${collapsed ? 'nav-collapsed' : ''}`} id="app" data-dock={dock} data-hover-expand={hoverExpand ? '1' : '0'} data-rail-drag={String(settings.todoRailDrag ?? '1') !== '0' ? '1' : '0'} data-focus-write={String(settings.focusWrite ?? '0') === '1' ? '1' : '0'}>
        <AppLockScreen />
      </div>
    );
  }

  return (
    <>
      <GlobalBg />
      <div className={`app ${collapsed ? 'nav-collapsed' : ''}`} id="app" data-dock={dock} data-hover-expand={hoverExpand ? '1' : '0'} data-rail-drag={String(settings.todoRailDrag ?? '1') !== '0' ? '1' : '0'} data-focus-write={String(settings.focusWrite ?? '0') === '1' ? '1' : '0'}>
        <Sidebar />
        <div className="main">
          <Tabs />
          <div className="topbar" id="topbar-slot" />
          <div className="view" id="view-root">
            {!ready ? <div className="booting">正在打开…</div>
              : bootError ? <div className="booting">启动失败：{bootError}</div>
              : body}
          </div>
        </div>
      </div>
      <TooltipLayer />
      <Toast />
      <PromptHost />
      <ConfirmHost />
      <QuickPanel />
      <CommandPalette />
      <ShortcutHelp />
    </>
  );
}
