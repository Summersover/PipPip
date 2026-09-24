/**
 * 入口：装配与启动。
 */

import { toDateKey } from './dates.js';
import { flushPending, goToday, index, mountHost, refreshToday, reindex, state } from './state.js';
import * as store from './store.js';
import { clearBanner, mountBanner, showBanner } from './views/banner.js';
import { renderCalendar, renderCell, renderTitle } from './views/calendar.js';
import { renderDayList, renderPipDetail } from './views/day.js';
import { renderPipCreate } from './views/pip-form.js';
import { closeAll, mountSheet, push, registerPage } from './views/sheet.js';
import { renderTemplateEdit, renderTemplateList } from './views/templates.js';

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

/**
 * 只重绘某一天的格子。
 *
 * 打卡之后用，让 pip 的出现动画落在正确的元素上，而不是整片重绘（TECH 6.2）。
 *
 * @param {import('./dates.js').DateKey} dateKey
 * @param {string} [pipId] 新记下的那一条，只给它加入场动画
 */
function renderCellAt(dateKey, pipId) {
  if (!gridEl) return;
  refreshToday();
  renderCell(gridEl, dateKey, index.byDate, index.byTemplate, state.todayKey);
  // 整格的点一起弹会像是出了错，所以只标记新出现的那个
  if (pipId) gridEl.querySelector(`.pip[data-pip="${pipId}"]`)?.classList.add('is-new');
}

/**
 * 让某个点先淡出，再重画那一格（PRD 9.6：删除记录后 pip 消失，120ms ease-in）。
 *
 * **不 await**：删记录是从详情页发起的，弹窗盖着日历，这一下通常看不见，为它拖慢
 * 「删完退回列表」不值得。淡出照做，日历的状态因此永远是「删完就已经没有那个点」，
 * 不依赖弹窗恰好遮着。
 *
 * @param {string} pipId
 * @param {import('./dates.js').DateKey} dateKey
 */
function fadeOutDotThenRedraw(pipId, dateKey) {
  const dot = gridEl?.querySelector(`.pip[data-pip="${pipId}"]`);
  if (!dot) {
    renderCellAt(dateKey);
    return;
  }
  dot.classList.add('is-removing');
  // 时长必须和 app.css 里 .pip.is-removing 的 animation 一致
  window.setTimeout(() => renderCellAt(dateKey), 120);
}

// ─────────────────────────────────────────────────────────
// 装配：视图做不了的那两件事
// ─────────────────────────────────────────────────────────

/**
 * 把「落盘 + 重绘」和「跳转」接给 state，视图通过它调（TECH 2 的依赖方向：
 * `views → state → model → store`，`views/*` 之间也不互相 import）。
 */
function mountAppHost() {
  mountHost({
    /**
     * 落盘 + 重绘。
     *
     * 打卡只重绘那一天的格子（TECH 6.2）；模板变更要整片重绘日历——点的颜色和顺序
     * 都可能变，删模板还会连点一起消失，而这种变更不属于某一天，没有比整片更细的
     * 粒度可用。
     *
     * 刻意**不**在这里关弹窗：打卡要关（PRD 7.2），改模板标题不该关。关不关是各个
     * 流程自己的事，由视图发 `close-sheet` 意图决定。
     */
    async write({ dateKey, pipId, removedPipId, calendar } = {}) {
      await persist();
      if (calendar) {
        render();
        return;
      }
      if (!dateKey) return;
      if (removedPipId) fadeOutDotThenRedraw(removedPipId, dateKey);
      else renderCellAt(dateKey, pipId);
    },

    intent(name, params = {}) {
      switch (name) {
        case 'new-template':
          push('template-edit', {});
          break;
        case 'edit-template':
          push('template-edit', { templateId: params.templateId });
          break;
        case 'new-pip':
          // 从某日列表进来时目标日期是那一天，补记就走这条（PRD 7.2）
          push('pip-create', { dateKey: params.dateKey });
          break;
        case 'edit-pip':
          push('pip-detail', { pipId: params.pipId, dateKey: params.dateKey });
          break;
        case 'close-sheet':
          closeAll();
          break;
        case 'back':
          // 和 header 的返回箭头走同一条路：退一条 history，由 popstate 把栈同步回去
          history.back();
          break;
        default:
          // 未知意图是写错了，不静默（TECH 11.3）
          console.warn(`[pip] 未知的跳转意图：${name}`);
      }
    },
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
  mountSheet();
  mountAppHost();
  registerPage('day-list', renderDayList);
  registerPage('pip-detail', renderPipDetail);
  registerPage('pip-create', renderPipCreate);
  registerPage('template-list', renderTemplateList);
  registerPage('template-edit', renderTemplateEdit);

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

// 事件委托：42 个格子只挂一个监听器。用 closest 而不是直接比较 target，
// 因为点到的可能是格子里的日期数字或点。
gridEl?.addEventListener('click', (event) => {
  const node = event.target;
  if (!(node instanceof Element)) return;
  const cell = node.closest('.cal-cell');
  if (!(cell instanceof HTMLButtonElement) || cell.disabled) return;
  const dateKey = cell.dataset.date;
  if (dateKey) push('day-list', { dateKey });
});

// 「打卡」是主动作，目标日期是今天。刻意取此刻而不是 state.todayKey：应用可能开着
// 过了午夜，而 todayKey 只在渲染时刷新（TECH 5.4）。
document.getElementById('toolbar-pip')?.addEventListener('click', () => {
  push('pip-create', { dateKey: toDateKey() });
});

document.getElementById('toolbar-templates')?.addEventListener('click', () => {
  push('template-list', {});
});

// 页面重新可见时，如果已经跨过午夜就重绘
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // 被藏起来时补一次还没落盘的编辑：打完字直接切后台不会有失焦，那个值就丢了
    // （TECH 3.4）。失败了不该打断，所以不 await。
    void flushPending();
    return;
  }
  if (toDateKey() !== state.todayKey) render();
});

void boot();
