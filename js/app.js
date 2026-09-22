/**
 * 入口：装配与启动。
 *
 * 这一步（实施顺序第 2 步）只有静态骨架和写死的数据。存储层是第 3 步。
 */

import { toDateKey } from './dates.js';
import { PRESET_COLORS, groupPipsByDate, indexTemplates } from './model.js';
import { renderCalendar, renderTitle } from './views/calendar.js';

// ─────────────────────────────────────────────────────────
// 临时数据
//
// 第 3 步接上 store.js 之后整块删除。刻意用「相对今天的天数」生成，这样
// 任何时候打开都能看到点，而不是写死某个日期、过了那个月就一片空。
// ─────────────────────────────────────────────────────────

function buildFixture() {
  /** @type {import('./model.js').Template[]} */
  const templates = [
    { id: 't_water', title: '喝水', icon: '💧', color: PRESET_COLORS[4], archived: false, sort_order: 0, created_at: 0, updated_at: 0 },
    { id: 't_run', title: '跑步', icon: '🏃', color: PRESET_COLORS[0], archived: false, sort_order: 1, created_at: 0, updated_at: 0 },
    { id: 't_book', title: '读书', icon: '📖', color: PRESET_COLORS[5], archived: false, sort_order: 2, created_at: 0, updated_at: 0 },
  ];

  /**
   * `[相对今天的天数, 模板索引, 次数]`
   *
   * 特意安排了两天用来验证点的显示规则：
   * `-5` 那天 6 次 → 两行，3 + 3
   * `-3` 那天 12 次 → 两行，5 + 3 个点再加 `+4`
   * @type {[number, number, number][]}
   */
  const plan = [
    [0, 0, 3],
    [0, 1, 1],
    [-1, 0, 2],
    [-1, 2, 1],
    [-2, 1, 1],
    [-3, 0, 12],
    [-5, 0, 6],
    [-9, 0, 1],
    [-9, 2, 1],
    [-14, 1, 1],
    [-21, 0, 2],
  ];

  /** @type {import('./model.js').Pip[]} */
  const pips = [];
  let n = 0;
  for (const [offset, templateIndex, count] of plan) {
    const base = new Date();
    base.setDate(base.getDate() + offset);
    const date = toDateKey(base);
    for (let i = 0; i < count; i++) {
      const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 8 + i, (i * 17) % 60).getTime();
      pips.push({
        id: `p_fixture_${n++}`,
        template_id: templates[templateIndex].id,
        date,
        at,
        note: '',
        updated_at: at,
      });
    }
  }
  return { version: 1, templates, pips };
}

const FIXTURE = buildFixture();
const pipsByDate = groupPipsByDate(FIXTURE.pips);
const templateById = indexTemplates(FIXTURE.templates);

// ─────────────────────────────────────────────────────────
// 视图状态
// ─────────────────────────────────────────────────────────

/** 当前浏览的月份。打开永远回到当月，不记忆上次浏览的位置（PRD 7.1）。 */
const view = { year: 0, month: 0 };

const titleEl = document.getElementById('cal-title');
const gridEl = /** @type {HTMLTableElement | null} */ (document.getElementById('cal-grid'));

/** 上一次渲染时的「今天」，用于检测跨午夜。 */
let lastTodayKey = '';

function goToday() {
  const now = new Date();
  view.year = now.getFullYear();
  view.month = now.getMonth() + 1;
}

/**
 * @param {number} delta 月份增减，允许跨年
 */
function shiftMonth(delta) {
  let month = view.month + delta;
  let year = view.year;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }
  view.year = year;
  view.month = month;
}

function render() {
  if (!titleEl || !gridEl) return;
  // 每次都重新算「今天」：页面放着过了午夜，「今天」会变（TECH 5.4）
  const todayKey = toDateKey();
  lastTodayKey = todayKey;
  renderTitle(titleEl, view.year, view.month);
  renderCalendar(gridEl, {
    year: view.year,
    month: view.month,
    pipsByDate,
    templateById,
    todayKey,
  });
}

// ─────────────────────────────────────────────────────────
// 事件
// ─────────────────────────────────────────────────────────

document.getElementById('prev-month')?.addEventListener('click', () => {
  shiftMonth(-1);
  render();
});

document.getElementById('next-month')?.addEventListener('click', () => {
  shiftMonth(1);
  render();
});

// 页面重新可见时，如果已经跨过午夜就重绘
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && toDateKey() !== lastTodayKey) render();
});

goToday();
render();
