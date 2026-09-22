/**
 * 数据层：类型定义与纯函数。
 *
 * 这里不接触 localStorage——那是 `store.js` 的唯一职责（见 TECH 3.1）。
 */

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
