/**
 * 模板管理（PRD 7.5）。
 *
 * 两个 sheet 页面：
 * - `template-list` 列表，启用中在前、已停用在后（灰显 + 「已停用」标记）
 * - `template-edit` 新建或编辑，同一个表单
 *
 * 写入走 state 的 addTemplate / updateTemplate / removeTemplate，跳转走 state 的
 * intent——视图既不 import store.js 也不 import sheet.js（TECH 2）。
 *
 * **保存时机**是 PRD 没规定、由这里定的一件事，分两种：
 * - **新建**用底部的「确定」提交，标题空着时按钮禁用。和 PRD 7.2 的打卡流程同一个
 *   形状，也给「标题必填」一个自然的落点。
 * - **编辑**不设保存按钮：标题和图标**失焦时保存，不逐键保存**——逐键保存会变成
 *   「每敲一个字就 save + reindex」，那是 TECH 12 明确说错的路径。颜色和停用是
 *   离散动作，点了立刻写。
 */

import { COLOR_CLASS, COLOR_NAME, PRESET_COLORS, TITLE_MAX, orderedTemplates, pickColor } from '../model.js';
import { addTemplate, index, intent, removeTemplate, state, updateTemplate } from '../state.js';

/**
 * 图标输入框的长度上限。
 *
 * 数据层对 `icon` 没有长度限制（TECH 4.4 的 normalize 不管它），而一个超长字符串会把
 * 方块和列表行的布局撑破，所以在入口这里挡住。16 个 UTF-16 单元放得下组合型 emoji
 * （带 ZWJ 的、带变体选择符的），又放不下一段文字。
 */
const ICON_MAX = 16;

/**
 * 编辑表单的保存动作，由表单渲染时登记。
 *
 * 失焦正常发生时它已经被调过一次了（值没变时不会真的写），所以它兜的是「打完字直接
 * 切后台 / 杀进程」——那种情况不会有失焦（TECH 3.4）。
 *
 * @type {(() => Promise<unknown>) | null}
 */
let savePending = null;

/**
 * 把还没落盘的编辑补写一次。app.js 在页面被藏起来时调（TECH 3.4）。
 *
 * @returns {Promise<void>}
 */
export async function flushPendingEdit() {
  await savePending?.();
}

/**
 * 模板的图标：设了 emoji 就用 emoji，没设就用一个该模板颜色的圆点（PRD 7.5）。
 *
 * 和 pip-form.js 里那份形状相同，但 `views/*` 之间不互相 import（TECH 2），
 * 所以各留一份。
 *
 * @param {import('../model.js').Template} template
 * @param {string} iconCls 有 emoji 时用的类名
 * @param {string} dotCls 没 emoji 时用的类名，尺寸由它决定
 * @returns {HTMLSpanElement}
 */
function buildIcon(template, iconCls, dotCls) {
  const el = document.createElement('span');
  if (template.icon) {
    el.className = iconCls;
    el.textContent = template.icon;
  } else {
    el.className = `${dotCls} pip ${COLOR_CLASS[template.color] ?? 'pip-unknown'}`;
  }
  return el;
}

/**
 * 一个带标签的输入框。用 `<label>` 包住 `<input>` 做隐式关联，不需要生成 id。
 *
 * 字号 16px 是硬性下限：更小的话 iOS Safari 聚焦时会自动放大页面（PRD 9.3）。
 *
 * @param {string} label
 * @param {string} value
 * @param {string} placeholder
 * @param {number} maxLength
 * @returns {{ el: HTMLLabelElement, input: HTMLInputElement }}
 */
function buildField(label, value, placeholder, maxLength) {
  const el = document.createElement('label');
  el.className = 'tpl-field';

  const caption = document.createElement('span');
  caption.className = 'tpl-field-label';
  caption.textContent = label;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tpl-input';
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = maxLength;

  el.append(caption, input);
  return { el, input };
}

/**
 * 8 色预设色板，单选（PRD 7.5 / 9.2）。
 *
 * 可点区域做满 44×44，里面画 28px 的圆：PRD 9.4 要求所有可点区域 ≥ 44×44px，而
 * 8 个 44px 的按钮正好铺满 390px 屏的 358px 可用宽度（`space-between` 把它们摊开，
 * 圆与圆之间留出约 19px 的空隙）。
 *
 * @param {string} initial 初始选中色
 * @param {(color: string) => void} onPick
 * @returns {{ el: HTMLDivElement, mark: (selected: string) => void }}
 */
