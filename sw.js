/**
 * service worker。
 *
 * ★ 这个文件里**只有 CACHE 和 ASSETS 是生成的**（由 tools/stamp-sw.js 扫描实际文件写入），
 *   其余逻辑手写——所以它是可读、可手改的源文件，不是构建产物。
 *
 *   不要手改那两个东西：漏改的后果分别是「用户永远拿不到新版本」和「离线崩」，两者
 *   都不会在开发时暴露。改完跑 `npm run stamp`。
 *
 * 策略（TECH 8.3）：
 * - install 时预缓存 ASSETS。任一文件失败就整个安装失败——这是好事，能立刻发现漏加文件
 * - fetch 时对同源 GET 用 cache-first；未命中走网络并顺手写进缓存（运行时兜底，防止
 *   漏加文件导致离线崩）
 * - activate 时删掉所有名字不等于 CACHE 的缓存
 *
 * 必须放在根目录，作用域才是整个站点。
 */

// >>> generated: assets
const CACHE = 'pip-5aab98be';

// 由 tools/stamp-sw.js 生成。清单变化时 CACHE 会自动变，不需要手改。
const ASSETS = [
  './',
  './css/app.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512-maskable.png',
  './icons/icon-512.png',
  './index.html',
  './js/app.js',
  './js/dates.js',
  './js/model.js',
  './js/state.js',
  './js/store.js',
  './js/theme-boot.js',
  './js/theme.js',
  './js/views/banner.js',
  './js/views/calendar.js',
  './js/views/day.js',
  './js/views/pip-form.js',
  './js/views/settings.js',
  './js/views/sheet.js',
  './js/views/templates.js',
  './manifest.webmanifest',
];
// <<< generated: assets

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 只管同源 GET：跨源的和写请求一律不碰
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // 运行时缓存兜底：漏加进 ASSETS 的文件也不会离线崩
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
    }),
  );
});

/**
 * 新版本等用户点了「刷新」才接管。
 *
 * **绝不自动调用 `skipWaiting()`。** 新 SW 在用户正开着应用的时候接管，已加载的旧页面
 * 会和新的缓存内容不一致，可能直接崩。必须等用户明确点按（TECH 8.3）。
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
