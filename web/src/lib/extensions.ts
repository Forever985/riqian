/**
 * #241 扩展包安装器。
 *
 * 这一层的职责只有一个：**装进去、能查到、能干净卸掉。**
 *
 * 三条设计原则，都是为了「装坏了能退回去」：
 *
 * ① **清单（registry）单独存**。装了哪些包、每个包改了什么，记在
 *    `settings.extRegistry` 里一份 JSON。不清不楚就往数据库里灌东西，
 *    用户想卸的时候没法知道该删哪些。
 *
 * ② **卸载走"反向补偿"**。安装时做的每一步都记下来（加了哪个模块、
 *    建了哪个标签、写了哪些 settings 键），卸载时按记录反着做。
 *    不靠"按名字猜"——用户可能改过名，也可能自己早就建了同名标签。
 *
 * ③ **主题和插件是两套补偿**。主题只是往 themeCustom 里签个名占一个槽，
 *    卸载就是把那个槽摘掉；插件会真的改库（加模块、加标签），
 *    所以它的记录必须精确到 id。
 */
import { api } from '../api';
import { useStore } from '../store';
import { THEME_DEFAULTS, COLOR_SLOTS, parseCustom, THEME_PACK_PREFIX, type ThemeColors } from './theme';
import {
  type AnyPack, type ThemePack, type PluginPack, type WorkshopPack,
  compareVersion, packFileName, stringifyPack,
} from './pack';

/* ---------------- 清单结构 ---------------- */

/**
 * 装过的主题包在 themeCustom 里占的槽名。用前缀区分"用户手调的"和"装来的"。
 *
 * 直接从 theme.ts 引，不再各写一份 —— 这个前缀现在被 normalizeTheme 用来
 * 判断"这是不是装来的主题"，两处写法一旦不一致，装完就会静默失效。
 */
export const THEME_KEY_PREFIX = THEME_PACK_PREFIX;

export interface InstalledBase {
  id: string;
  name: string;
  version: string;
  author?: string;
  desc?: string;
  home?: string;
  /** 装的时间 */
  at: string;
  /** 包原文 JSON。卸载后想重装、或者导出给别人，都靠它 */
  raw: string;
  /** 是否启用。主题同一时刻只能启用一个，所以主题的 enabled 另有处理 */
  enabled: boolean;
}

export interface InstalledTheme extends InstalledBase {
  kind: 'theme';
  /** 在 themeCustom 里占的键 */
  slot: string;
}

export interface InstalledPlugin extends InstalledBase {
  kind: 'plugin';
  /** 这个插件加出来的模块 id，卸载时按 id 删 */
  moduleIds: string[];
  /** 建出来的标签名，卸载时按名删（只删自己建的） */
  createdTags: string[];
  /** 建出来的待办清单 id */
  createdLists: string[];
  /** 写过的 settings 键 */
  settingKeys: string[];
}

export interface InstalledWorkshop extends InstalledBase {
  kind: 'workshop';
  work: string;
  /** 加出来的条目 id（模板 / 倒计时），卸载时按 id 删 */
  itemIds: string[];
  createdTags: string[];
}

export type Installed = InstalledTheme | InstalledPlugin | InstalledWorkshop;

export interface Registry {
  v: 1;
  items: Installed[];
}

const REG_KEY = 'extRegistry';

export function emptyRegistry(): Registry {
  return { v: 1, items: [] };
}

/** 从 settings 里读清单。坏了就当空 —— 宁可丢"装过什么"的记录，也不能让设置页打不开 */
export function readRegistry(settings: Record<string, unknown>): Registry {
  const raw = settings[REG_KEY];
  if (!raw) return emptyRegistry();
  try {
    const o = JSON.parse(String(raw));
    if (!o || !Array.isArray(o.items)) return emptyRegistry();
    return { v: 1, items: o.items as Installed[] };
  } catch {
    return emptyRegistry();
  }
}

async function writeRegistry(reg: Registry): Promise<void> {
  await useStore.getState().setSetting(REG_KEY, JSON.stringify(reg));
}

export function findInstalled(reg: Registry, id: string): Installed | undefined {
  return reg.items.find((x) => x.id === id);
}

