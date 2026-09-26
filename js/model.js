/**
 * 数据层：类型定义与纯函数。
 *
 * 这里不接触 localStorage——那是 `store.js` 的唯一职责（见 TECH 3.1）。
 */

import { isDateKey, toLocalIso } from './dates.js';

/** 结构版本。改结构时递增，并在 `migrate()` 里补迁移。 */
export const SCHEMA_VERSION = 1;

/** 标题最长字数（PRD 7.5）。 */
export const TITLE_MAX = 20;

/** 备注最长字数。上限是容量考虑，见 TECH 3.7。 */
export const NOTE_MAX = 200;

/**
 * 打卡模板。
 * @typedef {object} Template
 * @property {string} id
 * @property {string} title 必填，≤ 20 字
 * @property {string} icon emoji，可为空
 * @property {string} color 10 色预设之一
 * @property {boolean} archived 停用标记；停用不删记录
 * @property {number} sort_order 越小越靠前
 * @property {number} created_at
 * @property {number} updated_at
 */

/**
 * 一次打卡记录。同一个模板同一天可以有多条。
 * @typedef {object} Pip
 * @property {string} id
 * @property {string} template_id
 * @property {import('./dates.js').DateKey} date 本地时区日期，用于按天分组
 * @property {number} at 打卡时刻，用于当天内排序
 * @property {string} note 可为空，≤ 200 字
 * @property {number} updated_at
 */

/**
 * @typedef {object} PipData
 * @property {number} version
 * @property {Template[]} templates
 * @property {Pip[]} pips
 */

/**
 * 模板色板：10 个预设色，浅底和深底上都能辨识。
 *
 * **按色相排序**，所以色板是一段「红 → 暖 → 绿 → 蓝 → 品红 → 中性」的连续过渡，
 * 排成两行各 5 个时两行各自也是一段过渡。顺序**同时是新建模板时自动分配颜色
 * 的顺序**。数组元素就是存进 `Template.color` 的值，`normalize()` 会拒绝不在这个
 * 列表里的颜色（见 TECH 4.4）。
 *
 * 大红（`#C0392B`，6°）是 2026-09-26 换进来的：它顶替了青柠（127°）的位置，把色环
 * 的最暖端补齐——十色里从此有一个一眼可读的「红」；青柠下架后，苔绿 86° → 松绿
 * 168° 之间重新留出空档，两枚绿中间不再有第三枚绿，反而更好认。它和珊瑚（16°）
 * 色相只差 11°，7px 的小点分不出色相，**区分靠明度差**：刻意压到比珊瑚深一档
 * （与 `--danger` 同色——删除红只出现在按钮文字上，不出现在日历点里，语义不打架）。
 * 更亮、饱和更高的 `#D6493C` / `#FF2A1E` 都实渲染过，与珊瑚并列时容易混，弃。
 *
 * @type {readonly string[]}
 */
export const PRESET_COLORS = [
  '#C0392B', // 大红   6°
  '#E8734A', // 珊瑚  16°
  '#DFA32B', // 琥珀  40°
  '#7A9E4A', // 苔绿  86°
  '#3E8E7E', // 松绿 168°
  '#4A8FBF', // 湖蓝 205°
  '#7C6BB8', // 靛紫 253°
  '#B955BD', // 品红 298°
  '#D2607F', // 玫红 344°
  '#7A7671', // 石墨  中性
];

/**
 * 色值 → CSS 类名。`app.css` 里每个类对应一条 `background` 规则。
 *
 * 和 `PRESET_COLORS` 放在一起，因为它就是那份色板的呈现对应物，两个视图
 * （月历、当天列表）都要用。放在某个视图里会让另一个视图不得不跨视图 import，
 * 而 TECH 2 规定 `views/*` 之间不互相 import。
 *
 * 用类而不是行内 `style` 属性：CSP 的 `style-src 'self'` 会拦掉行内样式。
 *
 * ★ 键必须和 `PRESET_COLORS`、`app.css` 的 `.pip-*` 规则保持一致，
 *   `tests/calendar.test.js` 会把漂移测出来。
 *
 * @type {Record<string, string>}
 */
