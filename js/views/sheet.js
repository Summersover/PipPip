/**
 * 弹窗容器与内部页面栈。
 *
 * **只有一个 sheet 元素**，内部是一个页面栈。不用多个堆叠的 sheet：那样要处理
 * z-index、遮罩层数、滚动穿透，视觉上还会层层叠高（TECH 7.1）。
 *
 * 三件事在这里落地，都属于「不做就会出问题」的那类：
 * - **Android 返回键**：PWA 里没有路由，返回键默认直接退出应用，用户想关弹窗却
 *   退出了。每次 push 一层就压一条 history 记录，让返回键先关弹窗。
 * - **焦点管理**：弹窗打开时焦点要进去、Tab 不能跑出去、关闭时回到触发它的元素。
 * - **下滑关闭**：从顶部拖拽区往下拖，超过阈值或甩得够快就关。
 */

/**
 * @typedef {object} SheetPage
 * @property {string} title 显示在 header 中间
 * @property {HTMLElement} body 页面内容
 */

/**
 * @typedef {object} SheetEntry
 * @property {string} name
 * @property {Record<string, unknown>} params
 */

/**
 * @callback PageRenderer
 * @param {Record<string, unknown>} params
 * @returns {SheetPage}
 */

/** 关闭动画时长，必须和 app.css 里 .sheet 的 transition 一致。 */
const CLOSE_MS = 240;

/** 拖拽超过这个距离就关闭。 */
const DRAG_CLOSE_PX = 96;

/** 甩动速度超过这个值（px/ms）也关闭，哪怕距离不够。 */
const DRAG_CLOSE_VELOCITY = 0.5;

/** @type {Map<string, PageRenderer>} */
const pages = new Map();

/** @type {SheetEntry[]} */
const stack = [];

/** @type {{ scrim: HTMLElement, sheet: HTMLElement, dragArea: HTMLElement, back: HTMLButtonElement, title: HTMLElement, body: HTMLElement, close: HTMLButtonElement } | null} */
let els = null;

/** 打开前的焦点元素，关闭时还给它。 */
let restoreFocusTo = /** @type {HTMLElement | null} */ (null);

/** 关闭动画进行中，避免重复触发。 */
let closing = false;

/**
 * 关闭动画的定时器 id。
 *
 * 必须能取消：如果用户在关闭动画（240ms）跑完之前又打开了面板，那个定时器会在
 * 打开之后触发，把刚打开的面板又藏掉。所以 showPanel 里要先 clearTimeout。
 */
let hideTimer = 0;

/**
 * @param {string} name
 * @param {PageRenderer} renderer
 */
export function registerPage(name, renderer) {
  pages.set(name, renderer);
}

/**
 * 从文档里取好元素并接上事件。启动时调一次。
 */
export function mountSheet() {
  const scrim = document.getElementById('scrim');
  const sheet = document.getElementById('sheet');
  const dragArea = document.getElementById('sheet-drag');
  const back = document.getElementById('sheet-back');
  const title = document.getElementById('sheet-title');
  const body = document.getElementById('sheet-body');
  const close = document.getElementById('sheet-close');
  if (!scrim || !sheet || !dragArea || !back || !title || !body || !close) return;

  els = {
    scrim,
    sheet,
    dragArea,
    back: /** @type {HTMLButtonElement} */ (back),
    title,
    body,
    close: /** @type {HTMLButtonElement} */ (close),
  };

  els.scrim.addEventListener('click', () => closeAll());
  els.close.addEventListener('click', () => closeAll());
  els.back.addEventListener('click', () => history.back());
  document.addEventListener('keydown', onKeydown);
  els.sheet.addEventListener('keydown', onTabTrap);
  attachDrag();

  window.addEventListener('popstate', onPopstate);
}

/** 栈深。 */
export function depth() {
  return stack.length;
}

/**
 * 入栈一个页面。
 *
 * @param {string} name
 * @param {Record<string, unknown>} [params]
 */
