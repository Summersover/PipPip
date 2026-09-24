/**
 * 日期工具。全部是纯函数。
 *
 * ★ 本文件是时区 bug 的唯一可能来源，所以写得非常保守。
 *
 * 唯一允许的「Date → YYYY-MM-DD」方式就是 `toDateKey()`。
 * 任何地方不得出现 `toISOString()`——它按 UTC 输出，只要本地时间与 UTC 不在同一天就会错：
 *
 *   - 东八区（UTC+8）：本地 00:00–07:59 会算成**前一天**
 *   - 纽约（UTC-5）：本地 19:00–23:59 会算成**后一天**
 *
 * 这类错误是静默的，不报错，只是把打卡记到错的日期上。
 *
 * 本文件所有函数都只用 Date 的**本地分量**方法（getFullYear / getMonth / getDate / getHours…），
 * 不用任何 UTC 方法，所以结果与运行环境的时区无关。
 * `tests/dates.test.js` 会在多个时区下各跑一遍来证明这一点。
 */

/**
 * 本地时区的日期字符串，形如 `"2026-09-22"`。
 *
 * **必须零填充**，因为日期范围过滤靠字符串字典序比较（见 `inRange`）：
 * `"2026-09-30" < "2026-10-01"` 和 `"2026-12-31" < "2027-01-01"` 都成立，
 * 而 `"2026-9-30"` 这种写法会破坏这个性质。
 *
 * @typedef {string} DateKey
 */

/**
 * 月份网格的格子数。固定 6 行 × 7 列，这样切换月份时高度不跳动。
 * @type {number}
 */
export const GRID_CELLS = 42;

/** @type {readonly string[]} 索引 0 是周一 */
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 把 Date 转成本地时区的 `YYYY-MM-DD`。
 *
 * 这是唯一的转换出口。**不要**用 `toISOString().slice(0, 10)`。
 *
 * @param {Date} [d] 默认当前时刻
 * @returns {DateKey}
 */
export function toDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 拆出年月日分量。用 slice 而不是 split+解构，避免越界和类型收窄的噪音。
 *
 * @param {DateKey} key
 * @returns {{ y: number, m: number, d: number }} m 为 1–12（不是 Date 的 0–11）
 */
export function partsOf(key) {
  return {
    y: Number(key.slice(0, 4)),
    m: Number(key.slice(5, 7)),
    d: Number(key.slice(8, 10)),
  };
}

/**
 * 校验一个字符串是不是合法的 `DateKey`。
 *
 * 除了格式，还要做一次真实的 Date 往返，用来拒绝 `2026-02-30` 这种
 * 格式合法但日期不存在的值（`new Date(2026, 1, 30)` 会归一化成 3 月 2 日）。
 *
 * @param {unknown} s
 * @returns {s is DateKey}
 */