export const COLOR_CLASS = {
  '#C0392B': 'pip-scarlet',
  '#E8734A': 'pip-coral',
  '#DFA32B': 'pip-amber',
  '#7A9E4A': 'pip-moss',
  '#3E8E7E': 'pip-pine',
  '#4A8FBF': 'pip-lake',
  '#7C6BB8': 'pip-iris',
  '#B955BD': 'pip-orchid',
  '#D2607F': 'pip-rose',
  '#7A7671': 'pip-slate',
};

/**
 * 色值 → 中文名。名字取自 PRD 9.2 的色板表。
 *
 * 给色块一个不依赖颜色本身的可读名（PRD 12：颜色不单独承载信息）——色板选择器是
 * 界面上唯一「只有颜色、没有文字」的地方，读屏至少要念得出这是什么颜色。
 *
 * ★ 键必须和 `PRESET_COLORS` 一致，`tests/calendar.test.js` 会把漂移测出来。
 *
 * @type {Record<string, string>}
 */
export const COLOR_NAME = {
  '#C0392B': '大红',
  '#E8734A': '珊瑚',
  '#DFA32B': '琥珀',
  '#7A9E4A': '苔绿',
  '#3E8E7E': '松绿',
  '#4A8FBF': '湖蓝',
  '#7C6BB8': '靛紫',
  '#B955BD': '品红',
  '#D2607F': '玫红',
  '#7A7671': '石墨',
};

/**
 * 生成 id。
 *
 * 用 `crypto.randomUUID()` 而不是时间戳或 `Math.random()`：id 必须保证跨设备
 * 合并时不冲突，而时间戳在快速连续打卡时会撞。
 *
 * @param {'t' | 'p'} prefix
 * @returns {string}
 */
export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * 造一条 pip。
 *
 * `date` 由调用方给（打卡那一刻用本地时区算好的字符串，之后永远不变），`at` 取
 * 此刻。**两个都要存**：`date` 用来按天分组且不随时区漂移，`at` 用来在当天内排序
 * 和显示「14:30」（见 TECH 4.2）。只用 `at` 反推日期就会掉进时区陷阱。
 *
 * 同一个模板同一天可以产生多条，每次都是独立的记录，各有各的 id（PRD 第 8 节）。
 *
 * @param {string} templateId
 * @param {import('./dates.js').DateKey} dateKey
 * @param {string} [note] 可为空，超长截断
 * @returns {Pip}
 */
export function createPip(templateId, dateKey, note = '') {
  const now = Date.now();
  return {
    id: newId('p'),
    template_id: templateId,
    date: dateKey,
    at: now,
    note: String(note).slice(0, NOTE_MAX),
    updated_at: now,
  };
}

/**
 * 模板列表的展示顺序：启用中在前，已停用在后，组内按 `sort_order`（PRD 7.2 / 7.5）。
 *
 * 打卡弹窗第一步和统计页都用它。停用的模板在这两处都要照常出现——打卡页里它们是唯一
 * 的「恢复使用」入口，统计页里只要有记录就得算（记录就是记录）。
 *
 * @param {Template[]} templates
 * @returns {Template[]} 新数组，不改动传入的那个
 */
export function orderedTemplates(templates) {
  return [...templates].sort(
    (a, b) => Number(a.archived) - Number(b.archived) || a.sort_order - b.sort_order,
  );
}

/**
 * 下一个可用的排序值：排在最后。
 *
 * @param {Template[]} templates
 * @returns {number}
 */
export function nextSortOrder(templates) {
  return templates.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
}

/**
 * 挑一个还没被占用的预设色（PRD 9.2）。
 *
 * 自动分配是为了不让用户对着一个空色板先做一次外观决策。10 个都被占了就按模板数
 * 取模轮回去——总有颜色可用，不需要新增色。
 *
 * @param {Template[]} templates
 * @returns {string}
 */
export function pickColor(templates) {
  const used = new Set(templates.map((t) => t.color));
  return (
    PRESET_COLORS.find((color) => !used.has(color)) ??
    PRESET_COLORS[templates.length % PRESET_COLORS.length]
  );
}

/**
 * 造一个模板。
 *
 * `color` 不传或不在预设色板里就自动分配一个（PRD 9.2）；`sort_order` 排在最后，
 * 这样新建的模板出现在打卡弹窗的末尾，不打乱已有模板的颜色位置。
 *
 * @param {Template[]} templates 现有的全部模板，用来定颜色和顺序
 * @param {{ title: string, icon?: string, color?: string }} input
 * @returns {Template}
 */