export function push(name, params = {}) {
  const renderer = pages.get(name);
  if (!renderer) throw new Error(`未注册的弹窗页面：${name}`);

  const wasEmpty = stack.length === 0;
  if (wasEmpty) {
    restoreFocusTo = /** @type {HTMLElement | null} */ (document.activeElement);
    closing = false;
    showPanel();
  }

  stack.push({ name, params });
  renderStack('forward');

  // 每一层压一条 history 记录，让 Android 返回键先关弹窗而不是退出应用。
  // 放在 push 之后：这样返回时正好对应「退一层」。
  history.pushState({ pipSheet: stack.length }, '');
}

/**
 * 出栈一层。栈空了就关掉面板。
 */
export function pop() {
  if (stack.length === 0) return;
  stack.pop();
  if (stack.length === 0) {
    hidePanel();
    return;
  }
  renderStack('back');
}

/**
 * 清空并关闭。
 */
export function closeAll() {
  if (stack.length === 0 || closing) return;
  const layers = stack.length;
  stack.length = 0;
  hidePanel();

  // 把为弹窗压进去的 history 记录一起退掉，否则用户要按好几次返回键才能离开应用。
  // 不需要「忽略这次 popstate」——落回基础记录后 history.state 里没有 pipSheet，
  // syncToDepth 会看到目标深度是 0，而此时栈已经是空的，是空操作。
  history.go(-layers);
}

// ─────────────────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────────────────

/**
 * @param {'forward' | 'back'} direction
 */
function renderStack(direction) {
  if (!els) return;
  const top = stack[stack.length - 1];
  if (!top) return;

  const renderer = pages.get(top.name);
  if (!renderer) return;
  const page = renderer(top.params);

  els.title.textContent = page.title;
  els.body.replaceChildren(page.body);
  // 栈深大于 1 才有「返回」，栈底那一层是「关闭」
  els.back.hidden = stack.length <= 1;

  animatePage(direction);
}

/**
 * 重放一次入场动画。先移除 class 再强制重排，否则连续切换不会重新触发。
 *
 * @param {'forward' | 'back'} direction
 */
function animatePage(direction) {
  if (!els) return;
  const cls = direction === 'back' ? 'page-in-back' : 'page-in';
  els.body.classList.remove('page-in', 'page-in-back');
  void els.body.offsetWidth;
  els.body.classList.add(cls);
}

function showPanel() {
  if (!els) return;
  clearTimeout(hideTimer);
  els.scrim.hidden = false;
  els.sheet.hidden = false;
  els.sheet.style.transform = '';
  // 下一帧再加 is-open：从 display:none 直接加 class 不会触发过渡
  requestAnimationFrame(() => {
    els?.scrim.classList.add('is-open');
    els?.sheet.classList.add('is-open');
    // 焦点移到面板容器本身，而不是第一个按钮。容器带 aria-labelledby，
    // 读屏会先念出「对话框 + 标题」；直接聚焦 ✕ 的话用户只听到「关闭按钮」，
    // 不知道打开的是什么（TECH 7.3）。
    els?.sheet.focus();
  });
}

function hidePanel() {
  if (!els) return;
  closing = true;
  clearTimeout(hideTimer);
  els.scrim.classList.remove('is-open');
  els.sheet.classList.remove('is-open');
  els.sheet.style.transform = '';

  const el = els;
  hideTimer = window.setTimeout(() => {
    el.scrim.hidden = true;
    el.sheet.hidden = true;
    el.body.replaceChildren();
    closing = false;
  }, CLOSE_MS);

  // 焦点还给触发它的那个元素（TECH 7.3）
  restoreFocusTo?.focus?.();
  restoreFocusTo = null;
}

// ─────────────────────────────────────────────────────────
// 键盘
// ─────────────────────────────────────────────────────────

/** @param {KeyboardEvent} e */
function onKeydown(e) {
  if (e.key === 'Escape' && stack.length > 0) {
    e.preventDefault();
    closeAll();
  }
}

