/**
 * 某日记录列表。
 *
 * 第 4 步只做到「把当天的记录列出来」——够用来验证弹窗骨架。第 7 步会补上
 * 点进单条看详情、改备注、删记录，以及底部的「添加打卡」。
 */

import { formatDayLabel, formatTime } from '../dates.js';
import { COLOR_CLASS } from '../model.js';
import { index } from '../state.js';

/**
 * @param {import('../model.js').Pip} pip
 * @returns {HTMLLIElement}
 */
function buildRow(pip) {
  const template = index.byTemplate.get(pip.template_id);

  const li = document.createElement('li');
  li.className = 'day-row';

  const time = document.createElement('span');
  time.className = 'day-time';
  time.textContent = formatTime(pip.at);

  const icon = document.createElement('span');
  if (template?.icon) {
    icon.className = 'day-icon';
    icon.textContent = template.icon;
  } else {
    // 没设 emoji 就显示一个该模板颜色的圆点。模板缺失时用灰色兜底——
    // 孤儿记录不静默丢弃（TECH 4.4）
    icon.className = `day-icon pip ${COLOR_CLASS[template?.color ?? ''] ?? 'pip-unknown'}`;
  }

  const title = document.createElement('span');
  title.className = 'day-title';
  title.textContent = template?.title ?? '未知模板';

  li.append(time, icon, title);

  if (pip.note) {
    const note = document.createElement('p');
    note.className = 'day-note';
    note.textContent = pip.note;
    li.append(note);
  }

  return li;
}

/**
 * @param {Record<string, unknown>} params
 * @returns {import('./sheet.js').SheetPage}
 */
export function renderDayList(params) {
  const dateKey = String(params.dateKey ?? '');
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

  return { title: formatDayLabel(dateKey), body: wrap };
}
