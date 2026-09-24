/**
 * 状态容器与派生索引。
 *
 * 没有响应式系统：事件改 `state` → `reindex()`（仅数据变更时）→ 调受影响视图的
 * `render()`。见 TECH 6.2。
 */

import { toDateKey } from './dates.js';
import { SCHEMA_VERSION, createPip, groupPipsByDate, indexTemplates } from './model.js';

export const state = {
  /** @type {import('./model.js').PipData} */
  data: { version: SCHEMA_VERSION, templates: [], pips: [] },

  /** @type {import('./store.js').Prefs} */
  prefs: { theme: 'system' },

  /**
   * 数据读取异常时置 true，所有写入被拦掉。
   * 这是防「坏数据被真空数据覆盖」的最后一道闸，见 TECH 3.5。
   */
  readOnly: false,

  /** 当前浏览的月份。打开永远回到当月，不记忆上次浏览的位置（PRD 7.1）。 */
  view: { year: 0, month: 0 },

  /** 每次渲染前刷新，不缓存在模块顶层——页面放着过了午夜，「今天」会变（TECH 5.4）。 */
  todayKey: '',

  /** sheet 内部页面栈（TECH 7.1）。 */
  ui: { stack: /** @type {string[]} */ ([]) },
};

/**
 * 派生索引。数据变更时重建一次，不在渲染里重复过滤——渲染当月是 42 次 Map
 * 查表，不是 42 次数组遍历（TECH 6.1）。
 */
export const index = {
  /** @type {Map<string, import('./model.js').Pip[]>} 日期 → 当天记录，组内按 `at` 正序 */
  byDate: new Map(),

  /** @type {Map<string, import('./model.js').Template>} */
  byTemplate: new Map(),

  /**
   * 模板 → 该模板的全部记录。现在还没有读取方，是为统计预留的（TECH 6.5）：
   * 它和 `byDate` 是同一趟遍历，现在建好几乎零成本，等做统计时再补就得回头
   * 改这个函数。
   *
   * @type {Map<string, import('./model.js').Pip[]>}
   */
  pipsByTemplate: new Map(),
};

export function reindex() {
  index.byDate = groupPipsByDate(state.data.pips);
  index.byTemplate = indexTemplates(state.data.templates);

  index.pipsByTemplate = new Map();
  for (const p of state.data.pips) {
    let list = index.pipsByTemplate.get(p.template_id);
    if (!list) {
      list = [];
      index.pipsByTemplate.set(p.template_id, list);
    }
    list.push(p);
  }
}

/** 重新算「今天」。每次渲染前调，不缓存。 */
export function refreshToday() {
  state.todayKey = toDateKey();
}

// ─────────────────────────────────────────────────────────
// 装配出口
// ─────────────────────────────────────────────────────────

/**
 * @typedef {object} AppHost
 * @property {(changed: { dateKey?: string, pipId?: string }) => Promise<void>} write
 *   数据改了：落盘 + 重绘受影响的视图。
 * @property {(name: string, params?: Record<string, unknown>) => void} intent
 *   跳转意图：开某个 sheet 页面。
 */

/** @type {AppHost} */
let app = {
  write: async () => {},
  intent: () => {},
};

/**
 * app.js 启动时注入两个出口。
 *
 * 视图既不能 import `store.js`（落盘）也不能 import `sheet.js`（跳转）——依赖方向
 * 是 `views → state → model → store`，`views/*` 之间也不互相 import（TECH 2）。
 * 所以这两件事必须从这里出去，由 app.js 在装配时接上。
 *
 * 默认实现是空操作，这样模块单独被 import 时（比如测试里）不会炸。
 *
 * @param {AppHost} host
 */
export function mountHost(host) {
  app = host;
}

/**
 * 发起一个跳转意图。
 *
 * @param {string} name
 * @param {Record<string, unknown>} [params]
 */
export function intent(name, params = {}) {
  app.intent(name, params);
}

// ─────────────────────────────────────────────────────────
// 写操作
// ─────────────────────────────────────────────────────────

/**
 * 记一条 pip。
 *
 * 视图不自己拼「改数据 → 落盘 → 重建索引 → 重绘」这一串：漏掉任何一步都是**静默
 * 错数据**（改了没存、存了没重绘），所以统一从这里出去。
 *
 * @param {string} templateId
 * @param {import('./dates.js').DateKey} dateKey 目标日期，补记时是那一天
 * @param {string} [note]
 * @returns {Promise<boolean>} 只读模式下写入被拦掉，返回 false
 */
export async function addPip(templateId, dateKey, note = '') {
  // 数据读取异常时所有写入都被拦掉，这是防「坏数据被真空数据覆盖」的最后一道闸
  // （TECH 3.5）。此时界面上已经挂着不可关闭的横幅，不需要再给别的反馈。
  if (state.readOnly) return false;

  const pip = createPip(templateId, dateKey, note);
  state.data.pips.push(pip);
  reindex();

  await app.write({ dateKey, pipId: pip.id });
  return true;
}

/** 把浏览位置拨回当月。 */
export function goToday() {
  const now = new Date();
  state.view.year = now.getFullYear();
  state.view.month = now.getMonth() + 1;
}
