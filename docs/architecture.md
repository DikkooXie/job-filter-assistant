# 项目结构与执行细节

这份文档讲清楚 Offercome 由哪些部分组成、各部分怎么协作、一次操作从点击到落库经过哪些代码。硬约束（存储字段、消息名、防抖节奏等）以 `AGENTS.md` 为准，这里只解释它们背后的原因和位置。

最后核对：2026-11-07，`refactor/codebase-cleanup` 分支，版本 1.0.3.22。

---

## 1. 一句话概览

Chrome / Edge MV3 扩展。用户正常浏览 BOSS直聘 时，扩展**被动读取**页面自己发出的岗位接口响应，把岗位收进本地岗位库；用户在侧栏里查看、筛选岗位，并用自己配置的 AI 接口分析岗位与个人画像的匹配度、生成招呼语和沟通建议。扩展不替用户发消息、不投递。

```
BOSS 页面 ──(fetch/XHR 响应)──▶ sniffer ──postMessage──▶ collector ──runtime 消息──▶ background
                                                                                     │
                                         chrome.storage.local ◀────── 读写 ──────────┤
                                                                                     │
          侧栏 / 设置页 / 浮窗 ◀──── JOBS_UPDATED 广播 + storage.onChanged ──────────┘
                    │
                    └──── send(MSG.*) ────▶ background ──fetch──▶ 用户配置的 AI 接口
```

---

## 2. 目录结构

```
.
├── manifest.json                 MV3 清单（构建时复制到 dist/，开发构建名称加「 · dev」）
├── extension-pages/              三个扩展页面的 HTML 入口和挂载脚本
│   ├── options.html / .tsx       设置页
│   ├── sidepanel.html / .tsx     侧栏
│   ├── popup.html / .tsx         工具栏浮窗
│   ├── sidepanel-browse-preview.*  侧栏预览页（只给 npm run dev 调样式用，加载模拟 chrome）
│   └── styles.css                Tailwind 入口
├── dev/browse-preview-chrome.ts  预览页用的模拟 chrome API 与虚构岗位
├── src/
│   ├── common/                   纯逻辑：不碰 DOM，不直接依赖页面环境
│   ├── extension/                扩展 API 适配：消息发送、更新安装、简历解析
│   ├── background/background.ts  service worker：唯一的消息路由和业务编排
│   ├── content/                  内容脚本：sniffer.ts（MAIN world）、collector.ts（ISOLATED world）
│   ├── pages/                    三个 React 页面 + globals.css
│   ├── components/ui/            shadcn/ui 组件
│   └── vendor/                   第三方产物（pdf.js），原样复制
├── icons/                        扩展图标，原样复制
├── scripts/
│   ├── test.ts                   测试入口
│   ├── tests/                    按领域拆分的测试套件 + harness.ts
│   └── release.ts                发版脚本
├── vite.config.ts                构建配置（含内容脚本/后台的逐文件编译插件）
├── tsconfig.json / eslint.config.js / .prettierrc
└── .github/workflows/checks.yml  CI
```

