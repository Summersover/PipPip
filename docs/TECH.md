# Pip — 技术设计文档

> 本文档回答「怎么实现」。产品需求见 [`PRD.md`](PRD.md)，硬约束见 [`../AGENTS.md`](../AGENTS.md)。

版本：v1 · 2026-09-22

---

## 1. 技术选型

### 1.1 选型表

| 方面 | 选择 | 说明 |
|---|---|---|
| 语言 | 原生 HTML + CSS + ES2022 JavaScript | 见 1.2 |
| 模块 | 原生 ES Modules（`<script type="module">`） | 存储层必须可替换，需要真实的模块边界 |
| **类型** | **JSDoc 注解 + `tsc --noEmit`** | 只做检查，**不产出任何文件**。见 1.3 |
| 样式 | 单个 CSS 文件 + CSS 自定义属性 | 主题切换靠变量覆盖，不需要预处理器 |
| 存储 | localStorage | 容量测算见 3.7 |
| **运行时依赖** | **零** | 没有依赖就没有更新、没有供应链风险 |
| **开发依赖** | **1 个**（typescript），只在本地和提交前跑 | 不进产物 |
| **测试** | **`node --test`，在 5 个时区下各跑一遍** | 见 10.4 |
| 打包 | **无。产出文件就是源文件** | 部署就是把目录推上去 |

### 1.2 为什么不用框架

**判断依据：这个项目的复杂度不在视图层，而框架只解决视图层。**

真正的风险来源是这些，框架一个都帮不上：

| 难点 | 框架有帮助吗 |
|---|---|
| 时区 / 本地日期（`toISOString` 陷阱） | 没有，纯函数问题 |
| 存储损坏的只读保护 | 没有 |
| 导出合并算法（按 id + `updated_at`） | 没有 |
| service worker 更新生命周期 | 没有 |
| GitHub Pages 路径前缀 / origin 隔离 | 没有 |
| PWA 首屏闪白 | 没有 |
| 视图与状态同步 | **有** |

前六项出错都是**静默错数据**（日期记错一天、坏数据被覆盖、用户永远拿不到新版本），这才是要防的。第七项是框架的主场，而它在这里的规模是：**6 个渲染函数、一个扁平 state 对象、最复杂的视图是 42 个格子。**

关键判断是**更新粒度很粗**：打卡一次只重绘那一天的格子，切月份重绘 42 格，列表最多十几行。全部重绘一个视图也是亚毫秒级。React 存在的理由是「深层嵌套的细粒度状态更新」，这里没有这个东西。

体积上也很直白：**这个应用全部源码压缩后约 12–15KB，而 React + ReactDOM 约 45KB gzip**——框架比应用本身大三倍。

另外现在 CSP 是 `connect-src 'none'`，整个应用零网络请求。任何从 CDN 加载的依赖都会破坏这个性质，要用框架就得 vendor 进仓库，那它就从「CDN 上的东西」变成了「你维护的代码」。

**将来什么情况下改推荐**（三条，满足任意一条就上 Vite + TypeScript，可能再加 Svelte 或 Preact）：

1. **视图超过 12 个，且出现「第三处需要复用同一个非平凡 UI 片段」**——视图层复杂度上来，框架收益才开始
2. **真做多设备同步**——会引入网络层、冲突解决、乐观更新、离线队列，状态复杂度直接上台阶。这是最强的一条理由。**现在的设计刻意推迟同步，同时也推迟了引入框架的理由**
3. **想要真正的 `.ts` 文件**而不是 JSDoc

**统计（`打卡统计`）不构成第四条。** 它加的是**只读的派生视图**，不是状态复杂度——不增加写入路径、异步或并发。热力图的结构和日历网格是同一个东西，按模板分布用 CSS 宽度就够。详见 6.5。

### 1.3 工具链：类型检查 + 测试 + 两个脚本

**加了三样东西，但没有引入构建步骤。** 产出仍然是纯静态文件，部署方式一点没变。

**类型检查**：在 `.js` 里写 JSDoc 注解，`tsc --noEmit` 只检查不产出。浏览器照常直接跑这些文件。代价是一个 devDependency + 一个 `tsconfig.json`。

它补上的短板正好在风险最高的地方：`store.js` 的接口、`model.js` 的合并函数、`dates.js` 的日期工具、带 `version` 的数据模型。这些地方出错都是静默的。

`tsconfig.json` 里 `moduleResolution` 用 `nodenext` 而不是 `bundler`，**这是刻意的**：`nodenext` 强制相对 import 必须写扩展名（`'./dates.js'` 而不是 `'./dates'`），这正是浏览器原生 ES 模块的要求。用 `bundler` 会放过漏写扩展名的写法，而那种代码在打包器下能跑、在浏览器里直接 404。**这个项目没有打包器，所以必须让类型检查替我们挡住它。**

**测试**：用 Node 内置的 `node --test`，零依赖，见 10.4。

**两个零依赖脚本**：

- `tools/check-tz.js` — 在 5 个时区下各跑一遍测试
- `tools/stamp-sw.js` — 自动生成 `sw.js` 的预缓存清单和缓存版本号，消掉部署清单里最容易忘的两项，见 8.4

**代价（明确接受）**：

- 每个模块是一次 HTTP 请求。靠 HTTP/2 和 service worker 缓存解决，首屏之后不再请求
- 改完代码想在浏览器里看效果，不需要任何构建，刷新即可
- JSDoc 不如真正的 `.ts` 顺手。接受，因为换来的是「产出文件就是源文件」


---

## 2. 文件结构

```
/
├── index.html                  唯一页面
├── manifest.webmanifest        PWA 清单
├── sw.js                       service worker（必须在根目录，作用域才是整个站点）
├── .nojekyll                   禁用 GitHub Pages 的 Jekyll 处理
├── package.json                只有 1 个 devDependency（typescript），不进产物
├── tsconfig.json               类型检查配置，noEmit
├── .gitignore
├── css/
│   └── app.css                 唯一样式表（含全部设计令牌）
├── js/
│   ├── theme-boot.js           阻塞式，在 <head> 里，防深色闪白（非 module）
│   ├── app.js                  入口：装配、启动
│   ├── dates.js                日期工具（纯函数）✓ 已写
│   ├── store.js                ★ 唯一接触 localStorage 的文件
│   ├── model.js                数据操作（纯函数，含合并与统计聚合）
│   ├── state.js                状态容器与派生索引
│   ├── theme.js                主题解析与应用
│   └── views/
│       ├── banner.js           顶部横幅（数据安全提示，不可关闭）
│       ├── sheet.js            弹窗容器与内部页面栈
│       ├── calendar.js         月历网格
│       ├── day.js              某日列表 + 打卡详情
│       ├── pip-form.js         打卡流程（选模板 → 写备注 → 确定）
│       ├── templates.js        模板管理
│       └── settings.js         设置页
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-512-maskable.png
│   └── apple-touch-icon.png    180×180，iOS 不读 manifest 的图标
├── tests/
│   ├── dates.test.js           日期纯函数（含多时区）
│   ├── model.test.js           normalize / 合并 / 导出导入
│   ├── state.test.js           写操作与只读模式（注入假的 app 出口）
│   ├── store.test.js           存储层失败路径
│   └── calendar.test.js        色板一致性与点数量规则
├── tools/
│   ├── check-tz.js             多时区跑测试（文件名不能叫 test-*.js，见 10.4）
│   ├── serve.js                零依赖静态服务器（见 10.1）
│   └── stamp-sw.js             生成 sw.js 的 ASSETS 与 CACHE
└── docs/
```

**`tests/` 和 `tools/` 不进产物。** service worker 的预缓存清单由 `stamp-sw.js` 扫描 `css/ js/ icons/` 生成，不会包含它们。