export function createTemplate(templates, { title, icon = '', color }) {
  const now = Date.now();
  return {
    id: newId('t'),
    title: String(title).slice(0, TITLE_MAX),
    icon: String(icon),
    color: typeof color === 'string' && PRESET_COLORS.includes(color) ? color : pickColor(templates),
    archived: false,
    sort_order: nextSortOrder(templates),
    created_at: now,
    updated_at: now,
  };
}

/**
 * 按日期分组，组内按打卡时刻**正序**（早 → 晚，像日记）。
 *
 * 渲染当月是 42 次 Map 查表，不是 42 次数组遍历（见 TECH 6.1）。
 *
 * @param {Pip[]} pips
 * @returns {Map<string, Pip[]>} key 是 `DateKey`
 */
export function groupPipsByDate(pips) {
  /** @type {Map<string, Pip[]>} */
  const byDate = new Map();
  for (const p of pips) {
    let list = byDate.get(p.date);
    if (!list) {
      list = [];
      byDate.set(p.date, list);
    }
    list.push(p);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.at - b.at);
  return byDate;
}

/**
 * @param {Template[]} templates
 * @returns {Map<string, Template>}
 */
export function indexTemplates(templates) {
  return new Map(templates.map((t) => [t.id, t]));
}

/**
 * 从原始值里安全地取一个对象。
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asObject(value) {
  return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * 把读入的原始数据修补成合法结构。
 *
 * 每次从存储或导入读入后都要过一遍。**唯一的破坏性操作是丢弃 `date` 非法的
 * pip**——`date` 是按天分组和排序的唯一依据，非法就无法定位。所以要给 `onDrop`
 * 回调留痕（见 TECH 11.4），不能静默丢。
 *
 * 无法解析的 `template_id` **不丢弃**：保留记录，由视图渲染成灰色兜底。孤儿记录
 * 只可能来自手工编辑或损坏的导入文件，静默删掉是更坏的选择。
 *
 * @param {unknown} raw
 * @param {(dropped: { id: string, date: unknown }) => void} [onDrop]
 * @returns {PipData}
 */
export function normalize(raw, onDrop) {
  const source = asObject(raw);
  const rawTemplates = Array.isArray(source.templates) ? source.templates : [];
  const rawPips = Array.isArray(source.pips) ? source.pips : [];

  const templates = rawTemplates.map((entry) => {
    const t = asObject(entry);
    const color = typeof t.color === 'string' ? t.color : '';
    return {
      id: typeof t.id === 'string' && t.id ? t.id : newId('t'),
      title: String(t.title ?? '').slice(0, TITLE_MAX),
      icon: String(t.icon ?? ''),
      color: PRESET_COLORS.includes(color) ? color : PRESET_COLORS[0],
      archived: Boolean(t.archived),
      sort_order: typeof t.sort_order === 'number' && Number.isFinite(t.sort_order) ? t.sort_order : 0,
      created_at: Number(t.created_at) || Date.now(),
      updated_at: Number(t.updated_at) || Date.now(),
    };
  });

  /** @type {Pip[]} */
  const pips = [];
  for (const entry of rawPips) {
    const p = asObject(entry);
    if (!isDateKey(p.date)) {
      onDrop?.({ id: String(p.id ?? ''), date: p.date });
      continue;
    }
    pips.push({
      id: typeof p.id === 'string' && p.id ? p.id : newId('p'),
      template_id: String(p.template_id ?? ''),
      date: p.date,
      at: Number(p.at) || Date.now(),
      note: String(p.note ?? '').slice(0, NOTE_MAX),
      updated_at: Number(p.updated_at) || Date.now(),
    });
  }

  return { version: SCHEMA_VERSION, templates, pips };
}

