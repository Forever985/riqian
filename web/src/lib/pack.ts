/**
 * #241 扩展包：主题 / 插件 / 创意工坊作品，统一一种格式。
 *
 * 用户原话：「允许别人做好一个插件、主题、额外功能后加入到我的已开发的项目里来。
 * 就是，先在 github 上下载好我的本体，然后别人哪里又弄到另外人搞的适配我软件的额外项目，
 * 能够装的上。」
 *
 * 所以这一套的目标只有一个：**别人做的东西能装进来，装坏了能退回去。**
 *
 * 三种包共用同一个信封（envelope），靠 `kind` 区分：
 *
 *   { "rq": 1, "kind": "theme",    "id": "...", "name": "...", "version": "1.0.0", ... }
 *   { "rq": 1, "kind": "plugin",   ... }
 *   { "rq": 1, "kind": "workshop", ... }
 *
 * 为什么不做成三种格式：用户分不清"主题包"和"插件包"的区别，他也不该分清。
 * 拖进来一个文件，程序自己认这是什么 —— 认不出来才提示。
 *
 * `rq` 是格式版本号。将来改结构就往上加，老版本应用遇到高版本包会明确拒绝，
 * 而不是装进去一半然后行为诡异。
 */

/* ---------------- 信封 ---------------- */

/** 当前支持的包格式版本 */
export const PACK_VERSION = 1;

export type PackKind = 'theme' | 'plugin' | 'workshop';

export interface PackMeta {
  /** 格式版本，目前恒为 1 */
  rq: number;
  kind: PackKind;
  /** 全局唯一的包 id，建议 `<作者>.<名字>`，比如 `forever.paper-ink` */
  id: string;
  name: string;
  version: string;
  author?: string;
  desc?: string;
  /** 主页 / 仓库地址，装了之后可以点过去看看 */
  home?: string;
  /** 适用的最低应用版本，比如 "12.6"。不填表示不挑 */
  minApp?: string;
}

/* ---------------- 主题包 ---------------- */

/**
 * 主题包体。
 *
 * `colors` 就是 `themeCustom` 里的那 16 个槽位（见 lib/theme.ts 的 COLOR_SLOTS）。
 * 不要求全填 —— 缺的槽位会回落到内置主题的出厂值，
 * 所以"只改主色"这种小主题也能成立，不用抄一遍整份配色。
 */
export interface ThemePack extends PackMeta {
  kind: 'theme';
  /** 基于哪套内置主题做底（paper / ink / night / forest / rose / mono / semi） */
  base?: string;
  /** 是否是深色底色。用于校验「这配色是不是选错了」以及窗口标题栏的明暗 */
  dark?: boolean;
  colors: Record<string, string>;
}

/* ---------------- 插件包 ---------------- */

/**
 * 插件包体。
 *
 * 先明确「插件」在这里能做什么、不能做什么 —— 这一条必须写在最前面，
 * 否则一定会有人以为能塞 JS 进来。
 *
 * **能做**（声明式，全部是现有能力的组合，不执行任何外部代码）：
 *   · 一次装一批日记模块（模块类型 + 标题 + 默认配置）
 *   · 预置一批待办清单 / 标签 / 记账分类这些「字典」
 *   · 一组快捷键之外的偏好设置（写进 settings）
 *   · 解锁/隐藏某些模块在哪些页面出现
 *
 * **不能做**：加载任意 JS / 替换界面组件 / 读写文件 / 联网。
 * 这是刻意的：这个程序的界面是一整个 React 包内联进 exe 的，
 * 真要支持运行时代码注入，得先做沙箱（iframe + 受限 postMessage），
 * 那是另一个量级的工程，而且会给「数据只存在本地」这个前提开一个口子。
 * 声明式插件能覆盖绝大多数「我想要个 XX 功能」的诉求，先把它做扎实。
 */
export interface PluginModuleSpec {
  /** 模块类型，必须是现有类型之一：richtext / mood / weather / tags / habits / todo / sleep / energy / rating / images / quote / heading / divider */
  type: string;
  title: string;
  /** 模块配置，原样写进 modules.config。具体含义按类型不同 */
  config?: Record<string, unknown>;
}

export interface PluginPack extends PackMeta {
  kind: 'plugin';
  /** 装完要不要默认启用 */
  enabled?: boolean;
  /** 要添加的模块 */
  modules?: PluginModuleSpec[];
  /**
   * 要写进 settings 的键值。
   *
   * 命名必须有前缀，格式建议 `plugin.<包id>.<键>`，
   * 这样卸载时能靠前缀精确清干净，也不会和外来的其它设置撞车。
   */
  settings?: Record<string, string>;
  /** 需要预先存在的标签（不存在就建） */
  tags?: string[];
  /** 需要预先存在的待办清单（不存在就建） */
  todoLists?: string[];
}

/* ---------------- 创意工坊作品 ---------------- */

