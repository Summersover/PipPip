/**
 * 状态容器与派生索引。
 *
 * 没有响应式系统：事件改 `state` → `reindex()`（仅数据变更时）→ 调受影响视图的
 * `render()`。见 TECH 6.2。
 */

import { toDateKey } from './dates.js';
import { SCHEMA_VERSION, groupPipsByDate, indexTemplates } from './model.js';

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

/** 把浏览位置拨回当月。 */
export function goToday() {
  const now = new Date();
  state.view.year = now.getFullYear();
  state.view.month = now.getMonth() + 1;
}
