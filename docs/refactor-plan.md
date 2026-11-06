# 重构计划：只做 BOSS + 架构梳理 + 全项目 TypeScript

状态：P1、P2 已完成（195 通过 / 0 失败，构建通过）；P3 起未开始
分支：`refactor/codebase-cleanup`（基于 `dev`，两者均已推送 `personal`）
基线：`adbf521`，`npm test` 198 通过 / 0 失败，`npm run build` 通过
P1+P2 后：`npm test` 195 通过 / 0 失败（删除 4 个 51job 专属用例、新增 1 个「未注册平台返回空」用例，另把 8 处跨平台用例改写为 BOSS 数据）

## 提交节奏（已与用户确认）

- P1 + P2 合并为一个提交（死代码清理 + 收敛 BOSS）。
- P3 目录搬迁单独提交，用 `git mv` 保持重命名识别，与「改内容」分开。
- P4、P5 各自独立提交。
- P2 删除 51job 专属测试用例导致总数下降属正常，提交说明里写明删除原因。

## 脚本是否用 TS（结论）

用。`scripts/` 下的测试与发布脚本同样迁到 TS，通过 `tsx` 直接运行（Node ≥18，无需预编译步骤），收益是与 `src/common/` 共享类型，避免测试数据与真实字段脱节。`package.json` 的 `test` / `release` 命令相应改为 `tsx ...`。Node 22 自带 `--experimental-strip-types` 可作备选，但 `tsx` 对路径别名与旧版 Node 更友好，选 `tsx`。

## 目标

1. 收敛到 BOSS 单一平台，删除 51job（前程无忧）相关的平台分支、采集逻辑、文案和样本。
2. 让仓库结构一眼能看懂：一个入口对应一份实现，没有旧版并存，没有职责含糊的目录。
3. 全项目统一 TypeScript，包括 React 页面、`src/common/`、内容脚本、后台和 Node 脚本。
4. 行为不变：现有 198 个逻辑测试在迁移后等价保留（其中专测 51job 的用例随功能删除）。

## 明确不做

- 不改存储 key、存储结构、后台消息类型名（`AGENTS.md` 硬约束）。
- 不改 `showBadge` 的读取方式、保存防抖节奏、更新流程里文件夹选择窗口的弹出顺序。
- 不引入代码分割、不改构建产物文件名规则（固定 `assets/[name].js`，无哈希）。
- 不做新功能、不做界面改版。
- 不碰 `src/vendor/`（第三方打包产物）。

## 分阶段

每个阶段单独提交，结束必须 `npm test` 全过 + `npm run build` 通过；界面相关改动另需 `dist/` 加载验证。

### P1 死代码清理（已完成）

删除已被 React 版取代、且不进入 `dist/` 的旧实现：

- 根目录 `popup.html`、`sidepanel.html`（与 `extension-pages/` 重复且指向旧 JS）。
- `src/ui/popup.js`、`src/ui/sidepanel.js`、`src/ui/design.css`、`src/ui/popup.css`、`src/ui/sidepanel.css`。
- `dev/popup.html`、`dev/sidepanel.html`、`dev/mock-chrome.js`（旧预览入口）；保留 `dev/browse-preview-chrome.js`，它被 `extension-pages/sidepanel-browse-preview.jsx` 引用。
- `src/ui/ui-common.js` 中只剩旧页面使用的 `h` / `esc` / `toast` / `debounce`，以及无人使用的 `fromList` / `verdictLabel`；`send` / `toList` 迁入新位置（见 P3 目录方案）。

注意：`cn` 依赖**保留**。此前梳理时只搜了 `src/react` 与 `extension-pages`，误判为未使用；实际 `src/components/ui/` 的 10 个 shadcn 组件都 `import { cn } from 'cn'`（shadcn 官方的 Tailwind 类名合并包）。

同步修改：`scripts/test_logic.mjs` 中读取旧文件的用例（如 3061 行附近）、`README.md`、`docs/agents/cloud-start.md`、`docs/pre-main-feature-audit.md` P2-7。

### P2 收敛 BOSS（已完成）

- `src/common/platforms.js`（533 行）删除 51job 的 URL 匹配、归一化与样本解析。
- `src/content/collector.js`、`sniffer.js` 删除 51job 分支。
- `manifest.json` 移除 `51job.com` 的 host_permissions 与 content_scripts matches。
- 设置与侧栏中的平台下拉、平台标签、平台统计去掉「前程无忧」。
- `scripts/fixtures/qcwy_job.sample.json` 及对应测试删除。
- `GLOSSARY.md` / `README.md` / `PRODUCT.md`（本地）中的平台描述同步。

实际落点（与上面清单的差异）：

- 平台筛选（`view.platform` + 侧栏「平台」分段控件）一并移除；`filterVisibleJobs` 仍保留可选的 `platform` 参数（有用例覆盖），便于以后接入新平台。
- 侧栏/CSV 的平台标签对非 `boss` 的历史数据显示「其他平台」；旧 `qcwy` 岗位数据在存储里原样保留，不迁移、不删除，只是不再新增。
- `src/common/settingsStore.js` 的 `mergeSettings` 把历史 `mode: 'qcwy'` 归一到 `auto`，存储键与结构不变。
- `dev/browse-preview-chrome.js` 的虚构岗位全部改为 BOSS，预览页与正式界面一致。

验收：BOSS 收录、归一化、筛选、打分相关用例全部保留并通过（195 通过 / 0 失败）；界面不再出现 51job 选项；`npm run build` 通过。

### P3 架构梳理（目录与模块边界）

