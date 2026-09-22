#!/usr/bin/env node
/**
 * 生成 `sw.js` 里两个「必须和实际文件保持一致」的部分：
 *
 *   - `CACHE` 常量：由所有被缓存文件的内容哈希决定
 *   - `ASSETS` 数组：由实际存在的文件决定
 *
 * **为什么需要它。** 这个项目没有打包器，所以 service worker 的预缓存清单
 * 是手工维护的。而两件最容易忘、后果又最难在开发时发现的事：
 *
 *   - 忘了把新文件加进 `ASSETS` → 用户离线时崩
 *   - 忘了改 `CACHE` 版本号 → 用户永远拿不到新版本，而且会被误判成部署失败
 *
 * 交给脚本生成，这两条就从部署清单里消掉了。
 *
 * 零依赖，只用 `node:` 内置模块。
 *
 *   npm run stamp                  # 生成
 *   npm run stamp -- --check       # 只校验，不写入（提交前 / CI 用）
 *   node tools/stamp-sw.js --root <dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 生成区域的哨兵。sw.js 里这两个注释之间的内容会被整段重写，其余原样保留。 */
const START = '// >>> generated: assets';
const END = '// <<< generated: assets';

/** 站点根下需要缓存的单个文件。缺失只警告不报错——项目早期它们还不存在。 */
const ROOT_FILES = ['index.html', 'manifest.webmanifest'];

/** 需要递归扫描的目录。缺失则跳过。 */
const SCAN_DIRS = ['css', 'js', 'icons'];

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const rootArgIndex = args.indexOf('--root');
const root = path.resolve(rootArgIndex === -1 ? process.cwd() : args[rootArgIndex + 1]);

/** @param {string} msg */
function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/**
 * 递归列出目录下的文件，返回相对 root 的 POSIX 风格路径（正斜杠）。
 * 排序保证结果稳定——否则同样的内容会算出不同的哈希。
 *
 * @param {string} dirAbs
 * @param {string} prefix
 * @returns {string[]}
 */
function walk(dirAbs, prefix = '') {
  if (!fs.existsSync(dirAbs)) return [];
  /** @type {string[]} */
  const out = [];
  const entries = fs
    .readdirSync(dirAbs, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dirAbs, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

// ── 收集要缓存的文件 ──────────────────────────────────────────

/** @type {string[]} */
const files = [];

for (const name of ROOT_FILES) {
  if (fs.existsSync(path.join(root, name))) files.push(name);
  else console.warn(`  ! 缺少 ${name}（项目早期可能还没建，先跳过）`);
}

for (const dir of SCAN_DIRS) {
  const found = walk(path.join(root, dir), dir);
  if (found.length === 0) console.warn(`  ! 目录 ${dir}/ 不存在或为空，跳过`);
  files.push(...found);
}

if (files.length === 0) {
  fail(`在 ${root} 下没找到任何要缓存的文件。检查 --root 是否正确。`);
}

files.sort();

// ── 算内容哈希 ────────────────────────────────────────────────

const hash = crypto.createHash('sha256');
for (const rel of files) {
  hash.update(rel);
  hash.update('\0');
  hash.update(fs.readFileSync(path.join(root, rel)));
  hash.update('\0');
}
const cacheName = `pip-${hash.digest('hex').slice(0, 8)}`;

// ── 拼出生成区域 ──────────────────────────────────────────────

const region = [
  `const CACHE = '${cacheName}';`,
  '',
  '// 由 tools/stamp-sw.js 生成。清单变化时 CACHE 会自动变，不需要手改。',
  'const ASSETS = [',
  "  './',",
  ...files.map((f) => `  './${f}',`),
  '];',
  '',
].join('\n');

const next = `${START}\n${region}${END}`;

// ── 写回 sw.js ────────────────────────────────────────────────

const swPath = path.join(root, 'sw.js');
if (!fs.existsSync(swPath)) {
  // 「尚未存在」和「已过期」是两回事。sw.js 还没建（PWA 还没做，见 TECH 8.3）
  // 不该让 `npm run check` 一直报红，否则它会从一条有用的命令变成噪音。
  // 但显式跑 `npm run stamp` 时是明确要求生成，那就必须报错。
  if (checkOnly) {
    console.warn('  ! sw.js 还不存在，跳过校验（PWA 还没做）');
    process.exit(0);
  }
  fail(`找不到 ${swPath}。sw.js 需要先建好，并在其中留出哨兵注释区域：
  ${START}
  ${END}`);
}

const src = fs.readFileSync(swPath, 'utf8');
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  fail(`sw.js 里找不到哨兵注释区域。需要同时存在这两行，且顺序正确：
  ${START}
  ${END}`);
}

const updated = src.slice(0, startIdx) + next + src.slice(endIdx + END.length);

if (updated === src) {
  console.log(`✓ sw.js 已是最新（${cacheName}，${files.length} 个文件）`);
  process.exit(0);
}

if (checkOnly) {
  fail(`sw.js 的生成区域已过期。跑 \`npm run stamp\` 更新它。`);
}

fs.writeFileSync(swPath, updated);
console.log(`✓ 已更新 sw.js`);
console.log(`  CACHE  = ${cacheName}`);
console.log(`  文件数 = ${files.length}`);
for (const f of files) console.log(`    ./${f}`);