export function isDateKey(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = partsOf(s);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * 周一起始的列偏移。
 *
 * `getDay()` 是 0=周日…6=周六，我们需要 0=周一…6=周日。
 * **不要直接拿 `getDay()` 当列索引**，那样日历会从周日开始排。
 *
 * @param {Date} d
 * @returns {number} 0 = 周一 … 6 = 周日
 */
export function weekdayIndex(d) {
  return (d.getDay() + 6) % 7;
}

/**
 * `DateKey` → 本地时区当天 00:00 的 Date。
 *
 * @param {DateKey} key
 * @returns {Date}
 */
export function parseDateKey(key) {
  const { y, m, d } = partsOf(key);
  return new Date(y, m - 1, d);
}

/**
 * 把 `DateKey` 转成一个连续的天序号，用于算天数差。
 *
 * 用 `Date.UTC` 只作用于**年月日分量**（不是时间戳），所以结果是一个精确的整数天，
 * 不受夏令时影响——直接相减两个本地午夜的 Date 在有夏令时的时区会得到 23 或 25 小时。
 *
 * @param {DateKey} key
 * @returns {number}
 */
export function dayNumber(key) {
  const { y, m, d } = partsOf(key);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * 两个日期相差几天。`b` 比 `a` 晚则为正。
 *
 * @param {DateKey} a
 * @param {DateKey} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/**
 * 某个月的起止日期键，用于范围过滤。
 *
 * 配合 `inRange` 使用，靠字符串字典序比较，不需要把字符串解析成 Date。
 *
 * @param {number} year
 * @param {number} month 1–12
 * @returns {{ start: DateKey, end: DateKey }}
 */
export function monthRange(year, month) {
  return {
    start: toDateKey(new Date(year, month - 1, 1)),
    // 下个月的第 0 天 = 本月最后一天，由引擎处理闰年和月份长度
    end: toDateKey(new Date(year, month, 0)),
  };
}

/**
 * 日期是否落在闭区间内。**靠字符串字典序比较**，这是 `DateKey` 必须零填充的原因。
 *
 * @param {DateKey} key
 * @param {DateKey} start
 * @param {DateKey} end
 * @returns {boolean}
 */
export function inRange(key, start, end) {
  return key >= start && key <= end;
}

/**
 * @typedef {object} GridCell
 * @property {DateKey} key
 * @property {number} day 1–31
 * @property {boolean} inMonth 是否属于目标月份（非本月的格子留空不渲染）
 * @property {boolean} isToday
 */

/**
 * 生成固定 42 格的月份网格，周一起始。
 *
 * 用 `new Date(y, m, day)` 传本地分量而不是算毫秒偏移：跨月、跨年、闰年
 * 都由引擎归一化（`day` 为 0 或负数都正确）。
 *
 * @param {number} year
 * @param {number} month 1–12
 * @param {DateKey} [todayKey] 注入「今天」便于测试，默认取当前
 * @returns {GridCell[]} 长度恒为 42
 */
export function buildMonthGrid(year, month, todayKey = toDateKey()) {
  const lead = weekdayIndex(new Date(year, month - 1, 1));
  /** @type {GridCell[]} */
  const cells = [];
  for (let i = 0; i < GRID_CELLS; i++) {
    const d = new Date(year, month - 1, 1 - lead + i);
    const key = toDateKey(d);
    cells.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
      isToday: key === todayKey,
    });
  }
  return cells;
}

/**
 * `"2026年9月"`。月份不补零。
 *
 * @param {number} year
 * @param {number} month 1–12
 * @returns {string}
 */
export function formatMonth(year, month) {
  return `${year}年${month}月`;
}

/**
 * `"9月22日 周一"`。
 *
 * @param {DateKey} key
 * @returns {string}
 */
export function formatDayLabel(key) {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_LABELS[weekdayIndex(d)]}`;
}

/**
 * `"14:30"`，24 小时制，补零。
 *
 * @param {number} ts 时间戳
 * @returns {string}
 */
export function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * `"12 天前"`。按**本地日历日**相减，不是按毫秒除——
 * 今天 00:30 和昨天 23:30 相差 1 小时，但应该显示「昨天」。
 *
 * @param {number} ts 过去某个时刻的时间戳
 * @param {DateKey} [todayKey] 注入「今天」便于测试，默认取当前
 * @returns {string}
 */
export function formatRelativeDays(ts, todayKey = toDateKey()) {
  const n = daysBetween(toDateKey(new Date(ts)), todayKey);
  if (n <= 0) return '今天';
  if (n === 1) return '昨天';
  return `${n} 天前`;
}

/**
 * 带本地时区偏移的 ISO 8601，形如 `"2026-09-22T14:30:00+08:00"`。
 *
 * 导出文件的时间戳用它（TECH 9.1）。它**不是** `DateKey`，不需要和日历对齐，所以
 * 带上偏移是对的——换台设备打开文件也知道那是本地的几点。
 *
 * 仍然不用 `toISOString()`：那个按 UTC 输出，还得再把偏移算回去拼一遍（TECH 15
 * 禁止在 `dates.js` 之外直接出现它）。
 *
 * @param {Date} [d]
 * @returns {string}
 */
export function toLocalIso(d = new Date()) {
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, '0');
  // getTimezoneOffset() 返回「UTC - 本地」的分钟数，取负号得到常见写法的偏移
  const offset = -d.getTimezoneOffset();
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${offset < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
