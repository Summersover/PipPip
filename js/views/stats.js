/**
 * 统计（PRD 7.7）。
 *
 * **只数次数。** 不做目标、比率、环比、连续天数——PRD 2 的判断标准是「它会不会让用户
 * 产生『我欠着什么』的感觉」，那些都会，所以这一页只有一句话一件事：「这段时间你做了
 * 什么、各几次」。
 *
 * 区间用一行预设（本月／上月／今年／全部）打头，点当前区间那行展开两个原生日期字段
 * 自定义。默认落在「本月」，那是打开这一页最常想看的。
 *
 * 视图只读 `state.data` / `index`，不碰存储也不碰 sheet（TECH 2）。
 */

import { inRange, isDateKey, monthRange, partsOf, toDateKey } from '../dates.js';
import { orderedTemplates } from '../model.js';
import { state } from '../state.js';

/**
 * 预设区间。顺序按「越近越靠前」，本月排第一个——它是默认值。
 *
 * @type {{ id: 'month' | 'last-month' | 'year' | 'all', label: string }[]}
 */
const PRESETS = [
  { id: 'month', label: '本月' },
  { id: 'last-month', label: '上月' },
  { id: 'year', label: '今年' },
  { id: 'all', label: '全部' },
];

/**
 * 预设区间的起止日期。
 *
 * 一律用本地年月日分量算（`monthRange` 内部也是），**不碰 `toISOString`**——它按 UTC
 * 输出，东八区凌晨会把日期算成前一天（AGENTS.md / TECH 3.1）。
 *
 * @param {string} id
 * @param {import('../dates.js').DateKey} today
 * @returns {{ start: import('../dates.js').DateKey, end: import('../dates.js').DateKey }}
 */
function presetRange(id, today) {
  const { y, m } = partsOf(today);

  if (id === 'month') return monthRange(y, m);

  if (id === 'last-month') {
    // 一月往前一个月是上一年十二月，交给 Date 归一化，别自己写跨年判断
    const prev = new Date(y, m - 2, 1);
    return monthRange(prev.getFullYear(), prev.getMonth() + 1);
  }

  if (id === 'year') {
    return {
      start: toDateKey(new Date(y, 0, 1)),
      // 12 月的第 0 天 = 12 月 31 日
      end: toDateKey(new Date(y, 11, 31)),
    };
  }

  // 全部：从最早那条记录算起。一条都没有时就是今天这一天，结果自然是空的
  let start = today;
  for (const pip of state.data.pips) {
    if (pip.date < start) start = pip.date;
  }
  return { start, end: today };
}

/**
 * 区间内每个模板的次数。
 *
 * 直接扫 `state.data.pips`，不按日期建索引——统计是低频动作，而且「全部」这种区间本来
 * 就要看所有记录，为它建索引不划算（TECH 6.5：派生数据读时算，不写进存储）。
 *
 * @param {import('../dates.js').DateKey} start
 * @param {import('../dates.js').DateKey} end
 * @returns {Map<string, number>}
 */
