# 重构计划：只做 BOSS + 架构梳理 + 全项目 TypeScript

状态：P1–P5 已完成；P3 的 `views.tsx` / `browse.css` 拆分并入 P6；P6 进行中（设置页已完成；侧栏已转换批量队列、列表、底部弹层、详情分析、详情头部/标签/正文/事实/维度/要点和空/加载/错误状态、沟通页；浮窗待检查）
当前：`npm run typecheck` 零错误、`npm run lint` 零警告、`npm test` 197 通过 / 0 失败、`npm run build` 通过
分支：`refactor/codebase-cleanup`（基于 `dev`，两者均已推送 `personal`）
基线：`adbf521`，`npm test` 198 通过 / 0 失败，`npm run build` 通过
P1+P2 后：`npm test` 195 通过 / 0 失败（删除 4 个 51job 专属用例、新增 1 个「未注册平台返回空」用例，另把 8 处跨平台用例改写为 BOSS 数据）

| 阶段 | 提交 | 说明 |
| --- | --- | --- |
| P1 + P2 | `66938a9` | 删除旧版 UI，收敛为只支持 BOSS |
| P3 目录 | `7e370bd` | `src/` 按职责分层，`git mv` 保留重命名 |
| P4 工具 | `2d3d5df` | TypeScript / tsx / ESLint / Prettier，构建支持 TS 运行时脚本 |
| P5 类型化 | `153bbd8` → `d691883` | common → extension → options → sidepanel/popup → content/background → shadcn/入口 → 脚本，每层一个提交 |
| P4 测试 | `8add971` | `test_logic.mjs` 拆成 `scripts/tests/` 下 12 个 TS 套件 |

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
- `dev/popup.html`、`dev/sidepanel.html`、`dev/mock-chrome.js`（旧预览入口）；保留 `dev/browse-preview-chrome.js`，它被 `extension-pages/sidepanel-browse-preview.jsx` 引用（现为 `dev/browse-preview-chrome.ts` 与 `.tsx` 入口）。
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
- `dev/browse-preview-chrome.js`（现 `.ts`）的虚构岗位全部改为 BOSS，预览页与正式界面一致。

验收：BOSS 收录、归一化、筛选、打分相关用例全部保留并通过（195 通过 / 0 失败）；界面不再出现 51job 选项；`npm run build` 通过。

### P3 架构梳理（目录与模块边界，已完成）

下文路径是搬迁前的旧路径，保留作记录。未完成项：`views.tsx`（现 1341 行）与 `browse.css` 的拆分，移到 P6 随样式改造一起做，避免同一批文件改两次。

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

### P4 测试与工程化（已完成）

测试入口现为 `scripts/test.ts`，套件为 build / platforms / profile / filters / ai / update / badge / saveQueue / options / sidepanel / ensure / confirm。Prettier 已配置（`npm run format`），但尚未对全仓统一格式化，避免与 P6 的大改动冲突。

- `scripts/test_logic.mjs`（3692 行）拆成 `scripts/tests/` 下按领域划分的套件（platforms / profile / filters / prompts / update / saveQueue / sidepanel…），保留 `npm test` 单入口与全部用例。
- 引入 ESLint + Prettier，配置与现有代码风格对齐（单引号、分号、2 空格），先只对新增/改动文件强制，再统一格式化。
- CI：`.github/workflows/checks.yml` 增加 `dev`、`refactor/**` 触发分支与 lint / 类型检查步骤。

### P5 TypeScript 迁移（已完成）

实际落点：测试走「`esbuild` 把 TS 源转成 JS 再交给 `vm`」（`scripts/tests/harness.ts` 的 `runtimeScript`），不依赖构建顺序；全程未用 `any` 与类型抑制注释，也没有留下 `TODO(ts)`。迁移中只放宽了两处函数签名：`filters.ts` 接受 `Partial<JobFilters>`，`releaseRequest` 渠道参数可省略，行为不变。

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

- [ ] `npm run typecheck`、`npm run lint` 通过
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

进度与约定（执行中补充）：

