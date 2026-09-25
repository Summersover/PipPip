/**
 * 打卡流程（PRD 7.2）。
 *
 * 两步：先选模板，再写备注并确定。**两步在同一个 sheet 页面里**——TECH 7.1 的页面
 * 列表里只有 `pip-create` 一个，所以第二步不是 push 新页面，而是自己换内容。
 * 换的时候复用 app.css 里 sheet 页面那套 180ms 入场动画（PRD 9.6 的「两步之间切换」）。
 *
 * 目标日期由调用方给：从底部「打卡」进来是今天，从某日列表「Pip一下」进来是那一天，
 * 补记就走这条。
 *
 * 这是产品的主操作，必须在 3 次触摸内完成（PRD 7.2）：打卡 → 选模板 → 确定。
 *
 * 视图不碰存储、不碰 sheet：写入走 `state.addPip`，跳转走 `state.intent`。
 */

import { formatDayLabel, partsOf, toDateKey } from '../dates.js';
import { COLOR_CLASS, NOTE_MAX, orderedTemplates } from '../model.js';
import { addPip, intent, reorderTemplates, state } from '../state.js';

/**
 * 目标日期的显示文案。
 *
 * 今天是「今天 9月24日」，补记时显示实际日期（PRD 7.2 第二步 / PRD 10）。
 *
 * @param {import('../dates.js').DateKey} dateKey
 * @returns {string}
 */
function targetLabel(dateKey) {
  if (dateKey === toDateKey()) {
    const { m, d } = partsOf(dateKey);
    return `今天 ${m}月${d}日`;
  }
  return formatDayLabel(dateKey);
}

/**
 * 模板的图标：设了 emoji 就用 emoji，没设就用一个该模板颜色的圆点（PRD 7.2）。
 *
 * 色值要经 `COLOR_CLASS` 变成类名——CSP 的 `style-src 'self'` 会拦掉行内样式，
 * 所以颜色只能靠类（见 TECH 14）。
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
 * 一行：〔柄〕emoji/色点 + 标题 + 该模板颜色的圆点 + `›`。
 *
 * **一行三个动作**：行首的三横线柄拖动换位（启用中的模板才有），行主体进打卡备注页，
 * 行尾的 `›` 进这个模板的编辑页。按钮不能嵌套，所以整行是「div 里放三个 button」。
 *
 * 已停用的模板排在最后、整行退到次级色、**没有柄**：它不能打卡，只剩「恢复使用 /
 * 删除」两件事，顺序也永远垫底。工具栏那格改成「统计」之后，**这一页是模板唯一的
 * 入口**，所以停用的模板也必须还看得见、进得去，否则就再也恢复不了了。
 *
 * @param {import('../model.js').Template} template
 * @param {() => void} onPick 进打卡备注页（已停用时不会走到这儿）
 * @returns {HTMLLIElement}
 */
function buildRow(template, onPick) {
  const li = document.createElement('li');
  // 拖动结束时按 DOM 顺序收 id 重排，行的身份和归组带在身上
  li.dataset.id = template.id;
  li.dataset.archived = String(template.archived);

  const row = document.createElement('div');
  row.className = 'tpl-row';
  if (template.archived) row.classList.add('is-archived');

  if (!template.archived) {
    row.append(buildDragHandle(template, li));
  }

  const edit = () => intent('edit-template', { templateId: template.id });

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'tpl-row-main';
  // 读屏听到的是「喝水，记一笔」而不是光一个模板名（PRD 12）
  main.setAttribute('aria-label', template.archived ? `${template.title}，已停用` : `${template.title}，记一笔`);
  main.addEventListener('click', template.archived ? edit : onPick);
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

  const color = document.createElement('span');
  color.className = `tpl-row-color pip ${COLOR_CLASS[template.color] ?? 'pip-unknown'}`;

  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'tpl-chevron';
  chevron.textContent = '›';
  chevron.setAttribute('aria-label', `编辑 ${template.title}`);
  chevron.addEventListener('click', edit);

  row.append(main, color, chevron);
  li.append(row);
  return li;
}

