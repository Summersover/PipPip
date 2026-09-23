/**
 * 月历网格。
 *
 * 只负责把数据画成 DOM，不持有状态、不碰存储。所有输入通过参数传入。
 */

import { WEEKDAY_LABELS, buildMonthGrid, formatDayLabel, formatMonth } from '../dates.js';
import { COLOR_CLASS } from '../model.js';

/**
 * 一行最多几个点。
 *
 * 格子宽约 47px：5 个点占 5×5 + 4×2 = 33px，放得下且不挤；6 个就要 40px，
 * 加上左右留白已经太满。
 */
const DOTS_PER_ROW = 5;

/**
 * 两行最多显示 8 个点（5 + 3）。
 *
 * 不是 10（5 + 5）：有溢出时第二行末尾要放 `+N`，而 4 个点加文字宽 42.6px——
 * 360px 屏的格子只有 42.9px，余量 0.2px；320px 屏的格子 37.1px，直接溢出 5.5px。
 * 第二行退到 3 个点加文字是 34px，窄屏也放得下。
 *
 * 上限取 8 而不是「没溢出时 10、有溢出时 8」，是为了让显示的点数随记录数单调
 * 不减——否则从 10 条变 11 条，点反而会从 10 个掉到 8 个。
 *
 * 行数由 app.css 的 `.cal-dots` 固定为两行的高度。
 */
const MAX_DOTS = 8;

/** 有溢出时第二行放几个点，剩下的宽度留给 `+N`。 */
const OVERFLOW_ROW_DOTS = 3;

/**
 * 按模板在模板列表中的顺序排序。
 *
 * 这样同一个模板的颜色在每天的格子里位置一致，扫视时更容易认（PRD 7.1）。
 * 模板缺失时（只可能来自手工编辑或损坏的导入文件）排到最后，不丢记录。
 *
 * @param {import('../model.js').Pip[]} pips
 * @param {Map<string, import('../model.js').Template>} templateById
 */
function orderPips(pips, templateById) {
  return [...pips].sort((a, b) => {
    const ta = templateById.get(a.template_id)?.sort_order ?? Infinity;
    const tb = templateById.get(b.template_id)?.sort_order ?? Infinity;
    return ta - tb || a.at - b.at;
  });
}

/**
 * 把点分到各行，尽量均匀。
 *
 * **不靠 CSS 自动换行**：那样 6 个点会排成 5 + 1，第二行孤零零一个，而 3 + 3
 * 整齐得多。超过两行的情况在调用前已经被截断，所以这里最多分两行。
 *
 * @param {number} count
 * @returns {number[]} 每行的点数
 */
function splitRows(count) {
  if (count <= DOTS_PER_ROW) return count > 0 ? [count] : [];
  const top = Math.ceil(count / 2);
  return [top, count - top];
}

/**
 * 决定一个格子底部显示哪些点。
 *
 * @param {import('../model.js').Pip[]} pips
 * @param {Map<string, import('../model.js').Template>} templateById
 * @returns {{ rows: import('../model.js').Pip[][], overflow: number }}
 */
export function dotsForDay(pips, templateById) {
  if (pips.length === 0) return { rows: [], overflow: 0 };

  const ordered = orderPips(pips, templateById);

  if (ordered.length > MAX_DOTS) {
    // 有溢出：第二行只放 3 个，末尾留给 `+N`
    return {
      rows: [
        ordered.slice(0, DOTS_PER_ROW),
        ordered.slice(DOTS_PER_ROW, DOTS_PER_ROW + OVERFLOW_ROW_DOTS),
      ],
      overflow: ordered.length - MAX_DOTS,
    };
  }

  // 没溢出就尽量均分，避免 5 + 1 那种一头沉的排法
  /** @type {import('../model.js').Pip[][]} */
  const rows = [];
  let cursor = 0;
  for (const size of splitRows(ordered.length)) {
    rows.push(ordered.slice(cursor, cursor + size));
    cursor += size;
  }
  return { rows, overflow: 0 };
}

/**
 * @param {HTMLElement} el
 * @param {number} year
 * @param {number} month 1–12
 */
export function renderTitle(el, year, month) {
  el.textContent = formatMonth(year, month);
}

/**
 * 建格子的点区。
 *
 * **即使没有点也返回容器**，因为容器高度固定（两行点的高度）：这样有没有点、
 * 有几行点，日期数字都落在同一高度上。少了这个占位，数字会随点行数上下浮动——
 * 加了第二行之后这个偏差会到十几像素，一眼就能看出来。
 *
 * @param {import('../model.js').Pip[]} pips
 * @param {Map<string, import('../model.js').Template>} templateById
 * @returns {HTMLSpanElement}
 */