### 2.1 `src/common/` — 纯逻辑

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 共享类型：`Job`、`Match`、`Settings`、`JobFilters`、`Profile`、`AIProvider`、`Protocol` 等。只有类型，构建不产出文件。 |
| `constants.ts` | `STORAGE_KEYS`、`PLATFORM` / `PLATFORM_META`、`MODE`、全部消息类型 `MSG`、`SNIFFER_CHANNEL`、`defaultSettings()`、`defaultFilters()`。 |
| `platforms.ts` | BOSS 接口识别（`matchPlatformApi`）、把接口 JSON 归一成 `Job`（`normalizeResponse`）、uid 规则（`boss:<jobId>`）、详情包与列表 uid 对齐。 |
| `jobsStore.ts` | 岗位库读写：去重合并 `mergeJobs`（默认上限 800，星标优先保留）、删除、清空、星标、写匹配结果、补 JD、匹配缓存。写操作串行化，避免并发覆盖。 |
| `settingsStore.ts` | 设置与 AI 接口列表读写；`mergeSettings` 把旧数据补齐默认值，并把已移除平台的 `mode`（如 `qcwy`）归一到 `auto`。 |
| `profile.ts` | 画像结构、清洗、合并、完整度评分（11 项）。 |
| `profileImport.ts` | 画像导入：文件体积限制、JSON 校验、多份材料分段提取后合并。 |
| `profileFingerprint.ts` | 画像 + 当前模型的指纹，用作匹配缓存键的一部分；改这里会让已有缓存全部失效。 |
| `filters.ts` | 本地筛选（关键词、薪资、城市、经验、学历、屏蔽公司、风险词），不消耗 AI。`autoScoreUids` 决定自动打分的对象。 |
| `ensureDescription.ts` | 「打分前 JD 为空」时的补抓决策和串行队列。只做判断与排队，真正的点击/开标签在 background。 |
| `captureLog.ts` | 嗅探失败、uid 错配、补抓失败的诊断日志（只记种类和原因，不记 JD 正文、令牌、完整 URL），存在 `STORAGE_KEYS.lastReport`。 |
| `update.ts` | 扩展内更新的纯逻辑：版本比较、GitHub Release 解析、更新日志整理、安装包清单校验。 |
| `optionsLink.ts` | 设置页深链 hash 规则（`#ai`、`#ai-list` 等）。 |
| `build.ts` | 开发构建标识（名称加「 · dev」）。 |
| `text.ts` | 文本小工具。 |
| `ai/providers.ts` | 4 种协议（`openai-chat`、`openai-responses`、`anthropic`、`gemini`）、预设供应商、`sanitizeProvider`。 |
| `ai/client.ts` | 把统一的「消息 + 参数」翻译成各协议的 HTTP 请求，再把响应解析回文本/JSON：`chat`、`chatJson`、`testProvider`、`listModels`。 |
| `ai/prompts.ts` | 匹配、简历定制、沟通建议等提示词，以及对模型输出的清洗（`sanitizeMatch` 等）。 |
| `ai/privacy.ts` | 发给 AI 前的脱敏：去掉手机号/邮箱等，按设置决定是否带公司名、姓名。 |

> 注意：`jobsStore.ts`、`settingsStore.ts`、`captureLog.ts` 里有 `chrome.storage` 调用，严格说不是「纯」逻辑，但它们没有页面依赖，background 和页面都可以直接用，所以放在 `common/`。

### 2.2 `src/extension/` — 扩展 API 适配

| 文件 | 职责 |
| --- | --- |
| `messages.ts` | `send(type, extra, timeoutMs = 120000)`：页面 → background 的唯一发送函数。统一处理 `lastError`、空响应、`{ ok:false, error }`，并在超时后 reject（MV3 service worker 可能被回收，回调永不触发）。 |
| `update.ts` | 浏览器层更新：文件夹授权（File System Access + IndexedDB 记住句柄）、下载 Release zip、SHA-256 校验、解压、覆盖写入、删除旧资源、`chrome.runtime.reload()`。 |
| `resumeParser.ts` | PDF（按需动态加载 `src/vendor/pdf.min.mjs`）和 DOCX 简历解析为纯文本。 |

### 2.3 `src/pages/` — 三个 React 页面

**设置页 `pages/options/`**

- `OptionsApp.tsx`：页面编排。持有 settings / profile / providers 三份状态，挂三个保存队列。
- `SettingsShell.tsx`：外框、左侧导航、画像完整度侧栏。
- 四个标签页：`ProfileTab.tsx`（画像与简历导入）、`AiTab.tsx`（模型接口）、`FiltersTab.tsx`（筛选条件）、`GeneralTab.tsx`（通用、隐私、数据管理、更新）。
- `UpdatePanel.tsx`（关于与更新）、`ChangelogPage.tsx`（`#changelog`）。
- 状态与工具：`useInitialSettings.ts`（首屏并发拉取三份数据）、`saveQueue.ts` + `useSaveQueue.ts`（防抖保存）、`useSettingsHash.ts` + `pageHash.ts`（hash 路由）、`aiState.ts`、`filterForm.ts`、`jobStats.ts`、`types.ts`。
- 样式：正在从手写 CSS 换成 Tailwind 工具类（P6）。
  - 令牌：颜色、阴影、字号的值在 `shell.css` 的 `.settings-root`（浅色 / 深色两套），`src/pages/globals.css` 的 `@theme inline` 只把它们起成工具类名（`bg-field`、`text-ink-3`、`text-body`……）；`wide:` 断点表示宽于 860px。
  - 配方：`recipes.ts` 收两个以上标签页共用的类名组合（分组标题、说明文字、「标签 132px + 控件」字段行 `fieldGrid` / `fieldLabel` / `fieldHint`、按钮 `button()`、开关 `switchInput`、单选卡片 `choiceCard`）。只有一处用到的样式直接写在组件里。
  - 合并：类名统一用 `src/lib/cn.ts` 的 `cn()` 合并，它认识自定义字号令牌；直接用 `cn` 包会把 `text-body` 当颜色丢掉。
  - 已转换：`GeneralTab.tsx`、`FiltersTab.tsx`、`AiTab.tsx`（无残留 CSS）。尚未转换：`shell.css`、`profile.css`、`update-panel.css`。

