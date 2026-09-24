/**
 * 弹窗容器与内部页面栈。
 *
 * **只有一个 sheet 元素**，内部是一个页面栈。不用多个堆叠的 sheet：那样要处理
 * z-index、遮罩层数、滚动穿透，视觉上还会层层叠高（TECH 7.1）。
 *
 * 容器是**居中的悬浮卡片**（PRD 6 / 9.5），宽高都写死在 CSS 里，内容更高的页面在卡片
 * 内部滚。所以这里没有任何手势——关掉只有三条路：`✕`、点遮罩、Escape／Android 返回键。
 *
 * 两件事在这里落地，都属于「不做就会出问题」的那类：
 * - **Android 返回键**：PWA 里没有路由，返回键默认直接退出应用，用户想关弹窗却
 *   退出了。每次 push 一层就压一条 history 记录，让返回键先关弹窗。
 * - **焦点管理**：弹窗打开时焦点要进去、Tab 不能跑出去、关闭时回到触发它的元素。
 */

import { flushPending } from '../state.js';

/**
 * @typedef {object} SheetPage
 * @property {string} title 显示在 header 中间
 * @property {HTMLElement} body 页面内容，放不下就在卡片内部滚
 * @property {HTMLElement} [footer] 固定在卡片底边的动作条。内容会长到需要滚的页面
 *   （某日列表、模板列表）把主操作放这儿，免得要滑到底才够得着（PRD 9.5）
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

/** @type {Map<string, PageRenderer>} */
const pages = new Map();

/** @type {SheetEntry[]} */
const stack = [];

/** @type {{ scrim: HTMLElement, sheet: HTMLElement, back: HTMLButtonElement, title: HTMLElement, body: HTMLElement, footer: HTMLElement, close: HTMLButtonElement } | null} */
let els = null;

/** 打开前的焦点元素，关闭时还给它。 */
let restoreFocusTo = /** @type {HTMLElement | null} */ (null);

/** 关闭动画进行中，避免重复触发。 */
let closing = false;

/**
 * 面板正在打开：这一次页面渲染不播横向入场动画。
 *
 * 卡片自己已经有出现动画（缩放 + 淡入），内容再横向滑一次就成了两个动画叠在一起，
 * 看着像内容在自己往左挪。PRD 9.6 把这两件事分成两行——「卡片出现 / 收起」和
 * 「两步之间切换」——横向位移只属于后者。
 */
let openingPanel = false;

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
  const back = document.getElementById('sheet-back');
  const title = document.getElementById('sheet-title');
  const body = document.getElementById('sheet-body');
  const footer = document.getElementById('sheet-footer');
  const close = document.getElementById('sheet-close');
  if (!scrim || !sheet || !back || !title || !body || !footer || !close) return;

  els = {
    scrim,
    sheet,
    back: /** @type {HTMLButtonElement} */ (back),
    title,
    body,
    footer,
    close: /** @type {HTMLButtonElement} */ (close),
  };

  els.scrim.addEventListener('click', () => closeAll());
  els.close.addEventListener('click', () => closeAll());
  els.back.addEventListener('click', () => history.back());
  document.addEventListener('keydown', onKeydown);
  els.sheet.addEventListener('keydown', onTabTrap);

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
    openingPanel = true;
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
  flushLeavingPage();
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
  flushLeavingPage();
  const layers = stack.length;
  stack.length = 0;
  hidePanel();

  // 把为弹窗压进去的 history 记录一起退掉，否则用户要按好几次返回键才能离开应用。
  // 不需要「忽略这次 popstate」——落回基础记录后 history.state 里没有 pipSheet，
  // syncToDepth 会看到目标深度是 0，而此时栈已经是空的，是空操作。
  history.go(-layers);
}

/**
 * 页面要离开之前，先让它把没落盘的东西补写一次（TECH 3.4）。
 *
 * 挂在退层和关弹窗这两条路径上：它们不一定让输入框失焦——Android 返回键就没有任何
 * 指针事件，Escape 也不会。保存动作是同步读走输入框里的值再异步落盘的，所以这里
 * 不用等它完成，紧接着把页面换掉也不会丢。
 */
function flushLeavingPage() {
  void flushPending();
}

// ─────────────────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────────────────

/**
 * @param {'forward' | 'back'} direction
 */
function renderStack(direction) {
  // 打开后的第一次渲染不播横向入场：卡片正在做自己的出现动画（缩放 + 淡入），内容跟着
  // 横滑会变成两个动画叠着，看着像内容在自己往左挪。横向位移留给面板里的页面切换
  // （列表 → 详情、两步之间）。
  //
  // 标记在这里就消费掉，不放在函数末尾——中途 return 的话它留着，会把后面那一次的
  // 动画也一起吃掉。
  const skipAnimation = openingPanel;
  openingPanel = false;

  if (!els) return;
  const top = stack[stack.length - 1];
  if (!top) return;

  const renderer = pages.get(top.name);
  if (!renderer) return;
  const page = renderer(top.params);

  els.title.textContent = page.title;
  els.body.replaceChildren(page.body);
  if (page.footer) els.footer.replaceChildren(page.footer);
  else els.footer.replaceChildren();
  els.footer.hidden = !page.footer;
  // 栈深大于 1 才有「返回」，栈底那一层是「关闭」
  els.back.hidden = stack.length <= 1;

  if (!skipAnimation) animatePage(direction);
}

/**
 * 重放一次入场动画。先移除 class 再强制重排，否则连续切换不会重新触发。
 *
 * @param {'forward' | 'back'} direction
 */
function animatePage(direction) {
  if (!els) return;
  const cls = direction === 'back' ? 'page-in-back' : 'page-in';
  // 底栏跟着一起动：有底栏的页面（某日列表、模板列表）切到没有底栏的页面时，底栏会整块
  // 消失，不跟着动一下会显得是两件不相干的事
  for (const el of [els.body, els.footer]) {
    el.classList.remove('page-in', 'page-in-back');
    void el.offsetWidth;
    el.classList.add(cls);
  }
}

function showPanel() {
  if (!els) return;
  clearTimeout(hideTimer);
  els.scrim.hidden = false;
  els.sheet.hidden = false;
  // 从 display:none 直接加 is-open 不会触发过渡，得先强制排一次版。
  //
  // **用强制重排而不是 requestAnimationFrame**：后者依赖帧回调，而在某些环境下
  // 帧回调根本不派发（实测这个开发面板里就有），那样 is-open 永远加不上，面板会
  // 一直停在「没打开」的缩小淡出状态。`animatePage` 用的是同一个办法。
  void els.sheet.offsetWidth;
  els.scrim.classList.add('is-open');
  els.sheet.classList.add('is-open');
  // 焦点移到面板容器本身，而不是第一个按钮。容器带 aria-labelledby，读屏会先念出
  // 「对话框 + 标题」；直接聚焦 ✕ 的话用户只听到「关闭按钮」，不知道打开的是什么
  // （TECH 7.3）。
  els.sheet.focus();
}

function hidePanel() {
  if (!els) return;
  closing = true;
  clearTimeout(hideTimer);
  els.scrim.classList.remove('is-open');
  els.sheet.classList.remove('is-open');

  const el = els;
  hideTimer = window.setTimeout(() => {
    el.scrim.hidden = true;
    el.sheet.hidden = true;
    el.body.replaceChildren();
    el.footer.replaceChildren();
    el.footer.hidden = true;
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
