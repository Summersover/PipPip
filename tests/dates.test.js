/**
 * dates.js 的断言。用 Node 内置测试运行器，零依赖。
 *
 *   npm test          # 单次
 *   npm run test:tz   # 在多个时区下各跑一遍（关键）
 *
 * 这些用例必须在**所有时区下都通过**。跑多时区不是为了覆盖时区分支，
 * 而是要证明 dates.js 根本不依赖时区——它只用本地分量方法。
 *
 * 唯一一处刻意依赖时区的用例是「toISOString 陷阱的形状」，
 * 它按运行环境的实际偏移分支断言，所以在任何时区下都能过，
 * 同时把你所处时区的错误窗口具体地打印出来。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRID_CELLS,
  WEEKDAY_LABELS,
  toDateKey,
  partsOf,
  isDateKey,
  weekdayIndex,
  parseDateKey,
  dayNumber,
  daysBetween,
  monthRange,
  inRange,
  buildMonthGrid,
  formatMonth,
  formatDayLabel,
  formatTime,
  formatRelativeDays,
  toLocalIso,
} from '../js/dates.js';

// ─────────────────────────────────────────────────────────
// toDateKey：本文件存在的全部理由
// ─────────────────────────────────────────────────────────

test('toDateKey 在一天中的任何本地时刻都给出同一个日期', () => {
  // 这是最重要的断言：本地时刻变化不该改变「哪一天」。
  // 注意用的是 new Date(y, m, d, h, ...) —— 本地分量构造，不是时间戳。
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 8, 22, h, 30, 0);
    assert.equal(toDateKey(d), '2026-09-22', `本地 ${h}:30 应当仍是 2026-09-22`);
  }
});

test('toDateKey 覆盖一天的边界时刻', () => {
  assert.equal(toDateKey(new Date(2026, 8, 22, 0, 0, 0, 0)), '2026-09-22');
  assert.equal(toDateKey(new Date(2026, 8, 22, 23, 59, 59, 999)), '2026-09-22');
});

test('toDateKey 正确补零', () => {
  assert.equal(toDateKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(toDateKey(new Date(2026, 11, 31)), '2026-12-31');
});

test('toDateKey 跨月跨年边界', () => {
  assert.equal(toDateKey(new Date(2026, 8, 30, 23, 59)), '2026-09-30');
  assert.equal(toDateKey(new Date(2026, 9, 1, 0, 0)), '2026-10-01');
  assert.equal(toDateKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  assert.equal(toDateKey(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
});

test('toDateKey 处理闰年 2 月 29 日', () => {
  assert.equal(toDateKey(new Date(2024, 1, 29)), '2024-02-29');
});

test('toISOString 陷阱的形状（从实际偏移推导，各时区都能过）', () => {
  // getTimezoneOffset() 返回「本地加到 UTC 需要的分钟数」，即 UTC - 本地。
  // 东八区返回 -480，所以取负号得到 +480。
  const offsetMin = -new Date(2026, 8, 22, 12, 0).getTimezoneOffset();

  /** @param {Date} d */
  const utcSlice = (d) => d.toISOString().slice(0, 10);

  // toDateKey 在一天中的任何时刻都给出同一个日期——这是它正确的表现
  const keys = new Set();
  for (let h = 0; h < 24; h++) keys.add(toDateKey(new Date(2026, 8, 22, h, 30)));
  assert.deepEqual([...keys], ['2026-09-22']);

  // 逐小时找出 toISOString 与正确日期分歧的时刻。
  // 不硬编码「几点是安全的」——那取决于偏移，写死会在极端时区（比如 UTC+14）翻车。
  /** @type {number[]} */
  const badHours = [];
  for (let h = 0; h < 24; h++) {
    if (utcSlice(new Date(2026, 8, 22, h, 30)) !== '2026-09-22') badHours.push(h);
  }

  if (offsetMin === 0) {
    assert.equal(badHours.length, 0, 'UTC 下不该有分歧');
    return;
  }

  assert.ok(badHours.length > 0, `偏移 ${offsetMin} 分钟时应当存在分歧时刻`);

  // 分歧方向由偏移符号决定：正偏移退回前一天，负偏移跳到后一天
  const expectedUtc = offsetMin > 0 ? '2026-09-21' : '2026-09-23';
  for (const h of badHours) {
    assert.equal(
      utcSlice(new Date(2026, 8, 22, h, 30)),
      expectedUtc,
      `本地 ${h}:30 的 UTC 日期`,
    );
  }

  // 一天里只会有一个连续的错误窗口，不会是两段
  const contiguous = badHours.every((h, i) => i === 0 || h === badHours[i - 1] + 1);
  assert.ok(contiguous, `错误窗口应当是连续的一段，实际 ${badHours.join(',')}`);

  // 打印出来，直观看到当前时区的错误窗口在哪
  const from = String(badHours[0]).padStart(2, '0');
  const to = String(badHours[badHours.length - 1]).padStart(2, '0');
  console.log(
    `      偏移 ${offsetMin > 0 ? '+' : ''}${offsetMin / 60}h → toISOString 的错误窗口：本地 ${from}:00–${to}:59`,
  );
});