function buildDots(pips, templateById) {
  const wrap = document.createElement('span');
  wrap.className = 'cal-dots';

  const { rows, overflow } = dotsForDay(pips, templateById);

  rows.forEach((rowPips, index) => {
    const row = document.createElement('span');
    row.className = 'cal-dots-row';

    for (const pip of rowPips) {
      const dot = document.createElement('span');
      const color = templateById.get(pip.template_id)?.color ?? '';
      dot.className = `pip ${COLOR_CLASS[color] ?? 'pip-unknown'}`;
      row.append(dot);
    }

    // `+N` 挂在最后一行的末尾，和上一行的点等宽
    if (overflow > 0 && index === rows.length - 1) {
      const more = document.createElement('span');
      more.className = 'cal-more';
      more.textContent = `+${overflow}`;
      row.append(more);
    }

    wrap.append(row);
  });

  return wrap;
}

/**
 * 建一个日期格子。非本月返回空的 `<td>`（PRD 7.1：非本月不渲染，留空）。
 *
 * @param {import('../dates.js').GridCell} cell
 * @param {Map<string, import('../model.js').Pip[]>} pipsByDate
 * @param {Map<string, import('../model.js').Template>} templateById
 * @param {import('../dates.js').DateKey} todayKey
 * @returns {HTMLTableCellElement}
 */
function buildCell(cell, pipsByDate, templateById, todayKey) {
  const td = document.createElement('td');
  if (!cell.inMonth) return td;

  const pips = pipsByDate.get(cell.key) ?? [];
  // 未来日期不可点：打卡是记录已发生的事，不是立计划（PRD 7.1）。
  // 字典序比较在这里成立，因为 DateKey 是零填充的。
  const isFuture = cell.key > todayKey;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cal-cell';
  btn.dataset.date = cell.key;
  if (cell.isToday) btn.classList.add('is-today');
  if (isFuture) {
    btn.disabled = true;
    btn.classList.add('is-future');
  }

  const day = document.createElement('span');
  day.className = 'cal-day';
  day.textContent = String(cell.day);
  btn.append(day);

  const dotRow = buildDots(pips, templateById);
  btn.append(dotRow);

  const label = formatDayLabel(cell.key);
  btn.setAttribute('aria-label', pips.length > 0 ? `${label}，${pips.length} 次打卡` : label);
  if (cell.isToday) btn.setAttribute('aria-current', 'date');

  td.append(btn);
  return td;
}

/**
 * 渲染整个月历：周表头 + 42 个格子。
 *
 * 每次调用重建全部内容。42 个格子是亚毫秒级，不值得做增量更新——除了打卡
 * 之后只重绘那一天（见 TECH 6.2），那时用 `renderCell`。
 *
 * @param {HTMLTableElement} table
 * @param {object} opts
 * @param {number} opts.year
 * @param {number} opts.month 1–12
 * @param {Map<string, import('../model.js').Pip[]>} opts.pipsByDate
 * @param {Map<string, import('../model.js').Template>} opts.templateById
 * @param {import('../dates.js').DateKey} opts.todayKey
 */
export function renderCalendar(table, { year, month, pipsByDate, templateById, todayKey }) {
  table.replaceChildren();

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of WEEKDAY_LABELS) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label.replace('周', '');
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  const cells = buildMonthGrid(year, month, todayKey);
  for (let row = 0; row < 6; row++) {
    const tr = document.createElement('tr');
    for (let col = 0; col < 7; col++) {
      tr.append(buildCell(cells[row * 7 + col], pipsByDate, templateById, todayKey));
    }
    tbody.append(tr);
  }
  table.append(tbody);
}

/**
 * 只重绘某一天的格子。打卡之后用，让 pip 的出现动画落在正确的元素上。
 *
 * @param {HTMLTableElement} table
 * @param {import('../dates.js').DateKey} dateKey
 * @param {Map<string, import('../model.js').Pip[]>} pipsByDate
 * @param {Map<string, import('../model.js').Template>} templateById
 * @param {import('../dates.js').DateKey} todayKey
 */
export function renderCell(table, dateKey, pipsByDate, templateById, todayKey) {
  const btn = table.querySelector(`.cal-cell[data-date="${dateKey}"]`);
  if (!btn) return; // 这一天不在当前显示的月份里
  const cell = buildMonthGrid(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)),
    todayKey,
  ).find((c) => c.key === dateKey);
  if (!cell) return;
  const fresh = buildCell(cell, pipsByDate, templateById, todayKey).firstElementChild;
  if (fresh) btn.replaceWith(fresh);
}
