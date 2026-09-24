/**
 * state.js 写操作的断言。
 *
 * 这一组守的是**静默错数据**：写入路径出错不会报错，只会把记录弄丢、或者没写进存储。
 * `state.js` 不碰 DOM（`store.js` 才是唯一接触 localStorage 的文件），所以这里能直接
 * import 它，把 app.js 注入的那两个出口换成假的来观察。
 *
 * 每个用例先 `reset()`：模块级的 state 和索引在同一个进程里是共享的。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { NOTE_MAX, PRESET_COLORS } from '../js/model.js';
import {
  addPip,
  addTemplate,
  flushPending,
  index,
  mountHost,
  removePip,
  removeTemplate,
  setPendingFlush,
  state,
  updatePipNote,
  updateTemplate,
} from '../js/state.js';

/** @type {Record<string, unknown>[]} */
let writes = [];

function reset() {
  writes = [];
  state.data = { version: 1, templates: [], pips: [] };
  state.readOnly = false;
  setPendingFlush(null);
  mountHost({
    async write(changed) {
      writes.push(changed ?? {});
    },
    intent() {
      /* 这一组不关心跳转 */
    },
  });
}

/** @param {Partial<import('../js/model.js').Template>} [over] @returns {import('../js/model.js').Template} */
const template = (over = {}) => ({
  id: 't_a',
  title: '喝水',
  icon: '💧',
  color: PRESET_COLORS[0],
  archived: false,
  sort_order: 0,
  created_at: 1,
  updated_at: 1,
  ...over,
});

/** @param {Partial<import('../js/model.js').Pip>} [over] @returns {import('../js/model.js').Pip} */
const pip = (over = {}) => ({
  id: 'p_1',
  template_id: 't_a',
  date: '2026-09-22',
  at: 1000,
  note: '',
  updated_at: 1000,
  ...over,
});

// ─────────────────────────────────────────────────────────
// 打卡记录
// ─────────────────────────────────────────────────────────

test('addPip 记一条，并把日期和 id 交给 app 去重绘', async () => {
  reset();
  assert.equal(await addPip('t_a', '2026-09-22', '开会前灌了一杯'), true);

  const created = state.data.pips[0];
  assert.equal(state.data.pips.length, 1);
  assert.equal(created.template_id, 't_a');
  assert.equal(created.date, '2026-09-22');
  assert.equal(created.note, '开会前灌了一杯');
  assert.deepEqual(writes, [{ dateKey: '2026-09-22', pipId: created.id }]);
});

test('addPip 之后索引立刻能用', async () => {
  // 索引不跟着数据走的话，日历上看不到刚记的那一笔
  reset();
  await addPip('t_a', '2026-09-22');
  assert.equal(index.byDate.get('2026-09-22')?.length, 1);
});

test('updatePipNote 改备注并动 updated_at', async () => {
  reset();
  state.data.pips = [pip({ updated_at: 1000 })];

  assert.equal(await updatePipNote('p_1', '开会前灌了一杯'), true);
  assert.equal(state.data.pips[0].note, '开会前灌了一杯');
  assert.ok(state.data.pips[0].updated_at > 1000, 'updated_at 是合并时判断谁更新的依据');
});

test('updatePipNote 值没变时不写', async () => {
  // 失焦时值没动是常态（点一下输入框又移开），每次都写会把当前主值一遍遍推进 backup
  reset();
  state.data.pips = [pip({ note: '原来就这样' })];

  assert.equal(await updatePipNote('p_1', '原来就这样'), false);
  assert.deepEqual(writes, []);
});

test('updatePipNote 截断超长备注', async () => {
  reset();
  state.data.pips = [pip()];
  await updatePipNote('p_1', 'y'.repeat(500));
  assert.equal(state.data.pips[0].note.length, NOTE_MAX);
});

test('updatePipNote 找不到记录时返回 false 且不写', async () => {
  reset();
  assert.equal(await updatePipNote('p_没有', 'x'), false);
  assert.deepEqual(writes, []);
});