- 已完成：设置页「通用与隐私」（`GeneralTab.tsx`，删除 `general.css` 和未被引用的 `controls.tsx`）。四种截图与转换前逐像素一致。
- 已完成：设置页「岗位筛选」（`FiltersTab.tsx`，删除 `filters.css`）。开关改用共用的 `switchInput`，滑块颜色从 `#fff` 统一为通用页的 `#f7fbfa`，零阈值比对只有这 15×15 像素不同；其余与转换前逐像素一致。测试里的 `is-risk` 类名断言改为断言风险词标签的红色底。
- 已完成：设置页「模型接口」（`AiTab.tsx`，删除 `ai.css`）。「标签 + 控件」字段行与岗位筛选页共用，收进 `recipes.ts` 的 `fieldGrid` / `fieldLabel` / `fieldHint`。四种截图与转换前逐像素一致；「高级设置」的 `›` 需要保留 `rotate-0`，原样式的 `transform: rotate(0deg)` 会改变字形抗锯齿，去掉后有十几个像素不同。截图只覆盖默认状态，测试结果、请求头报错等状态靠逐条对照原 CSS 转换。
- 已完成：设置页「个人画像」（`ProfileTab.tsx`，删除 `profile.css`）。标签输入框与岗位筛选页共用，收进 `recipes.ts` 的 `tagBox` / `tagChip` / `tagInput`；原文件末尾针对右侧栏（`.settings-rail` / `.rail-missing`）的 1080px 规则移到 `shell.css`。默认页、粘贴框、草稿对话框共 12 张截图与转换前逐像素一致。两处按原样保留的旧行为：「抽取画像」按钮的 650 字重被 `.s-btn` 覆盖，实际是 500；「清除画像」标题不是分组的直接子元素，原样式没套上分组标题字号，实际是 14px 常规字重。按钮的键盘聚焦样式统一为 `focusRing`（原为改边框色 + 外圈柔光），只影响 Tab 聚焦时的外观。
- 已完成：设置页「关于与更新」（`UpdatePanel.tsx`，删除 `update-panel.css`）。通用页至此没有残留 CSS。除默认页外，加测了 `#updated` 成功提示 + 展开手动更新、检查到新版本（徽标、更新按钮、发布说明）、检查失败三种状态（共 12 张），页高全部不变。两处与转换前不同，均接受：「更新到 …」按钮改用共用 `button({ variant: 'primary' })`，带上了悬停变淡（原样式没有悬停效果），截图时鼠标停在按钮上所以这块不同；窄屏浅色画像页的 144px 差异出在基线那一轮，新构建与更早两轮截图逐像素一致。
- 已完成：设置页外壳、画像完整度侧栏与更新日志使用 Tailwind，删除 `shell.css`；主题变量和基础字体迁到 `theme.css`，原本无消费者的窄屏规则删除，折叠内容的 `hidden` 由 Tailwind preflight 处理。重新截取原始构建后，设置页四个标签的深浅色、宽窄屏共 16 张与迁移版逐像素一致；更新日志 8 张中 6 张一致、另两张分别相差 2 和 5 像素。原先基线与同一原始构建的重新截图也有大面积差异，因此以同轮重新截图为准。
- 侧栏进行中：批量进度条与队列抽屉拆至 `BatchViews.tsx`；列表、详情、沟通页的深浅色和宽窄屏共 12 张截图与拆分前逐像素一致。模型接口提示、队列遮罩、抽屉容器、头部、进度与统计、筛选栏容器、滚动区域、分组内容、空状态和底部操作栏已转换为 Tailwind，分别在深浅色和宽窄屏下截图，迁移前后各四张逐像素一致。队列内部及侧栏其余样式仍待转换。
- 侧栏详情头部、标签、正文与空/加载/错误状态改用 Tailwind，删除 `.job-detail` / `.detail-heading` / `.detail-title-line` / `.detail-tabs` / `.detail-content` / `.dims` / `.facts` / `.tags` / `.bullet-list` / `.surface-state` / `.skeletons` / `.list-scroll` 等规则；复合样式收进 `views.tsx` 顶部常量。列表滚动区同时换掉 `list-scroll`。本轮遇到三处「源码值 ≠ 实际生效值」：详情标题会被 `.job-panel :focus-visible`（未分层）画出青色聚焦环，工具类要写 `focus:!outline-none`；`.fine-print` 的 11px/10px 上边距被 `.detail-content p` 与 `.job-panel p { margin: 0 }` 压掉，实际等同正文段落；返回按钮的 11px/secondary 被 `.job-panel button { font: inherit; color: inherit }` 压掉，实际继承 13px 正文色。比对结论：同一份代码连截两次会整页差 1px（旧基线已陈旧），改用「同一个 dev server 上先 stash 到 HEAD 截一轮、再还原截一轮」后，28 张里有 27 张逐像素一致，仅浅色宽屏详情「岗位」页的要点圆点有 1 个抗锯齿像素相差 34，属可接受噪声。
- 侧栏沟通页改用 Tailwind：进展抽屉、步骤条、对话气泡、招呼语工作区、贴底建议条全部换成 `CommTab.tsx` 顶部常量，删除 `browse.css` 中 `.comm-*` / `.suggest` / `.sg-*` / `.sticky-comm` 共 359 行规则。按钮和文本框继续带 `!`，因为 `.job-panel button` / `.job-panel textarea` 的未分层重置会压过普通工具类；`.comm-greet-empty p` 的 8px 下边距同样要 `!mb-2`（`.job-panel p { margin: 0 }`）。空状态「生成招呼语」按钮按原样式补 `disabled:opacity-100`。比对用同一套脚本先 stash 到 HEAD 截 28 张基线、再还原截 28 张，逐像素全部一致；中途曾用 Role 选择器直接对比旧脚本的基线，有 4 张因点击后滚动位置不同而整页偏移，不能算回归。测试里按类名的断言改为断言常量内容和「`browse.css` 不再有 comm 规则」。
- 侧栏详情「分析」页的风险提示与底部操作按钮改用 Tailwind：`detail-warn` / `detail-warn-row` / `warn-txt` / `tune-link` / `analysis-empty` / `reanalyze` / `detail-open` 的规则从 `browse.css` 删除。四态截图里只有等级条（五段斜块）边缘在不同轮次间相差 19–20 像素，同一份代码连截两次也能复现同样的抖动，属截图噪声；其余区域逐像素一致。另用计算样式逐项核对：风险容器内边距 4/6、行内边距 8/6 与 7px 间距、图标 13px + 1px 上移、相邻行 1px 分隔线、「可以接受」悬停展开到 72px、重新分析按钮的禁用透明度 0.48 与悬停描边/文字色、详情按钮 36px 高，全部与转换前相同。
- 转换要照搬**层叠后实际生效**的样式，不是 CSS 源码里写的值。`update-panel.css` 有一条 `.settings-root .update-panel :where(p, h2, h3, h4, ol, ul) { margin: 0 }`，特异性 (0,2,0) 压过了所有单类名的 margin 规则（`.update-lead`、`.update-hint`、`.update-keep`、`.update-id`、发布说明和手动步骤里的段落/列表），那些外边距从来没生效过；照源码写进去页面会高出 36–102px。同理，「手动更新」的 `›` 原样式收起时没有 transform，这里不能加 `rotate-0`（与「高级设置」相反），否则字形有 7–9 像素不同。
- 复合样式用 `recipes.ts` 里的 TS 常量 / `cva` 收敛，而不是 `@apply`：类名留在 TSX 里可搜、可类型检查。
- 合并类名必须用 `src/lib/cn.ts`。`cn` 包默认不认识自定义字号令牌，`cn('text-body text-ink-1')` 会丢掉字号；`cva` 本身只拼接不合并，基础类和变体冲突时要再过一遍 `cn()`。
- 截图比对：截图前要等 `document.fonts.ready`，否则字体是否加载完会让同一份代码出现两种渲染（整页亚像素偏移、页高差 1px）。基线要从 HEAD 的独立 worktree 构建后截取，与改动版用同一套脚本。
