/**
 * 入口：装配与启动。
 */

import { toDateKey } from './dates.js';
import { goToday, index, refreshToday, reindex, state } from './state.js';
import * as store from './store.js';
import { clearBanner, mountBanner, showBanner } from './views/banner.js';
import { renderCalendar, renderTitle } from './views/calendar.js';

const titleEl = document.getElementById('cal-title');
const gridEl = /** @type {HTMLTableElement | null} */ (document.getElementById('cal-grid'));

// ─────────────────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────────────────

function render() {
  if (!titleEl || !gridEl) return;
  refreshToday();
  renderTitle(titleEl, state.view.year, state.view.month);
  renderCalendar(gridEl, {
    year: state.view.year,
    month: state.view.month,
    pipsByDate: index.byDate,
    templateById: index.byTemplate,
    todayKey: state.todayKey,
  });
}

// ─────────────────────────────────────────────────────────
// 写入
// ─────────────────────────────────────────────────────────

/**
 * 保存整个数据库。
 *
 * 只读模式下直接拒绝——这是防「坏数据被真空数据覆盖」的最后一道闸。用户的一次
 * 误点就会触发写入，所以检查必须在这里，不能指望每个调用方都记得（TECH 3.5）。
 */
async function persist() {
  if (state.readOnly) return;
  const result = await store.save(state.data);
  if (result.ok) {
    // 写成功了，之前那两条关于存储的警告就不成立了
    clearBanner('quota');
    clearBanner('unavailable');
    return;
  }
  showBanner({
    kind: result.reason === 'quota' ? 'quota' : 'unavailable',
    message:
      result.reason === 'quota' ? '存储写入失败，请立即导出备份' : '存储不可用，数据不会被保存',
  });
}

// ─────────────────────────────────────────────────────────
// 月份切换
// ─────────────────────────────────────────────────────────

/**
 * @param {number} delta 月份增减，允许跨年
 */
function shiftMonth(delta) {
  let month = state.view.month + delta;
  let year = state.view.year;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }
  state.view.year = year;
  state.view.month = month;
}

// ─────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────

/**
 * 把原始字符串原样导出，供数据损坏时抢救。
 *
 * 刻意**不**包 `{app, version, data}` 外壳（TECH 9.1 的正常导出格式）：这里导出
 * 的东西解析可能就已经失败了，套外壳没有意义，只会让用户更难还原。
 *
 * @param {string} raw
 */
function exportRaw(raw) {
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pip-raw-${toDateKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function boot() {
  mountBanner(document.getElementById('banner'));

  state.prefs = await store.loadPrefs();
  const availability = await store.probe();

  const result = await store.load({
    onDrop: (dropped) => {
      // 唯一会被丢弃的东西。留痕，不静默（TECH 11.4）
      console.warn('[pip] 丢弃了日期非法的记录', dropped);
    },
  });

  if (result.data) state.data = result.data;

  if (result.status === 'corrupt') {
    // 解析失败时**绝不自动写回**。用户看到空日历可能顺手一点，那就会把坏数据
    // 覆盖成真空数据，所以先停掉所有写入（TECH 3.5）。
    state.readOnly = true;
    showBanner({
      kind: 'corrupt',
      message: '数据读取异常，已暂停保存以免覆盖',
      actions: [{ label: '导出原始数据', onClick: () => exportRaw(result.raw ?? '') }],
    });
  } else if (result.status === 'recovered') {
    state.readOnly = true;
    showBanner({
      kind: 'corrupt',
      message: '主数据读取失败，现在显示的是备份内容',
      actions: [
        {
          label: '用备份继续',
          onClick: async () => {
            state.readOnly = false;
            await persist();
            // 用户已经选了继续，那句话就不成立了。不清掉它会一直挂着。
            clearBanner('corrupt');
          },
        },
        { label: '导出原始数据', onClick: () => exportRaw(result.raw ?? '') },
      ],
    });
  } else if (!availability.ok) {
    showBanner({
      kind: 'unavailable',
      message: '请勿在无痕模式使用，数据会丢失',
    });
  }

  reindex();
  goToday();
  render();
}

// ─────────────────────────────────────────────────────────
// 事件
// ─────────────────────────────────────────────────────────

document.getElementById('prev-month')?.addEventListener('click', () => {
  shiftMonth(-1);
  render();
});

document.getElementById('next-month')?.addEventListener('click', () => {
  shiftMonth(1);
  render();
});

// 页面重新可见时，如果已经跨过午夜就重绘
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && toDateKey() !== state.todayKey) render();
});

void boot();