**侧栏 `pages/sidepanel/`**

- `SidepanelApp.tsx`：编排。加载岗位库、监听广播、管理当前岗位、批量分析、确认弹层。
- `views.tsx`：列表行、详情、筛选抽屉、批量细条、队列抽屉等视图（1341 行，P6 拆分）。
- 纯规则（无存储、无消息，便于单测）：`browseModel.ts`（列表/详情展示规则）、`batchQueue.ts`（批量队列状态机）、`commTab.ts`（沟通页节点规则）、`confirmQueue.ts`（确认弹层队列）、`librarySource.ts`。
- `CommTab.tsx`（沟通页）、`ConfirmDialog.tsx`（基于 shadcn AlertDialog）。
- 样式：`browse.css`（2142 行，P6 拆分）。

**浮窗 `pages/popup/PopupApp.tsx`**：显示当前页识别状态和岗位数，开关自动收录，打开侧栏/设置。

---

## 3. 运行时组件与消息协议

### 3.1 四个运行环境

| 环境 | 文件 | 能做什么 | 不能做什么 |
| --- | --- | --- | --- |
| 页面 MAIN world | `content/sniffer.ts` | 包装页面的 `fetch` / `XMLHttpRequest`，读取 BOSS 岗位接口的响应 | 用不了 `chrome.*`；不改请求、不碰令牌 |
| 页面 ISOLATED world | `content/collector.ts` | 接收 sniffer 的 `postMessage`，转发给 background；响应 background 的点卡、刮取详情、打开沟通请求 | 不能 `import` 其他模块（逐文件编译、不打包） |
| service worker | `background/background.ts` | 消息路由、存储读写、跨域请求 AI、开关标签页 | 没有 DOM；随时可能被回收 |
| 扩展页面 | `pages/*` | React 界面，经 `extension/messages.ts` 调 background | 不直接请求 AI |

### 3.2 消息流向

所有消息类型定义在 `src/common/constants.ts` 的 `MSG`。background 用一个 `chrome.runtime.onMessage` 监听器统一处理，回复格式固定为 `{ ok: true, data }` 或 `{ ok: false, error }`。

| 方向 | 消息 |
| --- | --- |
| collector → background | `JOBS_CAPTURED`（接口包或 DOM 兜底，含 `sniffDrop` 诊断）、`CURRENT_JOB`（用户点开了某个岗位）、`PAGE_CONTEXT_CHANGED` |
| background → collector（`chrome.tabs.sendMessage`） | `FETCH_JOB_CARD`（点列表卡片触发详情接口）、`SCRAPE_JOB_DETAIL`（刮取页面上可见的 JD）、`SEND_GREETING`（打开沟通，只复制不发送） |
| background → 所有页面（广播） | `JOBS_UPDATED`（岗位库变了；可能带 `autoQueue` 让侧栏接手自动打分）、`CURRENT_JOB` |
| 设置页 → background | `SETTINGS_GET/SAVE`、`PROFILE_GET/SAVE/CLEAR`、`AI_PROVIDERS_GET/SAVE`、`AI_PROVIDER_TEST/MODELS`、`AI_RESUME_EXTRACT`、`JOB_LIST_REQUEST`、`JOB_EXPORT_REQUEST`、`JOB_CLEAR_REQUEST` |
| 侧栏 → background | `JOB_LIST_REQUEST`、`JOB_DELETE`、`JOB_STAR_TOGGLE`、`GREETING_SAVE`、`ACTIVE_CONTEXT_REQUEST`、`CURRENT_JOB`、`AI_MATCH_SCORE`、`AI_TAILOR_RESUME`、`AI_SUGGEST_REPLY`、`OPEN_JOB_CHAT`、`OPEN_ORIGINAL_JOB`、`OPEN_OPTIONS`，以及设置/画像的读写 |
| 浮窗 → background | `ACTIVE_CONTEXT_REQUEST`、`JOB_LIST_REQUEST`、`SETTINGS_GET/SAVE`、`OPEN_OPTIONS` |

