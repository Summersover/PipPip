/**
 * 设置页（PRD 7.6）。
 *
 * 这一页是**整屏替换日历**，不是 sheet（PRD 6）——所以它不注册进 sheet.js 的页面栈，
 * 由 app.js 切换两个视图、并把内容填进 `#settings-body`。
 *
 * 三块：主题（三档）、导出（下载 JSON）、导入（选文件 → 校验 → 选合并或覆盖 → 导入）。
 *
 * 导出提醒必须**常驻可见**，不能藏进二级页面：数据在浏览器里而不在用户手里，清缓存、
 * 换手机、卸载都会永久消失，我没有能力代为恢复（PRD 7.6）。
 */

import { daysBetween, formatRelativeDays, toDateKey } from '../dates.js';
import { buildExport, parseImport } from '../model.js';
import { importData, state, updatePrefs } from '../state.js';

/** 超过这么多天没导出就变红提醒（PRD 7.6）。 */
const EXPORT_WARN_DAYS = 30;

/** 主题三档（PRD 9.7）。 */
const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

/** 导入的两种模式，默认合并（PRD 7.6 / TECH 9.3）。 */
const IMPORT_MODES = [
  { value: 'merge', label: '合并', hint: '同 id 取较新的那条，两边的记录都留下' },
  { value: 'replace', label: '覆盖', hint: '替换当前数据，导入前会自动备份一份' },
];

/**
 * 一个分组：小标题 + 内容。
 *
 * @param {string} label
 * @param {HTMLElement[]} children
 * @returns {HTMLDivElement}
 */
function buildSection(label, children) {
  const section = document.createElement('div');
  section.className = 'settings-section';

  const caption = document.createElement('p');
  caption.className = 'settings-label';
  caption.textContent = label;

  section.append(caption, ...children);
  return section;
}

/**
 * 一个动作行：动作名 + 一行说明。和模板表单里那两行是同一个形状。
 *
 * @param {string} label
 * @param {string} hint
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function buildActionRow(label, hint, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'action';
  btn.addEventListener('click', onClick);

  const name = document.createElement('span');
  name.className = 'action-label';
  name.textContent = label;

  const note = document.createElement('span');
  note.className = 'action-hint';
  note.textContent = hint;

  btn.append(name, note);
  return btn;
}

/**
 * 一组单选行。
 *
 * 选中的线索有两个：前面那个点是实心还是浅色，以及文字色深浅——不靠颜色单独承载
 * 信息（PRD 12）。点本身也是这个产品的视觉语言（PRD 9.2「颜色归点」），拿它当单选
 * 指示不需要引入新的控件形态。
 *
 * @param {{ value: string, label: string, hint?: string }[]} options
 * @param {string} selected
 * @param {(value: string) => void} onPick
 * @returns {{ el: HTMLDivElement, mark: (value: string) => void }}
 */
function buildChoices(options, selected, onPick) {
  const el = document.createElement('div');
  el.className = 'choices';

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();

  for (const option of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice';
    btn.addEventListener('click', () => onPick(option.value));

    const dot = document.createElement('span');
    dot.className = 'choice-dot';

    const text = document.createElement('span');
    text.className = 'choice-text';

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = option.label;
    text.append(label);

    if (option.hint) {
      const hint = document.createElement('span');
      hint.className = 'choice-hint';
      hint.textContent = option.hint;
      text.append(hint);
    }

    btn.append(dot, text);
    buttons.set(option.value, btn);
    el.append(btn);
  }

  /** @param {string} value */
  function mark(value) {
    for (const [key, btn] of buttons) {
      btn.setAttribute('aria-pressed', String(key === value));
    }
  }

  mark(selected);
  return { el, mark };
}

/**
 * 主题三档。改了立刻写偏好并应用，不设保存按钮（PRD 9.7）。
 *
 * @returns {HTMLDivElement}
 */
function buildThemeSection() {
  const choices = buildChoices(THEME_OPTIONS, state.prefs.theme, (value) => {
    choices.mark(value);
    // 偏好存在自己的 key 里，不碰数据，所以只读模式下也允许改主题
    void updatePrefs({ theme: /** @type {import('../store.js').ThemePref} */ (value) });
  });

  return buildSection('主题', [choices.el]);
}

/**
 * 把 `parseImport` 的原因码翻成人话。
 *
 * 失败要说清原因，不能静默忽略（PRD 11 / TECH 9.2）——「导入失败」四个字等于没说。
 *
 * @param {{ reason: string, detail?: string }} failure
 * @returns {string}
 */