/**
 * 工坊作品。和插件不同，作品是**内容**而不是**功能**：
 * 一套日记模板、一个画板、一组倒计时、一份记账分类。
 *
 * 之所以叫「创意工坊」而不是「模板中心」：它装的东西比模板宽 ——
 * 用户做了一套「考研倒计时 10 条」，那显然不是模板。
 */
export interface WorkshopPack extends PackMeta {
  kind: 'workshop';
  /** 作品类型 */
  work: 'templates' | 'countdowns' | 'tags' | 'ledgerCats';
  /** 内容，形状随 work 变化，安装时逐个校验 */
  items: unknown[];
}

export type AnyPack = ThemePack | PluginPack | WorkshopPack;

/* ---------------- 解析 ---------------- */

/** 解析结果：要么成功带包，要么失败带一句能给人看的原因 */
export type ParseResult =
  | { ok: true; pack: AnyPack }
  | { ok: false; err: string };

const HEX = /^#[0-9a-f]{3,8}$/i;

/** 允许的模块类型。插件包里写了别的就拒，不然装完是一个渲染不出来的空模块 */
export const PLUGIN_MODULE_TYPES = [
  'richtext', 'mood', 'weather', 'tags', 'habits', 'todo',
  'sleep', 'energy', 'rating', 'images', 'quote', 'heading', 'divider',
];

/**
 * 把一段文本解析成包。
 *
 * 三种输入都要认，因为用户拿到东西的方式不一样：
 *   · 拖进来的 .json 文件
 *   · 从网页上复制的 JSON
 *   · 别人发的一段分享码（也是 JSON，只是可能在 markdown 代码块里）
 * 所以先做「剥壳」——去掉 ```json 围栏、去掉首尾空白，再 JSON.parse。
 */
export function parsePack(raw: string): ParseResult {
  let src = String(raw || '').trim();
  if (!src) return { ok: false, err: '内容是空的' };

  // 从聊天软件复制出来的东西经常带 markdown 围栏
  src = src.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  let o: unknown;
  try {
    o = JSON.parse(src);
  } catch {
    return { ok: false, err: '不是合法的 JSON。常见原因：复制时丢了结尾的 }、用了中文引号、或者被聊天软件转义过' };
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    return { ok: false, err: '顶层得是一个对象，不是数组或字符串' };
  }

  const r = o as Record<string, unknown>;

  // ---- 格式版本 ----
  const rq = Number(r.rq);
  if (!Number.isFinite(rq)) return { ok: false, err: '缺少 rq（格式版本号）。这可能不是日签的扩展包' };
  if (rq > PACK_VERSION) {
    return { ok: false, err: `这个包用的格式版本是 ${rq}，当前程序只认到 ${PACK_VERSION}。把日签升级之后再装` };
  }

  // ---- 种类 ----
  const kind = String(r.kind || '');
  if (kind !== 'theme' && kind !== 'plugin' && kind !== 'workshop') {
    return { ok: false, err: `不认识的 kind：「${kind || '(空)'}」。只支持 theme / plugin / workshop` };
  }

  // ---- 公共字段 ----
  const id = String(r.id || '').trim();
  const name = String(r.name || '').trim();
  if (!id) return { ok: false, err: '缺少 id' };
  // id 会被拼进 settings 键名和存储键，限制字符集省得后面要转义
  if (!/^[\w.\-]+$/.test(id)) {
    return { ok: false, err: `id 只能用字母、数字、下划线、点、短横线：「${id}」不合格` };
  }
  if (!name) return { ok: false, err: '缺少 name（显示名）' };

  const meta: PackMeta = {
    rq,
    kind,
    id,
    name,
    version: String(r.version || '0.0.0'),
    author: r.author ? String(r.author) : '',
    desc: r.desc ? String(r.desc) : '',
    home: r.home ? String(r.home) : '',
    minApp: r.minApp ? String(r.minApp) : '',
  };

  if (kind === 'theme') return parseTheme(r, meta);
  if (kind === 'plugin') return parsePlugin(r, meta);
  return parseWorkshop(r, meta);
}

function parseTheme(r: Record<string, unknown>, meta: PackMeta): ParseResult {
  const src = r.colors;
  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    return { ok: false, err: '主题包缺少 colors 对象' };
  }
  const colors: Record<string, string> = {};
  const bad: string[] = [];
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    const val = String(v || '').trim();
    if (!val) continue;
    /*
     * 颜色必须是一串十六进制。为什么要卡这么死：
     * 这些值最终会写进 style.setProperty('--xx', value)，
     * 用户能做的不只是「颜色难看」——写个 url(...) 或者表达式进去就是注入。
     * 只放行 #rgb / #rgba / #rrggbb / #rrggbbaa 最省心。
     */
    if (!HEX.test(val)) { bad.push(`${k}=${val}`); continue; }
    colors[k] = val;
  }
  if (bad.length) {
    return { ok: false, err: `这些颜色值不是 #十六进制，已拒绝：${bad.slice(0, 4).join('、')}${bad.length > 4 ? ' 等' : ''}` };
  }
  if (!Object.keys(colors).length) return { ok: false, err: 'colors 里一个有效颜色都没有' };

  return {
    ok: true,
    pack: {
      ...meta,
      kind: 'theme',
      base: r.base ? String(r.base) : '',
      dark: r.dark === true,
      colors,
    } as ThemePack,
  };
}