function buildSwatches(initial, onPick) {
  const el = document.createElement('div');
  el.className = 'tpl-swatches';

  /** @type {Map<string, { btn: HTMLButtonElement, dot: HTMLSpanElement }>} */
  const items = new Map();

  for (const color of PRESET_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tpl-swatch';
    // 色块得有个不依赖颜色的可读名（PRD 12：颜色不单独承载信息）
    btn.setAttribute('aria-label', COLOR_NAME[color] ?? color);
    btn.addEventListener('click', () => onPick(color));

    const dot = document.createElement('span');
    dot.className = `tpl-swatch-dot pip ${COLOR_CLASS[color] ?? 'pip-unknown'}`;

    btn.append(dot);
    items.set(color, { btn, dot });
    el.append(btn);
  }

  /** @param {string} selected */
  function mark(selected) {
    for (const [color, { btn, dot }] of items) {
      const on = color === selected;
      btn.setAttribute('aria-pressed', String(on));
      dot.classList.toggle('is-picked', on);
    }
  }

  mark(initial);
  return { el, mark };
}

/**
 * 表单底部的一个动作行：动作名 + 一行说明。
 *
 * 停用和删除的区别必须写在界面上（PRD 7.5）——这是这个产品里最容易误操作的地方。
 *
 * @param {string} label
 * @param {string} hint
 * @param {boolean} danger
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function buildAction(label, hint, danger, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = danger ? 'tpl-action is-danger' : 'tpl-action';
  btn.addEventListener('click', onClick);

  const name = document.createElement('span');
  name.className = 'tpl-action-label';
  name.textContent = label;

  const note = document.createElement('span');
  note.className = 'tpl-action-hint';
  note.textContent = hint;

  btn.append(name, note);
  return btn;
}

/**
 * 删除确认（PRD 7.5 唯一的二次确认）。
 *
 * 文案里必须写清会连带删掉几条记录——「可逆的操作不确认，不可逆的才确认」，
 * 而这是全项目唯一不可逆的操作。
 *
 * @param {import('../model.js').Template} template
 * @param {number} count 会一起删掉的记录条数
 * @param {() => void} onCancel
 * @param {() => void} onDelete
 * @returns {HTMLDivElement}
 */
function buildConfirm(template, count, onCancel, onDelete) {
  const box = document.createElement('div');
  box.className = 'tpl-confirm';

  const title = document.createElement('p');
  title.className = 'tpl-confirm-title';
  title.textContent = `删除「${template.title}」？`;

  const body = document.createElement('p');
  body.className = 'tpl-confirm-body';
  // 一条记录都没有时不说「这项的 0 条」，那句话没有信息量
  body.textContent = count > 0 ? `这项的 ${count} 条打卡记录也会一起删除，无法恢复。` : '无法恢复。';

  const row = document.createElement('div');
  row.className = 'tpl-confirm-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary';
  cancel.textContent = '取消';
  cancel.addEventListener('click', onCancel);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-danger';
  remove.textContent = '删除';
  remove.addEventListener('click', onDelete);

  row.append(cancel, remove);
  box.append(title, body, row);
  return box;
}

/**
 * 列表里的一行：emoji + 标题（+ 「已停用」）+ 颜色圆点 + `›`（PRD 7.5）。
 *
 * @param {import('../model.js').Template} template
 * @returns {HTMLLIElement}
 */
function buildRow(template) {
  const li = document.createElement('li');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tpl-row';
  if (template.archived) btn.classList.add('is-archived');
  btn.addEventListener('click', () => intent('edit-template', { templateId: template.id }));

  const main = document.createElement('span');
  main.className = 'tpl-row-main';
  main.append(buildIcon(template, 'tpl-row-icon', 'tpl-row-dot'));

  const title = document.createElement('span');
  title.className = 'tpl-row-title';
  title.textContent = template.title;
  main.append(title);

  if (template.archived) {
    const tag = document.createElement('span');
    tag.className = 'tpl-tag';
    tag.textContent = '已停用';
    main.append(tag);
  }

  // 色点是这个模板在日历上的颜色，emoji 表达不了，所以两个都要（PRD 7.5）
  const color = document.createElement('span');
  color.className = `tpl-row-color pip ${COLOR_CLASS[template.color] ?? 'pip-unknown'}`;

  const chevron = document.createElement('span');
  chevron.className = 'tpl-chevron';
  chevron.textContent = '›';
  chevron.setAttribute('aria-hidden', 'true');

  btn.append(main, color, chevron);
  li.append(btn);
  return li;
}

/**
 * 模板列表。
 *
 * @returns {import('./sheet.js').SheetPage}
 */
export function renderTemplateList() {
  // 列表成为栈顶就意味着编辑表单已经离开了，那个保存动作不必再留着
  savePending = null;

  const wrap = document.createElement('div');

  const list = document.createElement('ul');
  list.className = 'tpl-list';

  for (const template of orderedTemplates(state.data.templates)) {
    list.append(buildRow(template));
  }

  // 新建是低频动作，做成列表末尾的一行，不用悬浮按钮（PRD 7.5）
  const item = document.createElement('li');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tpl-row tpl-row--new';
  add.textContent = '＋ 新建模板';
  add.addEventListener('click', () => intent('new-template'));
  item.append(add);
  list.append(item);

  wrap.append(list);
  return { title: '模板', body: wrap };
}

