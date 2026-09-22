/**
 * 日历视图的两组断言。
 *
 * 1. 色板一致性——`model.js` 的 PRESET_COLORS、`calendar.js` 的 COLOR_CLASS、
 *    `app.css` 的 `.pip-*` 规则是三份重复的数据，必须同步。用类而不是行内
 *    style 是为了不触发 CSP 的 style-src 限制，代价就是这份重复，所以要有
 *    测试兜住漂移。
 * 2. 点数量规则——「最多两行共 8 个，超过就显示 8 个 + `+N`」是 PRD 7.1 的
 *    产品决定，很容易在重构时被改错，而错了只是看起来不对，不会报错。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PRESET_COLORS } from '../js/model.js';
import { COLOR_CLASS, dotsForDay } from '../js/views/calendar.js';

const css = fs.readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

/**
 * 从 app.css 里抓出 `.pip-xxx { background: #rrggbb; }` 形式的规则。
 * `.pip-unknown` 用的是 var()，不会匹配到——它本来就不属于预设色板。
 * @returns {Map<string, string>} 类名后缀 → 小写色值
 */
function cssPalette() {
  const found = new Map();
  const re = /\.pip-([a-z]+)\s*\{\s*background:\s*(#[0-9a-fA-F]{6})\s*;\s*\}/g;
  let m;
  while ((m = re.exec(css)) !== null) found.set(m[1], m[2].toLowerCase());
  return found;
}

test('app.css 的 pip 色板和 model.js 的 PRESET_COLORS 完全一致', () => {
  const fromCss = [...cssPalette().values()].sort();
  const fromModel = PRESET_COLORS.map((c) => c.toLowerCase()).sort();
  assert.deepEqual(fromCss, fromModel, '两边必须一一对应，多一个少一个都算漂移');
});

test('COLOR_CLASS 的键就是 PRESET_COLORS', () => {
  assert.deepEqual(Object.keys(COLOR_CLASS).sort(), [...PRESET_COLORS].sort());
});

test('每个 COLOR_CLASS 的值在 app.css 里都有对应规则', () => {
  const declared = new Set(cssPalette().keys());
  for (const cls of Object.values(COLOR_CLASS)) {
    assert.ok(declared.has(cls.replace('pip-', '')), `app.css 缺少 .${cls}`);
  }
});

// ── 点数量规则 ────────────────────────────────────────────────

/**
 * @param {string} id
 * @param {number} sort_order
 * @returns {import('../js/model.js').Template}
 */
function template(id, sort_order) {
  return {
    id,
    title: id,
    icon: '',
    color: PRESET_COLORS[0],
    archived: false,
    sort_order,
    created_at: 0,
    updated_at: 0,
  };
}

/**
 * @param {string} id
 * @param {string} template_id
 * @param {number} at
 * @returns {import('../js/model.js').Pip}
 */
function pip(id, template_id, at) {
  return { id, template_id, date: '2026-09-22', at, note: '', updated_at: at };
}

const TEMPLATES = [template('t_a', 0), template('t_b', 1), template('t_c', 2)];
const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));

/** @param {number} n */
function makePips(n) {
  return Array.from({ length: n }, (_, i) => pip(`p${i}`, 't_a', 1000 + i));
}

/** 把分行结果压平，方便断言顺序 */
const flat = (result) => result.rows.flat();

test('没有记录时不显示点', () => {
  assert.deepEqual(dotsForDay([], BY_ID), { rows: [], overflow: 0 });
});

test('1 到 5 条排成一行', () => {
  for (let n = 1; n <= 5; n++) {
    const { rows, overflow } = dotsForDay(makePips(n), BY_ID);
    assert.deepEqual(rows.map((r) => r.length), [n], `${n} 条应当是一行 ${n} 个`);
    assert.equal(overflow, 0, `${n} 条不该有溢出`);
  }
});