sniffer 与 collector 之间不走 runtime 消息，而是同源 `window.postMessage`，频道名 `job-helper:sniffer`（`SNIFFER_CHANNEL`）。内容脚本不能 import，所以 sniffer / collector 里的频道名、接口路径正则、`FETCH_JOB_CARD` 等是字面量副本，改 `constants.ts` 或 `platforms.ts` 时要同步改。

### 3.3 存储

全部在 `chrome.storage.local`，键名在 `STORAGE_KEYS`：

| 键 | 内容 |
| --- | --- |
| `settings` | 设置（运行模式、自动收录/打分、去重、上限、筛选条件、隐私开关、`showBadge` 等） |
| `profile` (`jobHelperProfileV1`) | 个人画像 |
| `jobs` (`jobHelperJobsV1`) | 岗位库数组，每条 `Job` 带 `uid`、`match`、`greeting`、`star` 等 |
| `aiProviders` (`jobHelperAiProvidersV1`) | AI 接口列表与当前选中项 |
| `matchCache` (`jobHelperMatchCacheV1`) | 匹配结果缓存，键为 `${uid}::prompt-v4::${画像指纹}` |
| `lastReport` (`jobHelperLastCaptureReportV1`) | 诊断日志 |
| `reopenAfterUpdate` | 更新安装后的一次性标记（不在 `STORAGE_KEYS` 里，定义为 `src/extension/update.ts` 的 `REOPEN_FLAG`） |

键名和结构不能改：用户已有数据，改名即丢失。`showBadge` 还被内容脚本按字面量读取。

---

## 4. 关键流程

### 4.1 收录岗位

1. **sniffer**（`document_start`、MAIN world）在页面脚本之前包装 `fetch` / `XHR`。URL 命中 BOSS 列表或详情接口（`/wapi/zpgeek/search/joblist`、`pc/recommend/job/list`、`job/detail`、`job/card` 等）时，克隆响应、解析 JSON，`postMessage` 给 collector。非 JSON 的响应发 `sniff-drop`。
2. 详情接口常常在 collector（`document_idle`）挂上监听前就已返回，所以 sniffer 把最近的消息存在 `recent` 里；collector 启动后发 `replay-request`，sniffer 重新投递一遍（带 `replay: true`）。collector 用 1.5 秒内同 URL 去重，避免同一响应入库两次。
3. **collector** 收到后：
   - 如果是详情接口，先从请求 URL 的 `encryptJobId` / 页面 URL / 响应体中取岗位标识，发 `CURRENT_JOB`，侧栏随之切换到该岗位；
   - 再把 payload 原样发 `JOBS_CAPTURED`。如果刚点过列表卡片，附上点卡时记下的 `hintJobId`，用于把只带数字 id 的详情包对齐到列表 uid；
   - 页面上一个接口都没嗅到时，用 DOM 兜底生成一份列表 payload（URL 以 `#dom` 结尾）。
4. **background `onJobsCaptured`**：
   - `classifyBossDrop` 识别登录失效/风控之类的空包，写诊断日志后返回；
   - `normalizeResponse` 归一成 `Job[]`；`captureKeyNotes` 记录 uid 对齐情况；
   - 关闭「自动收录」时只补已有岗位的 JD，不新增（`filterCapturedJobs`）；
   - `mergeJobs` 去重合并、按上限淘汰（星标优先保留），广播 `JOBS_UPDATED`；
   - 开启「自动打分」时，对新岗位按筛选条件挑出 uid：侧栏开着就交给侧栏队列（广播里带 `autoQueue`），否则后台直接 `scoreBatch`。
5. **侧栏** 收到 `JOBS_UPDATED` 后 `JOB_LIST_REQUEST` 重新拉列表；同时监听 `storage.onChanged`，广播丢了也能刷新。

