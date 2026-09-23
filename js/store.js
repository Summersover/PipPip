/**
 * 存储层。
 *
 * ★ 这是整个项目里**唯一**允许出现 `localStorage` 的文件。唯一的例外是
 *   `theme-boot.js`：它必须同步读完 prefs 才能设主题（否则深色模式首屏闪白），
 *   而本文件的接口按设计是异步的。那个例外只读一个 key、不写任何东西。
 *
 * 对外接口**全部返回 Promise**，即使内部是同步的。这是成本最低、收益最高的一条
 * 决定：将来换成云同步时只改这一个文件，界面一行都不用动（见 TECH 3.1）。
 */

import { looksLikeData, migrate, normalize } from './model.js';

/**
 * key 布局（TECH 3.2）。
 *
 * 加 `pip:v1:` 前缀是因为 localStorage 在同一 origin 下所有页面共享，GitHub
 * Pages 上同账号的第二个项目会共享配额和 key 空间。
 *
 * ★ `KEY_PREFS` 在 `theme-boot.js` 里也硬编码了一份——那个脚本不是 module，
 *   没法 import。改这里要一起改那边。
 */
const KEY_DATA = 'pip:v1:data';
const KEY_BACKUP = 'pip:v1:backup';
const KEY_PREFS = 'pip:v1:prefs';

/** 探测用的临时 key，写完立刻删掉。 */
const KEY_PROBE = 'pip:v1:__probe';

/**
 * @typedef {object} LoadResult
 * @property {'empty' | 'ok' | 'recovered' | 'corrupt'} status
 * @property {import('./model.js').PipData} [data] `corrupt` 时没有
 * @property {string} [raw] 原始字符串。`recovered` / `corrupt` 时保留，供用户导出抢救
 */

/**
 * @typedef {object} Prefs
 * @property {'system' | 'light' | 'dark'} theme
 */

/**
 * @typedef {{ ok: true } | { ok: false, reason: 'quota' | 'unavailable' | 'empty' }} WriteResult
 */

/**
 * 取存储对象。某些浏览器在禁用存储时**访问** `localStorage` 就会抛 SecurityError，
 * 所以这里也要包起来。
 * @returns {Storage | null}
 */
function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @returns {string | null}
 */
function read(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} raw
 * @returns {unknown}
 */
function tryParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * 是不是配额写满。
 *
 * 除了标准的 `QuotaExceededError`，还要认 Firefox 的老名字和两个数字码——不同
 * 浏览器给的形状不一样，漏掉一个就会把「配额满」误报成「存储不可用」，而两者的
 * 处理方式不同（前者要提示立即导出，后者要提示别用无痕模式）。
 *
 * @param {unknown} e
 * @returns {boolean}
 */
function isQuotaError(e) {
  if (!e || typeof e !== 'object') return false;
  const err = /** @type {{ name?: string, code?: number }} */ (e);
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  );
}

/**
 * 读取整个数据库。
 *
 * 返回四种状态，调用方必须全部处理：
 * - `empty`     没有数据，首次打开
 * - `ok`        正常
 * - `recovered` 主 key 坏了或结构不对，已从 backup 恢复
 * - `corrupt`   主 key 和 backup 都不可用
 *
 * **绝不自动写回。** 解析失败时保留原始字符串交给调用方，由用户决定怎么处理
 * （见 TECH 3.5）。
 *
 * @param {{ onDrop?: (dropped: { id: string, date: unknown }) => void }} [options]
 * @returns {Promise<LoadResult>}
 */
export async function load(options = {}) {
  const { onDrop } = options;

  const rawMain = read(KEY_DATA);
  const parsedMain = rawMain === null ? undefined : tryParse(rawMain);

  if (looksLikeData(parsedMain)) {
    return { status: 'ok', data: migrate(normalize(parsedMain, onDrop)) };
  }

  // 主 key 缺失或损坏，回退 backup
  const rawBackup = read(KEY_BACKUP);
  const parsedBackup = rawBackup === null ? undefined : tryParse(rawBackup);

  if (looksLikeData(parsedBackup)) {
    // 主 key 本来就空、只是 backup 有东西，也算 recovered：用户需要知道
    // 「现在看到的不是主数据」，否则会以为一切正常
    return {
      status: 'recovered',
      data: migrate(normalize(parsedBackup, onDrop)),
      raw: rawMain ?? rawBackup ?? '',
    };
  }

  if (rawMain === null && rawBackup === null) return { status: 'empty' };
  return { status: 'corrupt', raw: rawMain ?? rawBackup ?? '' };
}

/**
 * 写入整个数据库。
 *
 * **写之前先把现有主值挪进 backup**，但只在它能解析时才挪——否则会用坏数据
 * 覆盖掉一份好的 backup，那就把唯一的退路也毁了。
 *
 * @param {import('./model.js').PipData} data
 * @returns {Promise<WriteResult>}
 */
export async function save(data) {
  const s = storage();
  if (!s) return { ok: false, reason: 'unavailable' };

  const rawMain = read(KEY_DATA);
  if (rawMain !== null && looksLikeData(tryParse(rawMain))) {
    try {
      s.setItem(KEY_BACKUP, rawMain);
    } catch {
      // backup 是尽力而为的兜底，失败不该阻断主写入
    }
  }

  try {
    s.setItem(KEY_DATA, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}

/**
 * 读偏好设置。与数据分开存：偏好不是用户数据，不该进导出文件，数据损坏时也
 * 不该连带丢失（TECH 3.2）。
 *
 * @returns {Promise<Prefs>}
 */
export async function loadPrefs() {
  const raw = read(KEY_PREFS);
  const parsed = raw === null ? undefined : tryParse(raw);
  const theme = parsed && typeof parsed === 'object'
    ? /** @type {Record<string, unknown>} */ (parsed).theme
    : undefined;
  return { theme: theme === 'light' || theme === 'dark' ? theme : 'system' };
}

/**
 * @param {Prefs} prefs
 * @returns {Promise<WriteResult>}
 */
export async function savePrefs(prefs) {
  const s = storage();
  if (!s) return { ok: false, reason: 'unavailable' };
  try {
    s.setItem(KEY_PREFS, JSON.stringify(prefs));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}

/**
 * 探测存储是否可用。启动时跑一次。
 *
 * **这个探测并不完整**：现代 iOS Safari 在无痕模式下**允许**写入 localStorage，
 * 只是退出浏览器即清空。探测抓不到这种情况，只能靠文案提示。不要以为 probe
 * 通过就万事大吉（TECH 3.6）。
 *
 * @returns {Promise<WriteResult>}
 */
export async function probe() {
  const s = storage();
  if (!s) return { ok: false, reason: 'unavailable' };
  try {
    s.setItem(KEY_PROBE, '1');
    s.removeItem(KEY_PROBE);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}

/**
 * 手动把当前数据存进 backup。
 *
 * 导入之前要调一次：用户选了「覆盖」又选错文件，是唯一能一次毁掉全部数据的
 * 操作，必须留退路（TECH 9.2）。
 *
 * @returns {Promise<WriteResult>}
 */
export async function snapshotToBackup() {
  const rawMain = read(KEY_DATA);
  if (rawMain === null) return { ok: false, reason: 'empty' };
  const s = storage();
  if (!s) return { ok: false, reason: 'unavailable' };
  try {
    s.setItem(KEY_BACKUP, rawMain);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}