/**
 * 新建或编辑。`params.templateId` 为空就是新建。
 *
 * @param {Record<string, unknown>} params
 * @returns {import('./sheet.js').SheetPage}
 */
export function renderTemplateEdit(params) {
  const templateId = typeof params.templateId === 'string' ? params.templateId : null;
  // 列表是按当时的数据画的，正常不会指到一个不存在的模板；真指到了就当成新建，
  // 免得对着一个空表单改一个不存在的东西
  const existing = templateId
    ? (state.data.templates.find((t) => t.id === templateId) ?? null)
    : null;

  let pickedColor = existing?.color ?? pickColor(state.data.templates);

  const wrap = document.createElement('div');
  wrap.className = 'tpl-form';

  const title = buildField('标题', existing?.title ?? '', '比如：跑步', TITLE_MAX);
  const icon = buildField('图标', existing?.icon ?? '', '', ICON_MAX);

  const swatches = buildSwatches(pickedColor, (color) => {
    pickedColor = color;
    swatches.mark(color);
    // 颜色是离散动作，点了立刻写
    if (existing) void save();
  });

  const colorField = document.createElement('div');
  colorField.className = 'tpl-field';
  const colorLabel = document.createElement('span');
  colorLabel.className = 'tpl-field-label';
  colorLabel.textContent = '颜色';
  colorField.append(colorLabel, swatches.el);

  wrap.append(title.el, icon.el, colorField);

  /**
   * 把表单当前的值写回去。标题必填，空值不落盘。
   * @returns {Promise<void>}
   */
  async function save() {
    if (!existing) return;

    const next = title.input.value.trim();
    if (!next) {
      // 标题清空了：不写，并把输入框回填成已保存的值，免得界面和存储说的不一样
      title.input.value = existing.title;
      return;
    }
    await updateTemplate(existing.id, {
      title: next,
      icon: icon.input.value.trim(),
      color: pickedColor,
    });
  }

  if (!existing) {
    // ── 新建：底部一个「确定」 ──────────────────────────────
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn-primary';
    confirm.textContent = '确定';
    confirm.disabled = title.input.value.trim() === '';
    title.input.addEventListener('input', () => {
      confirm.disabled = title.input.value.trim() === '';
    });
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      const created = await addTemplate({
        title: title.input.value.trim(),
        icon: icon.input.value.trim(),
        color: pickedColor,
      });
      if (!created) {
        confirm.disabled = false;
        return;
      }
      intent('back');
    });
    wrap.append(confirm);

    return { title: '新建模板', body: wrap };
  }

  // ── 编辑：失焦保存 + 停用/删除 ────────────────────────────
  savePending = save;

  // 收窄后的引用。`paintActions` 是提升的函数声明，可能被提到上面的检查之前调用，
  // 所以 TS 不认外层对 `existing` 的收窄。
  const editing = existing;

  // focusout 会冒泡，所以挂在表单容器上一次就够。失焦即保存，不逐键保存。
  wrap.addEventListener('focusout', () => void save());
  // Escape 关弹窗不会让输入框失焦，而 sheet.js 的处理器挂在 document 上、比这里晚，
  // 所以在这里先把值补写一次
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void save();
  });

  const actions = document.createElement('div');
  actions.className = 'tpl-actions';

  /** 停用状态翻转后要重画这两行，标签和说明都跟着变。 */
  function paintActions() {
    const archived = editing.archived;
    const count = index.pipsByTemplate.get(editing.id)?.length ?? 0;

    const toggle = buildAction(
      archived ? '恢复使用' : '停用',
      archived ? '重新出现在打卡列表里' : '不再出现在打卡列表里，记录全部保留',
      false,
      async () => {
        await updateTemplate(editing.id, { archived: !archived });
        paintActions();
      },
    );

    const remove = buildAction(
      '删除这个模板',
      // 一条记录都没有时不说「连这项的 0 条」，那句话没有信息量
      count > 0 ? `连这项的 ${count} 条记录一起删掉，无法恢复` : '无法恢复',
      true,
      () => {
        actions.replaceChildren(
          buildConfirm(editing, count, paintActions, async () => {
            await removeTemplate(editing.id);
            savePending = null;
            intent('back');
          }),
        );
      },
    );

    actions.replaceChildren(toggle, remove);
  }

  paintActions();
  wrap.append(actions);

  return { title: '编辑模板', body: wrap };
}