### 4.2 AI 匹配打分（`AI_MATCH_SCORE` → `scoreOne`）

1. 取当前 AI 接口（`getActiveProvider`：命中 `activeProviderId`，否则用第一项），没有就报错让用户去设置页。
2. 读画像、设置、岗位库。
3. **JD 为空时补抓**（`queueEnsure`，全局串行，两条之间至少间隔 `ENSURE_DESC_GAP_MS`）：
   1. 在已打开的 BOSS 标签里找到列表卡片，发 `FETCH_JOB_CARD` 让 collector 点一下，等嗅探器把详情写进岗位库；
   2. 仍为空，发 `SCRAPE_JOB_DETAIL` 刮当前页可见的 JD（collector 会校验页面岗位标识，对不上就拒绝，防止把上一张卡的 JD 串过来）；
   3. 还为空，后台静默打开原岗位页、等待、关闭。
   每一步的结果写进诊断日志；单条失败不影响整批。
4. 仍无 JD 时，写入一个「缺少描述」的降级结果并报错，不把空 JD 当成功分析。
5. 计算画像指纹，查缓存键 `${uid}::prompt-v4::${fp}`；能复用就直接写回岗位。提示词改版时提升 `prompt-vN`，旧缓存自然失效。
6. `buildMatchPrompt`（内部经 `privacy.ts` 脱敏，是否带公司名由 `settings.privacy.sendCompanyName` 决定）→ `chatJson` → `sanitizeMatch` → 写缓存、写岗位、广播。

`AI_MATCH_BATCH` 逐条调用 `scoreOne`，间隔约 400ms。侧栏自己的批量队列（`batchQueue.ts`）间隔约 500ms，逐条发 `AI_MATCH_SCORE`，进度展示在细条和队列抽屉里。

`AI_TAILOR_RESUME`（简历定制建议）和 `AI_SUGGEST_REPLY`（沟通建议改写）只返回给页面在当前会话展示，**不落库**；失败时也不回退到本地模板。

### 4.3 打开原岗位 / 进入沟通

- `OPEN_ORIGINAL_JOB`：前台激活或打开原岗位页。JD 为空时等待嗅探写入，超时后让详情页刮可见 JD（最多 6 次），只补已有 uid，不关标签。
- `OPEN_JOB_CHAT`：打开岗位页 → 等加载 → 发 `SEND_GREETING`。collector 找到「立即沟通/继续沟通」按钮点击进入聊天页，**只把招呼语复制到剪贴板，不自动发送**。侧栏在这之前会先弹确认框；「我已发出招呼」只记录状态。

### 4.4 设置页加载与保存

1. `useInitialSettings` 并发发 `SETTINGS_GET`、`PROFILE_GET`、`AI_PROVIDERS_GET`。
2. 编辑时由 `saveQueue.ts` 按类别防抖：设置 200ms、画像 600ms、AI 接口 500ms。失败且期间没有新编辑时按原间隔重排；`visibilitychange` 隐藏、`pagehide`、`beforeunload` 时立即发出未保存内容。
3. 简历导入：`resumeParser.ts` 解析文件 → `AI_RESUME_EXTRACT`（多份材料分段提取）→ `profileImport.ts` 合并为画像草稿 → 用户确认后保存。

### 4.5 扩展内更新

1. `UpdatePanel` 按渠道（正式 / 预览）调 `fetchLatestRelease`，GitHub Releases API → `parseRelease` → 与已安装版本比较。
2. 用户点「立即更新」并在确认框里确认后，**同步**进入 `installRelease`，第一步就是 `showDirectoryPicker()`。中间不能有任何 `await`，否则浏览器丢弃用户手势，文件夹选择窗口不会弹出。
3. 校验所选文件夹的 `manifest.json` 与当前运行的扩展是同一份安装 → 下载 zip → SHA-256 校验 → 解压（带路径守卫）→ 校验包内 manifest（同 key、同 id、版本更高）→ 写前再确认一次文件夹 → 覆盖写入 → 删除不再存在的 `assets/` 旧文件。
4. 写 `reopenAfterUpdate` 标记 → `chrome.runtime.reload()`。background 的 `onInstalled` 读到标记后打开 `options.html#updated`。