**依赖方向是单向的**，不允许反向引用：

```
views/* ──→ state.js ──→ model.js ──→ store.js ──→ localStorage
   │            │           │
   └────────────┴───────────┴──→ dates.js（纯函数，谁都能用）
```

**`views/*` 之间不互相 import。** 需要跨视图跳转时通过 `state.js` 的意图（intent）机制，不直接调用对方。

---

## 3. 存储层

### 3.1 这是整个项目最重要的一条边界

**`store.js` 是唯一允许出现 `localStorage` 这个词的文件。** 其他任何文件出现它都算违规。将来换云同步时只改这一个文件，界面一行不用动。

对外接口**全部返回 Promise**，即使内部是同步的：

```js
// store.js 对外暴露
export async function load()                          // → LoadResult
export async function save(data)                      // → SaveResult
export async function loadPrefs()                     // → Prefs
export async function savePrefs(prefs)                // → SaveResult
export async function probe()                         // → { ok, reason }
export async function snapshotToBackup()              // 导入前手动兜底
```

### 3.2 key 布局

```
pip:v1:data     → 整个数据库 JSON
pip:v1:backup   → 上一次成功写入前的旧值
pip:v1:prefs    → 偏好与本地状态（主题、上次导出时间），与数据分开
```

**为什么 prefs 要分开**：主题偏好和上次导出时间都不是用户数据，不该进导出文件；数据损坏时也不该连带丢失。

**为什么加 `pip:v1:` 前缀**：localStorage 在同一 origin 下所有页面共享。GitHub Pages 上同账号的第二个项目会共享配额和 key 空间，不加前缀会撞。

### 3.3 读取

返回的四种状态，调用方必须全部处理：

```js
{ status: 'empty' }                    // 没有数据，首次打开
{ status: 'ok', data }                 // 正常
{ status: 'recovered', data, raw }     // 主 key 坏了或结构不对，从 backup 恢复成功
{ status: 'corrupt', raw }             // 主 key 和 backup 都不可用
```

判断「可用」**不能只看 `JSON.parse` 成不成功**，还要看解析出来的东西像不像我们的结构（`looksLikeData()`：至少有一个 `templates` 或 `pips` 数组）。

这一步是必须的，因为存在一种很隐蔽的失败：JSON 能解析、但不是我们的数据（手工改过，或者误存了别的 JSON）。如果把它当成空数据渲染，用户看到空日历、顺手点一下打卡，就会把原数据覆盖掉——**和 3.5 要防的是同一条链**。所以这种情况算损坏：保留原始字符串，不自动写回。

职责划分：`looksLikeData()` 判断「这是不是我们的数据」，`normalize()` 在确认是我们的数据之后补全缺字段、丢弃日期非法的记录。两者不能互相替代。

实现在 `store.js`，这里不再重复代码片段，避免两处漂移。

### 3.4 写入

```js
export async function save(data) {
  const rawMain = read(KEY_DATA);
  // 关键：只有当现有主值能解析时才把它挪进 backup。
  // 否则会用坏数据覆盖掉一份好的 backup。
  if (rawMain !== null && tryParse(rawMain)) {
    try { localStorage.setItem(KEY_BACKUP, rawMain); } catch {}
  }
  try {
    localStorage.setItem(KEY_DATA, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}
```

**写入策略**：数据很小（< 1MB），整块序列化约 1ms，所以**每次变更立即写，不做防抖**。唯一的例外是备注输入——按 PRD 7.4，备注在**失焦时**保存，不逐键保存。为避免用户打完字直接杀掉应用，还要在**弹窗关闭时**和 `visibilitychange`（页面隐藏）时补一次保存。

### 3.5 损坏保护：进入只读模式

**这是最容易造成不可逆数据丢失的地方。**

风险链条：主 key 解析失败 → 应用渲染成「空的」→ 用户看到一个空日历 → 顺手点一下打卡 → 触发 `save()` → 坏数据被真·空数据覆盖 → 永久丢失。

对策：`load()` 返回 `recovered` 或 `corrupt` 时，**应用进入只读模式**：

- 顶部常驻一条不可关闭的横幅：「数据读取异常，已暂停保存以免覆盖」
- 所有写入路径被 `state.readOnly` 拦掉（`save()` 前先检查）
- 横幅上有两个动作：`导出当前数据`（把 `raw` 原样导出，便于事后抢救）和 `用备份继续`（`recovered` 时才有）
- **绝不自动写回**。恢复必须由用户明确点按触发

`raw`（原始字符串）必须保留到用户做出选择，不能丢。

### 3.6 可用性探测

```js
export async function probe() {
  const k = 'pip:v1:__probe';
  try {
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'unavailable' };
  }
}
```

启动时跑一次。失败则显示「请勿在无痕模式使用，数据会丢失」。

**这个探测并不完整**：现代 iOS Safari 在无痕模式下**允许**写入 localStorage，只是退出浏览器即清空。探测抓不到这种情况，只能靠文案提示。不要以为 probe 通过就万事大吉。

```js
function isQuotaError(e) {
  return !!e && (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014
  );
}
```

### 3.7 容量测算

**为什么是 localStorage 而不是 IndexedDB**：算过账了。

一条 pip 的 JSON 大约 150 字节（`id`、`template_id`、`date`、`at`、`note`、`updated_at` 加上键名和标点）。因为一天可以重复打卡，按重度使用每天 10 条算：

```
10 条/天 × 365 天 × 150 字节 ≈ 550KB/年
```

localStorage 配额约 5MB，也就是大约 **33,000 条**记录。按 10 条/天能用约 9 年，按 5 条/天约 18 年。

结论：**够用，不需要 IndexedDB**。但这个测算直接推出一条约束和一条预警：

- **备注限 200 字**（见 4.4 的 `normalize`）。没有上限的话，一个爱写长备注的用户能单独吃掉一大块配额
- **导出提醒不只是防丢数据**，也是容量问题的早期预警。超过 30 天没导出就变红，见 PRD 7.6

真到卡顿或逼近配额时换 IndexedDB，只改本文件。

---

## 4. 数据模型

### 4.1 结构

```js
{
  version: 1,
  templates: [
    {
      id: "t_k3f9a2",              // 生成规则见 4.3
      title: "喝水",                // 必填，≤ 20 字
      icon: "💧",                   // emoji，可为空字符串
      color: "#4A8FBF",            // 必须是 10 色预设之一
      archived: false,             // 停用标记
      sort_order: 0,               // 越小越靠前
      created_at: 1790000000000,
      updated_at: 1790000000000
    }
  ],
  pips: [
    {
      id: "p_m7x1b5",
      template_id: "t_k3f9a2",
      date: "2026-09-22",          // 本地时区 YYYY-MM-DD
      at: 1790012340000,           // 打卡时刻，用于当天内排序
      note: "开会前灌了一杯",         // 可为空，≤ 200 字
      updated_at: 1790012340000
    }
  ]
}
```

### 4.2 `date` 和 `at` 为什么都要存

- `date` 用于按天分组渲染日历。它是**在打卡那一刻用本地时区算好的字符串**，之后永远不变，不受时区影响
- `at` 用于同一天内的排序（列表按时间正序）

只用 `at` 反推日期会掉进时区陷阱（`toISOString()` 按 UTC 输出，东八区凌晨 00:00–07:59 之间会把日期算成**前一天**）。只用 `date` 则同一天的多条记录无法排序，也显示不出「14:30」这个时间。

### 4.3 id 生成

```js
function newId(prefix) {
  // crypto.randomUUID 在 iOS 15.4+ 可用，目标环境满足
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
```

用 `crypto.randomUUID()` 而不是时间戳或 `Math.random()`：id 要保证跨设备合并时不冲突，时间戳在快速连续打卡时会撞。