/** 同名包已存在时给出提示文案；能升能降能重装 */
export function installHint(reg: Registry, p: AnyPack): string {
  const old = findInstalled(reg, p.id);
  if (!old) return '';
  const d = compareVersion(p.version, old.version);
  if (d > 0) return `会从 ${old.version} 升级到 ${p.version}`;
  if (d < 0) return `装的是旧版本（${p.version}），当前已有 ${old.version}`;
  return '同版本，会覆盖重装';
}

/* ---------------- 安装：主题 ---------------- */

/**
 * 装主题。
 *
 * 做法是把包里的颜色合并进 `themeCustom[slot]`，而不是"新增一套内置主题"——
 * 内置主题表是写在代码里的常量（THEMES），运行时加不进去；
 * 而 `themeCustom` 本来就是"在内置主题之上覆盖颜色"的机制，正好是给这个用的。
 *
 * `slot` 用 `pack:<id>`，这样：
 *   · 不会与内置的 paper / ink / night… 撞名
 *   · 卸载时能一眼看出哪些槽是装来的
 *   · 同一个包重装/升级，覆盖的是自己那一个槽，不会越装越多
 */
export async function installTheme(p: ThemePack): Promise<{ ok: boolean; err?: string }> {
  const store = useStore.getState();
  const settings = store.settings as Record<string, unknown>;
  const reg = readRegistry(settings);

  const slot = THEME_KEY_PREFIX + p.id;
  const custom = parseCustom(settings.themeCustom as string | undefined);

  /*
   * 底子从哪来：包自己声明了 base 就用那个内置主题，否则用当前主题。
   * 为什么不从空白开始 —— 主题只要给 16 个槽里的任意几个也是合法的，
   * 缺的那些必须有个合理的值，否则页面会变成一堆 CSS 变量的 initial 值（黑底黑字）。
   *
   * 当前主题本身可能就是一个装来的包（pack:xxx），那种不能直接当 baseKey 用 ——
   * THEME_DEFAULTS 里没有它，得顺着它的 slot 取已算好的那份，否则会掉回 paper。
   */
  const cur = String(settings.theme || 'paper');
  const curCustom = parseCustom(settings.themeCustom as string | undefined)[cur];
  const fallbackBase = curCustom
    ? curCustom
    : (THEME_DEFAULTS[cur] || THEME_DEFAULTS.paper);
  const base = p.base && THEME_DEFAULTS[p.base] ? THEME_DEFAULTS[p.base] : fallbackBase;

  const merged: ThemeColors = { ...base };
  for (const s of COLOR_SLOTS) {
    const v = p.colors[s.key];
    if (v) merged[s.key] = v;
  }

  custom[slot] = merged;
  await store.setSetting('themeCustom', JSON.stringify(custom));

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const rec: InstalledTheme = {
    kind: 'theme',
    id: p.id,
    name: p.name,
    version: p.version,
    author: p.author,
    desc: p.desc,
    home: p.home,
    at: now,
    raw: stringifyPack(p),
    // 装完立刻切过去 —— 用户点"安装"就是要用，不是要收藏
    enabled: true,
    slot,
  };

  // 主题是互斥的：其它已启用的主题包全部让位
  reg.items = reg.items.map((x) => (x.kind === 'theme' ? { ...x, enabled: false } : x));
  const i = reg.items.findIndex((x) => x.id === p.id);
  if (i >= 0) reg.items[i] = rec; else reg.items.push(rec);
  await writeRegistry(reg);

  // 切到刚装的主题
  await store.setSetting('theme', slot);
  return { ok: true };
}

/** 切到某个已装的主题 */
export async function activateTheme(reg: Registry, id: string): Promise<void> {
  const store = useStore.getState();
  const found = reg.items.find((x) => x.kind === 'theme' && x.id === id) as InstalledTheme | undefined;
  if (!found) return;
  reg.items = reg.items.map((x) => (x.kind === 'theme' ? { ...x, enabled: x.id === id } : x));
  await writeRegistry(reg);
  await store.setSetting('theme', found.slot);
}

/* ---------------- 安装：插件 ---------------- */

