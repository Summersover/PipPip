#!/usr/bin/env node
/**
 * 在多个时区下各跑一遍测试。
 *
 * **为什么需要它。** dates.js 的全部风险就是时区。单跑一次只能证明它在你
 * 当前时区下是对的，而「本机通过、用户那边记错一天」正是这类 bug 的典型形态。
 * 同一个断言在多个时区下都通过，才算真的证明了它不依赖时区。
 *
 * 时区必须在**子进程启动前**通过环境变量设置，所以这里用 spawn 而不是
 * 在同一个进程里改 `process.env.TZ`——后者在各平台上行为不一致。
 *
 * ★ 实测：Git Bash（MSYS2）下 `TZ=Asia/Shanghai node ...` 这种命令行写法
 *   **不会**把 TZ 传给子进程（`process.env.TZ` 是 undefined，时区静默回落到
 *   系统值），而 `TZ=x cmd` 在 Windows cmd 下同样不生效。所以必须用 spawn
 *   显式传 env——否则「多时区测试」会假装在测，实际五个时区跑的是同一个。
 *
 * 零依赖。
 *
 * ★ 文件名刻意叫 check-tz 而不是 test-tz：Node 的测试运行器默认会把
 *   `test-*.js` 当成测试文件自动抓取，那样这个脚本会被嵌套执行一遍。
 *   同理，npm script 里用显式 glob 而不是靠自动发现。
 *
 *   npm run test:tz
 */

import { spawnSync } from 'node:child_process';

/** 显式 glob。靠自动发现会把 tools/ 下的脚本也当成测试文件。 */
const TEST_GLOB = 'tests/**/*.test.js';

/** @type {{ zone: string, why: string }[]} */
const ZONES = [
  { zone: 'Asia/Shanghai', why: '目标环境（UTC+8），凌晨会踩 toISOString 陷阱' },
  { zone: 'UTC', why: '零偏移，陷阱不存在' },
  { zone: 'America/New_York', why: '负偏移 + 夏令时，深夜会踩陷阱' },
  { zone: 'Pacific/Kiritimati', why: 'UTC+14，极端正偏移' },
  { zone: 'Pacific/Midway', why: 'UTC-11，极端负偏移' },
];

let failed = 0;

for (const { zone, why } of ZONES) {
  const result = spawnSync(process.execPath, ['--test', TEST_GLOB], {
    env: { ...process.env, TZ: zone },
    encoding: 'utf8',
  });

  const passed = result.status === 0;
  if (passed) {
    console.log(`✓ ${zone.padEnd(22)} ${why}`);
  } else {
    failed++;
    console.log(`✗ ${zone.padEnd(22)} ${why}`);
    console.log('─'.repeat(72));
    console.log(result.stdout || '');
    console.log(result.stderr || '');
    console.log('─'.repeat(72));
  }
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} / ${ZONES.length} 个时区失败`);
  process.exit(1);
}
console.log(`✓ 全部 ${ZONES.length} 个时区通过`);