### 4.4 `normalize(data)`

每次从存储或导入读入后都过一遍，做防御性修补：

```js
function normalize(raw) {
  const templates = Array.isArray(raw?.templates) ? raw.templates : [];
  const pips = Array.isArray(raw?.pips) ? raw.pips : [];
  return {
    version: 1,
    templates: templates.map(t => ({
      id: String(t.id ?? newId('t')),
      title: String(t.title ?? '').slice(0, 20),
      icon: String(t.icon ?? ''),
      color: PRESET_COLORS.includes(t.color) ? t.color : PRESET_COLORS[0],
      archived: Boolean(t.archived),
      sort_order: Number.isFinite(t.sort_order) ? t.sort_order : 0,
      created_at: Number(t.created_at) || Date.now(),
      updated_at: Number(t.updated_at) || Date.now(),
    })),
    pips: pips.map(p => ({
      id: String(p.id ?? newId('p')),
      template_id: String(p.template_id ?? ''),
      date: isDateKey(p.date) ? p.date : null,     // 见下
      at: Number(p.at) || Date.now(),
      note: String(p.note ?? '').slice(0, 200),
      updated_at: Number(p.updated_at) || Date.now(),
    })).filter(p => p.date !== null),              // date 非法则丢弃这条
  };
}
```

`isDateKey` 用正则 `/^\d{4}-\d{2}-\d{2}$/` 加一次真实的 `Date` 往返校验（拒绝 `2026-02-30`）。`date` 是唯一的排序与分组依据，非法就无法定位，只能丢弃——这是 normalize 里唯一的破坏性操作，所以要记一条日志（见 11.4）。

**无法解析的 `template_id` 不丢弃。** 保留记录，渲染时用灰色圆点 + 「未知模板」兜底。孤儿记录只在手工编辑或损坏的导入文件里出现，静默删除会丢数据。

### 4.5 版本迁移

现在 `version: 1`，没有历史版本。但**钩子要先留好**：

```js
function migrate(data) {
  // 将来：while (data.version < CURRENT) { data = MIGRATIONS[data.version](data); }
  return data;
}
```

`load()` 和 `import()` 都要过 `migrate()`。因为还没有任何真实数据，现在不需要写任何迁移函数。

---

## 5. 日期工具（`dates.js`）

全部是纯函数，全部有断言覆盖。**这个文件是时区 bug 的唯一可能来源，所以要写得非常保守。**

### 5.1 本地日期字符串

```js
// ★ 唯一允许的「Date → YYYY-MM-DD」方式
export function toDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

**禁止 `toISOString().slice(0, 10)`。** 它按 UTC 输出，只要本地时间与 UTC 不在同一天就会错：

- **东八区（UTC+8）**：本地 **00:00–07:59** 算成**前一天**
- **纽约（UTC-5/-4）**：本地 **20:00–23:59** 算成**后一天**
- **UTC+14**：本地 00:00–13:59 都错

错误窗口随偏移变化，所以**不要靠记忆判断哪个时段危险**——`npm run test:tz` 会在五个时区下把当前时区的窗口直接打印出来。这是 AGENTS.md 里的硬约束，也是验收标准第 12 条。

### 5.2 周一起始的列偏移

```js
// getDay(): 0=周日, 1=周一 ... 6=周六
// 需要:     0=周一, 1=周二 ... 6=周日
export function weekdayIndex(d) {
  return (d.getDay() + 6) % 7;
}
```

**不要直接拿 `getDay()` 当列索引**，那样日历会从周日开始排。

### 5.3 月份网格

```js
// 固定 6 行 × 7 列 = 42 格。固定行数是为了切换月份时高度不跳动。
export function buildMonthGrid(year, month /* 1-12 */) {
  const lead = weekdayIndex(new Date(year, month - 1, 1));
  const todayKey = toDateKey();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    // JS 会自动归一化越界的日期，1 - lead 为负或 31 + n 超界都正确
    const d = new Date(year, month - 1, 1 - lead + i);
    const key = toDateKey(d);
    cells.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1,
      isToday: key === todayKey,
    });
  }
  return cells;
}
```

用 `new Date(y, m, d)` 传本地分量而不是算毫秒偏移：跨月、跨年、闰年都由引擎处理，不需要自己算。中国没有夏令时，但即使有，这种构造方式也是安全的（不会出现「加 86400000 毫秒结果还是昨天」的问题）。

### 5.4 跨午夜

`todayKey` 会过期。如果用户晚上打开应用放着不动，过了午夜后「今天」还是昨天。对策：

- **每次渲染前重新计算 `todayKey`**，不缓存在模块顶层
- 监听 `visibilitychange`，页面重新可见时若 `toDateKey() !== state.todayKey`，则更新并重渲染

### 5.5 格式化

```js
export function formatMonth(year, month)   // → "2026年9月"（月份不补零）
export function formatDayLabel(key)        // → "9月22日 周二"
export function formatTime(ts)             // → "14:30"（24 小时制，补零）
export function formatRelativeDays(ts)     // → "12 天前" / "昨天" / "今天"
```

`formatRelativeDays` 按**本地日历日**相减，不是按毫秒除：今天 00:30 和昨天 23:30 只差 1 小时，但应该显示「昨天」。

天数差用 `Date.UTC(y, m - 1, d)` 只作用于**年月日分量**算出精确的整数天序号。**不能直接相减两个本地午夜的 Date**——在有夏令时的时区那会得到 23 或 25 小时，再除以 86400000 取整就会错一天。

### 5.6 日期范围过滤：靠字符串字典序

`DateKey` 是零填充的 `YYYY-MM-DD`，所以范围过滤**直接比字符串**，不需要解析成 Date：

```js
const { start, end } = monthRange(2026, 9);   // { start: '2026-09-01', end: '2026-09-30' }
const thisMonth = state.data.pips.filter((p) => inRange(p.date, start, end));
```

这是正确的，因为零填充保证跨月和跨年都成立：

```
'2026-09-30' < '2026-10-01'   ✓  '09' < '10'
'2026-12-31' < '2027-01-01'   ✓
```

**这也是 `DateKey` 必须零填充、不能写成 `2026-9-22` 的原因**——一旦不补零，`'2026-9-30' < '2026-10-01'` 就变成 `'9' > '1'`，范围过滤会静默漏数据。这条性质在统计里会被大量用到（见 6.5）。

`monthRange` 的月末用 `new Date(year, month, 0)`（下个月的第 0 天）算，闰年和月份长度都由引擎处理。

---

## 6. 状态与渲染

### 6.1 状态容器

```js
// state.js
const state = {
  data: { version: 1, templates: [], pips: [] },
  prefs: { theme: 'system' },
  readOnly: false,          // 见 3.5
  view: { year: 0, month: 0 },   // 当前浏览的月份
  todayKey: '',
  ui: { stack: [] },        // sheet 内部页面栈
};

// 派生索引，数据变更时重建
let index = { byDate: new Map(), byTemplate: new Map(), pipsByTemplate: new Map() };

