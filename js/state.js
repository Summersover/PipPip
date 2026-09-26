/**
 * 状态容器与派生索引。
 *
 * 没有响应式系统：事件改 `state` → `reindex()`（仅数据变更时）→ 调受影响视图的
 * `render()`。见 TECH 6.2。
 */

import { toDateKey } from './dates.js';
import {
  NOTE_MAX,
  SCHEMA_VERSION,
  createPip,
  createTemplate,
  groupPipsByDate,
  indexTemplates,
  mergeData,
} from './model.js';

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
 * @property {(changed: { dateKey?: string, pipId?: string, removedPipId?: string, calendar?: boolean }) => Promise<void>} write
 *   数据改了：落盘 + 重绘受影响的视图。`calendar` 表示整片重绘日历（模板变更用），
 *   `removedPipId` 表示这个点要淡出后再重画那一格。
 * @property {(name: string, params?: Record<string, unknown>) => void} intent
 *   跳转意图：开某个 sheet 页面，或退一层、关掉。
 * @property {() => Promise<unknown>} backup
 *   把当前数据无条件写进备份。导入前兜底用（TECH 9.2）。
 * @property {(next: import('./store.js').Prefs) => Promise<unknown>} prefs
 *   保存并应用偏好（主题、上次导出时间）。
 */