// ─────────────────────────────────────────────────────────
// 分量与校验
// ─────────────────────────────────────────────────────────

test('partsOf 返回 1–12 的月份', () => {
  assert.deepEqual(partsOf('2026-09-22'), { y: 2026, m: 9, d: 22 });
  assert.deepEqual(partsOf('2026-01-01'), { y: 2026, m: 1, d: 1 });
  assert.deepEqual(partsOf('2026-12-31'), { y: 2026, m: 12, d: 31 });
});

test('isDateKey 接受合法值', () => {
  assert.equal(isDateKey('2026-09-22'), true);
  assert.equal(isDateKey('2024-02-29'), true);
});

test('isDateKey 拒绝格式错误的值', () => {
  for (const bad of ['2026-9-22', '26-09-22', '2026/09/22', '2026-09-22T00:00', '', 'abc', '2026-09-2']) {
    assert.equal(isDateKey(bad), false, `应当拒绝 ${JSON.stringify(bad)}`);
  }
});

test('isDateKey 拒绝不存在的日期', () => {
  // 这是往返校验的价值：new Date(2026, 1, 30) 会归一化成 3 月 2 日
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey('2026-02-29'), false, '2026 不是闰年');
  assert.equal(isDateKey('2026-04-31'), false);
  assert.equal(isDateKey('2026-13-01'), false);
  assert.equal(isDateKey('2026-00-10'), false);
});

test('isDateKey 拒绝非字符串', () => {
  for (const bad of [null, undefined, 20260922, {}, []]) {
    assert.equal(isDateKey(bad), false);
  }
});

// ─────────────────────────────────────────────────────────
// 周一起始
// ─────────────────────────────────────────────────────────

test('weekdayIndex 以周一为 0', () => {
  assert.equal(weekdayIndex(new Date(2026, 8, 21)), 0, '2026-09-21 是周一');
  assert.equal(weekdayIndex(new Date(2026, 8, 22)), 1, '2026-09-22 是周二');
  assert.equal(weekdayIndex(new Date(2026, 8, 26)), 5, '2026-09-26 是周六');
  assert.equal(weekdayIndex(new Date(2026, 8, 27)), 6, '2026-09-27 是周日');
});

test('weekdayIndex 全周覆盖且与标签顺序一致', () => {
  // 2026-09-21 起连续七天
  const got = [];
  for (let i = 0; i < 7; i++) got.push(weekdayIndex(new Date(2026, 8, 21 + i)));
  assert.deepEqual(got, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(WEEKDAY_LABELS.length, 7);
  assert.equal(WEEKDAY_LABELS[0], '周一');
  assert.equal(WEEKDAY_LABELS[6], '周日');
});

// ─────────────────────────────────────────────────────────
// 月份网格
// ─────────────────────────────────────────────────────────

test('buildMonthGrid 恒为 42 格', () => {
  for (let m = 1; m <= 12; m++) {
    assert.equal(buildMonthGrid(2026, m).length, GRID_CELLS, `2026-${m} 应当 42 格`);
  }
  assert.equal(buildMonthGrid(2024, 2).length, 42);
});

test('buildMonthGrid 首格是含本月 1 日的那一周的周一（lead=1）', () => {
  // 2026-09-01 是周二，所以首格是 8 月 31 日（周一）
  const cells = buildMonthGrid(2026, 9);
  assert.equal(cells[0].key, '2026-08-31');
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[1].key, '2026-09-01');
  assert.equal(cells[1].inMonth, true);
  assert.equal(cells[41].key, '2026-10-11');
});

test('buildMonthGrid 处理 lead=0（1 日就是周一）', () => {
  // 2026-06-01 是周一，首格就是它自己
  const cells = buildMonthGrid(2026, 6);
  assert.equal(cells[0].key, '2026-06-01');
  assert.equal(cells[0].inMonth, true);
});

