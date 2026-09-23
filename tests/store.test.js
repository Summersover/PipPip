/**
 * store.js 的断言。
 *
 * 这一组守的是**数据丢失**——存储层出错不会报错，只会静默把用户的历史弄没，
 * 所以每条失败路径都要有用例。
 *
 * 用注入的假 localStorage：Node 里没有这个全局（实测 Node 24 不定义它），
 * 而 store.js 是在函数调用时才去读 `globalThis.localStorage`，所以在调用前
 * 装上即可，不需要给生产代码留注入点。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../js/store.js';

const KEY_DATA = 'pip:v1:data';
const KEY_BACKUP = 'pip:v1:backup';
const KEY_PREFS = 'pip:v1:prefs';

/**
 * @param {{ failSet?: (key: string, value: string) => boolean, failGet?: boolean }} [opts]
 */
function fakeStorage(opts = {}) {
  const map = new Map();
  return {
    getItem(key) {
      if (opts.failGet) {
        const e = new Error('denied');
        e.name = 'SecurityError';
        throw e;
      }
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (opts.failSet?.(key, String(value))) {
        const e = new Error('quota exceeded');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    key: () => null,
    get length() {
      return map.size;
    },
    map,
  };
}

/** @param {ReturnType<typeof fakeStorage> | null} storage */
function install(storage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

/** @param {Record<string, string>} entries */
function seed(entries) {
  const s = fakeStorage();
  for (const [k, v] of Object.entries(entries)) s.map.set(k, v);
  install(s);
  return s;
}

const sample = (over = {}) => ({ version: 1, templates: [], pips: [], ...over });

// ─────────────────────────────────────────────────────────
// 读取
// ─────────────────────────────────────────────────────────

test('什么都没有时返回 empty', async () => {
  install(fakeStorage());
  assert.deepEqual(await store.load(), { status: 'empty' });
});

test('正常数据返回 ok', async () => {
  const data = sample({
    templates: [
      { id: 't_a', title: '喝水', icon: '💧', color: '#4A8FBF', archived: false, sort_order: 0, created_at: 1, updated_at: 1 },
    ],
    pips: [{ id: 'p_1', template_id: 't_a', date: '2026-09-22', at: 1, note: '', updated_at: 1 }],
  });
  seed({ [KEY_DATA]: JSON.stringify(data) });

  const result = await store.load();
  assert.equal(result.status, 'ok');
  assert.equal(result.data?.pips.length, 1);
  assert.equal(result.data?.templates[0].title, '喝水');
});

test('主数据坏掉时回退备份，并保留原始字符串', async () => {
  const good = sample({
    pips: [{ id: 'p_1', template_id: 't_a', date: '2026-09-22', at: 1, note: '', updated_at: 1 }],
  });
  seed({ [KEY_DATA]: '{坏掉的 JSON', [KEY_BACKUP]: JSON.stringify(good) });

  const result = await store.load();
  assert.equal(result.status, 'recovered');
  assert.equal(result.data?.pips.length, 1, '应当读到备份里的记录');
  assert.equal(result.raw, '{坏掉的 JSON', '原始字符串要留着，供用户导出抢救');
});

test('主数据和备份都坏掉时返回 corrupt 并保留原始字符串', async () => {
  seed({ [KEY_DATA]: '{坏', [KEY_BACKUP]: '也坏' });

  const result = await store.load();
  assert.equal(result.status, 'corrupt');
  assert.equal(result.data, undefined, 'corrupt 时不该给出数据，否则用户会以为它是好的');
  assert.equal(result.raw, '{坏');
});

test('能解析但不是我们的结构，算损坏而不是空数据', async () => {
  // 这是最隐蔽的一条：如果当成空数据渲染，用户一点保存就把原数据覆盖了，
  // 和 TECH 3.5 要防的是同一条链
  seed({ [KEY_DATA]: '{"hello":"world"}' });

  const result = await store.load();
  assert.equal(result.status, 'corrupt');
  assert.equal(result.raw, '{"hello":"world"}');
});

test('顶层是数组也算损坏', async () => {
  seed({ [KEY_DATA]: '[1,2,3]' });
  assert.equal((await store.load()).status, 'corrupt');
});

test('结构合法但内容残缺时补全而不是报错', async () => {
  seed({ [KEY_DATA]: JSON.stringify({ templates: [{ title: '只有标题' }], pips: [] }) });

  const result = await store.load();
  assert.equal(result.status, 'ok');
  assert.equal(result.data?.templates.length, 1);
  assert.ok(result.data?.templates[0].id, '缺 id 要补一个');
});

test('读不到存储时返回 empty 而不是抛错', async () => {
  install(fakeStorage({ failGet: true }));
  assert.deepEqual(await store.load(), { status: 'empty' });
});

// ─────────────────────────────────────────────────────────
// 写入
// ─────────────────────────────────────────────────────────

test('保存后能原样读回', async () => {
  install(fakeStorage());
  const data = sample({
    pips: [{ id: 'p_1', template_id: 't_a', date: '2026-09-22', at: 123, note: '记一笔', updated_at: 123 }],
  });

  assert.deepEqual(await store.save(data), { ok: true });
  const result = await store.load();
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data?.pips, data.pips);
});

test('保存时把旧的主值挪进备份', async () => {
  const rawA = JSON.stringify(sample({ pips: [] }));
  const s = seed({ [KEY_DATA]: rawA });

  await store.save(sample({ pips: [{ id: 'p_1', template_id: 't', date: '2026-09-22', at: 1, note: '', updated_at: 1 }] }));

  assert.equal(s.map.get(KEY_BACKUP), rawA, '旧值要留在备份里');
});

test('主值损坏时不覆盖一份好的备份', async () => {
  // 否则唯一的退路也被毁了
  const goodBackup = JSON.stringify(sample({ pips: [{ id: 'p_old', template_id: 't', date: '2026-09-01', at: 1, note: '', updated_at: 1 }] }));
  const s = seed({ [KEY_DATA]: '{坏', [KEY_BACKUP]: goodBackup });

  await store.save(sample({ pips: [] }));

  assert.equal(s.map.get(KEY_BACKUP), goodBackup, '好的备份必须原样保留');
});

test('首次保存（还没有主值）不会写备份', async () => {
  const s = seed({});
  await store.save(sample());
  assert.equal(s.map.get(KEY_BACKUP), undefined);
});

test('配额写满时返回 quota，不抛错', async () => {
  install(fakeStorage({ failSet: (key) => key === KEY_DATA }));
  assert.deepEqual(await store.save(sample()), { ok: false, reason: 'quota' });
});

test('配额写满发生在备份那一步时，主写入仍然进行', async () => {
  // 备份是尽力而为的兜底，失败不该阻断主写入
  const s = fakeStorage({ failSet: (key) => key === KEY_BACKUP });
  s.map.set(KEY_DATA, JSON.stringify(sample()));
  install(s);

  const result = await store.save(sample({ pips: [{ id: 'p_1', template_id: 't', date: '2026-09-22', at: 1, note: '', updated_at: 1 }] }));
  assert.deepEqual(result, { ok: true });
  assert.ok(s.map.get(KEY_DATA)?.includes('p_1'));
});

test('存储完全不可用时返回 unavailable', async () => {
  install(null);
  assert.deepEqual(await store.save(sample()), { ok: false, reason: 'unavailable' });
});

test('snapshotToBackup 把当前数据存进备份', async () => {
  const raw = JSON.stringify(sample());
  const s = seed({ [KEY_DATA]: raw });

  assert.deepEqual(await store.snapshotToBackup(), { ok: true });
  assert.equal(s.map.get(KEY_BACKUP), raw);
});

test('没有数据时 snapshotToBackup 明确返回 empty', async () => {
  install(fakeStorage());
  assert.deepEqual(await store.snapshotToBackup(), { ok: false, reason: 'empty' });
});

// ─────────────────────────────────────────────────────────
// 偏好
// ─────────────────────────────────────────────────────────

test('偏好往返', async () => {
  install(fakeStorage());
  assert.deepEqual(await store.loadPrefs(), { theme: 'system' }, '没存过时默认跟随系统');

  await store.savePrefs({ theme: 'dark' });
  assert.deepEqual(await store.loadPrefs(), { theme: 'dark' });
});

test('偏好值非法时回落到跟随系统', async () => {
  seed({ [KEY_PREFS]: JSON.stringify({ theme: 'neon' }) });
  assert.deepEqual(await store.loadPrefs(), { theme: 'system' });
});

test('偏好损坏时回落到跟随系统，不影响数据', async () => {
  seed({ [KEY_PREFS]: '{坏', [KEY_DATA]: JSON.stringify(sample()) });
  assert.deepEqual(await store.loadPrefs(), { theme: 'system' });
  assert.equal((await store.load()).status, 'ok', '偏好坏掉不该牵连数据');
});

test('偏好与数据分开存', async () => {
  // 偏好不该进数据 key，也不该因为数据损坏而丢
  const s = seed({});
  await store.savePrefs({ theme: 'dark' });
  await store.save(sample());

  assert.ok(s.map.has(KEY_PREFS));
  assert.ok(s.map.has(KEY_DATA));
  assert.ok(!s.map.get(KEY_DATA)?.includes('theme'));
});

// ─────────────────────────────────────────────────────────
// 可用性探测
// ─────────────────────────────────────────────────────────

test('探测成功时不留垃圾 key', async () => {
  const s = fakeStorage();
  install(s);
  assert.deepEqual(await store.probe(), { ok: true });
  assert.equal(s.map.size, 0, '探测用的临时 key 必须删掉');
});

test('探测失败时给出原因', async () => {
  install(fakeStorage({ failSet: () => true }));
  assert.deepEqual(await store.probe(), { ok: false, reason: 'quota' });

  install(null);
  assert.deepEqual(await store.probe(), { ok: false, reason: 'unavailable' });
});