/**
 * 判断一个解析出来的值是不是「看起来像 Pip 的数据」。
 *
 * 用来区分两种失败：JSON 解析不了，和解析得了但不是我们的结构。后者如果当成
 * 空数据渲染，用户一点保存就会把原数据覆盖掉——和 TECH 3.5 要防的是同一条链。
 * 所以两者都算损坏，都要保留原始字符串。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksLikeData(value) {
  const v = asObject(value);
  return Array.isArray(v.templates) || Array.isArray(v.pips);
}

/**
 * 结构迁移。现在只有 v1，没有历史版本，所以是恒等函数。
 *
 * 钩子先留着：将来加版本时在这里串起 `MIGRATIONS[version]`，`load()` 和
 * `import()` 都会过这里（见 TECH 4.5）。
 *
 * @param {PipData} data
 * @returns {PipData}
 */
export function migrate(data) {
  return data;
}

// ─────────────────────────────────────────────────────────
// 导出与导入（TECH 9）
// ─────────────────────────────────────────────────────────

/** 导出文件外壳上的标记，导入时用来认「这是不是 Pip 的文件」。 */
export const EXPORT_APP = 'pip';

/** 认得的外壳版本。将来加版本时在这里追加，并在 `migrate()` 里补上迁移。 */
export const KNOWN_VERSIONS = [SCHEMA_VERSION];

/**
 * 包一层导出外壳（TECH 9.1）。
 *
 * `app` / `version` 是给导入校验用的；`exportedAt` 只是给人看的时间戳，**不进
 * `data`**——数据里不该混进「什么时候导出的」这种设备本地信息。
 *
 * @param {PipData} data
 * @param {Date} [now]
 * @returns {{ app: string, version: number, exportedAt: string, data: PipData }}
 */
export function buildExport(data, now = new Date()) {
  return {
    app: EXPORT_APP,
    version: SCHEMA_VERSION,
    exportedAt: toLocalIso(now),
    data,
  };
}

/**
 * 解析并校验一个导入文件。
 *
 * **失败要说清原因**，不能静默忽略（PRD 11 / TECH 9.2）——所以返回的是原因码而不是
 * 一个光秃秃的 false，由界面翻成人话。
 *
 * @param {string} text 文件原文
 * @param {(dropped: { id: string, date: unknown }) => void} [onDrop] 交给 normalize 留痕
 * @returns {{ ok: true, data: PipData }
 *   | { ok: false, reason: 'parse' | 'not-pip' | 'version' | 'incomplete', detail?: string }}
 */
export function parseImport(text, onDrop) {
  /** @type {unknown} */
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'parse' };
  }

  const shell = asObject(payload);
  if (shell.app !== EXPORT_APP) return { ok: false, reason: 'not-pip' };

  const version = shell.version;
  if (typeof version !== 'number' || !KNOWN_VERSIONS.includes(version)) {
    return { ok: false, reason: 'version', detail: String(version) };
  }

  // 外壳对但 data 不像我们的结构：和 store.js 的损坏判定是同一条链，不能当成空数据
  if (!looksLikeData(shell.data)) return { ok: false, reason: 'incomplete' };

  return { ok: true, data: migrate(normalize(shell.data, onDrop)) };
}

/**
 * 按 id 取并集，同 id 冲突取 `updated_at` 较新者（TECH 9.3）。
 *
 * 每条 pip 和 template 都有独立 id，所以规则是明确的——这也是每条记录都带
 * `updated_at` 的用途。
 *
 * **已知语义漏洞**：并集无法传播「删除」。A 设备删掉的一条在 B 设备上仍然存在，
 * 合并时会回来。接受它，纪律是「同一时间只在一台设备上打卡」，换设备该用「覆盖」。
 *
 * @template {{ id: string, updated_at?: number }} T
 * @param {T[]} local
 * @param {T[]} incoming
 * @returns {T[]}
 */
export function mergeById(local, incoming) {
  /** @type {Map<string, T>} */
  const map = new Map();
  for (const item of [...local, ...incoming]) {
    const prev = map.get(item.id);
    // 时间戳相同则保留本地（先写入的），避免无意义地改动本地数据
    if (!prev || (item.updated_at ?? 0) > (prev.updated_at ?? 0)) map.set(item.id, item);
  }
  return [...map.values()];
}

/**
 * 合并两整份数据。
 *
 * @param {PipData} local
 * @param {PipData} incoming
 * @returns {PipData}
 */
export function mergeData(local, incoming) {
  return {
    version: SCHEMA_VERSION,
    templates: mergeById(local.templates, incoming.templates).sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
    pips: mergeById(local.pips, incoming.pips),
  };
}
