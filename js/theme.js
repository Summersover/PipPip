/**
 * 主题解析与应用。
 *
 * ★ 关键设计：`data-theme` 上只写**解析后的结果**（`light` / `dark`），不写偏好
 *   （`system`）。这样 CSS 只需要两条规则，不用处理 `prefers-color-scheme` 与
 *   `data-theme` 的交叉组合（TECH 8.2）。
 *
 * 偏好本身存在 `pip:v1:prefs` 里，由 `store.js` 读写、`state.prefs` 持有。
 *
 * `theme-boot.js` 在首次绘制前做同一件事，但它是**非 module 的阻塞脚本**（必须赶在
 * 首屏之前跑），没法 import 这里，所以那边有一份自己的实现。改这里的解析规则时，
 * 那边要一起改。
 */

/** 系统深色偏好的媒体查询。 */
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * 把偏好解析成实际主题。
 *
 * @param {import('./store.js').ThemePref} pref
 * @returns {'light' | 'dark'}
 */
export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * 把偏好应用到文档上。
 *
 * @param {import('./store.js').ThemePref} pref
 */
export function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

/**
 * 偏好是「跟随系统」时，系统的深浅切换要跟着走。
 *
 * @param {() => import('./store.js').ThemePref} currentPref 取当前偏好
 * @returns {() => void} 取消监听
 */
export function watchSystemTheme(currentPref) {
  const media = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    // 只有「跟随系统」才跟着变：用户固定了浅色或深色，就不该被系统改掉
    if (currentPref() === 'system') applyTheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