/**
 * 行首的三横线拖动柄。
 *
 * **只有启用中的模板有柄。** 已停用的永远垫底，拖它没有意义；启用中的行拖到停用那组
 * 的边界时停住（`showStep` 按启用/停用两组渲染，插不进去）。
 *
 * 触发走 Pointer Events，**不用 HTML5 drag & drop**（`draggable` 在 iOS Safari 的
 * 触屏上不生效）。拖拽期间禁止触摸滚动之类的默认行为要靠 CSS（`touch-action: none`），
 * `addEventListener('touchmove', …, { passive: false })` 不是必须的。
 *
 * @param {import('../model.js').Template} template
 * @param {HTMLLIElement} li 所在的列表行，拖拽时被收起、结束后恢复
 * @returns {HTMLButtonElement}
 */
function buildDragHandle(template, li) {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'tpl-drag';
  handle.setAttribute('aria-label', `调整 ${template.title} 的顺序`);
  handle.dataset.dragHandle = '';

  handle.addEventListener('pointerdown', (event) => {
    // 左键当手指用；右键、触控笔的橡皮那些不碰
    if (!event.isPrimary || event.button !== 0) return;
    beginDrag(handle, li, event);
  });

  return handle;
}

/**
 * 拖拽期间的活动状态。模块级而不是闭包级：一次只有一个拖拽在进行，
 * 而 move / up / cancel 挂在 window 上，监听器必须能独立于任何手柄引用收尾。
 *
 * `order` 是拖起那一刻的完整行序（含停用行，它们永远垫底）。**拖动中不动 DOM**：
 * 拖动行用 transform 跟手，让位行用 transform 滑开，DOM 顺序只在松手时提交一次。
 *
 * @type {{
 *   li: HTMLLIElement,
 *   handle: HTMLButtonElement,
 *   pointerId: number,
 *   startY: number,
 *   height: number,
 *   order: HTMLLIElement[],
 *   from: number,
 *   to: number,
 *   activeCount: number,
 * } | null}
 */
let drag = null;

/**
 * 开始一次拖拽：记下起点、行高和当时的行序，把手柄和行标记成拖拽态。
 *
 * 行自己的样式交 CSS（`.is-dragging` 浮起，`.is-reordering` 给让位行开过渡）。
 * `setPointerCapture` 保证触屏上这个手势不被列表滚动截走；但 move / up / cancel
 * **挂在 window 上**，不挂手柄——松手的落位会把手柄连同行一起 `insertBefore`
 * 摘下来再插回去，手柄一离文档，浏览器就释放捕获，挂它身上的监听器从此收不到
 * 事件，落盘就悬了。挂 window 没有问题：事件无论落在哪个元素上都会冒泡上来。
 *
 * @param {HTMLButtonElement} handle
 * @param {HTMLLIElement} li
 * @param {PointerEvent} event
 */
function beginDrag(handle, li, event) {
  if (drag) return; // 上一场还没收尾（理论上不会：window 监听必收尾），别叠
  event.preventDefault();
  const list = li.parentElement;
  if (!list) return;

  /** @type {HTMLLIElement[]} */
  const order = [...list.querySelectorAll('li')];

  drag = {
    li,
    handle,
    pointerId: event.pointerId,
    startY: event.clientY,
    height: li.getBoundingClientRect().height,
    order,
    from: order.indexOf(li),
    to: order.indexOf(li),
    activeCount: order.filter((row) => row.dataset.archived !== 'true').length,
  };

  li.classList.add('is-dragging');
  list.classList.add('is-reordering');
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // 个别内核在手柄恰好被重建时会拒；抓不到也有 window 监听兜底
  }
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

/**
 * 拖动中：拖动行 transform 跟手，越过半行就把目标槽换掉、让位行滑开。
 *
 * 目标槽 = 起点槽 + 位移除以行高取整（半行为界），钳在启用组里——停用行永远
 * 垫底。只有目标槽真的变了才碰让位行，平时的移动只是给拖动行改一个 transform。
 *
 * @param {PointerEvent} event
 */
function onDragMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const { li, startY, height, from, activeCount } = drag;
  const dy = event.clientY - startY;
  li.style.transform = `translateY(${dy}px)`;

  const to = Math.min(Math.max(from + Math.round(dy / height), 0), activeCount - 1);
  if (to === drag.to) return;
  drag.to = to;
  shiftSiblings();
}

/**
 * 让被越过的行滑开：拖动行从 from 挪到 to，中间的行各让一行。
 *
 * transform 不参与布局，每行空出的那一格还留着，所以没有重排；让位的滑动
 * 是 CSS 过渡（`.is-reordering`），这里只负责把位移写对。
 */
