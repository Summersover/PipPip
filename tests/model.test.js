/**
 * model.js 里 `normalize()` 的断言。
 *
 * 它守的是「从存储或导入读进来的东西有多脏」。这里唯一的破坏性操作是丢弃
 * `date` 非法的记录，所以那一条要重点验：既不能静默丢，也不能乱丢。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTE_MAX,
  PRESET_COLORS,
  SCHEMA_VERSION,
  TITLE_MAX,
  activeTemplates,
  buildExport,
  createPip,
  createTemplate,
  looksLikeData,
  mergeById,
  mergeData,
  nextSortOrder,
  normalize,
  orderedTemplates,
  parseImport,
  pickColor,
} from '../js/model.js';

const pip = (over = {}) => ({
  id: 'p_1',
  template_id: 't_a',
  date: '2026-09-22',
  at: 1000,
  note: '',
  updated_at: 1000,
  ...over,
});

const template = (over = {}) => ({
  id: 't_a',
  title: '喝水',
  icon: '💧',
  color: PRESET_COLORS[4],
  archived: false,
  sort_order: 0,
  created_at: 1,
  updated_at: 1,
  ...over,
});

test('完全不是对象的输入也产出合法空结构', () => {
  for (const junk of [null, undefined, 42, 'x', []]) {
    const out = normalize(junk);
    assert.equal(out.version, SCHEMA_VERSION);
    assert.deepEqual(out.templates, []);
    assert.deepEqual(out.pips, []);
  }
});

test('缺字段的模板被补全而不是丢掉', () => {
  const out = normalize({ templates: [{ title: '只有标题' }], pips: [] });
  assert.equal(out.templates.length, 1);
  assert.ok(out.templates[0].id, '缺 id 要补一个');
  assert.equal(out.templates[0].color, PRESET_COLORS[0], '缺颜色用色板第一个');
  assert.equal(out.templates[0].archived, false);
});

test('色板之外的颜色回落到预设值', () => {
  // 颜色要进 CSS 类名映射，来路不明的值会渲染成一个没有样式的点
  const out = normalize({ templates: [template({ color: '#123456' })], pips: [] });
  assert.equal(out.templates[0].color, PRESET_COLORS[0]);
});

test('标题和备注超长被截断', () => {
  const out = normalize({
    templates: [template({ title: 'x'.repeat(50) })],
    pips: [pip({ note: 'y'.repeat(500) })],
  });
  assert.equal(out.templates[0].title.length, TITLE_MAX);
  assert.equal(out.pips[0].note.length, NOTE_MAX);
});

test('date 非法的记录被丢弃，并回调告知', () => {
  const dropped = [];
  const out = normalize(
    { templates: [], pips: [pip({ id: 'p_ok' }), pip({ id: 'p_bad', date: '2026-9-22' }), pip({ id: 'p_bad2', date: null })] },
    (d) => dropped.push(d),
  );

  assert.equal(out.pips.length, 1, '只留合法的那条');
  assert.equal(out.pips[0].id, 'p_ok');
  assert.deepEqual(
    dropped.map((d) => d.id),
    ['p_bad', 'p_bad2'],
    '丢记录必须留痕，不能静默（TECH 11.4）',
  );
});

test('不存在的日期也算非法', () => {
  // 2026 不是闰年，2 月没有 29 日
  const out = normalize({ templates: [], pips: [pip({ date: '2026-02-29' })] });
  assert.equal(out.pips.length, 0);
});

test('模板缺失的记录被保留而不是丢掉', () => {
  // 孤儿记录只可能来自手工编辑或损坏的导入文件。静默删掉是更坏的选择。
  const out = normalize({ templates: [], pips: [pip({ template_id: 't_不存在' })] });
  assert.equal(out.pips.length, 1);
  assert.equal(out.pips[0].template_id, 't_不存在');
});

test('缺 at 的记录用当前时间补，不会变成 0', () => {
  // at 是当天内排序的依据，补成 0 会让它排到最前面
  const before = Date.now();
  const out = normalize({ templates: [], pips: [pip({ at: undefined })] });
  assert.ok(out.pips[0].at >= before);
});

test('缺 id 的记录补一个唯一的 id', () => {
  const out = normalize({ templates: [], pips: [pip({ id: undefined }), pip({ id: undefined })] });
  assert.ok(out.pips[0].id && out.pips[1].id);
  assert.notEqual(out.pips[0].id, out.pips[1].id, '两条不能拿到同一个 id');
});

test('normalize 是幂等的', () => {
  const once = normalize({ templates: [template()], pips: [pip()] });
  const twice = normalize(once);
  assert.deepEqual(twice, once);
});

test('looksLikeData 只认有模板或记录数组的对象', () => {
  assert.equal(looksLikeData({ templates: [], pips: [] }), true);
  assert.equal(looksLikeData({ templates: [] }), true);
  assert.equal(looksLikeData({ pips: [] }), true);

  assert.equal(looksLikeData({}), false);
  assert.equal(looksLikeData({ hello: 'world' }), false);
  assert.equal(looksLikeData([1, 2]), false);
  assert.equal(looksLikeData('x'), false);
  assert.equal(looksLikeData(null), false);
  assert.equal(looksLikeData(undefined), false);
});

// ─────────────────────────────────────────────────────────
// 造记录与取启用中的模板（打卡流程用的两个纯函数）
// ─────────────────────────────────────────────────────────

test('createPip 同时存本地日期和时刻', () => {
  // 两个都要存：date 用来按天分组且不随时区漂移，at 用来在当天内排序（TECH 4.2）
  const before = Date.now();
  const p = createPip('t_a', '2026-09-22', '开会前灌了一杯');
  assert.equal(p.template_id, 't_a');
  assert.equal(p.date, '2026-09-22');
  assert.ok(p.at >= before, 'at 取此刻');
  assert.equal(p.note, '开会前灌了一杯');
  assert.equal(p.updated_at, p.at, '新记录的 updated_at 就是它的时刻');
  assert.ok(p.id.startsWith('p_'));
});

test('createPip 不填备注也能记', () => {
  // PRD 7.2：备注可选，不填也能确定
  assert.equal(createPip('t_a', '2026-09-22').note, '');
});

test('createPip 截断超长备注', () => {
  assert.equal(createPip('t_a', '2026-09-22', 'y'.repeat(500)).note.length, NOTE_MAX);
});

test('同一个模板同一天可以记多条，各有各的 id', () => {
  // PRD 验收第 4 条：一个模板一天能打多次，日历上显示多个点
  const a = createPip('t_a', '2026-09-22');
  const b = createPip('t_a', '2026-09-22');
  assert.notEqual(a.id, b.id);
});

test('activeTemplates 只留启用中的，并按 sort_order 排', () => {
  const list = activeTemplates([
    template({ id: 't_c', sort_order: 2 }),
    template({ id: 't_a', sort_order: 0 }),
    template({ id: 't_arch', sort_order: 1, archived: true }),
  ]);
  assert.deepEqual(list.map((t) => t.id), ['t_a', 't_c'], '停用的不出现，顺序按 sort_order');
});

test('activeTemplates 不改动传进来的数组', () => {
  // 先 filter 出新数组再 sort：就地排会改到 state.data.templates 的顺序
  const source = [template({ id: 't_b', sort_order: 1 }), template({ id: 't_a', sort_order: 0 })];
  activeTemplates(source);
  assert.deepEqual(source.map((t) => t.id), ['t_b', 't_a']);
});

// ─────────────────────────────────────────────────────────
// 模板管理用的纯函数
// ─────────────────────────────────────────────────────────

test('orderedTemplates 启用中在前、已停用在后，组内按 sort_order', () => {
  const list = orderedTemplates([
    template({ id: 't_arch2', sort_order: 5, archived: true }),
    template({ id: 't_b', sort_order: 1 }),
    template({ id: 't_arch1', sort_order: 2, archived: true }),
    template({ id: 't_a', sort_order: 0 }),
  ]);
  assert.deepEqual(list.map((t) => t.id), ['t_a', 't_b', 't_arch1', 't_arch2']);
});

test('nextSortOrder 排在现有最大的后面', () => {
  assert.equal(nextSortOrder([]), 0);
  assert.equal(nextSortOrder([template({ sort_order: 0 })]), 1);
  assert.equal(nextSortOrder([template({ id: 'a', sort_order: 3 }), template({ id: 'b', sort_order: 1 })]), 4);
});

test('pickColor 挑第一个没被占用的预设色', () => {
  assert.equal(pickColor([]), PRESET_COLORS[0]);
  assert.equal(pickColor([template({ color: PRESET_COLORS[0] })]), PRESET_COLORS[1]);
  assert.equal(
    pickColor([template({ color: PRESET_COLORS[1] }), template({ color: PRESET_COLORS[0] })]),
    PRESET_COLORS[2],
    '跟占用顺序无关，只看第一个没被用的',
  );
});

test('pickColor 在 8 色全被占用时轮回去，不返回 undefined', () => {
  const all = PRESET_COLORS.map((color, i) => template({ id: `t_${i}`, color }));
  const picked = pickColor(all);
  assert.ok(PRESET_COLORS.includes(picked), '必须还是预设色板里的一个');
});

test('createTemplate 补全字段并自动分配颜色和顺序', () => {
  const created = createTemplate([template({ color: PRESET_COLORS[0], sort_order: 4 })], {
    title: '跑步',
  });
  assert.ok(created.id.startsWith('t_'));
  assert.equal(created.title, '跑步');
  assert.equal(created.icon, '', '图标可选');
  assert.equal(created.color, PRESET_COLORS[1], '跳过已被占用的颜色');
  assert.equal(created.archived, false, '新建的一律是启用中');
  assert.equal(created.sort_order, 5, '排在最后，不打乱已有模板的颜色位置');
  assert.equal(created.updated_at, created.created_at);
});

test('createTemplate 认传入的颜色，不在色板里则回落到自动分配', () => {
  assert.equal(createTemplate([], { title: 'x', color: PRESET_COLORS[3] }).color, PRESET_COLORS[3]);
  assert.equal(createTemplate([], { title: 'x', color: '#123456' }).color, PRESET_COLORS[0]);
});

test('createTemplate 截断超长标题', () => {
  assert.equal(createTemplate([], { title: 'x'.repeat(50) }).title.length, TITLE_MAX);
});

// ─────────────────────────────────────────────────────────
// 导出与导入
// ─────────────────────────────────────────────────────────

test('buildExport 包一层外壳，exportedAt 不进 data', () => {
  const data = { version: SCHEMA_VERSION, templates: [], pips: [] };
  const payload = buildExport(data, new Date(2026, 8, 22, 14, 30, 0));

  assert.equal(payload.app, 'pip');
  assert.equal(payload.version, SCHEMA_VERSION);
  assert.equal(payload.data, data, 'data 原样带出，不掺别的东西');
  assert.ok(payload.exportedAt.startsWith('2026-09-22T14:30:00'), payload.exportedAt);
});

test('parseImport 认得自己导出的文件', () => {
  const payload = buildExport({ version: SCHEMA_VERSION, templates: [template()], pips: [pip()] });
  const result = parseImport(JSON.stringify(payload));

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.pips.length, 1);
});

test('parseImport 对每种坏文件都给出对应的原因码', () => {
  // PRD 11 / TECH 9.2：失败要明确说明原因，不能静默忽略
  const cases = [
    ['{不是 JSON', 'parse'],
    [JSON.stringify({ app: '别的', version: 1, data: { templates: [], pips: [] } }), 'not-pip'],
    [JSON.stringify({ app: 'pip', version: 99, data: { templates: [], pips: [] } }), 'version'],
    [JSON.stringify({ app: 'pip', version: 1 }), 'incomplete'],
    [JSON.stringify({ app: 'pip', version: 1, data: { hello: 'world' } }), 'incomplete'],
    [JSON.stringify([1, 2, 3]), 'not-pip'],
  ];

  for (const [text, reason] of cases) {
    const result = parseImport(text);
    assert.equal(result.ok, false, `${reason} 应当失败`);
    if (!result.ok) assert.equal(result.reason, reason, `实际 ${result.reason}`);
  }
});

test('parseImport 把文件里的版本号带出来，供提示用', () => {
  const result = parseImport(
    JSON.stringify({ app: 'pip', version: 99, data: { templates: [], pips: [] } }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.detail, '99');
});

test('parseImport 过一遍 normalize，缺字段被补全而不是报错', () => {
  const result = parseImport(
    JSON.stringify({ app: 'pip', version: 1, data: { templates: [{ title: '只有标题' }], pips: [] } }),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.data.templates[0].id, '缺 id 要补一个');
});

test('parseImport 丢弃非法日期时回调留痕', () => {
  // normalize 唯一的破坏性操作，不能静默（TECH 11.4）
  const dropped = [];
  parseImport(
    JSON.stringify({ app: 'pip', version: 1, data: { templates: [], pips: [pip({ date: '2026-9-22' })] } }),
    (d) => dropped.push(d),
  );
  assert.equal(dropped.length, 1);
});

test('mergeById 按 id 取并集，同 id 取 updated_at 较新者', () => {
  const local = [pip({ id: 'p_1', note: '本地', updated_at: 100 })];
  const incoming = [
    pip({ id: 'p_1', note: '导入', updated_at: 200 }),
    pip({ id: 'p_2', updated_at: 1 }),
  ];

  const merged = mergeById(local, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((p) => p.id === 'p_1')?.note, '导入');
});

test('mergeById 时间戳相同时保留本地', () => {
  // 否则一次合并会把本地数据无意义地改一遍
  const local = [pip({ id: 'p_1', note: '本地', updated_at: 100 })];
  const incoming = [pip({ id: 'p_1', note: '导入', updated_at: 100 })];
  assert.equal(mergeById(local, incoming)[0].note, '本地');
});

test('mergeById 缺 updated_at 时按 0 算，本地优先', () => {
  const local = [pip({ id: 'p_1', note: '本地', updated_at: undefined })];
  const incoming = [pip({ id: 'p_1', note: '导入', updated_at: undefined })];
  assert.equal(mergeById(local, incoming)[0].note, '本地');
});

test('mergeData 合并两份数据，模板按 sort_order 排', () => {
  const local = {
    version: SCHEMA_VERSION,
    templates: [template({ id: 't_b', sort_order: 1 })],
    pips: [pip({ id: 'p_1' })],
  };
  const incoming = {
    version: SCHEMA_VERSION,
    templates: [template({ id: 't_a', sort_order: 0 })],
    pips: [pip({ id: 'p_2' })],
  };

  const merged = mergeData(local, incoming);
  assert.deepEqual(merged.templates.map((t) => t.id), ['t_a', 't_b']);
  assert.deepEqual(merged.pips.map((p) => p.id).sort(), ['p_1', 'p_2']);
});