test('buildMonthGrid 处理 lead=6（1 日是周日）', () => {
  // 2026-02-01 是周日，前面要补满 6 格
  const cells = buildMonthGrid(2026, 2);
  assert.equal(cells[0].key, '2026-01-26');
  assert.equal(cells[0].inMonth, false);
  assert.equal(cells[6].key, '2026-02-01');
  assert.equal(cells[6].inMonth, true);
});

test('buildMonthGrid 的本月格子数等于当月天数', () => {
  assert.equal(buildMonthGrid(2026, 9).filter((c) => c.inMonth).length, 30);
  assert.equal(buildMonthGrid(2026, 2).filter((c) => c.inMonth).length, 28);
  assert.equal(buildMonthGrid(2024, 2).filter((c) => c.inMonth).length, 29, '闰年');
  assert.equal(buildMonthGrid(2026, 12).filter((c) => c.inMonth).length, 31);
});

test('buildMonthGrid 格子连续无重复', () => {
  const cells = buildMonthGrid(2026, 9);
  for (let i = 1; i < cells.length; i++) {
    assert.equal(daysBetween(cells[i - 1].key, cells[i].key), 1, `第 ${i} 格应当比前一格晚一天`);
  }
});

test('buildMonthGrid 标记今天（注入 todayKey，不依赖真实日期）', () => {
  const cells = buildMonthGrid(2026, 9, '2026-09-22');
  const today = cells.filter((c) => c.isToday);
  assert.equal(today.length, 1);
  assert.equal(today[0].key, '2026-09-22');

  // 今天不在本月时，本月网格里不该有标记
  assert.equal(buildMonthGrid(2026, 9, '2026-11-05').filter((c) => c.isToday).length, 0);
});

test('buildMonthGrid 跨年月份正确', () => {
  const jan = buildMonthGrid(2027, 1);
  assert.equal(jan.filter((c) => c.inMonth).length, 31);
  assert.ok(jan[0].key.startsWith('2026-12'), `首格应当是 2026 年 12 月，实际 ${jan[0].key}`);
});

// ─────────────────────────────────────────────────────────
// 范围过滤（靠字符串字典序）
// ─────────────────────────────────────────────────────────