function shiftSiblings() {
  if (!drag) return;
  const { li, order, from, to, height } = drag;
  order.forEach((row, k) => {
    if (row === li) return;
    const shift =
      from < to && from < k && k <= to
        ? -height
        : to < from && to <= k && k < from
          ? height
          : 0;
    row.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

/**
 * 拖完（或被来电、弹窗打断）：落位、落盘、收掉浮起。
 *
 * 落位是**同一次同步执行**里的一串（只绘制一次）：让位行清位移 + 拖动行插进
 * 目标槽——此刻两者的自然位置和位移后的位置正好重合，画面纹丝不动；期间过渡
 * 被 `.is-committing` 关掉，否则「清零位移」会被再演一遍，行会弹回原位再滑回来。
 * 手指停在两槽之间时的残余位移用 Web Animations 滑进槽位，滑完才收掉投影。
 *
 * 先摘监听再做事——后面任何一步出异常都不能把 window 监听留在那里，否则下一次
 * 点哪儿都像在拖拽。落盘失败会有横幅，不在这里重试。
 *
 * @param {PointerEvent} event
 */
function onDragEnd(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { li, handle, pointerId, order, from, to } = drag;
  drag = null;

  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  // pointerup 之后浏览器会隐式释放捕获；已不在手上就别去要，有的内核会抛
  if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);

  const list = li.parentElement;
  if (!list) {
    li.classList.remove('is-dragging');
    return;
  }

  const visualTop = li.getBoundingClientRect().top;

  list.classList.add('is-committing');
  for (const row of order) {
    if (row !== li) row.style.transform = '';
  }
  if (to !== from) {
    // 插到目标槽：往下挪就插在「目标槽的下一行」前面，往上挪就插在目标槽前面
    const reference = order[to > from ? to + 1 : to] ?? null;
    list.insertBefore(li, reference);
  }
  li.style.transform = '';
  list.classList.remove('is-committing');

  const residual = visualTop - li.getBoundingClientRect().top;
  if (Math.abs(residual) > 0.5) {
    li.animate(
      [{ transform: `translateY(${residual}px)` }, { transform: 'none' }],
      { duration: 150, easing: 'ease-out' },
    );
  }
  // 投影跟着残余位移一起收，别在行还悬着的时候突然抽掉
  window.setTimeout(() => li.classList.remove('is-dragging'), 150);
  list.classList.remove('is-reordering');

  const orderedIds = /** @type {HTMLLIElement[]} */ ([...list.querySelectorAll('li[data-id]')]).map(
    (child) => /** @type {string} */ (child.dataset.id),
  );
  void reorderTemplates(orderedIds);
}

/**
 * 第二步的正文：已选模板 + 目标日期 + 备注框。
 *
 * **「确定」不在这儿**——它在底栏（见 `buildConfirmButton`）。把出口和内容分开，内容再长
 * 也不会把按钮挤到需要滚一下才看得见的地方。
 *
 * @param {import('../model.js').Template} template
 * @param {import('../dates.js').DateKey} dateKey
 * @param {() => void} onBack 点顶部的已选模板回第一步换一个（PRD 7.2）
 * @returns {{ el: HTMLDivElement, note: HTMLTextAreaElement }}
 */
function buildNoteStep(template, dateKey, onBack) {
  const wrap = document.createElement('div');

  const picked = document.createElement('button');
  picked.type = 'button';
  picked.className = 'pip-picked';
  picked.addEventListener('click', onBack);
  picked.append(buildIcon(template, 'pip-picked-icon', 'pip-picked-dot'));

  const title = document.createElement('span');
  title.textContent = template.title;
  picked.append(title);

  // 这一行能点回第一步，但没写文案。给个指示，否则没人知道它可点。
  // 列表行用的是同一个符号（PRD 7.5）。
  const chevron = document.createElement('span');
  chevron.className = 'pip-picked-chevron';
  chevron.textContent = '›';
  chevron.setAttribute('aria-hidden', 'true');
  picked.append(chevron);

  const target = document.createElement('p');
  target.className = 'pip-target';
  target.textContent = targetLabel(dateKey);

  const note = document.createElement('textarea');
  note.className = 'pip-note';
  note.rows = 3;
  note.maxLength = NOTE_MAX;
  note.placeholder = '今天做了什么？';

  wrap.append(picked, target, note);
  return { el: wrap, note };
}

/**
 * 底栏里的那颗「确定」。
 *
 * 放在底栏而不是跟在备注框后面，理由见 buildNoteStep。备注框在正文里，所以这里用回调
 * 按需取值，而不是把它抓在手里。
 *
 * @param {() => string} readNote
 * @param {(note: string) => Promise<boolean>} onSubmit
 * @returns {HTMLButtonElement}
 */
function buildConfirmButton(readNote, onSubmit) {
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn-primary';
  confirm.textContent = '＋ 确定';
  confirm.addEventListener('click', async () => {
    // 落盘是异步的，连点两下会记成两条。所以先禁掉；写入被拦下（只读模式）时
    // 再放回来，否则用户就卡在这一步了。
    confirm.disabled = true;
    const ok = await onSubmit(readNote());
    if (!ok) {
      confirm.disabled = false;
      return;
    }
    // 「记一条 → 弹窗关闭」是 PRD 7.2 的一个整体流程，但关不关是流程自己的事，
    // 所以由这里发意图，而不是塞进 state.addPip 里。
    intent('close-sheet');
  });
  return confirm;
}

/**
 * 一个模板都没有时的空状态（PRD 7.2 / 11）。
 *
 * 只有标题和提示，「新建模板」在底栏——空状态和列表两种情况下底栏是同一颗按钮，
 * 不用在正文里再放一颗。
 *
 * @returns {HTMLDivElement}
 */
function buildEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'pip-empty';

  const title = document.createElement('p');
  title.className = 'pip-empty-title';
  title.textContent = '还没有模板';

  const hint = document.createElement('p');
  hint.className = 'pip-empty-hint';
  hint.textContent = '新建一个，比如「跑步」';

  wrap.append(title, hint);
  return wrap;
}

/**
 * 打卡流程的入口。
 *
 * @param {Record<string, unknown>} params
 * @returns {import('./sheet.js').SheetPage}
 */
export function renderPipCreate(params) {
  const dateKey = /** @type {import('../dates.js').DateKey} */ (
    typeof params.dateKey === 'string' ? params.dateKey : toDateKey()
  );

  // 启用中的在前，已停用的在后（PRD 7.2 / 7.5）
  const all = orderedTemplates(state.data.templates);
  const templates = all.filter((template) => !template.archived);
  const archived = all.filter((template) => template.archived);

  const wrap = document.createElement('div');
  // 底栏只建一次，然后交给 sheet.js 搬进卡片底栏；换步骤时只换它里面的内容，引用一直有效
  const footer = document.createElement('div');

  // 第一步的底栏动作：新建模板。它一直住在这儿，列表和空状态都是同一颗按钮
  // （PRD 7.2）。走强调色而不是次级色：这一页是模板唯一的入口，新建是它的主要动作之一。
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn-primary';
  add.textContent = '＋ 新建模板';
  add.addEventListener('click', () => intent('new-template'));
  footer.append(add);

  if (all.length === 0) {
    wrap.append(buildEmptyState());
    return { title: '选择模板', body: wrap, footer };
  }

  // 首屏不播入场动画：sheet 页面本身已经播过一次了（sheet.js 的 renderStack），
  // 再播一次会看着闪两下。
  let firstRender = true;

  /**
   * @param {import('../model.js').Template | null} picked null 表示第一步
   * @param {'forward' | 'back'} direction
   */
  function showStep(picked, direction) {
    const step = document.createElement('div');
    if (!firstRender) {
      step.classList.add(direction === 'back' ? 'pip-step-back' : 'pip-step-forward');
    }
    firstRender = false;

    if (picked) {
      const noteStep = buildNoteStep(picked, dateKey, () => showStep(null, 'back'));
      footer.replaceChildren(
        buildConfirmButton(
          () => noteStep.note.value,
          (note) => addPip(picked.id, dateKey, note),
        ),
      );
      step.append(noteStep.el);
    } else {
      // 第一步没有主操作——模板行本身就是那一步的动作，底栏只放新建
      footer.replaceChildren(add);
      const list = document.createElement('ul');
      list.className = 'tpl-list';
      for (const template of all) {
        list.append(buildRow(template, () => showStep(template, 'forward')));
      }
      step.append(list);
    }

    wrap.replaceChildren(step);
  }

  showStep(null, 'forward');
  return { title: '选择模板', body: wrap, footer };
}
