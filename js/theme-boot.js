/**
 * 主题引导。**必须是阻塞式的非 module 脚本**，在 `<head>` 里、CSS 之前加载。
 *
 * 为什么不能等 `theme.js`：深色模式下如果等 JS 跑完再设主题，用户会先看到
 * 一帧白屏。这个脚本在首次绘制前就把 `data-theme` 定好。
 *
 * 为什么不是内联脚本：CSP 的 `script-src 'self'` 会拦掉内联脚本，为了它放宽
 * CSP 不值得（见 TECH 14）。
 *
 * ★ 这是 `store.js` 之外**唯一**直接读 localStorage 的地方，而且只读不写、
 *   只读一个 key。原因就是上面那条：它必须同步完成，而 store 的接口按设计
 *   是异步的。见 TECH 3.1。
 *
 * 注意它只写**解析后的结果**（light / dark），不写偏好（system）——偏好留在
 * `pip:v1:prefs` 里，由 `theme.js` 解析。这样 CSS 只需要两条规则。
 */
(function () {
  var theme = 'light';
  try {
    var prefs = JSON.parse(localStorage.getItem('pip:v1:prefs') || '{}');
    var pref = prefs.theme || 'system';
    theme =
      pref === 'dark' ||
      (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark'
        : 'light';
  } catch (e) {
    /* 读不到就用浅色，不要因此挡住首屏 */
  }
  document.documentElement.dataset.theme = theme;
})();