function countByTemplate(start, end) {
  const counts = new Map();
  for (const pip of state.data.pips) {
    // 字符串字典序比较就是日期比较，DateKey 零填充就是为了这个（dates.js 的 inRange）
    if (!inRange(pip.date, start, end)) continue;
    counts.set(pip.template_id, (counts.get(pip.template_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * 一个带标签的日期输入。和模板表单里的 `buildField` 形状相同，但那个是文本框、这个
 * 是 `<input type="date">`；`views/*` 之间不互相 import（TECH 2），所以各留一份。
 *
 * @param {string} label
 * @param {import('../dates.js').DateKey} value
 * @returns {{ el: HTMLLabelElement, input: HTMLInputElement }}
 */
function buildDateField(label, value) {
  const el = document.createElement('label');
  el.className = 'field';

  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = label;

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'field-input';
  input.value = value;

  el.append(caption, input);
  return { el, input };
}

/**
 * 这段时间里一次都没有记过的状态。
 *
 * 措辞必须是中性的：没有「没完成」「还差」这类说法（PRD 2 / 11）。
 *
 * @returns {HTMLDivElement}
 */
function buildEmpty() {
  const box = document.createElement('div');
  box.className = 'pip-empty';

  const title = document.createElement('p');
  title.className = 'pip-empty-title';
  title.textContent = '这段时间没有记录';

  const hint = document.createElement('p');
  hint.className = 'pip-empty-hint';
  hint.textContent = '换个区间看看';

  box.append(title, hint);
  return box;
}

/**
 * 结果区：一句话一件事，每件事一行。
 *
 * 顺序用**模板自己的顺序**（sort_order），不按次数排——按次数排就成了排行榜，而这一页
 * 不该有「谁比谁多」的意思（PRD 7.7）。0 次的模板不出现：写成「你总共冥想了 0 次」
 * 就正好是 PRD 2 里那句不该出现的话。
 *
 * @param {{ start: import('../dates.js').DateKey, end: import('../dates.js').DateKey }} range
 * @returns {HTMLElement}
 */
function buildResults(range) {
  const counts = countByTemplate(range.start, range.end);
  const templates = orderedTemplates(state.data.templates).filter(
    (template) => (counts.get(template.id) ?? 0) > 0,
  );

  if (templates.length === 0) return buildEmpty();

  const wrap = document.createElement('div');

  const period = document.createElement('p');
  period.className = 'stat-period';
  period.textContent = '这段时间内';
  wrap.append(period);

  for (const template of templates) {
    const line = document.createElement('p');
    line.className = 'stat-line';
    line.append(`你总共${template.title}了 `);

    const times = document.createElement('span');
    times.className = 'stat-n';
    times.textContent = `${counts.get(template.id)} 次`;
    line.append(times);

    wrap.append(line);
  }

  return wrap;
}

/**
 * 统计页的入口。
 *
 * @returns {import('./sheet.js').SheetPage}
 */
export function renderStats() {
  // 每次渲染重新取「今天」，不缓存在模块顶层（TECH 5.4）
  const today = toDateKey();

  /** @type {string | null} 选中的预设；自定义时是 null，让预设那一行都不亮 */
  let presetId = PRESETS[0].id;
  /** @type {{ start: import('../dates.js').DateKey, end: import('../dates.js').DateKey }} */
  let range = presetRange(presetId, today);
  let showCustom = false;

  const wrap = document.createElement('div');

  const seg = document.createElement('div');
  seg.className = 'seg';
  /** @type {Map<string, HTMLButtonElement>} */
  const items = new Map();

  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-item';
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      presetId = preset.id;
      range = presetRange(preset.id, today);
      showCustom = false;
      paint();
    });
    items.set(preset.id, btn);
    seg.append(btn);
  }

  const rangeLine = document.createElement('button');
  rangeLine.type = 'button';
  rangeLine.className = 'range-line';

  const rangeText = document.createElement('span');

  const chevron = document.createElement('span');
  chevron.className = 'tpl-chevron';
  chevron.textContent = '›';
  chevron.setAttribute('aria-hidden', 'true');

  rangeLine.append(rangeText, chevron);

  const startField = buildDateField('开始', range.start);
  const endField = buildDateField('结束', range.end);

  const fields = document.createElement('div');
  fields.className = 'range-fields';
  fields.hidden = true;
  fields.append(startField.el, endField.el);

  /**
   * 读两个日期字段，把区间换成自定义的。
   *
   * 起止填反了就自己换过来——不然会得到一段空区间，而用户看着两个日期是对的，
   * 只会以为「统计坏了」。
   */
  function applyCustom() {
    const start = startField.input.value;
    const end = endField.input.value;
    if (!isDateKey(start) || !isDateKey(end)) return;
    presetId = null;
    range = start <= end ? { start, end } : { start: end, end: start };
    paint();
  }

  startField.input.addEventListener('change', applyCustom);
  endField.input.addEventListener('change', applyCustom);

  rangeLine.addEventListener('click', () => {
    if (showCustom) {
      showCustom = false;
    } else {
      // 展开就把当前区间填进去当起点，并让预设那一行都不亮：此刻看的是自定义区间
      showCustom = true;
      presetId = null;
      startField.input.value = range.start;
      endField.input.value = range.end;
    }
    paint();
  });

  const results = document.createElement('div');

  function paint() {
    for (const [id, btn] of items) btn.setAttribute('aria-pressed', String(id === presetId));
    rangeText.textContent = `${range.start} – ${range.end}`;
    fields.hidden = !showCustom;
    results.replaceChildren(buildResults(range));
  }

  wrap.append(seg, rangeLine, fields, results);
  paint();

  // 这一页没有主操作，底栏留空（sheet.js 会把它藏起来）
  return { title: '统计', body: wrap };
}