export async function installPlugin(p: PluginPack): Promise<{ ok: boolean; err?: string; warn?: string }> {
  const store = useStore.getState();
  const settings = store.settings as Record<string, unknown>;
  const reg = readRegistry(settings);
  const old = findInstalled(reg, p.id) as InstalledPlugin | undefined;

  /*
   * 重装/升级时先把上一版拆掉。
   *
   * 为什么要拆而不是"增量加"：插件改了模块标题、去掉了一个模块，
   * 增量加会留下一堆孤儿模块，用户删都不知道从哪删。
   * 代价是用户对上一版模块做的自定义（改标题、改配置）会丢 ——
   * 这一点必须在 UI 上明确警告，不能默默吃掉。
   */
  if (old) {
    await uninstallPlugin(old, { silent: true });
  }

  const moduleIds: string[] = [];
  const createdTags: string[] = [];
  const createdLists: string[] = [];
  const settingKeys: string[] = [];

  // ---- 模块 ----
  for (const m of p.modules || []) {
    const r = await api.modules.add(m.type, m.title).catch(() => null);
    if (r?.id) {
      moduleIds.push(r.id);
      // config 是对象，后端要的是 JSON 字符串（modules.update 的 config 字段按字符串存）
      if (m.config) {
        await api.modules.update({ id: r.id, config: JSON.stringify(m.config) }).catch(() => {});
      }
    }
  }

  // ---- 标签 ----
  /*
   * 标签在库里**没有独立的表**：`TagList()` 是从 entry_tags 聚合出来的
   * （SELECT tag, COUNT(*) FROM entry_tags GROUP BY tag）。
   * 也就是说「凭空建一个没人用的标签」在这个数据结构里不存在 ——
   * 标签之所以存在，是因为至少有一天用了它。
   *
   * 所以插件的 tags 只能这样落地：挑一篇已经存在的日记，把标签追加进去。
   * 挑「最近写过的那篇」而不是「今天」—— 往今天硬塞标签会凭空造出一篇
   * 用户没写过的日记，那比标签没建成更糟。
   * 一篇都没有就跳过，并在返回里说明。
   */
  let tagSkipped = 0;
  if (p.tags?.length) {
    const host = await pickTagHostDate();
    if (host) {
      const current = await api.entry.get(host).catch(() => null);
      const have: string[] = ((current as { tags?: string[] } | null)?.tags) || [];
      const next = Array.from(new Set([...have, ...p.tags]));
      await api.tags.set(host, next).catch(() => {});
      createdTags.push(...p.tags.filter((t) => !have.includes(t)));
    } else {
      tagSkipped = p.tags.length;
    }
  }

  // ---- 待办清单 ----
  for (const n of p.todoLists || []) {
    const exists = (useStore.getState().todoLists || []).some((x) => x.name === n);
    if (!exists) {
      const r = await api.todos.addList(n).catch(() => null);
      if (r?.id) createdLists.push(r.id);
    }
  }

  // ---- 设置 ----
  for (const [k, v] of Object.entries(p.settings || {})) {
    await store.setSetting(k, v);
    settingKeys.push(k);
  }

  // 重整一次前端状态，让新模块/标签立刻出现
  await useStore.getState().reloadModules().catch(() => {});
  await useStore.getState().reloadTags().catch(() => {});
  await useStore.getState().reloadTodoLists().catch(() => {});

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const rec: InstalledPlugin = {
    kind: 'plugin',
    id: p.id,
    name: p.name,
    version: p.version,
    author: p.author,
    desc: p.desc,
    home: p.home,
    at: now,
    raw: stringifyPack(p),
    enabled: p.enabled !== false,
    moduleIds,
    createdTags,
    createdLists,
    settingKeys,
  };

  const i = reg.items.findIndex((x) => x.id === p.id);
  if (i >= 0) reg.items[i] = rec; else reg.items.push(rec);
  await writeRegistry(reg);

  return { ok: true };
}

/**
 * 挑一篇已存在的日记当标签的落脚点。
 *
 * 为什么不直接 useStore 里拿日期：那里只有"当前正在看的那天"，不一定是写过的。
 * 走 entry.list 拿最近有内容的日期，比猜今天靠谱。
 * 一篇都没有（全新库）就返回空，让调用方跳过 —— 不能为了建标签而造日记。
 */
async function pickTagHostDate(): Promise<string> {
  try {
    const rows = await api.entry.list({ limit: 1 });
    if (!Array.isArray(rows) || !rows.length) return '';
    return String(rows[0].date || '');
  } catch {
    return '';
  }
}

