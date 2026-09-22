#!/usr/bin/env node
/**
 * 本地静态服务器。零依赖。
 *
 * **为什么不用 `python -m http.server`**：Windows 上 `python` 常常只是 Microsoft
 * Store 的占位程序，点一下会跳应用商店而不是启动服务。而 ES 模块必须走 HTTP
 * （`file://` 会被 CORS 拦住，一个模块都加载不了），service worker 也需要安全
 * 上下文，所以「起一个服务器」是这个项目里绕不过的步骤，不该依赖一个可能不
 * 存在的解释器。
 *
 *   npm run serve
 *   node tools/serve.js [端口]
 *
 * 会打印本机局域网地址，方便用手机打开验证——但注意**局域网 HTTP 不是安全
 * 上下文**，service worker 在手机上不会注册。手机上验 PWA 必须走 HTTPS
 * （线上地址）或 `localhost`（手机上的 localhost 指向手机自己）。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.argv[2]) || 8000;
const ROOT = process.cwd();

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 把请求路径映射到磁盘文件，并挡住目录穿越。
 * @param {string} urlPath
 * @returns {string | null} 绝对路径；越界返回 null
 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  let target = path.join(ROOT, decoded);
  if (!target.startsWith(ROOT)) return null; // 目录穿越
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }
  return target;
}

const server = http.createServer((req, res) => {
  const target = resolveFile(req.url || '/');

  if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 ${req.url}`);
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // 开发时不要缓存，否则改完看不到效果
    'cache-control': 'no-store',
  });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Pip dev server  →  http://localhost:${PORT}/`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`局域网（手机可试，但 service worker 不会注册）  →  http://${iface.address}:${PORT}/`);
      }
    }
  }
  console.log('Ctrl+C 停止');
});