test('6 到 8 条排成两行，且尽量均匀', () => {
  // 不靠 CSS 自动换行：那样 6 条会排成 5 + 1，第二行孤零零一个
  const expected = { 6: [3, 3], 7: [4, 3], 8: [4, 4] };
  for (const [n, shape] of Object.entries(expected)) {
    const { rows, overflow } = dotsForDay(makePips(Number(n)), BY_ID);
    assert.deepEqual(rows.map((r) => r.length), shape, `${n} 条的分行`);
    assert.equal(overflow, 0, `${n} 条不该有溢出`);
    assert.equal(flat({ rows }).length, Number(n), '总数要对得上');
  }
});

test('每行不超过 5 个', () => {
  for (let n = 1; n <= 30; n++) {
    for (const row of dotsForDay(makePips(n), BY_ID).rows) {
      assert.ok(row.length <= 5, `${n} 条时出现了 ${row.length} 个的一行`);
    }
  }
});

test('超过 8 条时第二行退到 3 个，末尾留给 +N', () => {
  // 第二行放 4 个点加文字宽 42.6px，在 360px 屏上会顶满、320px 屏上溢出（PRD 7.1）
  const nine = dotsForDay(makePips(9), BY_ID);
  assert.deepEqual(nine.rows.map((r) => r.length), [5, 3]);
  assert.equal(nine.overflow, 1);

  const twelve = dotsForDay(makePips(12), BY_ID);
  assert.deepEqual(twelve.rows.map((r) => r.length), [5, 3]);
  assert.equal(twelve.overflow, 4);

  const many = dotsForDay(makePips(30), BY_ID);
  assert.equal(many.overflow, 22);
});

test('显示的点数随记录数单调不减', () => {
  // 否则从 10 条变 11 条时点反而变少，看着像出了错
  let previous = 0;
  for (let n = 1; n <= 30; n++) {
    const shown = flat(dotsForDay(makePips(n), BY_ID)).length;
    assert.ok(shown >= previous, `${n} 条时显示 ${shown} 个，比 ${n - 1} 条的 ${previous} 个还少`);
    previous = shown;
  }
});

test('点按模板在模板列表中的顺序排列', () => {
  // 乱序传入，期望按 sort_order 排回来——这样同一个模板的颜色每天位置一致
  const pips = [pip('p1', 't_c', 1), pip('p2', 't_a', 2), pip('p3', 't_b', 3)];
  assert.deepEqual(
    flat(dotsForDay(pips, BY_ID)).map((p) => p.template_id),
    ['t_a', 't_b', 't_c'],
  );
});

test('排序在跨行时依然成立', () => {
  // 8 个点排成两行，第二行接着第一行的顺序，不能各行独立排序
  const pips = Array.from({ length: 8 }, (_, i) =>
    pip(`p${i}`, i % 2 === 0 ? 't_a' : 't_b', 1000 + i),
  );
  const ids = flat(dotsForDay(pips, BY_ID)).map((p) => p.template_id);
  assert.deepEqual(ids, ['t_a', 't_a', 't_a', 't_a', 't_b', 't_b', 't_b', 't_b']);
});

test('同一模板的多条按打卡时刻排序', () => {
  const pips = [pip('p1', 't_a', 300), pip('p2', 't_a', 100), pip('p3', 't_a', 200)];
  assert.deepEqual(
    flat(dotsForDay(pips, BY_ID)).map((p) => p.at),
    [100, 200, 300],
  );
});

test('模板缺失的记录排到最后而不是被丢掉', () => {
  // 只可能来自手工编辑或损坏的导入文件。静默丢记录是更坏的选择。
  const pips = [pip('p1', 't_gone', 1), pip('p2', 't_a', 2)];
  const dots = flat(dotsForDay(pips, BY_ID));
  assert.equal(dots.length, 2, '不该丢记录');
  assert.deepEqual(dots.map((p) => p.template_id), ['t_a', 't_gone']);
});

test('溢出的计数包含模板缺失的记录', () => {
  const pips = [...makePips(8), pip('p_gone', 't_gone', 9999)];
  const { rows, overflow } = dotsForDay(pips, BY_ID);
  assert.equal(flat({ rows }).length, 8, '9 条记录显示 8 个');
  assert.equal(overflow, 1);
});
