/**
 * 数据层：类型定义与纯函数。
 *
 * 这里不接触 localStorage——那是 `store.js` 的唯一职责（见 TECH 3.1）。
 */

import { isDateKey } from './dates.js';

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
 * @property {string} color 8 色预设之一
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
 * 模板色板：8 个中明度色，浅底和深底上都能辨识。
 *
 * 顺序也是新建模板时自动分配颜色的顺序。数组元素就是存进 `Template.color`
 * 的值，`normalize()` 会拒绝不在这个列表里的颜色（见 TECH 4.4）。
 *
 * @type {readonly string[]}
 */
export const PRESET_COLORS = [
  '#E8734A', // 珊瑚
  '#DFA32B', // 琥珀
  '#7A9E4A', // 苔绿
  '#3E8E7E', // 松绿
  '#4A8FBF', // 湖蓝
  '#7C6BB8', // 靛紫
  '#D2607F', // 玫红
  '#7A7671', // 石墨
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
  '#E8734A': 'pip-coral',
  '#DFA32B': 'pip-amber',
  '#7A9E4A': 'pip-moss',
  '#3E8E7E': 'pip-pine',
  '#4A8FBF': 'pip-lake',
  '#7C6BB8': 'pip-iris',
  '#D2607F': 'pip-rose',
  '#7A7671': 'pip-slate',
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