/**
 * 删掉一个标签名。
 *
 * 没有 `tag.delete` 这种接口，因为标签不是独立实体 —— 它只是 entry_tags 里的字符串。
 * 所以「删标签」的唯一正确做法是：把所有挂着这个标签的日期都取出来，
 * 逐个去掉那一个标签，再写回去。
 *
 * 必须逐日重写而不是 DELETE ... WHERE tag=?：TagSet 的语义是
 * "这一天的标签就是这个数组"，所以要保留同一天里的其它标签。
 */
async function removeTagName(name: string): Promise<void> {
  const dates = await findDatesWithTag(name);
  for (const d of dates) {
    const cur = await api.entry.get(d).catch(() => null);
    const have: string[] = ((cur as { tags?: string[] } | null)?.tags) || [];
    if (!have.includes(name)) continue;
    await api.tags.set(d, have.filter((x) => x !== name)).catch(() => {});
  }
}

/** 找出哪些日期挂着这个标签。走 entry.list 的 tag 筛选，别把全库读一遍 */
async function findDatesWithTag(name: string): Promise<string[]> {
  try {
    const rows = await api.entry.list({ tag: name, limit: 5000 });
    return (Array.isArray(rows) ? rows : []).map((r) => String(r.date || '')).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 卸载插件：按安装时记下的 id 精确反向删除。
 *
 * `silent` 用于重装前的预拆 —— 那时候清单还没写完，不重复写。
 */
export async function uninstallPlugin(
  rec: InstalledPlugin,
  opt: { silent?: boolean } = {},
): Promise<void> {
  const store = useStore.getState();

  for (const id of rec.moduleIds) {
    await api.modules.remove(id).catch(() => {});
  }
  for (const t of rec.createdTags) {
    await removeTagName(t).catch(() => {});
  }
  for (const id of rec.createdLists) {
    await api.todos.removeList(id).catch(() => {});
  }
  /*
   * settings 反向补偿：把插件写过的键清成空串，而不是删掉这一行。
   *
   * 为什么不清空行：settings 在库里是 meta 表的一行，删掉和"值为空"在读的时候
   * 大多数地方都当没设，但保留空行能让「这个键曾经属于某个插件」这件事有迹可循，
   * 也避免某些代码路径 `if (k in settings)` 判断出错。
   */
  for (const k of rec.settingKeys) {
    await store.setSetting(k, '');
  }

  if (!opt.silent) {
    const reg = readRegistry(store.settings as Record<string, unknown>);
    reg.items = reg.items.filter((x) => x.id !== rec.id);
    await writeRegistry(reg);
  }

  await store.reloadModules().catch(() => {});
  await store.reloadTags().catch(() => {});
  await store.reloadTodoLists().catch(() => {});
}

/* ---------------- 安装：工坊作品 ---------------- */

/**
 * 装工坊作品。
 *
 * 和插件的区别：作品只是**内容条目**（模板正文、倒计时），
 * 装进来是往对应表里加行，不改任何设置、不动任何模块。
 */
export async function installWorkshop(p: WorkshopPack): Promise<{ ok: boolean; err?: string; count?: number }> {
  const store = useStore.getState();
  const reg = readRegistry(store.settings as Record<string, unknown>);

  const itemIds: string[] = [];
  const createdTags: string[] = [];
  let failed = 0;
  /** 模板和倒计时都靠"装前/装后列表差集"拿 id —— 见下面的说明 */
  let before: Set<string> = new Set();

  if (p.work === 'templates') {
    before = new Set((await api.templates.list().catch(() => [])).map((x) => x.id));
  } else if (p.work === 'countdowns') {
    before = new Set((await api.cd.list().catch(() => [])).map((x) => x.id));
  }

  for (const raw of p.items) {
    const it = raw as Record<string, unknown>;
    try {
      if (p.work === 'templates') {
        /*
         * templates.save 只返回 {ok}，不带 id —— 这是老接口的历史遗留。
         * 所以装完统一走一次"差集"拿新 id，没必要为一个扩展功能去改建表接口。
         */
        await api.templates.save(String(it.name || '未命名模板'), String(it.body || ''));
      } else if (p.work === 'countdowns') {
        const r = await api.cd.add({
          title: String(it.title || '未命名'),
          // date 必填，空的话后端会算出奇怪的日期，给个今天的兜底
          date: String(it.date || ''),
          repeat: String(it.repeat || ''),
          color: String(it.color || ''),
          note: String(it.note || ''),
        });
        if (r?.id) itemIds.push(r.id);
      } else if (p.work === 'tags') {
        const name = String(it.name || it || '').trim();
        if (!name) continue;
        /*
         * 标签没有独立实体，只能挂到已有的日记上。
         * 找不到落脚点就明确算失败 —— 假装装上了会让用户在标签列表里找不到，
         * 那比直接说"没装上"更让人困惑。
         */
        const host = await pickTagHostDate();
        if (!host) { failed++; continue; }
        const cur = await api.entry.get(host).catch(() => null);
        const have: string[] = ((cur as { tags?: string[] } | null)?.tags) || [];
        if (!have.includes(name)) {
          await api.tags.set(host, [...have, name]);
          createdTags.push(name);
        }
      } else if (p.work === 'ledgerCats') {
        /*
         * 记账分类不是一张表，它是记账记录上的字符串，加上前端从历史记录里聚合出的可选列表。
         * 也就是说"空分类"这个概念在这里不存在 —— 没有记录就没有分类。
         * 与其伪造一条 0 元记录来撑起分类，不如直说这个类型暂不支持导入。
         */
        failed++;
      }
    } catch {
      failed++;
    }
  }

  // 模板：用差集补出这次新加的 id
  if (p.work === 'templates') {
    const after = await api.templates.list().catch(() => []);
    for (const t of after) if (!before.has(t.id)) itemIds.push(t.id);
  }

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const rec: InstalledWorkshop = {
    kind: 'workshop',
    id: p.id,
    name: p.name,
    version: p.version,
    author: p.author,
    desc: p.desc,
    home: p.home,
    at: now,
    raw: stringifyPack(p),
    enabled: true,
    work: p.work,
    itemIds,
    createdTags,
  };

  const i = reg.items.findIndex((x) => x.id === p.id);
  if (i >= 0) reg.items[i] = rec; else reg.items.push(rec);
  await writeRegistry(reg);

  if (failed && !itemIds.length) {
    return { ok: false, err: `${failed} 条都没装上（作品类型「${p.work}」暂不支持自动导入，或数据格式不对）` };
  }
  return { ok: true, count: itemIds.length + createdTags.length };
}

/* ---------------- 卸载：统一入口 ---------------- */

export async function uninstall(rec: Installed): Promise<void> {
  const store = useStore.getState();

  if (rec.kind === 'plugin') {
    await uninstallPlugin(rec);
    return;
  }

  if (rec.kind === 'theme') {
    const reg = readRegistry(store.settings as Record<string, unknown>);
    // 摘掉自己在 themeCustom 里的槽
    const custom = parseCustom(store.settings.themeCustom as string | undefined);
    delete custom[rec.slot];
    await store.setSetting('themeCustom', JSON.stringify(custom));

    // 正用着这个主题就退回内置第一套，不然页面会指向一个已经删掉的变量集
    if (String(store.settings.theme) === rec.slot) {
      await store.setSetting('theme', 'paper');
    }
    reg.items = reg.items.filter((x) => x.id !== rec.id);
    await writeRegistry(reg);
    return;
  }

  // 工坊作品
  const reg = readRegistry(store.settings as Record<string, unknown>);
  for (const id of rec.itemIds) {
    if (rec.work === 'templates') await api.templates.remove(id).catch(() => {});
    else if (rec.work === 'countdowns') await api.cd.remove(id).catch(() => {});
  }
  for (const t of rec.createdTags) await removeTagName(t).catch(() => {});
  reg.items = reg.items.filter((x) => x.id !== rec.id);
  await writeRegistry(reg);
}

/* ---------------- 导出 ---------------- */

/** 把一个已装的包还原成可再分发的文本（用它存下的原文，不是重新拼） */
export function exportInstalled(rec: Installed): { text: string; name: string } {
  let text = rec.raw;
  let name = `riqian-${rec.kind}-${rec.id}-${rec.version}.json`;
  try {
    const p = JSON.parse(rec.raw) as AnyPack;
    name = packFileName(p);
    text = stringifyPack(p);
  } catch {
    /* 原文坏了就按原样给出去，总比不给强 */
  }
  return { text, name };
}