function parsePlugin(r: Record<string, unknown>, meta: PackMeta): ParseResult {
  const mods: PluginModuleSpec[] = [];
  if (Array.isArray(r.modules)) {
    for (const m of r.modules) {
      if (!m || typeof m !== 'object') continue;
      const mm = m as Record<string, unknown>;
      const type = String(mm.type || '').trim();
      if (!PLUGIN_MODULE_TYPES.includes(type)) {
        return { ok: false, err: `插件里有个模块类型「${type}」不存在。可用：${PLUGIN_MODULE_TYPES.join(' / ')}` };
      }
      mods.push({
        type,
        title: String(mm.title || '').trim() || type,
        config: mm.config && typeof mm.config === 'object' ? (mm.config as Record<string, unknown>) : undefined,
      });
    }
  }

  const settings: Record<string, string> = {};
  if (r.settings && typeof r.settings === 'object' && !Array.isArray(r.settings)) {
    for (const [k, v] of Object.entries(r.settings as Record<string, unknown>)) {
      /*
       * 只允许插件改自己命名空间下的键。
       * 不加这条，一个插件就能把你的 theme / fontFamily / dataRoot 全改掉 ——
       * 那不是扩展，那是接管。
       */
      if (!k.startsWith('plugin.')) {
        return { ok: false, err: `settings 的键「${k}」不合规：插件只能写以 plugin. 开头的键` };
      }
      settings[k] = String(v ?? '');
    }
  }

  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];

  const pack: PluginPack = {
    ...meta,
    kind: 'plugin',
    enabled: r.enabled === true,
    modules: mods,
    settings,
    tags: strList(r.tags),
    todoLists: strList(r.todoLists),
  };

  // 一个什么都不做的插件没有安装价值，直接告诉作者
  if (!mods.length && !Object.keys(settings).length && !pack.tags?.length && !pack.todoLists?.length) {
    return { ok: false, err: '这个插件什么都没声明（modules / settings / tags / todoLists 全是空的）' };
  }
  return { ok: true, pack };
}

function parseWorkshop(r: Record<string, unknown>, meta: PackMeta): ParseResult {
  const work = String(r.work || '');
  const allow = ['templates', 'countdowns', 'tags', 'ledgerCats'];
  if (!allow.includes(work)) {
    return { ok: false, err: `不认识的作品类型「${work || '(空)'}」。支持：${allow.join(' / ')}` };
  }
  if (!Array.isArray(r.items) || !r.items.length) {
    return { ok: false, err: '作品里 items 是空的' };
  }
  return {
    ok: true,
    pack: { ...meta, kind: 'workshop', work, items: r.items } as WorkshopPack,
  };
}

/* ---------------- 生成 ---------------- */

/** 把一个包序列化成能直接存文件 / 发出去的文本（2 空格缩进，人能读也能改） */
export function stringifyPack(p: AnyPack): string {
  return JSON.stringify(p, null, 2);
}

/** 包转成文件时用的文件名。去掉文件名里不能用的字符 */
export function packFileName(p: AnyPack, ext = 'json'): string {
  const safe = `${p.id}-${p.version}`.replace(/[\\/:*?"<>|]/g, '_');
  return `riqian-${p.kind}-${safe}.${ext}`;
}

/** 给人看的一句话摘要，列表里用 */
export function packSummary(p: AnyPack): string {
  if (p.kind === 'theme') {
    const n = Object.keys(p.colors).length;
    return `${n} 个颜色${p.base ? ` · 基于「${p.base}」` : ''}`;
  }
  if (p.kind === 'plugin') {
    const bits: string[] = [];
    if (p.modules?.length) bits.push(`${p.modules.length} 个模块`);
    if (p.tags?.length) bits.push(`${p.tags.length} 个标签`);
    if (p.todoLists?.length) bits.push(`${p.todoLists.length} 个清单`);
    if (Object.keys(p.settings || {}).length) bits.push(`${Object.keys(p.settings || {}).length} 项设置`);
    return bits.join(' · ') || '空插件';
  }
  const WORK_NAME: Record<string, string> = {
    templates: '日记模板', countdowns: '倒计时', tags: '标签', ledgerCats: '记账分类',
  };
  return `${WORK_NAME[p.work] || p.work} · ${p.items.length} 条`;
}

/** 版本号粗比较：只用来判断"装的是不是新版"，不做语义化版本的完整实现 */
export function compareVersion(a: string, b: string): number {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}