test('removePip 删掉并交出那一天的日期', async () => {
  reset();
  state.data.pips = [pip(), pip({ id: 'p_2', date: '2026-09-23' })];

  assert.equal(await removePip('p_1'), '2026-09-22');
  assert.deepEqual(state.data.pips.map((p) => p.id), ['p_2']);
  assert.deepEqual(writes, [{ dateKey: '2026-09-22', removedPipId: 'p_1' }]);
  assert.equal(index.byDate.has('2026-09-22'), false, '索引要跟着删，否则日历上还留着点');
});

test('removePip 找不到记录时不写', async () => {
  reset();
  assert.equal(await removePip('p_没有'), null);
  assert.deepEqual(writes, []);
});

// ─────────────────────────────────────────────────────────
// 模板
// ─────────────────────────────────────────────────────────

test('addTemplate 自动分配颜色、排在最后，并让日历整片重绘', async () => {
  reset();
  state.data.templates = [template({ color: PRESET_COLORS[0], sort_order: 3 })];

  const created = await addTemplate({ title: '跑步', icon: '🏃' });
  assert.ok(created);
  assert.equal(created.color, PRESET_COLORS[1], '跳过已被占用的颜色');
  assert.equal(created.sort_order, 4);
  assert.deepEqual(writes, [{ calendar: true }]);
});

test('updateTemplate 只在值真的变了时写', async () => {
  reset();
  state.data.templates = [template()];

  assert.equal(await updateTemplate('t_a', { title: '喝水' }), false, '值没变');
  assert.deepEqual(writes, []);

  assert.equal(await updateTemplate('t_a', { title: '喝水水' }), true, '值变了');
  assert.equal(state.data.templates[0].title, '喝水水');
});

test('updateTemplate 找不到模板时返回 false', async () => {
  reset();
  assert.equal(await updateTemplate('t_没有', { title: 'x' }), false);
});

test('removeTemplate 连它的记录一起删，并报出删了几条', async () => {
  reset();
  state.data.templates = [template(), template({ id: 't_b', title: '跑步' })];
  state.data.pips = [pip(), pip({ id: 'p_2' }), pip({ id: 'p_3', template_id: 't_b' })];

  assert.equal(await removeTemplate('t_a'), 2, '这条模板有 2 条记录');
  assert.deepEqual(state.data.templates.map((t) => t.id), ['t_b']);
  assert.deepEqual(state.data.pips.map((p) => p.id), ['p_3'], '别的模板的记录不能动');
  assert.equal(index.pipsByTemplate.has('t_a'), false);
});

test('停用不删记录', async () => {
  // PRD 7.5：停用只是不再出现在打卡列表里，历史记录和日历上的点全部保留
  reset();
  state.data.templates = [template()];
  state.data.pips = [pip()];

  await updateTemplate('t_a', { archived: true });
  assert.equal(state.data.templates[0].archived, true);
  assert.equal(state.data.pips.length, 1);
});

// ─────────────────────────────────────────────────────────
// 只读模式与补写登记
// ─────────────────────────────────────────────────────────

test('只读模式下所有写操作都被拦掉，一条数据都不动', async () => {
  // 这是防「坏数据被真空数据覆盖」的最后一道闸（TECH 3.5）
  reset();
  state.data.templates = [template()];
  state.data.pips = [pip()];
  state.readOnly = true;

  assert.equal(await addPip('t_a', '2026-09-22'), false);
  assert.equal(await updatePipNote('p_1', 'x'), false);
  assert.equal(await removePip('p_1'), null);
  assert.equal(await addTemplate({ title: '跑步' }), null);
  assert.equal(await updateTemplate('t_a', { title: 'x' }), false);
  assert.equal(await removeTemplate('t_a'), 0);

  assert.equal(state.data.pips.length, 1);
  assert.equal(state.data.pips[0].note, '');
  assert.equal(state.data.templates.length, 1);
  assert.deepEqual(writes, [], '只读模式下不该有任何写入');
});

test('flushPending 调登记过的那一个动作', async () => {
  reset();
  let calls = 0;
  setPendingFlush(async () => {
    calls++;
  });

  await flushPending();
  assert.equal(calls, 1);
});

test('登记被清掉之后 flushPending 是空操作', async () => {
  // 页面离开之后那个动作不该再跑：它闭着一个已经被丢掉的输入框
  reset();
  let calls = 0;
  setPendingFlush(async () => {
    calls++;
  });
  setPendingFlush(null);

  await flushPending();
  assert.equal(calls, 0);
});