目标结构（`src/` 下按「谁在用」分层，而不是按技术类型堆叠）：

```
src/
  common/        纯逻辑：不碰 DOM、不直接碰 chrome API 的部分优先放这里，便于测试
  extension/     浏览器/扩展 API 适配层：send、storage、tabs、更新安装等
  background/    后台 service worker
  content/       注入页面的脚本
  pages/         React 页面（options / popup / sidepanel），各自目录内聚组件与样式
  components/ui/ shadcn 组件，保持不动
  vendor/        第三方产物，保持不动
```

具体动作：

- `src/react/settings/*` → `src/pages/options/`；`src/react/sidepanel/*` → `src/pages/sidepanel/`；`src/react/popup.jsx` → `src/pages/popup/`。`extension-pages/` 只保留 HTML/入口，或合并进 `src/pages/` 后调整 Vite root。
- `src/ui/ui-common.js` 的 `send` → `src/extension/messages`；`toList` 等纯函数 → `src/common/`。
- `src/ui/update.js` → `src/extension/update`（与 `src/common/update.js` 的纯逻辑保持分离）。
- `src/react/sidepanel.jsx` 中 CSV 导出、进度存储 key、格式化等纯函数抽到 `src/pages/sidepanel/` 的独立模块并补测试。
- `views.jsx`（1165 行）按列表 / 详情 / 弹层拆分；`browse.css`（2142 行）随组件拆分。
- 路径别名统一用 `@/`，避免 `../../` 深度相对路径。

### P4 测试与工程化

- `scripts/test_logic.mjs`（3692 行）拆成 `scripts/tests/` 下按领域划分的套件（platforms / profile / filters / prompts / update / saveQueue / sidepanel…），保留 `npm test` 单入口与全部用例。
- 引入 ESLint + Prettier，配置与现有代码风格对齐（单引号、分号、2 空格），先只对新增/改动文件强制，再统一格式化。
- CI：`.github/workflows/checks.yml` 增加 `dev`、`refactor/**` 触发分支与 lint / 类型检查步骤。

### P5 TypeScript 迁移

- 依赖：`typescript`，脚本运行用 `tsx`（`npm test`、`npm run release` 直接跑 `.ts`，不需要预编译）。
- `tsconfig.json`：`strict: true`、`noUncheckedIndexedAccess: true`、`moduleResolution: bundler`、别名 `@/*`；React 页面用 `.tsx`。
- 类型落地顺序：`src/common/`（纯逻辑先行，定义 Job / Profile / Settings / Provider / Match 等核心类型）→ `src/extension/` → `src/pages/` → `src/content/` + `src/background/` → `scripts/`。
- 内容脚本与后台：改为由构建步骤编译到 `dist/src/content/`、`dist/src/background/`，保持产物路径与文件名不变；**同时修订 `AGENTS.md` 中「内容脚本不经过打包、被原样复制」的约束**，改为「内容脚本单独编译、不与其他模块打包、产物路径固定」。
- 测试桩：目前用 `vm` 读取 `src/content/*.js` 源文本的用例，改为读取编译产物或用 `tsx` 加载 TS 源，二选一，写入本计划时倾向后者（避免测试依赖构建顺序）。
- `vite.config.js` 的 `chunkFileNames` 特判（badge / profile）需在迁移后重新验证产物文件名。

## 风险与注意

- 删除 51job 会同时删掉一批测试用例，必须在提交说明里写清「删除的用例数 = 删除的功能」，不能用通过率掩盖。
- 目录大搬迁会让 git diff 很大，建议用 `git mv` 保持重命名识别，且与「改内容」的提交分开。
- TS 迁移期间不允许用 `any` 静默绕过核心类型；确需临时放宽的地方写 `// TODO(ts):` 并在 PR 中列出。
- 本计划不涉及发布；`npm run release` 需要单独授权。

## 验证清单（每阶段）

- [ ] `npm test` 全过
- [ ] `npm run build` 通过
- [ ] `dist/` 加载扩展，BOSS 列表页收录 → 侧栏出现岗位 → 单条分析 → 导出，路径可用
- [ ] 涉及界面时：深浅色、宽窄屏截图
- [ ] 未执行的检查在 PR 中明确列出

### P6 样式统一到 Tailwind（追加，用户提出）

现状：shadcn 组件（`src/components/ui/`）用 Tailwind + `cva`，但业务代码 538 个 `className` 中只有 23 个用工具类，其余是语义类名 + 独立 CSS，共 4,968 行（`browse.css` 2142、`shell.css` 828、`ai.css` 468、`update-panel.css` 466、`profile.css` 451、`general.css` 309、`filters.css` 276）。两套样式体系并行，shadcn 选型价值没有发挥出来。

目标：业务组件样式统一走 Tailwind 工具类，`@theme` 中的设计令牌作为唯一样式来源，重复度高的复合样式用 `@apply` 收敛，不再为每个页面维护独立 CSS 文件。

做法：

- 按页面推进，一次一个（options → sidepanel → popup），每页转换前后做同尺寸截图比对（深/浅色 × 宽/窄屏）。
- 现有 CSS 变量（`--jp-*` 等）映射到 `@theme` 令牌，不直接删变量，先确认没有跨文件引用。
- 保留确实无法用工具类表达的部分（复杂选择器、`content`、关键帧）在极小的全局 CSS 中，并在文件头说明保留原因。
- 验收以视觉证据为准，`npm test` 中针对 CSS 选择器的断言需同步改写。

风险：视觉回归。必须与 TS 迁移分开提交，便于独立回滚。