function importErrorText(failure) {
  switch (failure.reason) {
    case 'parse':
      return '这个文件不是 JSON，读不出来';
    case 'not-pip':
      return '这不是 Pip 的导出文件';
    case 'version':
      return `文件来自别的版本（${failure.detail}），这个版本读不了`;
    case 'incomplete':
      return '文件内容不完整';
    default:
      return '这个文件读不了';
  }
}

/**
 * 导出与导入。
 *
 * @returns {HTMLDivElement}
 */
function buildDataSection() {
  const wrap = document.createElement('div');
  wrap.className = 'settings-rows';

  // ── 导出提醒。常驻，不藏进二级页面（PRD 7.6）──
  const reminder = document.createElement('p');
  reminder.className = 'settings-reminder';

  function paintReminder() {
    const at = state.prefs.lastExportAt;
    if (typeof at !== 'number') {
      reminder.textContent = '还没有导出过，建议现在备份';
      reminder.classList.add('is-overdue');
      return;
    }

    // 天数差按本地日历日算，不按毫秒除——和 formatRelativeDays 同一个理由
    const days = daysBetween(toDateKey(new Date(at)), toDateKey());
    const overdue = days >= EXPORT_WARN_DAYS;
    const since = formatRelativeDays(at);
    // 超期时的文案照 PRD 10 带上一句催促
    reminder.textContent = overdue ? `上次导出：${since}，建议现在备份` : `上次导出：${since}`;
    reminder.classList.toggle('is-overdue', overdue);
  }

  const exportRow = buildActionRow('导出数据', '导出后请保存到文件', async () => {
    const payload = buildExport(state.data);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pip-${toDateKey()}.json`;
    link.click();
    // 立刻 revoke 会让下载在部分浏览器（尤其 Safari）里拿不到数据，等一拍再撤
    window.setTimeout(() => URL.revokeObjectURL(url), 0);

    await updatePrefs({ lastExportAt: Date.now() });
    paintReminder();
  });

  // ── 导入 ──
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;

  const panel = document.createElement('div');
  panel.className = 'import-panel';
  panel.hidden = true;

  const note = document.createElement('p');
  note.className = 'import-note';
  note.hidden = true;

  /** @type {import('../model.js').PipData | null} */
  let pending = null;
  /** @type {'merge' | 'replace'} */
  let mode = 'merge';

  const chooseRow = buildActionRow('导入数据', '从 Pip 导出的 JSON 文件里读回来', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const text = await file.text();
    const result = parseImport(text, (dropped) => {
      // normalize 唯一的破坏性操作，要留痕（TECH 11.4）
      console.warn('[pip] 导入时丢弃了日期非法的记录', dropped);
    });

    if (!result.ok) {
      pending = null;
      panel.hidden = true;
      note.className = 'import-note is-error';
      note.textContent = importErrorText(result);
      note.hidden = false;
      return;
    }

    pending = result.data;
    mode = 'merge';
    note.hidden = true;

    const fileName = document.createElement('p');
    fileName.className = 'import-file';
    fileName.textContent = file.name;

    // 选模式：默认合并（PRD 7.6）。buildChoices 只管画，选中的值留在 mode 里。
    const modes = buildChoices(IMPORT_MODES, mode, (value) => {
      mode = value === 'replace' ? 'replace' : 'merge';
      modes.mark(value);
    });

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'btn-primary';
    submit.textContent = '导入';
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      const incoming = /** @type {import('../model.js').PipData} */ (pending);
      const ok = await importData(incoming, mode);
      submit.disabled = false;

      if (!ok) {
        // 只读模式拦下所有数据写入（TECH 3.5），顶部横幅已经挂着原因
        note.className = 'import-note is-error';
        note.textContent = '数据读取异常，已暂停导入';
        note.hidden = false;
        return;
      }

      pending = null;
      fileInput.value = '';
      panel.hidden = true;
      note.className = 'import-note';
      note.textContent = '已导入';
      note.hidden = false;
    });

    panel.replaceChildren(fileName, modes.el, submit);
    panel.hidden = false;
  });

  paintReminder();
  wrap.append(exportRow, reminder, chooseRow, panel, note, fileInput);

  return buildSection('数据', [wrap]);
}

/**
 * 把设置页内容填进容器。app.js 在切到设置页时调。
 *
 * @param {HTMLElement} host
 */
export function renderSettings(host) {
  host.replaceChildren(buildThemeSection(), buildDataSection());
}