export function reindex() {
  index.byDate = new Map();
  index.pipsByTemplate = new Map();
  for (const p of state.data.pips) {
    if (!index.byDate.has(p.date)) index.byDate.set(p.date, []);
    index.byDate.get(p.date).push(p);

    if (!index.pipsByTemplate.has(p.template_id)) index.pipsByTemplate.set(p.template_id, []);
    index.pipsByTemplate.get(p.template_id).push(p);
  }
  for (const list of index.byDate.values()) list.sort((a, b) => a.at - b.at);
  index.byTemplate = new Map(state.data.templates.map((t) => [t.id, t]));
}
```

**索引只重建一次，不在渲染里重复过滤。** 渲染当月是 42 次 Map 查表，不是 42 次数组遍历。

`pipsByTemplate`（模板 id → 该模板的所有 pip）现在是**空的用途**，是为统计预留的（见 6.5）。提前建好它是因为它和 `byDate` 是同一趟遍历，加上去几乎零成本；等到做统计时再补，就得回头改这个函数。

### 6.2 渲染模型

没有虚拟 DOM，没有响应式系统。规则：

1. 事件处理器修改 `state`
2. 调用 `save(state.data)`（立即，除备注外）
3. 调用 `reindex()`（仅数据变更时）
4. 调用受影响视图的 `render()`——**不是全量重渲染**

```js
// 打卡后只重绘那一天的格子，让 pip 出现动画落在正确的元素上
await addPip(templateId, dateKey, note);
reindex();
calendar.renderCell(dateKey);
```

只有三种情况全量重渲染：月份切换、主题切换、数据整体替换（导入）。

### 6.3 日历格子的点

实现在 `views/calendar.js` 的 `dotsForDay()`，返回**分行**的结果（`{ rows, overflow }`）而不是一个扁平数组——分行不能让 CSS 自动换行来做，因为那样 6 个点会排成 5 + 1，第二行孤零零一个，而 3 + 3 整齐得多。

规则（完整推导见 PRD 7.1）：

| 记录数 | 显示 |
|---|---|
| 1–5 | 一行 |
| 6–8 | 两行，均分 |
| > 8 | 两行 5 + 3，第二行末尾 `+N`（`+N` 用 10px：11px 的两位数会溢出） |

两个宽度约束是实测出来的，不是估的：

- 一行 5 个点占 **43px**（5×7 + 4×2），iPhone 14 / 390px 屏的格子内宽 47.2px，余 2.1px；6 个要 52px。这是每行 5 个的上限来源
- `+N` 要占宽度，**4 个点加文字是 55.2px**（溢出 8px），所以有溢出时第二行退到 3 个点 + 文字（**46.2px**，余 1px）
- 行间距（点之间和两行之间）都是 2px，**不能改成 3px**：5 个点会变成 47px，只剩 0.1px

尺寸按 **iPhone 14（390×844）** 定，这是支持范围内最小的机型。320px 之类的窄屏放不下 7px 的点（PRD 9.4）。

**点区在 DOM 里始终存在**，即使没有点（`buildDots()` 总是返回容器）。容器高度固定为两行，这样日期数字不会随点行数上下浮动——两行点时偏差有十几像素。去掉这个占位就会看到数字没对齐。

### 6.4 文本安全

**唯一真实的 XSS 入口是用户输入的标题和备注。** 硬规则：

- 所有用户文本一律用 `el.textContent = value`
- **禁止** `innerHTML`、`insertAdjacentHTML`、`outerHTML` 拼接用户数据
- 静态结构可以用 `innerHTML` 写模板字符串，但其中不得插值任何用户数据

虽然数据只在自己设备上、攻击面很小，但「备注里粘一段 HTML 把界面搞乱」是很容易发生的自伤，成本也就一行代码。

### 6.5 统计（将来的扩展，现在不实现）

统计**不落库**。这是本节唯一必须现在就守住的约定。

**不要**给 template 加 `count` 字段，也不要存一张 `stats` 表。理由：它会引入一致性 bug——计数器和真实 pips 可能漂移，而漂移之后没有任何机制能发现它。这和「日期记错一天」「坏数据被覆盖」是同一类**静默错误**，是这个应用最不能承受的。

**一律读时计算。** 数据规模完全没问题：就算到配额上限 33,000 条（见 3.7），一趟聚合也是毫秒级。

注意区分两件事：**内存里的派生索引可以随便建**（6.1 的 `byDate` / `pipsByTemplate`），因为它不持久化，每次 `reindex()` 都从真实 pips 重建，不存在漂移。不能接受的是把派生结果**写进存储**。

各类统计的落地方式：

| 统计形态 | 做法 |
|---|---|
| 累计笔数 / 天数 | 一趟 reduce，无索引也够 |
| 热力图（一年密度） | **复用日历网格**：`buildMonthGrid` 的同一套「日期 → 格子」映射，换一个颜色取值函数。不需要新组件 |
| 按模板分布 | `pipsByTemplate` 取长度，横条用 CSS 宽度，不需要 SVG |
| 趋势折线 / 柱状 | 手写 SVG。只有需要坐标轴、tooltip、缩放时才考虑引图表库 |

**图表库是独立于框架的另一个决定**，别和 1.2 捆在一起：Chart.js 是命令式的（给它一个 DOM 节点和数据，它自己画），React 和原生用起来一样，框架不帮忙。约 60KB gzip，真需要时单独评估。

**技术上是简单的那一半，难的是产品那半边。** 习惯类应用的统计极容易滑向「完成率」「连续天数」「比上月少 12%」，而那些正是本产品明令禁止的东西（见 PRD 第 2、4 节）。**做统计之前先想清楚「什么样的统计不制造压力」，再动手写代码。**

---

## 7. 导航与弹窗

### 7.1 一个 sheet 容器 + 内部页面栈

只有**一个** `<div class="sheet">` 元素，内部是一个页面栈。页面是：

```
day-list        某日记录列表
pip-detail      打卡详情
pip-create      打卡流程（带目标日期参数）
template-list   模板列表
template-edit   模板新建/编辑
```

从底部工具栏进入：push `template-list` 或 `pip-create`（目标日期 = 今天）。
从日历点某天：push `day-list`，它内部可以再 push `pip-detail` 或 `pip-create`（目标日期 = 那一天）。

**为什么用一个容器而不是多个堆叠的 sheet**：多个 sheet 叠加要处理 z-index、遮罩层数、滚动穿透，而且视觉上会层层叠高。单容器 + 页面栈没有这些问题，视觉上也永远是「一层弹窗」。

**栈行为**：

- 栈深 > 1 时，header 左侧出现 `‹` 返回
- `✕`、点遮罩、`Escape`、Android 返回键都关闭**整个栈**
- 页面切换用 180ms `ease-out` 的横向位移 + 淡入
- 关闭时清空栈

**没有下滑关闭**（原来有，改成居中卡片之后去掉了）：卡片居中、高度随内容（下限 40vh / 上限 min(68vh, 72dvh)），往下拖既关不掉也没有可展开的内容。顶部那条 38×5px 的横条因此只是装饰。

### 7.2 Android 返回键

PWA 里没有路由，Android 的返回键默认会**退出应用**，用户想关弹窗却退出了。对策：每次 push 时 `history.pushState({ pipSheet: 栈深 }, '')`，`popstate` 时把栈同步回去；栈空时再按返回才真的退出。

这个必须做，否则 Android 上体验是坏的。桌面浏览器的浏览器返回键也顺带正确了。

**关键设计：`popstate` 的处理从 `history.state` 读出目标深度，而不是数「该忽略几次」。**

第一版用的是「我们自己调 `history.go(-n)` 时，忽略接下来 N 次 popstate」这种计数器，它有个致命问题：`history.go()` 是异步的，中间还可能夹杂别的历史事件，计数器一旦和实际到达的 popstate 数量对不上就**永久错位**——要么该忽略的没忽略（面板莫名其妙关掉），要么该响应的被吃掉（返回键失灵）。

改成从 `history.state.pipSheet` 读出「浏览器认为现在该有多深」，然后把栈调整到那个深度：

```js
function syncToDepth(wanted) {
  const target = Math.max(0, Math.min(wanted, stack.length));
  while (stack.length > target) stack.pop();
  if (stack.length === 0) { if (!closing) hidePanel(); return; }
  renderStack('back');
}
```

这是**自纠正**的：多退的层会补上，多余的 popstate 是空操作。副作用是 `closeAll()` 里也不需要设「忽略一次」了——`history.go(-layers)` 落回基础记录后 `history.state` 里没有 `pipSheet`，目标深度是 0，而此时栈已经是空的，天然是空操作。

### 7.3 焦点管理

弹窗打开时：

1. 记录当前 `document.activeElement` 作为返回目标
2. 焦点移到**面板容器本身**（它带 `tabindex="-1"` 和 `aria-labelledby`）。不要聚焦第一个按钮：那样读屏只念「关闭按钮」，用户不知道打开的是什么；聚焦容器会先念出「对话框 + 标题」
3. 焦点循环限制在面板内（`Tab` / `Shift+Tab` 不逃出）——不限制的话焦点会跑到背后的日历上，而用户看不见那里

关闭时焦点回到第 1 步记录的元素。

### 7.4 一个容易踩的实现细节

写完才发现的，记在这里：

- **关闭动画的定时器必须能取消。** 关闭用 240ms 的 `setTimeout` 收尾（藏元素、清空栈），如果用户在动画跑完前又打开了面板，那个定时器会在打开之后触发，把刚打开的面板又藏掉。所以 `showPanel()` 里先 `clearTimeout`。

> 原来还有两条和「下滑关闭」有关的坑：拖拽结束时要先复位位移再决定关不关（反过来写的话，`closeAll()` 在栈已空时会提前返回，那个 `translateY` 就永久留在元素上了），以及 `setPointerCapture()` 要包 try/catch（指针在两次事件之间已经释放时它会抛）。
>
> 改成居中卡片时那套手势整个删掉了，坑也就不存在了。记在这里只是免得将来重新加手势时又踩一遍。

---

## 8. PWA

### 8.1 manifest

```json
{
  "name": "Pip",
  "short_name": "Pip",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#FBFBFA",
  "theme_color": "#FBFBFA",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-512-maskable.png", "sizes": "512x512",
      "type": "image/png", "purpose": "maskable" }
  ]
}
```

`name` 和 `short_name` 都是 `Pip`——三个字母，iOS 图标下不会截断。

`start_url` 和 `scope` 用**相对路径** `./`，不能用 `/`。因为 GitHub Pages 是 `summersover.github.io/PipPip/` 这种带路径前缀的形式，写 `/` 会指向域名根而不是项目。

**maskable 图标**：Android 上图标会被裁成圆形/方形/水滴形。maskable 版本的图形必须落在中心 80% 的「安全区」内，否则边缘会被切掉。内容就是一个居中的圆点。

**iOS 不读 manifest 里的 icons**，必须另外提供：

```html
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
```

`apple-touch-icon.png` 是 180×180，且**不能有透明通道**（iOS 会把透明区域填黑）。

### 8.2 主题与首屏闪白

深色模式下如果等 JS 跑完再设主题，用户会看到一帧白屏。对策：在 `<head>` 里同步加载一个极小的非 module 脚本：

```html
<meta name="color-scheme" content="light dark">
<script src="./js/theme-boot.js"></script>
```

```js
// js/theme-boot.js — 必须是同步阻塞的，且不能是 module（module 默认 defer）
(function () {
  var theme = 'light';
  try {
    var prefs = JSON.parse(localStorage.getItem('pip:v1:prefs') || '{}');
    var pref = prefs.theme || 'system';
    theme = pref === 'dark' ||
      (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark' : 'light';
  } catch (e) { /* 用默认值 */ }
  document.documentElement.dataset.theme = theme;
})();
```

**关键设计：`data-theme` 永远只存解析后的结果（`light` / `dark`），不存偏好（`system`）。** 偏好存在 `pip:v1:prefs` 里，由 `theme.js` 负责解析。这样 CSS 只需要两条规则：

```css
:root, :root[data-theme="light"] { /* 浅色令牌 */ }
:root[data-theme="dark"]         { /* 深色令牌 */ }
```

不需要处理 `prefers-color-scheme` 与 `data-theme` 的交叉组合。

`theme.js` 在偏好为 `system` 时监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件，重新解析并更新 `data-theme`。

### 8.3 service worker

`sw.js` 里**只有预缓存清单和缓存名是生成的**，其余逻辑手写：

```js
// >>> generated: assets
const CACHE = 'pip-9aa4904e';
const ASSETS = [
  './',
  './css/app.css',
  './js/theme-boot.js',
  './js/app.js',
  './js/dates.js',
  // …由 tools/stamp-sw.js 扫描实际文件生成，见 8.4
];
// <<< generated: assets
```

**策略**：

- 安装时预缓存 `ASSETS`（`cache.addAll`，任一失败则安装失败——这是好事，能立刻发现漏文件）
- fetch 时对**同源 GET** 用 cache-first，未命中则走网络并顺手写进缓存（运行时缓存兜底，防止漏加文件导致离线崩）
- `activate` 时删除所有名字不等于 `CACHE` 的缓存

**更新流程必须写对，否则推送新版本用户还是旧的，会被误判成部署失败**：

```js
// app.js
const reg = await navigator.serviceWorker.register('./sw.js');

function notifyUpdate(worker) {
  // 显示「有新版本，点击刷新」
  banner.onClick = () => {
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
}

if (reg.waiting) notifyUpdate(reg.waiting);
reg.addEventListener('updatefound', () => {
  const sw = reg.installing;
  sw.addEventListener('statechange', () => {
    if (sw.state === 'installed' && navigator.serviceWorker.controller) {
      notifyUpdate(sw);   // controller 存在说明这是更新，不是首次安装
    }
  });
});

navigator.serviceWorker.addEventListener('controllerchange', () => {
  location.reload();      // 只 reload 一次，见下
});
```

```js
// sw.js
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
```

两个必须注意的点：

1. **绝不自动调用 `skipWaiting()`。** 如果新 SW 在用户正开着应用时接管，已加载的旧页面会和新的缓存内容不一致，可能直接崩。必须等用户点「刷新」
2. `controllerchange` 的 reload 要用一个标志位保证只执行一次，否则可能循环刷新

### 8.4 缓存名和预缓存清单都由脚本生成

**不要手改 `CACHE` 和 `ASSETS`。** 这两样必须和实际文件严格一致，而手工维护正是最容易出错的环节：

- 忘了改 `CACHE` → 用户永远拿不到新版本，而且会被误判成部署失败
- 漏加文件进 `ASSETS` → 用户离线时崩

两件事都很难在开发时发现，所以交给 `tools/stamp-sw.js`：

```bash
npm run stamp              # 重新生成
npm run stamp -- --check   # 只校验，过期则非零退出（提交前 / CI 用）
```

做法：扫描 `css/` `js/` `icons/` 和根目录的 `index.html`、`manifest.webmanifest`，对**路径 + 内容**算 sha256，取前 8 位作为 `CACHE = 'pip-<hash>'`，同时生成 `ASSETS` 数组。内容变了哈希就变，缓存名自动失效——版本号不需要任何人记得去改。

`sw.js` 里被重写的部分用哨兵注释圈出，**其余内容（SW 逻辑）原样保留**，所以 `sw.js` 仍然是可读、可手改的源文件，不是构建产物：

```js
// >>> generated: assets
const CACHE = 'pip-9aa4904e';
const ASSETS = [ /* … */ ];
// <<< generated: assets
```

零依赖，只用 `node:fs` / `node:crypto` / `node:path`。

**它不会把 `tests/` 和 `tools/` 加进缓存**——那两个目录不在扫描范围内，也不该进产物。

### 8.5 存储持久化

```js
if (navigator.storage?.persist) {
  navigator.storage.persist();   // 尽力而为，不保证成功
}
```

iOS 基本不理会这个调用，但仍要请求——Android Chrome 上它会显著降低被清理的概率。iOS 的清理问题靠「必须添加到主屏幕」解决（主屏幕应用被豁免，见 PRD 5）。

---

## 9. 导出与导入

### 9.1 导出格式

```json
{
  "app": "pip",
  "version": 1,
  "exportedAt": "2026-09-22T14:30:00+08:00",
  "data": { "version": 1, "templates": [], "pips": [] }
}
```

外壳的 `app` / `version` 用于导入时校验。`exportedAt` 是时间戳，用带时区偏移的 ISO 字符串是正确的（这里不受 `toISOString` 陷阱影响，因为它不是日期 key，不需要和日历对齐）。

文件名：`pip-2026-09-22.json`（本地日期）。

```js
const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement('a'), { href: url, download: filename });
a.click();
URL.revokeObjectURL(url);
```

**iOS 的注意点**：`download` 属性在 iOS Safari 13+ 可用，但行为是弹分享面板而不是直接存文件。文案上要说「导出后请保存到文件」，不能让用户以为点了就安全了。

### 9.2 导入流程

```
选文件 → 读文本 → 校验 → 选模式 → 自动备份当前数据 → 写入 → 重渲染
```

校验：

```js
if (payload?.app !== 'pip') return fail('这不是 Pip 的导出文件');
if (!KNOWN_VERSIONS.includes(payload.version)) return fail(`不支持的版本：${payload.version}`);
if (!payload.data) return fail('文件内容不完整');
```

失败时**明确说明原因**，不要静默忽略（PRD 11 节）。

**导入前必须把当前数据写进 `pip:v1:backup`**（调用 `snapshotToBackup()`）。用户选了「覆盖」结果选错文件，是唯一能一次毁掉全部数据的操作，必须留退路。

### 9.3 合并算法

```js
function mergeById(local, incoming) {
  const map = new Map();
  for (const item of [...local, ...incoming]) {
    const prev = map.get(item.id);
    // 时间戳相同则保留本地（先写入的），避免无意义地改动本地数据
    if (!prev || (item.updated_at ?? 0) > (prev.updated_at ?? 0)) {
      map.set(item.id, item);
    }
  }
  return [...map.values()];
}

export function mergeData(local, incoming) {
  return {
    version: 1,
    templates: mergeById(local.templates, incoming.templates)
      .sort((a, b) => a.sort_order - b.sort_order),
    pips: mergeById(local.pips, incoming.pips),
  };
}
```

因为每条 pip 和 template 都有独立 id，合并规则是明确的：按 id 取并集，同 id 冲突取 `updated_at` 较新者。这就是每条记录都带 `updated_at` 的用途。

**已知语义漏洞**：并集无法传播「删除」。A 设备删掉的一条记录，在 B 设备上仍然存在，合并时会回来。接受这个漏洞，因为纪律是「同一时间只在一台设备上打卡」，换设备时应该用「覆盖」而不是「合并」。

---

## 10. 本地开发

### 10.1 必须走 HTTP

**不能用 `file://` 打开 `index.html`。** 两个原因：

1. ES modules 在 `file://` 下被 CORS 拦住，一个都加载不了
2. service worker 只在安全上下文（HTTPS 或 `localhost`）里工作

```bash
npm run serve          # 等价于 node tools/serve.js，默认 8000 端口
node tools/serve.js 8080
```

然后开 `http://localhost:8000`。

**为什么自己写一个服务器而不是用 `python -m http.server`**：Windows 上 `python`
常常只是 Microsoft Store 的占位程序，运行它只会跳应用商店。而「起一个服务器」
是这个项目里绕不过的步骤（上面两条原因），不该依赖一个可能不存在的解释器。
`tools/serve.js` 零依赖，只用 `node:http`，另外会打印局域网地址方便用手机打开。

> 手机走局域网 HTTP 时 **service worker 不会注册**（局域网 IP 不是安全上下文）。
> 手机上验 PWA 必须走 HTTPS 或 `localhost`。

### 10.2 origin 隔离（容易踩）

`file://`、`localhost:8000`、`localhost:5000`、线上的 `github.io` 是**四个独立的 origin**，localStorage 互不相通。本地测试的数据不会出现在线上，线上数据也不会出现在本地。不要为此困惑。

同一个原因：**换了端口号就是换了 origin，数据就没了**。调试时固定用一个端口。

### 10.3 调试 service worker

service worker 缓存极顽固，改完代码看不到效果是常态：

- DevTools → Application → Service Workers → 勾 **Update on reload**
- 改完 `sw.js` 或 `CACHE` 版本号后，勾 **Bypass for network** 或直接 **Unregister** 再刷新
- 测离线：Application → 勾 **Offline**，然后刷新
- **普通刷新不算数。** 只改了 `css/app.css` 而没跑 `npm run stamp`，`CACHE` 名（8.4）没变，浏览器不认为 SW 有新版本，旧缓存继续发旧文件；就算跑了 `stamp`，新 SW 也会停在 waiting（8.3 第 1 点不自动 `skipWaiting`），当前页面仍由旧 SW 供旧缓存。实测过一次：改完 `.sheet-body` 的 margin / padding 后普通刷新，读到的仍是 `margin-top: -52px`（旧 CSS）
- 所以「改完看不到变化」的第一处理是：关掉该 origin 的**所有**标签页再打开（或 Unregister / 勾 Update on reload），不要连着改第三遍代码
- 典型症状：弹窗顶部横条下方有一道灰影、或横条和标题的白色底看着像「拼接」的——那是半透明 header 那版旧 CSS，不是当前的样式表

### 10.4 测试

用 Node 内置的测试运行器，零依赖。测试文件放 `tests/`，用 `node:test` + `node:assert/strict`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { toDateKey, buildMonthGrid } from '../js/dates.js';

test('toDateKey 在一天中的任何本地时刻都给出同一个日期', () => {
  for (let h = 0; h < 24; h++) {
    assert.equal(toDateKey(new Date(2026, 8, 22, h, 30)), '2026-09-22');
  }
});
```

```bash
npm test          # 单次
npm run test:tz   # 在 5 个时区下各跑一遍 ← 关键
```

#### 为什么必须多时区跑

`dates.js` 的全部风险就是时区。单跑一次只能证明它**在你当前时区**是对的，而「本机通过、用户那边记错一天」正是这类 bug 的典型形态。

`tools/check-tz.js` 在 Asia/Shanghai、UTC、America/New_York、Pacific/Kiritimati（UTC+14）、Pacific/Midway（UTC-11）各跑一遍。跑多时区不是「覆盖时区分支」，而是要证明 `dates.js` **根本不依赖时区**——它只用本地分量方法。

**三个实测出来的坑**（都踩过，写在这里省得再踩）：

1. **`TZ=Asia/Shanghai node ...` 这种命令行写法在 Git Bash 下不生效。** `process.env.TZ` 会是 `undefined`，时区静默回落到系统值——于是「多时区测试」假装在测，实际五个时区跑的是同一个。Windows cmd 下 `TZ=x cmd` 同样不生效。**必须用 `spawnSync` 显式传 env**，`check-tz.js` 就是这么做的。
2. **`tools/` 下的脚本不能叫 `test-*.js`。** Node 的测试运行器默认会把 `test-*.js` 当成测试文件自动抓取，那样 `check-tz.js` 会被嵌套执行一遍（在 `node --test` 里再 spawn 五个 `node --test`）。所以它叫 `check-tz` 而不是 `test-tz`，并且 `tests/` 下的文件是显式列出来传给 `--test` 的，不靠自动发现。
3. **`--test` 的路径参数不能带通配符（Node 20）。** 通配符路径是 Node 21+ 才认的，20 上 `node --test "tests/**/*.test.js"` 直接报 `Could not find ...`——五个时区一起变红，看着像时区逻辑崩了，其实只是参数没被识别。所以 `npm test` 传的是目录（`node --test tests/`），`tools/check-tz.js` 用 `readdirSync` 把 `tests/` 下的 `*.test.js` 列成显式路径。

#### 时区断言要「从偏移推导」，不要硬编码时刻

第一版测试里写了「本地 12:30 是安全时刻」作为对照，结果在 UTC+14 下挂了——那里本地 12:30 仍然落在 UTC 的前一天。**任何「几点是安全的」这种硬编码都取决于偏移**，换个时区就错。

正确写法是遍历一天里所有时刻，找出两种写法分歧的窗口，再断言窗口的**方向**（正偏移退回前一天、负偏移跳到后一天）和**连续性**（一天里只有一个窗口）。这样在任何时区下都能过，还会把当前时区的窗口打印出来：

```
偏移 +8h → toISOString 的错误窗口：本地 00:00–07:59
偏移 -4h → toISOString 的错误窗口：本地 20:00–23:59
```

#### 测什么，不测什么

**必须覆盖**（错了都是静默错数据）：

- `dates.js` 全部纯函数——跨午夜、跨月跨年、闰年、周一起始、42 格网格、字典序范围过滤
- `model.js` 的 `mergeById`——同 id 取 `updated_at` 较新者，相同则保留本地

**不需要覆盖**：视图渲染和 DOM 操作。那些错误看得见，测试成本换不来收益。

**没有测试框架不代表不测。** 上面这两组逻辑一旦错就是静默错数据，必须有断言兜住。跑一次的成本是一条命令。

---

## 11. 错误处理

### 11.1 错误分类与对策

| 情况 | 检测 | 对策 |
|---|---|---|
| 存储不可用（禁用 / 无痕） | `probe()` 启动时 | 常驻横幅「请勿在无痕模式使用，数据会丢失」，仍允许使用 |
| 配额写满 | `save()` 返回 `reason: 'quota'` | 横幅「存储写入失败，请立即导出备份」 |
| 主 key 损坏 | `load()` 返回 `recovered` / `corrupt` | 进入只读模式（3.5），绝不自动写回 |
| 导入文件不合法 | 校验 `app` / `version` | 明确说明原因，不改动现有数据 |
| 无启用中的模板时打卡 | 模板列表全为空或全停用 | 打卡弹窗显示空状态 + 「新建模板」 |
| service worker 注册失败 | `register()` 抛错或 reject | 静默降级——应用照常能用，只是没有离线能力。不要弹错给用户 |

### 11.2 横幅优先级

同时只显示一条，按严重度取最高：

```
数据损坏（只读）40 > 存储写入失败 30 > 无痕模式警告 20 > 有新版本 10
```

**横幅必须能被撤掉，而且要按 kind 匹配地撤**（`clearBanner(kind)`）。横幅没有自动消失的机制，所以两个地方必须主动清：

- 用户点了「用备份继续」之后要撤掉损坏那条——否则「主数据读取失败，现在显示的是备份内容」会一直挂着，而它已经不成立了
- 写入成功之后要撤掉配额那条

按 kind 匹配是为了避免顺手把更严重的那条一起撤掉：写成功一次不该把「数据损坏」也清掉。

### 11.3 绝不静默失败

所有 `catch` 要么给用户可见反馈，要么至少 `console.warn` 带上上下文。唯一允许完全静默的是 `snapshotToBackup()` 里的失败——因为它本身就是尽力而为的兜底，失败时主流程仍会执行，弹提示反而会打断。

### 11.4 日志

不做埋点、不上报。只在 `console` 里留一条环形缓冲，记录最近 50 条关键事件（加载状态、写入失败、normalize 丢弃的记录数），供用户导出问题时附上：

```js
const log = [];
function logEvent(kind, detail) {
  log.push({ t: Date.now(), kind, detail });
  if (log.length > 50) log.shift();
}
```

`normalize` 丢弃非法 `date` 的记录时，必须 `logEvent('normalize:drop', { id, date })`——这是唯一的破坏性操作，要留痕。

---

## 12. 性能

数据量小（见 3.7：约 33,000 条记录才到配额），所以不做过度优化。要守住的是三条：

| 指标 | 目标 | 手段 |
|---|---|---|
| 首屏（已装到主屏幕） | < 1s | service worker 缓存全部资源，无网络请求 |
| 月份切换 | < 16ms（不掉帧） | 42 次 Map 查表，不做数组遍历 |
| 打卡后反馈 | 立即 | 只重绘当天那一格，不等全量渲染 |

**明确不做的优化**：虚拟列表、增量渲染、Web Worker、请求合并。数据规模远够不上。

**要留意的**：`reindex()` 是 O(n)，每次数据变更跑一次。n = 记录总数，一万条也是毫秒级。但如果将来出现「每敲一个字就 save + reindex」的路径，那就错了——备注按 PRD 是失焦保存，天然避开了这个问题。

---

## 13. 部署

### 13.1 GitHub Pages 配置

- 仓库 **public**（免费账户只能从公开仓库发布 Pages）
- Settings → Pages → Source: **Deploy from a branch** → `main` / `/(root)`
- 根目录放 `.nojekyll`，禁用 Jekyll 处理（避免它扫描、忽略某些文件、拖慢部署）
- HTTPS 由 Pages 自动提供，service worker 依赖它

**仓库**：`https://github.com/Summersover/PipPip.git`，站点地址因此是 `https://summersover.github.io/PipPip/`。**这个 origin 定死了不要再换**（见 13.3）。

```bash
git remote add origin https://github.com/Summersover/PipPip.git
git push -u origin main
```

**仓库名**：不要叫 `pip`——会和 Python 的 pip 撞搜索污染，所以在 `pip-app` / `getpip` 里挑，最终定的是 `PipPip`。

### 13.2 所有路径必须相对

因为站点在 `summersover.github.io/PipPip/` 下，**绝对路径 `/js/app.js` 会指向域名根，404**。所有引用用 `./`：

```html
<script type="module" src="./js/app.js"></script>
<link rel="stylesheet" href="./css/app.css">
```

manifest 的 `start_url` / `scope` 同理。

### 13.3 域名不可逆

**用了 `github.io/仓库名/` 形式后就不要再绑自定义域名。** 换域名 = 换 origin = 旧数据读不到（数据还在浏览器里，但应用够不着）。域名一旦发出去就定死，这是整个方案里最不可逆的决定。

### 13.4 部署清单

每次部署前先跑一条命令：

```bash
npm run check   # 类型检查 + 5 个时区跑测试 + 校验 sw.js 生成区域是否过期
```

然后核对：

- [ ] `npm run check` 通过（含 `stamp --check`；**不要手改 `CACHE` 和 `ASSETS`**，见 8.4）
- [ ] 手机 4G 下打开线上地址，功能正常
- [ ] 微信内打开链接能加载
- [ ] 深色模式下无首屏闪白
- [ ] 打卡一条后刷新，数据还在
- [ ] 东八区**凌晨**打卡，记录落在当天而不是前一天（`toISOString` 陷阱，见 5.1）

> 原本最容易忘的两项——手改缓存版本号、手加新文件进预缓存清单——已经由 `tools/stamp-sw.js` 消掉了。那两项忘掉的后果分别是「用户永远拿不到新版本」和「离线崩」，而且都不会在开发时暴露。

---

## 14. 安全

- **零网络请求。** 没有 API、没有分析、没有第三方资源、没有网络字体。数据不出设备
- **CSP**：因为零外部资源，可以上很严的策略

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; img-src 'self' data:; style-src 'self';
               script-src 'self'; connect-src 'none'; form-action 'none';
               base-uri 'none'">
```

`connect-src 'none'` 是一道硬保证：即使将来误加了网络代码，也会被浏览器拦下。

注意这条 CSP 与 8.2 的主题引导脚本**不冲突**——因为主题脚本是外部文件（`./js/theme-boot.js`）而不是内联脚本，所以不需要 `'unsafe-inline'`，也不需要算 hash。这是把它单独拆成一个文件的主要原因。

`style-src 'self'` 有个调试期的副作用值得记一笔：浏览器会拒掉内联的 `<style>` 和 `style=` 属性（插进去的元素 `sheet` 是 `null`，样式静默不生效），所以在预览里临时试间距/颜色**不能用注入 `<style>` 的办法**，要走 CSSOM：`document.styleSheets[0].insertRule('.x { padding-top: 12px }', document.styleSheets[0].cssRules.length)`，试完 `deleteRule` 或直接刷新。

- **文本安全**：见 6.4，用户输入一律 `textContent`
- **供应链**：**运行时零依赖**。唯一一个 devDependency（typescript）只在本地和提交前跑，不进产物、不参与构建，所以没有运行时供应链风险

---

## 15. 编码约定

- **命名**：`template`（模板）、`pip`（一次打卡记录）。不要出现 `tracker`、`mark`、`habit`、`checkin`
- **界面文案**：禁止「完成」「待办」「未完成」「打卡成功」。说「记录」，说「删除记录」（见 PRD 第 2 节、AGENTS.md）
- **类型**：`js/` 下所有文件都写 JSDoc 注解，`npm run typecheck` 必须通过。公共函数要有 `@param` / `@returns`；可复用的类型用 `@typedef` 定义（如 `DateKey`、`GridCell`）
- **相对 import 必须写扩展名**（`'./dates.js'`，不是 `'./dates'`）。浏览器原生 ES 模块要求如此，`tsconfig` 用 `nodenext` 会在类型检查阶段拦住漏写的——这一条是刻意的，见 1.3
- **日期**：只用 `dates.js` 里的函数。**任何地方不得直接出现 `toISOString()`**
- **日期范围过滤**用字符串字典序（`inRange`），不要解析成 Date 再比较（见 5.6）
- **派生数据一律读时计算**，不写进存储。不要给 template 加计数器字段（见 6.5）
- **存储**：只在 `store.js` 里出现 `localStorage`
- **CSS 类名**：小写连字符，语义化（`.cal-cell`、`.pip-dot`、`.sheet-header`），不用 BEM 的 `__` / `--`
- **日历网格的几何必须是固定的**，两条都踩过：
  - 格子高度用确定值（`--cell-h`），**不要用百分比**。表格里 `height: 100%` 的解析不可靠（实测 68px 被算成 79px）
  - `tbody tr` **必须显式给高度**。否则一行里没有本月日期时（30 天的月份只需 5 行，第 6 行全空）会塌缩成内边距的 4px，于是 5 行和 6 行的月份高度不同，**切换月份时页面会跳**——正好违背固定 6 行的初衷（PRD 7.1）
- **CSS 布局**：日历是 `<table>`（`table-layout: fixed`，固定 7 列），当日列表的行用 Grid，月份栏和工具栏用 Flex
- **视口高度**：用 `100dvh` 并给 `100vh` 兜底（iOS 地址栏收放会导致 `vh` 跳变）
- **安全区**：底部工具栏和 sheet 底部内边距都要加 `env(safe-area-inset-bottom)`
- **注释**：只写代码本身表达不了的约束（时区、iOS 行为、为什么不用某个方案）。不写「这行做了什么」

---

## 16. 风险清单

| 风险 | 影响 | 对策 |
|---|---|---|
| iOS 主屏幕应用与 Safari 是两套存储 | 用户混用会看到两份数据 | 应用内图文引导 + 文案明确要求只用主屏幕图标 |
| iOS 清理 7 天未访问站点的存储 | 数据静默消失 | 主屏幕应用被豁免；引导必须添加到主屏幕 |
| 用户清缓存 / 换手机 | 数据永久消失，无法代为恢复 | 导出提醒（超 30 天变红）+ 导出/导入 |
| 误选「覆盖」导入 | 一次毁掉全部数据 | 导入前自动备份到 `pip:v1:backup` |
| 误删模板 | 连历史记录一起丢 | 二次确认并写明会删掉几条；日常建议用「停用」 |
| 主 key 损坏后手滑保存 | 坏数据被真空数据覆盖 | 只读模式（3.5），绝不自动写回 |
| `sw.js` 的生成区域过期（忘了跑 `stamp`） | 用户永远拿不到新版本，误判为部署失败；或离线崩 | 缓存名和预缓存清单由 `tools/stamp-sw.js` 生成（8.4），不再手工维护 |
| 部署前忘了跑 `npm run check` | 类型错误、日期逻辑错、生成区域过期会一起漏过去 | 部署清单第一项就是它（13.4） |
| 用了绝对路径 | GitHub Pages 下 404 | 所有引用用 `./`，部署前核对 |
| 将来绑自定义域名 | 换 origin，旧数据读不到 | 文档明令禁止，域名发出去就定死 |
| `toISOString()` 混进日期逻辑 | 东八区凌晨 00:00–07:59 记成前一天，静默错数据 | `dates.js` 唯一出口 + 多时区测试覆盖 + 验收标准第 12 条 |
| 配额写满 | 写入失败 | `setItem` 包 try/catch + 横幅提示立即导出 + 备注限 200 字 |

---

## 17. 实施顺序

按这个顺序做，每步都能跑，且早期成果不会因为后期卡住而白费。

| # | 步骤 | 产出 | 状态 |
|---|---|---|---|
| 0 | 工具链：`package.json` + `tsconfig.json` + `tools/` | 类型检查和测试能跑 | ✅ 已完成 |
| 1 | `dates.js` + `tests/dates.test.js`（5 个时区） | 时区和周一起始有断言兜住 | ✅ 已完成 |
| 2 | 静态骨架：`index.html` + `app.css` + 设计令牌 + 写死数据的日历网格 | 能看到月历和彩点 | ✅ 已完成 |
| 3 | `store.js` + `model.js` + `state.js`，从存储读出并渲染 | 数据能持久化 | ✅ 已完成 |
| 4 | `views/sheet.js` 弹窗容器 + 页面栈 + Android 返回键 | 弹窗骨架可用 | ✅ 已完成 |
| 5 | `views/pip-form.js` 打卡流程 | 核心动线通了 | ✅ 已完成 |
| 6 | `views/templates.js` 模板管理（新建/编辑/停用/删除） | 模板可管理 | ✅ 已完成 |
| 7 | `views/day.js` 某日列表 + 详情 | 能回看和补记 | ✅ 已完成 |
| 8 | `views/settings.js` + 主题 + 导出/导入 | 数据能带走 | ✅ 已完成 |
| 9 | PWA：manifest + 图标 + `sw.js` + 更新流程 | 能装到主屏幕、能离线 | ✅ 已完成 |
| 10 | 部署 + 4G/微信可达性验证 | **go/no-go 判定点** | |

**为什么把工具链和 `dates.js` 提到最前面**：`dates.js` 是唯一会**静默错数据**的纯逻辑文件，而它零依赖、不需要任何 UI 就能写完和验证。先做完它，后面所有日期相关的代码都站在一个已被五个时区验证过的地基上，而不是等到写 UI 时才发现日期算错。

第 2 步不依赖网络、不依赖 go/no-go 结果，可以立刻开始。第 10 步如果失败，备选路线见 [`PRD.md`](PRD.md) 第 5 节的「备选形态」（微信小程序 + 云开发）。

每完成一步跑一次 `npm run check`。
