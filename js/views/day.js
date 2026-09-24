/**
 * 某日记录列表与打卡详情（PRD 7.3 / 7.4）。
 *
 * 两个 sheet 页面：
 * - `day-list`   某天的全部记录，按时间正序（早 → 晚，像日记），底部「＋ Pip一下」
 * - `pip-detail` 单条记录的详情：改备注、删记录
 *
 * 写入走 state 的 updatePipNote / removePip，跳转走 state 的 intent——视图既不
 * import store.js 也不 import sheet.js（TECH 2）。
 *
 * 详情页的备注按 PRD 7.4 是**失焦自动保存，不逐键保存**（TECH 3.4 / 12）。失焦不是
 * 唯一的离开方式——Android 返回键、下滑关弹窗都不会让输入框失焦——所以保存动作登记
 * 到 state，由 sheet.js 在页面要离开时补写一次。
 */

import { formatDayLabel, formatTime } from '../dates.js';
import { COLOR_CLASS, NOTE_MAX } from '../model.js';
import { index, intent, removePip, setPendingFlush, state, updatePipNote } from '../state.js';

/**
 * 模板的图标：设了 emoji 就用 emoji，没设就用一个该模板颜色的圆点（PRD 7.3）。
 *
 * 和 pip-form.js、templates.js 里那两份形状相同，但 `views/*` 之间不互相 import
 * （TECH 2），所以各留一份。
 *
 * @param {import('../model.js').Template | undefined} template
 * @param {string} iconCls 有 emoji 时用的类名
 * @param {string} dotCls 没 emoji 时用的类名，尺寸由它决定
 * @returns {HTMLSpanElement}
 */
function buildIcon(template, iconCls, dotCls) {
  const el = document.createElement('span');
  if (template?.icon) {
    el.className = iconCls;
    el.textContent = template.icon;
  } else {
    // 模板缺失的记录用灰色兜底、标题显示「未知模板」，不静默丢弃（TECH 4.4）
    el.className = `${dotCls} pip ${COLOR_CLASS[template?.color ?? ''] ?? 'pip-unknown'}`;
  }
  return el;
}

/**
 * 模板的标题。孤儿记录（只可能来自手工编辑或损坏的导入文件）给一个兜底名字。
 *
 * @param {import('../model.js').Template | undefined} template
 * @returns {string}
 */
function titleOf(template) {
  return template?.title ?? '未知模板';
}

/**
 * 列表里的一行：时间 + 模板 emoji（没设就显示色点）+ 标题，有备注时下面一行灰字。
 *
 * 整行是按钮，点进详情（PRD 7.3）。
 *
 * @param {import('../model.js').Pip} pip
 * @returns {HTMLLIElement}
 */
function buildRow(pip) {
  const template = index.byTemplate.get(pip.template_id);

  const li = document.createElement('li');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'day-row';
  btn.addEventListener('click', () => intent('edit-pip', { pipId: pip.id, dateKey: pip.date }));

  const time = document.createElement('span');
  time.className = 'day-time';
  time.textContent = formatTime(pip.at);

  const title = document.createElement('span');
  title.className = 'day-title';
  title.textContent = titleOf(template);

  btn.append(time, buildIcon(template, 'day-icon', 'day-icon'), title);

  if (pip.note) {
    // 用 span 不用 p：button 里只能放短语内容，p 是流内容。截断靠 CSS 一行省略。
    const note = document.createElement('span');
    note.className = 'day-note';
    note.textContent = pip.note;
    btn.append(note);
  }

  li.append(btn);
  return li;
}

/**
 * 底部的「＋ Pip一下」。目标日期是这一天，补记就走它（PRD 7.2 / 7.3）。
 *
 * @param {import('../dates.js').DateKey} dateKey
 * @returns {HTMLButtonElement}
 */
function buildAddButton(dateKey) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = '＋ Pip一下';
  btn.addEventListener('click', () => intent('new-pip', { dateKey }));
  return btn;
}

/**
 * 某日记录列表。
 *
 * @param {Record<string, unknown>} params
 * @returns {import('./sheet.js').SheetPage}
 */
export function renderDayList(params) {
  const dateKey = /** @type {import('../dates.js').DateKey} */ (String(params.dateKey ?? ''));
  const pips = index.byDate.get(dateKey) ?? [];

  const wrap = document.createElement('div');
  wrap.className = 'day';

  if (pips.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'day-empty';
    empty.textContent = '这天还什么都没记';
    wrap.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'day-list';
    for (const pip of pips) list.append(buildRow(pip));
    wrap.append(list);
  }

  // 底栏：固定在卡片底边，不跟着列表滚走——记录一多，它就滑到看不见的地方了（PRD 9.5）。
  // 空状态也走同一个底栏：别让用户对着一句「这天还什么都没记」发呆（PRD 11）。
  return { title: formatDayLabel(dateKey), body: wrap, footer: buildAddButton(dateKey) };
}

/**
 * 打卡详情。改备注、删记录（PRD 7.4）。
 *
 * @param {Record<string, unknown>} params
 * @returns {import('./sheet.js').SheetPage}
 */
export function renderPipDetail(params) {
  const pipId = String(params.pipId ?? '');
  const dateKey = String(params.dateKey ?? '');
  const pip = state.data.pips.find((p) => p.id === pipId);

  // 记录已经没了（理论上到不了：删记录之后会退回列表，不会重新渲染这一页）。真到了
  // 就退回那一天的列表，而不是对着一个空壳。
  if (!pip) {
    return renderDayList({ dateKey: dateKey || state.todayKey });
  }

  const template = index.byTemplate.get(pip.template_id);

  const wrap = document.createElement('div');
  wrap.className = 'pip-detail';

  // 模板：emoji + 标题 + 颜色，停用的在标题后加灰色小字（PRD 7.4）
  const head = document.createElement('div');
  head.className = 'pip-detail-template';
  head.append(buildIcon(template, 'day-icon', 'day-icon'));

  const title = document.createElement('span');
  title.className = 'pip-detail-title';
  title.textContent = titleOf(template);
  head.append(title);

  if (template?.archived) {
    const tag = document.createElement('span');
    tag.className = 'tpl-tag';
    tag.textContent = '已停用';
    head.append(tag);
  }

  const color = document.createElement('span');
  color.className = `pip-detail-color pip ${COLOR_CLASS[template?.color ?? ''] ?? 'pip-unknown'}`;
  head.append(color);

  const when = document.createElement('p');
  when.className = 'pip-detail-when';
  when.textContent = `${formatDayLabel(pip.date)} ${formatTime(pip.at)}`;

  const noteField = document.createElement('label');
  noteField.className = 'field';
  const noteLabel = document.createElement('span');
  noteLabel.className = 'field-label';
  noteLabel.textContent = '备注';
  const note = document.createElement('textarea');
  note.className = 'pip-note';
  note.rows = 3;
  note.maxLength = NOTE_MAX;
  note.value = pip.note;
  noteField.append(noteLabel, note);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'pip-detail-remove';
  remove.textContent = '删除';
  remove.addEventListener('click', async () => {
    await removePip(pip.id);
    // 这条记录已经没了，那个补写动作再跑一次只是白跑
    setPendingFlush(null);
    intent('back');
  });

  wrap.append(head, when, noteField, remove);

  /** @returns {Promise<void>} */
  const saveNote = async () => {
    await updatePipNote(pip.id, note.value);
  };

  setPendingFlush(saveNote);
  // 失焦即保存（PRD 7.4）。focusout 会冒泡，挂在容器上一次就够。
  wrap.addEventListener('focusout', () => void saveNote());

  return { title: '记录详情', body: wrap };
}
