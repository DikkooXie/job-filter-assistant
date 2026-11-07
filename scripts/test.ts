// 逻辑测试单入口：按顺序加载 scripts/tests/ 下的套件，最后汇总通过/失败数。
// 运行全部：npm test
// 只跑部分：npm test -- update ensure（按套件文件名前缀匹配）
//
// 套件之间会改 globalThis.chrome 等全局桩，所以逐个 await 导入，不并发。
import { results } from './tests/harness.js';

const SUITES = [
  'build',
  'platforms',
  'profile',
  'filters',
  'ai',
  'update',
  'badge',
  'saveQueue',
  'options',
  'sidepanel',
  'ensure',
  'confirm',
];

const wanted = process.argv.slice(2);
const selected = wanted.length ? SUITES.filter((name) => wanted.some((w) => name.startsWith(w))) : SUITES;
if (!selected.length) {
  console.error(`没有匹配的套件：${wanted.join(' ')}。可选：${SUITES.join(' / ')}`);
  process.exit(1);
}

for (const name of selected) {
  await import(`./tests/${name}.test.js`);
}

const { pass, fail } = results();
console.log(`\n${'='.repeat(40)}\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