test('monthRange 给出当月首末日', () => {
  assert.deepEqual(monthRange(2026, 9), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(monthRange(2026, 12), { start: '2026-12-01', end: '2026-12-31' });
});

test('monthRange 处理闰年二月', () => {
  assert.deepEqual(monthRange(2024, 2), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(monthRange(2026, 2), { start: '2026-02-01', end: '2026-02-28' });
});

test('inRange 靠字典序工作，跨月跨年都成立', () => {
  const { start, end } = monthRange(2026, 9);
  assert.equal(inRange('2026-09-01', start, end), true, '首日含');
  assert.equal(inRange('2026-09-30', start, end), true, '末日含');
  assert.equal(inRange('2026-09-22', start, end), true);
  assert.equal(inRange('2026-08-31', start, end), false, '前一天');
  assert.equal(inRange('2026-10-01', start, end), false, '后一天');

  // 字典序本身的性质：零填充保证跨月跨年不串
  assert.ok('2026-09-30' < '2026-10-01');
  assert.ok('2026-12-31' < '2027-01-01');
  assert.ok('2026-09-02' <= '2026-09-22');
});

// ─────────────────────────────────────────────────────────
// 天数差与相对时间
// ─────────────────────────────────────────────────────────

test('dayNumber 是连续整数，跨月跨年都不跳', () => {
  assert.equal(dayNumber('2026-09-23') - dayNumber('2026-09-22'), 1);
  assert.equal(dayNumber('2026-10-01') - dayNumber('2026-09-30'), 1);
  assert.equal(dayNumber('2027-01-01') - dayNumber('2026-12-31'), 1);
  assert.equal(dayNumber('2024-03-01') - dayNumber('2024-02-28'), 2, '闰年 2 月 29 日');
  assert.equal(dayNumber('2026-03-01') - dayNumber('2026-02-28'), 1, '平年');
});

test('daysBetween 有符号', () => {
  assert.equal(daysBetween('2026-09-22', '2026-09-25'), 3);
  assert.equal(daysBetween('2026-09-25', '2026-09-22'), -3);
  assert.equal(daysBetween('2026-09-22', '2026-09-22'), 0);
});

test('formatRelativeDays 按本地日历日算，不按毫秒', () => {
  // 关键用例：今天 00:30 与昨天 23:30 只差 1 小时，但应当是「昨天」
  const yesterdayLate = new Date(2026, 8, 21, 23, 30).getTime();
  const todayEarly = '2026-09-22';
  assert.equal(formatRelativeDays(yesterdayLate, todayEarly), '昨天');

  assert.equal(formatRelativeDays(new Date(2026, 8, 22, 1, 0).getTime(), todayEarly), '今天');
  assert.equal(formatRelativeDays(new Date(2026, 8, 22, 23, 0).getTime(), todayEarly), '今天');
  assert.equal(formatRelativeDays(new Date(2026, 8, 10, 12, 0).getTime(), todayEarly), '12 天前');
  assert.equal(formatRelativeDays(new Date(2026, 7, 22, 12, 0).getTime(), todayEarly), '31 天前');
});

test('formatRelativeDays 覆盖导出提醒的阈值', () => {
  const today = '2026-09-22';
  assert.equal(formatRelativeDays(new Date(2026, 8, 21).getTime(), today), '昨天');
  assert.equal(formatRelativeDays(new Date(2026, 7, 23).getTime(), today), '30 天前');
  assert.equal(formatRelativeDays(new Date(2026, 7, 22).getTime(), today), '31 天前');
});

// ─────────────────────────────────────────────────────────
// 格式化
// ─────────────────────────────────────────────────────────

test('formatMonth 月份不补零', () => {
  assert.equal(formatMonth(2026, 9), '2026年9月');
  assert.equal(formatMonth(2026, 12), '2026年12月');
  assert.equal(formatMonth(2026, 1), '2026年1月');
});

test('formatDayLabel 含星期且周一起始', () => {
  assert.equal(formatDayLabel('2026-09-22'), '9月22日 周二');
  assert.equal(formatDayLabel('2026-09-21'), '9月21日 周一');
  assert.equal(formatDayLabel('2026-09-27'), '9月27日 周日');
});

test('formatTime 是 24 小时制并补零', () => {
  assert.equal(formatTime(new Date(2026, 8, 22, 14, 30).getTime()), '14:30');
  assert.equal(formatTime(new Date(2026, 8, 22, 9, 5).getTime()), '09:05');
  assert.equal(formatTime(new Date(2026, 8, 22, 0, 0).getTime()), '00:00');
  assert.equal(formatTime(new Date(2026, 8, 22, 23, 59).getTime()), '23:59');
});

test('parseDateKey 给出本地午夜', () => {
  const d = parseDateKey('2026-09-22');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8, 'Date 的月份是 0–11');
  assert.equal(d.getDate(), 22);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(toDateKey(d), '2026-09-22', '往返一致');
});

// ─────────────────────────────────────────────────────────
// 带本地偏移的 ISO（导出文件的时间戳）
// ─────────────────────────────────────────────────────────

test('toLocalIso 的格式是带偏移的 ISO 8601', () => {
  assert.match(
    toLocalIso(new Date(2026, 8, 22, 14, 30, 0)),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
  );
});

test('toLocalIso 写的是本地分量，不是 UTC 分量', () => {
  // 和 toDateKey 同一个道理：本地 00:30 的日期部分必须是本地的今天。
  // 任何时区下都成立，所以不硬编码时区。
  assert.ok(
    toLocalIso(new Date(2026, 8, 22, 0, 30, 0)).startsWith('2026-09-22T00:30:00'),
    toLocalIso(new Date(2026, 8, 22, 0, 30, 0)),
  );
});

test('toLocalIso 的偏移和运行环境的实际偏移一致', () => {
  // 从 Date 自己算出偏移再比，不在测试里写死时区
  const d = new Date(2026, 8, 22, 14, 30, 0);
  const offsetMin = -d.getTimezoneOffset();
  const abs = Math.abs(offsetMin);
  const pad = (n) => String(n).padStart(2, '0');
  const expected = `${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  assert.ok(toLocalIso(d).endsWith(expected), `应当以 ${expected} 结尾`);
});

test('toLocalIso 能被 Date 解析回同一时刻', () => {
  // 这是它存在的意义：换台设备打开导出文件，也知道那是本地的几点
  const d = new Date(2026, 8, 22, 14, 30, 0);
  assert.equal(new Date(toLocalIso(d)).getTime(), d.getTime());
});
