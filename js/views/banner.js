/**
 * 顶部横幅。
 *
 * 同时只显示一条，按严重度取最高——否则「有新版本」会把「数据损坏」挤掉，
 * 而那是最需要用户看到的一条（TECH 11.2）。
 */

/**
 * 严重度。数字大的不会被数字小的覆盖。
 * @type {Record<string, number>}
 */
const PRIORITY = {
  corrupt: 40,
  quota: 30,
  unavailable: 20,
  update: 10,
};

/** @type {HTMLElement | null} */
let root = null;

/**
 * @typedef {'corrupt' | 'quota' | 'unavailable' | 'update'} BannerKind
 */

/** @type {{ kind: BannerKind, priority: number, message: string, actions: { label: string, onClick: () => void }[] } | null} */
let current = null;

/**
 * @param {HTMLElement | null} node
 */
export function mountBanner(node) {
  root = node;
}

/**
 * @typedef {object} BannerOptions
 * @property {BannerKind} kind
 * @property {string} message
 * @property {{ label: string, onClick: () => void }[]} [actions]
 */

/**
 * @param {BannerOptions} options
 */
export function showBanner({ kind, message, actions = [] }) {
  const priority = PRIORITY[kind] ?? 0;
  if (current && current.priority > priority) return;
  current = { kind, priority, message, actions };
  render();
}

/**
 * 撤掉横幅。**按 kind 匹配**，只撤掉指定那一条。
 *
 * 这一条不能省：横幅没有自动消失的机制，用户点了「用备份继续」之后，如果不清掉，
 * 「主数据读取失败」这句话会一直挂着，而它已经不成立了。按 kind 匹配是为了避免
 * 顺手把更严重的那条（比如数据损坏）一起撤掉。
 *
 * @param {BannerKind} kind
 */
export function clearBanner(kind) {
  if (!current || current.kind !== kind) return;
  current = null;
  render();
}

/** 横幅是「不可关闭」的：数据安全相关的提示不该被随手划掉。 */
function render() {
  if (!root) return;
  root.replaceChildren();
  if (!current) {
    root.hidden = true;
    return;
  }

  const text = document.createElement('span');
  text.className = 'banner-text';
  text.textContent = current.message;
  root.append(text);

  for (const action of current.actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'banner-action';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    root.append(btn);
  }

  root.hidden = false;
}