/** @type {AppHost} */
let app = {
  write: async () => {},
  intent: () => {},
  backup: async () => {},
  prefs: async () => {},
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
// 未落盘的编辑
// ─────────────────────────────────────────────────────────

/**
 * 当前 sheet 页面里还没落盘的编辑，由页面渲染时登记。
 *
 * 文本输入按 PRD 7.4 是**失焦时保存，不逐键保存**（TECH 3.4 / 12），而失焦不是
 * 唯一离开方式：Android 返回键、下滑关弹窗都不会让输入框失焦。所以页面渲染时把
 * 自己的保存动作登记在这里，由 app.js 在页面被藏起来时、由 sheet.js 在页面要离开
 * 时各补写一次。
 *
 * 只可能有一份：sheet 同时只显示一个页面。
 *
 * @type {(() => Promise<unknown>) | null}
 */
let pendingFlush = null;

/**
 * 登记（或清空）当前页面的补写动作。
 *
 * @param {(() => Promise<unknown>) | null} fn
 */
export function setPendingFlush(fn) {
  pendingFlush = fn;
}

/**
 * 补写一次还没落盘的编辑。
 *
 * 不 await 也不抛：调用它的地方是「页面正在离开」这种收尾路径，失败了不该拦着
 * 关弹窗。写入失败本身会由 `app.write` 里的横幅报出来。
 *
 * @returns {Promise<void>}
 */
export async function flushPending() {
  await pendingFlush?.();
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

/**
 * 改一条记录的备注。
 *
 * 和 `updateTemplate` 一样，**只有真的变了才写**：失焦时值没动是常态。
 *
 * 备注不进任何派生索引（`byDate` 只看 `date`，组内只看 `at`），而且索引里存的就是
 * pip 对象本身，所以改完不用 `reindex()`。
 *
 * @param {string} pipId
 * @param {string} note
 * @returns {Promise<boolean>} 是否真的落盘了
 */
export async function updatePipNote(pipId, note) {
  if (state.readOnly) return false;

  const pip = state.data.pips.find((p) => p.id === pipId);
  if (!pip) return false;

  const next = String(note).slice(0, NOTE_MAX);
  if (next === pip.note) return false;

  pip.note = next;
  // updated_at 是合并时判断谁更新的依据（TECH 9.3），改了就得动
  pip.updated_at = Date.now();

  await app.write({});
  return true;
}

/**
 * 删一条记录。
 *
 * **不在这里二次确认**：确认是界面的事（记录详情页就地展开，挡的是误触，见
 * PRD 7.4），存储层只管删——删掉一条随时可以重新打一次。
 *
 * @param {string} pipId
 * @returns {Promise<string | null>} 被删那条的日期，供调用方重绘那一格
 */
export async function removePip(pipId) {
  if (state.readOnly) return null;

  const pos = state.data.pips.findIndex((p) => p.id === pipId);
  if (pos === -1) return null;

  const [removed] = state.data.pips.splice(pos, 1);
  reindex();

  await app.write({ dateKey: removed.date, removedPipId: removed.id });
  return removed.date;
}

/**
 * 改偏好（主题、上次导出时间）。
 *
 * 偏好不落进 `data`，所以不走 `write`：那边会重绘日历，而改主题只要换一层 CSS 变量。
 * 保存与应用由 app.js 接上。
 *
 * @param {Partial<import('./store.js').Prefs>} patch
 */
export async function updatePrefs(patch) {
  state.prefs = { ...state.prefs, ...patch };
  await app.prefs(state.prefs);
}

/**
 * 用导入的数据替换或合并当前数据（TECH 9.2 / 9.3）。
 *
 * 导入前**必须**先留一条退路：选「覆盖」又选错文件，是唯一能一次毁掉全部数据的操作。
 * 这里走的是 `store.snapshotToBackup()`（无条件备份），而不是 `save()` 里那次备份
 * ——后者只在现有主值「看起来像我们的数据」时才挪，主值恰好损坏时反倒不留。
 *
 * @param {import('./model.js').PipData} incoming 已过 `parseImport` 的校验与归一
 * @param {'merge' | 'replace'} mode
 * @returns {Promise<boolean>} 只读模式下返回 false
 */
export async function importData(incoming, mode) {
  if (state.readOnly) return false;

  await app.backup();
  state.data = mode === 'merge' ? mergeData(state.data, incoming) : incoming;
  reindex();

  await app.write({ calendar: true });
  return true;
}

/**
 * 新建一个模板。颜色不传就自动分配一个还没被占用的（PRD 9.2）。
 *
 * @param {{ title: string, icon?: string, color?: string }} input
 * @returns {Promise<import('./model.js').Template | null>} 只读模式下返回 null
 */
export async function addTemplate(input) {
  if (state.readOnly) return null;

  const template = createTemplate(state.data.templates, input);
  state.data.templates.push(template);
  reindex();

  await app.write({ calendar: true });
  return template;
}

/**
 * 改一个模板。
 *
 * **只有真的变了才写。** 失焦时值没动是常态（点一下输入框又移开），每次都写会把
 * 当前主值一遍遍推进 backup，那份退路就被同样的内容填满了。
 *
 * @param {string} id
 * @param {{ title?: string, icon?: string, color?: string, archived?: boolean }} patch
 * @returns {Promise<boolean>} 是否真的落盘了
 */
export async function updateTemplate(id, patch) {
  if (state.readOnly) return false;

  const template = state.data.templates.find((t) => t.id === id);
  if (!template) return false;

  const next = {
    title: patch.title ?? template.title,
    icon: patch.icon ?? template.icon,
    color: patch.color ?? template.color,
    archived: patch.archived ?? template.archived,
  };
  const changed =
    next.title !== template.title ||
    next.icon !== template.icon ||
    next.color !== template.color ||
    next.archived !== template.archived;
  if (!changed) return false;

  Object.assign(template, next, { updated_at: Date.now() });
  reindex();

  await app.write({ calendar: true });
  return true;
}

/**
 * 重排模板：按传入的 id 顺序重写 `sort_order`（0,1,2…），选模板页拖拽排序用。
 *
 * `pips` 不带顺序语义，日历点区和统计页各自按 `sort_order` 排（TECH 6.5 的读时
 * 计算），所以这里只改模板。
 *
 * @param {string[]} orderedIds 目标顺序的模板 id 列表
 * @returns {Promise<boolean>} 是否真的落盘了
 */
export async function reorderTemplates(orderedIds) {
  if (state.readOnly) return false;

  const byId = new Map(state.data.templates.map((t) => [t.id, t]));
  let changed = false;
  let order = 0;
  for (const id of orderedIds) {
    const template = byId.get(id);
    if (!template) continue; // 重排名单里带上了不存在的模板，跳过，不中断剩下的
    if (template.sort_order !== order) {
      template.sort_order = order;
      template.updated_at = Date.now();
      changed = true;
    }
    order += 1;
  }
  if (!changed) return false;

  reindex();
  await app.write({ calendar: true });
  return true;
}

/**
 * 删一个模板，**连它的记录一起删**（PRD 7.5）。
 *
 * 这是全项目唯一会连带删掉用户数据的操作，二次确认由界面负责，这里只管删。
 * 日常想「不想再打了」用停用：停用不删记录，所以随时能恢复——这也是这个设计里
 * 不存在孤儿记录的原因。
 *
 * @param {string} id
 * @returns {Promise<number>} 一起删掉的记录条数
 */
export async function removeTemplate(id) {
  if (state.readOnly) return 0;

  const pos = state.data.templates.findIndex((t) => t.id === id);
  if (pos === -1) return 0;

  const removed = state.data.pips.filter((p) => p.template_id === id).length;
  state.data.templates.splice(pos, 1);
  state.data.pips = state.data.pips.filter((p) => p.template_id !== id);
  reindex();

  await app.write({ calendar: true });
  return removed;
}

/** 把浏览位置拨回当月。 */
export function goToday() {
  const now = new Date();
  state.view.year = now.getFullYear();
  state.view.month = now.getMonth() + 1;
}