这一流程依赖构建产物文件名固定（`assets/[name].js`，无哈希）：同名覆盖即可完成更新。

---

## 5. 构建

`npm run build` → `vite build`，配置在 `vite.config.ts`：

- **React 页面**：`extension-pages/*.html` 是 Rollup 入口，产物 `dist/*.html` + `dist/assets/[name].js` / `[name].css`。`chunkFileNames` 对 `badge`、`profile` 两个共享块写死名称；不做代码分割、不加哈希。
- **运行时脚本**：自定义插件对 `src/background`、`src/content`、`src/common` 下的每个 `.ts` **逐文件**用 esbuild 转译成同路径 `.js`（不打包），manifest 直接指向这些路径。只有类型的文件（如 `types.ts`）不产出。
- **原样复制**：`manifest.json`（开发构建时经 `toDevManifest` 加「 · dev」）、`icons/`、`src/vendor/`。
- `JFA_RELEASE=1` 时跳过开发标记，发版脚本使用。

`npm run dev` 只用于调样式：侧栏预览页加载 `dev/browse-preview-chrome.ts` 模拟 chrome API 和虚构岗位，扩展能力需要构建后加载 `dist/`。

### 发版 `npm run release`

`scripts/release.ts`：检查 manifest 有 `key`、预览包必须四段版本号、工作区干净 → `npm test` → `JFA_RELEASE=1` 构建 → 把 `dist/` 打成 zip（manifest 在根目录）→ `gh release create`（`--prerelease` 发预览）。`--dry-run` 只构建打包。

---

## 6. 测试与质量门

| 命令 | 内容 |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit`，strict + `noUncheckedIndexedAccess`，全仓零错误 |
| `npm run lint` | ESLint（`typescript-eslint` recommended），零警告 |
| `npm test` | `tsx scripts/test.ts`，当前 195 条，全部通过 |
| `npm run build` | 见上节 |

CI（`.github/workflows/checks.yml`）在 `main`、`dev`、`refactor/**`、`agent/**` 等分支和所有 PR 上依次运行 `npm ci` → lint → typecheck → test → build。

### 测试结构

- `scripts/test.ts` 按固定顺序加载套件：`build`、`platforms`、`profile`、`filters`、`ai`、`update`、`badge`、`saveQueue`、`options`、`sidepanel`、`ensure`、`confirm`。`npm test -- update ensure` 只跑名字以这些前缀开头的套件。
- `scripts/tests/harness.ts` 提供 `test` / `testAsync` / `section`、`loadFixture`、`memoryChrome`（内存版 `chrome.storage`）、`installChrome`、`partialJob`（构造不完整的岗位样本）。
- 纯逻辑模块直接 import 测；内容脚本先用 esbuild 转译（`runtimeScript`），再在 `vm.runInNewContext` 里配桩运行。
- 只测逻辑，不测界面。部分测试会读取 `.tsx` / `.css` 源码做结构断言（例如 `confirm.test.ts` 检查确认弹层样式规则），改 CSS 选择器时要同步改断言。

---

## 7. 改代码时去哪里

| 想改 | 先看 |
| --- | --- |
| 新的 BOSS 接口或字段变化 | `common/platforms.ts`（归一化）+ `content/sniffer.ts` 的 `matchApi`（字面量副本）+ `platforms.test.ts` 的样本 |
| 匹配提示词 | `common/ai/prompts.ts`；改输出结构时提升 `background.ts` 里的 `prompt-vN` |
| 新增 AI 协议 | `common/ai/providers.ts`（协议与预设）+ `common/ai/client.ts`（请求/解析）+ `types.ts` 的 `Protocol` |
| 设置项 | `types.ts` 的 `Settings` → `constants.ts` 的 `defaultSettings()` → `settingsStore.mergeSettings` → 设置页对应 Tab。只加字段，不改名 |
| 侧栏展示规则 | 先改 `browseModel.ts` / `batchQueue.ts` / `commTab.ts` 并补测试，再改 `views.tsx` |
| 更新流程 | 纯逻辑 `common/update.ts`，浏览器层 `extension/update.ts`；保持点击后立即进入文件夹选择 |
| 样式 | 当前仍以页面级 CSS 为主（`--jp-*` 变量），Tailwind 统一按 `docs/refactor-plan.md` 的 P6 进行 |