/**
 * 把 Tab 限制在弹窗内。不限制的话焦点会跑到背后的日历上，而用户看不见那里。
 *
 * @param {KeyboardEvent} e
 */
function onTabTrap(e) {
  if (e.key !== 'Tab' || !els) return;
  const focusable = els.sheet.querySelectorAll(
    'button:not([hidden]):not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;

  const first = /** @type {HTMLElement} */ (focusable[0]);
  const last = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);
  const active = document.activeElement;

  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

// ─────────────────────────────────────────────────────────
// Android 返回键
// ─────────────────────────────────────────────────────────

/**
 * 把页面栈调整到 history 记录的深度。
 *
 * 刻意**不**用「忽略接下来 N 次 popstate」那种计数器。计数器一旦和实际到达的
 * popstate 数量对不上就永久错位（`history.go()` 是异步的，中间还可能夹杂别的
 * 历史事件），要么该忽略的没忽略，要么该响应的被吃掉。而直接从 `history.state`
 * 读出目标深度是**自纠正**的：多退的层会补上，多余的 popstate 是空操作。
 *
 * @param {number} wanted
 */
function syncToDepth(wanted) {
  const target = Math.max(0, Math.min(wanted, stack.length));
  while (stack.length > target) stack.pop();

  if (stack.length === 0) {
    if (!closing) hidePanel();
    return;
  }
  renderStack('back');
}

/**
 * @returns {number} 当前 history 记录里记的弹窗深度
 */
function historyDepth() {
  const state = /** @type {{ pipSheet?: unknown } | null} */ (history.state);
  const value = state?.pipSheet;
  return typeof value === 'number' ? value : 0;
}

function onPopstate() {
  if (stack.length === 0 && historyDepth() === 0) return;
  syncToDepth(historyDepth());
}

// ─────────────────────────────────────────────────────────
// 下滑关闭
// ─────────────────────────────────────────────────────────

function attachDrag() {
  if (!els) return;
  const area = els.dragArea;

  let startY = 0;
  let startAt = 0;
  let dragging = false;

  /** @param {PointerEvent} e */
  const onDown = (e) => {
    // 面板没开就别接手势，否则会去改一个隐藏元素
    if (!els || e.button !== 0 || stack.length === 0) return;
    dragging = true;
    startY = e.clientY;
    startAt = performance.now();
    els.sheet.style.transition = 'none';
    try {
      // 指针在两次事件之间已经释放时这里会抛。捕获只是为了在指针移出拖拽区后
      // 还能收到 pointermove，拿不到也不该让整个手势失效。
      area.setPointerCapture(e.pointerId);
    } catch {
      /* 没捕获到就靠 area 上的监听，短距离拖动仍然可用 */
    }
  };

  /** @param {PointerEvent} e */
  const onMove = (e) => {
    if (!dragging || !els) return;
    // 只允许往下拖，往上拖不回弹是因为面板高度固定，往上没有内容
    const dy = Math.max(0, e.clientY - startY);
    els.sheet.style.transform = `translateY(${dy}px)`;
  };

  /** @param {PointerEvent} e */
  const onUp = (e) => {
    if (!dragging || !els) return;
    dragging = false;
    try {
      area.releasePointerCapture(e.pointerId);
    } catch {
      /* 没捕获成功过，也就没有可释放的 */
    }

    const dy = Math.max(0, e.clientY - startY);
    const elapsed = Math.max(1, performance.now() - startAt);
    const velocity = dy / elapsed;
    const shouldClose = dy > DRAG_CLOSE_PX || velocity > DRAG_CLOSE_VELOCITY;

    els.sheet.style.transition = '';
    // 先把位移清掉再决定关不关。反过来写的话，closeAll() 在栈已空时会提前返回，
    // 那个位移就永久留在元素上了。
    els.sheet.style.transform = '';
    if (shouldClose) closeAll();
  };

  area.addEventListener('pointerdown', onDown);
  area.addEventListener('pointermove', onMove);
  area.addEventListener('pointerup', onUp);
  area.addEventListener('pointercancel', onUp);
}
