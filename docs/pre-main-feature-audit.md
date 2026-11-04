# 合 main 前功能体检

基线：`feat/vite-ui-roadmap` @ `c55ca331`（本单分支 `agent/issue-83` 与之相同）。对照日期 2026-11-04。只读代码、规格和 GitHub issue / PR，没有改功能，没有合 `main`，没有打 Release，没有改 `README.md`（与 #82 并行）。

没有在已登录的 BOSS直聘 / 前程无忧上点过收录、打分或「打开原岗位」。下面凡写「真机未验」，都是这个缺口，不是推断线上已经坏了。

分级：

- **P0**：同学试用会直接踩坑，或会碰到真实招聘方 / 隐私。合 `main` 前要改，或在对外说明里写死。
- **P1**：体验明显缺一块，但还能绕开。合 `main` 前强烈建议处理，或写进已知限制。
- **P2**：打磨、挂单未做、或残余风险可后置。

条目统计：**P0 × 2，P1 × 8，P2 × 9**。

## 对照后可维持的行为

这些和现行规格或已合入工单一致，不单列成缺陷：

- 设置四页是「个人画像 / 模型接口 / 岗位筛选 / 通用与隐私」。更新日志是 `#changelog`，不是第五个导航项（`src/react/settings/pageHash.js`，`docs/settings-ui-spec.md`）。
- 侧栏齿轮 `OPEN_OPTIONS` 打开设置；缺模型时「前往设置」落到 `#ai`；画像完整度不足和简历页「前往设置完善画像」落到 `#profile`（`src/react/sidepanel.jsx`）。
- 侧栏「开启过滤」和设置「启用本地筛选」写的是同一个 `settings.filters.enabled`（`docs/job-list-and-preference-spec.md`、`docs/settings-ui-spec.md`）。
- 过滤开启时，自动打分跳过会被隐藏的新岗位（`src/common/filters.js` `autoScoreUids`）。自动分析默认关。
- 雷点规则已写进匹配提示词，缓存键为 `prompt-v4`（`src/common/ai/prompts.js`、`src/background/background.js` `scoreOne`）。这是 #25 的落地，见 P2-1。
- 画像页只有一个「雷点」标签入口，同时显示 `avoidKeywords` 与 `dealbreakers`（`src/react/settings/ProfileTab.jsx`）。
- `fillAndSend` 的现行实现只点击「立即沟通」一类入口，不往聊天框填字、不点发送（`src/content/collector.js`）。风险在「会点沟通入口」，见 P0-2。
- 分析抽屉和批量队列的 CSS 数值与 #72 终锁一致（`src/react/sidepanel/browse.css`）。预览页量距见 PR #73，扩展真机未复测，见 P2-7。
- `changelogEntries` 按 `publishedAt` 降序，缺时间戳再用 `compareVersions`（#79 / PR #81）。`selectPreviewRelease` 在拉回的列表里取最高版本（#77 / PR #77）。拉列表的窗口仍只有 20 条，见 P2-6。

## P0

### P0-1 对外说明还在描述另一套侧栏

- **现象**：同学若按当前 `README.md` 找功能，会去找顶部「岗位库 / 当前岗位」双模块、子页「岗位信息 / 公司画像 / 打招呼」、底栏「批量分析」「批量导出」，以及「新窗口打开并不打断当前浏览」。现侧栏是单一「岗位库」，当前岗位是顶栏图标；详情是「岗位 / 分析 / 公司 / 简历 / 流程」五页；未勾选时主按钮是「进入工作台」（见 P1-1）；勾选后是「智能分析」。截图 `docs/screenshots/01`–`05` 挂在这份说明下。
- **证据**：`README.md`「界面预览」「核心功能」；现入口 `extension-pages/sidepanel.jsx` → `src/react/sidepanel.jsx`，页签在 `src/react/sidepanel/views.jsx` 的 `DETAIL_TABS`。打开沟通使用 `chrome.tabs.create({ url, active: true })`（`src/background/background.js` `openJobChat`）。#82 负责重写 README，本单按约定不改它。
- **分级**：P0
- **建议**：合 `main` 前必须带上 #82 的说明，或在发布说明里明确「不要按仓库里这份 README 找按钮」。本单不改 README。

### P0-2 「打开沟通并复制」默认不确认，并会点招聘站的沟通入口

- **现象**：流程页按钮「打开沟通并复制」会复制招呼语、前台打开岗位页，再让内容脚本点击「立即沟通 / 继续沟通」等按钮。默认设置 `privacy.confirmBeforeSend` 为 `false`，没有确认框。文字不会自动填进聊天框，也不会被插件点发送；招聘方仍可能看到新的沟通会话。按钮文案和设置项「发送招呼语前确认」都容易让人以为只是复制。
- **证据**：`src/common/constants.js` `defaultSettings().privacy.confirmBeforeSend === false`；`src/react/sidepanel.jsx` `sendGreeting`；`src/background/background.js` `openJobChat`；`src/content/collector.js` `fillAndSend`（注释写明只打开沟通，随后 `start.click()`）。常量注释仍写「填入聊天框并发送」（`MSG.SEND_GREETING`），和现行内容脚本不一致。
- **分级**：P0
- **建议**：合 `main` 前在 #82 或试用须知里写明一句：此按钮会打开招聘页并点击「立即沟通」，不会自动发出招呼语，对方可能看到会话。若不能接受「默认无确认」，另开小单把该开关默认打开。本单不改代码。明确不做的是自动填字和自动发送，不是「完全不接触招聘页」。

## P1

### P1-1 未勾选时的主按钮「进入工作台」打开的是设置页

- **现象**：没有勾选岗位时，底栏主按钮写「进入工作台」，点击后和齿轮一样调用 `OPEN_OPTIONS`，没有单独的工作台。同学按字面会以为还有一层处理界面。
- **证据**：`src/react/sidepanel/views.jsx` `ListFooter`；`src/react/sidepanel.jsx` `onWorkbench={() => send(MSG.OPEN_OPTIONS)}`。仓库里没有工作台路由或页面。
- **分级**：P1
- **建议**：合 `main` 前强烈建议另单改成「设置」或去掉该按钮。若来不及改代码，写进已知限制：未勾选时的主按钮实际打开设置。

### P1-2 流程页有步骤条，但第一步「已准备」在现行侧栏里写不进去

- **现象**：详情「流程」有三步：准备招呼语、尝试打开沟通、手动确认发送。列表按钮文案会随状态变成「打招呼 / 继续流程 / 确认发送 / 查看流程」。现行 React 侧栏只在打开沟通成功时写入 `opened`，在用户确认时写入 `sent`，编辑或保存招呼语不会写入 `prepared`。因此新用户会一直停在「待打招呼」，直到去点沟通。流程页同时摆出「重新生成 / 复制 / 打开沟通并复制 / 标记已发送」，不是 #36 要求的「每种状态只有一个主操作」。没有「后续流程 / 待扩展」占位，也没有虚构面试状态。
- **证据**：`src/react/sidepanel/browseModel.js` `FLOW_STATUS_LABELS` / `FLOW_ENTRY_LABELS`；`src/react/sidepanel/views.jsx` `FlowStatus`、流程页按钮；`src/react/sidepanel.jsx` 仅 `setProgress(..., 'opened' | 'sent')`。旧页面 `src/ui/sidepanel.js` 会在保存招呼语时写 `prepared`，但 Vite 构建用的是 `extension-pages/sidepanel.html`，旧页面不进 `dist/`。#36 仍开放且 `blocked`。
- **分级**：P1
- **建议**：合 `main` 前可写进已知限制：流程状态只有「待打招呼 / 待确认发送 / 已发送（手动确认）」这几档会在新侧栏里出现；「招呼语已准备」要等 #36。不建议为了占位再画不能点的后续步骤。

### P1-3 空描述打分和「打开原岗位」刷 JD 没有真机验收，超时仍会出分

- **现象**：描述为空时，打分前会串行补抓（点已打开列表里的卡片，否则后台短开再关掉），大约 6 秒等不到仍按现有内容打分。空描述时点「打开原岗位」会前台打开并等待嗅探，超时再刮详情页可见正文，写回原来的 `uid`。已有描述只开标签。选择器未对当前线上 DOM 验收。详情渲染慢、登录墙、或招聘页在更新扩展后没有重新加载时，侧栏可以仍然没有 JD，同时分析已经给出分数。
- **证据**：`src/common/ensureDescription.js`、`src/background/background.js` `scoreOne` / `openOriginalJob`；`src/content/collector.js` `scrapeVisibleJobDetail`。PR #76（#74）写明没有登录态真机。PR #80（#78）写明没有在 BOSS / 51job 上点「打开原岗位」，并写了选择器与约 7.5 秒超时的残余。逻辑测试覆盖决策和合并，不覆盖现网页面。
- **分级**：P1
- **建议**：合 `main` 前强烈建议用同学自己的账号抽测两条：BOSS 列表空描述打分、空描述点「打开原岗位」。来不及则写进已知限制：空 JD 超时仍出分；描述以岗位页上的正文为准，分数可能建立在标题和少量字段上。不要在试用里承诺「一点就同步到完整 JD」。

### P1-4 「不喜欢」已按自然语言抽屉落地，开放工单和列表规格仍是另一套

- **现象**：列表和详情的「不喜欢」打开底抽屉，整句写入雷点（`dealbreakers`），toast「已写入画像」，不自动重跑分析。没有预设原因，自由说明也不进 `preference.notes`。已有匹配分保持原样，直到用户再分析。`notes` 在提示词里表示「可以接受」、不降分，所以整句进雷点是 #65 的有意选择。
- **证据**：#65 已关闭，PR #69；`src/react/sidepanel.jsx` `saveDislike`；`src/common/profile.js` `appendDealbreaker`。仍开放的 #26 要求预设原因进规避关键词、自由说明进 notes，验收勾选全空。`docs/job-list-and-preference-spec.md` 仍写预设原因 +「给 AI 的说明」。#37 还要把 #26 接进新布局，状态 `blocked`。
- **分级**：P1
- **建议**：合 `main` 前不要按 #26 原文再做一套芯片反馈。写进已知限制：不喜欢是整句雷点，已有分数不变，需要的话用「重新分析」或智能分析里的「全部重新分析」。#26 / #37 应改写成「已由 #65 覆盖」或收窄剩余缺口，避免下一个 agent 按旧验收返工。

### P1-5 能收藏，不能按收藏回看

- **现象**：列表和详情可以收藏 / 取消收藏，数据走现有星标字段。没有收藏视图，筛选弹层里也没有这一项。界面不说明收藏岗位不会因为岗位库超限被自动清掉。清空和删除仍会删掉收藏。
- **证据**：`src/react/sidepanel.jsx` `JOB_STAR_TOGGLE`；`src/react/sidepanel/views.jsx` 的 `FilterSheet` 只有平台和匹配结果。设置「通用与隐私」写明上限和「收藏的岗位不会被淘汰」（`docs/settings-ui-spec.md`）。#35 仍开放且 `blocked`。
- **分级**：P1
- **建议**：合 `main` 前写进已知限制：收藏只防超限自动清理，不提供「只看收藏」。回看要自己在列表里找星标。#35 保持挂单。

### P1-6 单条分析失败主要靠一条会消失的提示

- **现象**：点已有分数会打开「分析」页，不发新的 AI 请求；「分析 / 重新分析」才请求。失败时 `notify` 约 2.6 秒后消失，分析页不保留失败原因和重试以外的常驻错误。旧结果还在（请求失败不会先清掉已有 `match`）。未配置模型时有常驻「尚未配置模型接口」条，这条是好的。
- **证据**：`src/react/sidepanel.jsx` `analyze`、`notify` 的 2600ms；`src/react/sidepanel/views.jsx` `AnalysisBody` 只有「尚未分析」或已有结果，没有失败区。#32 仍开放，验收要求失败原因不能只靠会消失的通知。
- **分级**：P1
- **建议**：合 `main` 前写进已知限制：单条失败看当次提示，错过就再点「分析」。批量失败可以留在队列抽屉里重试（`QueueDrawer`），这条比单条完整。#32 的其余缺口（进行中禁重复提交已有一部分）随该工单做。

### P1-7 浏览 BOSS 时页面上会被插入「HR 活跃优先」

- **现象**：在 BOSS 列表，内容脚本会插入按钮「HR 活跃优先」。打开后按 HR 在线状态重排当前已渲染的岗位行，并打「HR活跃」标记。这不是 BOSS 自己的控件。设置和 README 都没有这一项。它不发额外请求。
- **证据**：`src/content/collector.js` `ensureFreshButton` / `applyFreshSort`。构建会原样复制 `src/content/`（`vite.config.js`）。
- **分级**：P1
- **建议**：合 `main` 前在试用须知写明：BOSS 页面上的「HR 活跃优先」来自扩展，只重排当前列表，关掉会尽量还原。若试用范围不想改招聘站 DOM，另单再隐藏；本单不改。

### P1-8 扩展名叫 Offercome，设置里仍叫「岗位筛选助手」

- **现象**：`manifest.json` 的名称是 Offercome（#46）。设置侧栏品牌、文档标题是「岗位筛选助手」，品牌标记是漏斗图标，不是产品 Logo。侧栏页面标题同样是「岗位筛选助手」（`extension-pages/sidepanel.html`）。同学会看到两个名字。
- **证据**：`manifest.json`；`src/react/settings/SettingsShell.jsx`；`extension-pages/sidepanel.html`。Logo 出图按本单范围另开落码，仓库里没有待合入的 Logo 资源任务文件。
- **分级**：P1
- **建议**：合 `main` 前对外统一称 Offercome。设置里的旧名和正式 Logo 可后置，不要在没有出图锁的情况下现画图标。

## P2

### P2-1 #23 的「提示词没写雷点规则」已经过时

- **现象**：#23 仍开放、`needs-triage`，正文写打分提示词没有规避关键词和一票否决。现行提示词把两个字段都当作雷点：语义判断、字面命中只作线索、命中则降分写入 risks/gaps，不把 `eligible` 设为 false。缓存键已升到 `prompt-v4`。
- **证据**：#23、已关闭的 #25、`src/common/ai/prompts.js` 第 5–7 条、`scoreOne` 的 `prompt-v4`。
- **分级**：P2
- **建议**：合 `main` 前不必再按 #23 原文改提示词。另做一次工单改写或关闭，避免重复实现。用真实岗位回归雷点降分仍可后置。

### P2-2 列表整治 #29 / #32–#38 有的已经长在现侧栏上，工单仍全部开放

- **现象**：#29 仍是 `needs-triage`。#31 已关闭（浏览与详情往返，PR #39）。#32–#38 仍是 `ready-for-agent` + `blocked`，依赖链没解开，但后续视觉单已经把一部分行为做进现侧栏。和工单相比，还没做或只做了一部分的有：

  | 工单 | 现况 |
  | --- | --- |
  | #32 查看匹配与单项分析 | 点分数只打开结果；重新分析单独按钮。失败提示会消失，见 P1-6 |
  | #33 批量分析、准备与失败恢复 | 有串行队列、取消剩余、失败重试、底栏细条。没有「准备招呼语」批量，也没有「处理下一个」。队列只在当前侧栏会话，刷新不重放 |
  | #34 筛选与设置同步 | 开关已双向同步，文案仍是「开启过滤 / 启用本地筛选」，不是工单里的「应用筛选规则」。筛选弹层没有「调整规则」深链，也没有流程状态筛选 |
  | #35 收藏回看与删除 | 星标和删除确认在。没有收藏视图，见 P1-5 |
  | #36 流程以打招呼为第一步 | 步骤条和列表文案在，状态写不齐，见 P1-2 |
  | #37 新布局接入不喜欢 | 抽屉已按 #65 接入，不是 #26 的预设原因对话框，见 P1-4 |
  | #38 当前可见项导出 | 勾选后导出的是当前可见且选中的 CSV。未勾选时不能导出「当前可见列表」。设置页「导出岗位」导出的是整个岗位库 |

- **证据**：上述 issue 状态；`src/react/sidepanel.jsx` `batchExport` / `startAnalysis` / `FilterSheet` 调用；`src/react/options.jsx` `JOB_EXPORT_REQUEST`（全库）。#33 原文允许队列不跨刷新。
- **分级**：P2（其中 P1-1 至 P1-6 已单列的体验缺口不要降级）
- **建议**：这些工单继续挂着，合 `main` 前不必为了「工单还开着」重做已落地的列表。对外说明不要承诺收藏视图、流程筛选、未勾选即导出当前视图、批量准备招呼语。

### P2-3 筛选弹层没有「偏低」，也筛不了流程

- **现象**：匹配结果选项是全部 / 强匹配 / 较匹配 / 一般 / 未分析。档次里还有「偏低」（`weak`），弹层选不到。流程状态不能当筛选条件。
- **证据**：`src/react/sidepanel/views.jsx` `FilterSheet`；`src/react/sidepanel.jsx` `verdictNames` 含 `weak`；#34 要求流程筛选。
- **分级**：P2
- **建议**：可后置。要找偏低岗位时用排序「匹配优先」或打开详情看分数。

### P2-4 预览更新和更新日志只看最近 20 条发布

- **现象**：#77 改为在拉回的预发布里用版本号取最高，不再用列表第一条。请求仍是 `per_page=20`（`releaseRequest`）。GitHub 列表若按 tag 字符串排序，更高的四段版本可能落在这 20 条之外，预览检查和更新日志都会漏掉它。#79 只排序已经拉回来的条目。两处都没有在扩展里对真实 Release 列表目视过。
- **证据**：`src/common/update.js` `releaseRequest`、`selectPreviewRelease`、`changelogEntries`；PR #77、PR #81 的验证说明；设置文案「按发布时间排序」（`src/react/settings/ChangelogPage.jsx`）。
- **分级**：P2
- **建议**：当前预览号停在 `1.0.3.12` 附近时，20 条通常够用，合 `main` 前可不修。走预览通道给同学发包装时，发完在设置里看一眼「可更新到」和日志第一条是不是这次的包。条数再涨时另单翻页或加大 `per_page`。

### P2-5 间距曾经贴死，数值已在预览页量过

- **现象**：#72 之前，分析范围副文和批量队列统计行被 `.job-panel p { margin: 0 }` 贴死。PR #73 改了选择器，并在 `sidepanel-browse-preview.html` 上按终锁表量过 handle、副文、选项、进度条、pill（与 mock 一致）。本仓库没有留下叠图。没有在加载 `dist/` 的扩展里复测这两处。
- **证据**：PR #73；`src/react/sidepanel/browse.css` 中 `.analyze-sheet`、`.job-panel .analyze-sub`、`.queue-summary`、`.queue-chips`。
- **分级**：P2
- **建议**：合 `main` 前若有人打开预览包，顺手看智能分析抽屉和批量队列是否又贴死即可，不单列必修。

### P2-6 摘聊与 Logo 按约定不做

- **现象**：仓库源码和开放 issue 标题里没有「摘聊」实现。#78 / #79 只写「不要改摘聊」，等 UI 一体高保真锁后再开单。设置和侧栏没有聊天记录摘取入口。Logo 仍是扩展图标生成脚本和设置里的漏斗标记，没有单独的出图落码单。
- **证据**：全库检索无摘聊模块；`scripts/make_icons.py` 与 `icons/` 是现有扩展图标；#78、#79 正文。
- **分级**：P2
- **建议**：合 `main` 前对外写明不做：不摘聊天记录，不提供正式 Logo 换图。不要在试用反馈里把这两项当故障。

### P2-7 旧页面和旧预览还在仓库里

- **现象**：仓库根的 `sidepanel.html` / `popup.html` 和 `dev/sidepanel.html` 加载 `src/ui/sidepanel.js`（旧侧栏）。Vite 从 `extension-pages/` 构建，发布 zip 打的是 `dist/`（`scripts/release.mjs`）。从仓库根目录「加载已解压的扩展」会进旧侧栏，和同学应装的包不是同一个界面。README 开发节仍把 `dev/sidepanel.html` 写成界面预览。`dev/mock-chrome.js` 对 `SEND_GREETING` 返回 `mode: 'sent'`，和真内容脚本的「只点沟通」不一致。
- **证据**：根目录 `sidepanel.html`、`extension-pages/sidepanel.html`、`vite.config.js`、`scripts/release.mjs`、`README.md`「开发与测试」、`dev/mock-chrome.js`。
- **分级**：P2
- **建议**：试用包只用 Release zip 或 `npm run build` 后的 `dist/`。合 `main` 前不必删旧文件（测试仍会读 `src/ui/sidepanel.js`）。#82 不要再把 `dev/sidepanel.html` 写成当前界面。

### P2-8 「可以接受」写进备注，当前这条风险不会马上消失

- **现象**：分析页「可以接受」把句子写入 `preference.notes`（前缀「可以接受：」），toast「已写入画像」，不重跑。提示词要求 notes 里写明可以接受的事项不要降分。当前岗位上这条风险还在，直到再次分析。抽屉文案「后续同类可不提示」取决于模型是否照做。
- **证据**：`src/react/sidepanel/views.jsx` `AcceptRiskSheet`；`src/react/sidepanel.jsx` `onAcceptRisk`；`prompts.js` 第 7 条。
- **分级**：P2
- **建议**：可后置。已知限制里可带一句：接受风险和「不喜欢」都只影响之后的分析。

### P2-9 重新生成招呼语会清掉未保存草稿

- **现象**：「重新生成」成功后删掉内存里的草稿，并向 `GREETING_SAVE` 写入空字符串，再用新的标准档填回。按钮是显式的，没有「未保存编辑将被覆盖」的第二步确认。
- **证据**：`src/react/sidepanel.jsx` `regenerate`。#36 要求重新生成不要悄悄覆盖未保存编辑。
- **分级**：P2
- **建议**：可后置。试用时先复制再点重新生成。

## 合 main 前建议

### 必修（或必须写进对外说明）

1. **#82 的 README 一起走。** 当前 README 和截图对不上现侧栏（P0-1）。本仓库这份 README 不要单独当成同学指南发出。
2. **写明「打开沟通并复制」的真实行为**（P0-2）：前台打开招聘页并点击「立即沟通」；不自动发出招呼语；默认没有确认框。不能接受无确认时，另单改 `confirmBeforeSend` 的默认值，不要在合 `main` 的同一刻临时改存储默认值而不写迁移说明。
3. **试用包来自 `dist/` / Release zip**，不要把仓库根目录加载成扩展（P2-7）。稳定通道的 `releases/latest` 在本分支合入 `main` 并发布之前，仍不是这套 Vite 侧栏。

### 可声明的后置项（建议写进试用须知，不挡合入）

- 不做摘聊，不做 Logo 换图（P2-6）。
- 不自动发送招呼语；也不要理解成「完全不会打开招聘站沟通」。
- 空 JD 可能仍出分；「打开原岗位」刷新 JD 未在现网验收（P1-3）。
- 「不喜欢」是整句雷点，不改已有分数；没有预设原因（P1-4）。不要按 #26 再做一版。
- 未勾选时「进入工作台」打开设置（P1-1），除非合入前另单改掉文案。
- 没有收藏视图、没有流程筛选、未勾选不能导出「当前筛选结果」（P1-5、P2-2、P2-3）。设置里的导出是整个岗位库。
- 流程里的「招呼语已准备」在新侧栏不会自动记上（P1-2）。
- 单条分析失败看当次提示；批量失败在队列里（P1-6）。
- BOSS 页面上的「HR 活跃优先」是扩展插入的（P1-7）。
- 设置里的名字仍是「岗位筛选助手」（P1-8）。
- 预览通道和更新日志只覆盖最近 20 条 Release（P2-4）。#77 / #79 的排序逻辑有单测，扩展内目视未做。
- 分析抽屉和批量条的间距已在预览页按 #72 量过，扩展里未复测（P2-5）。
- #32–#38、#26、#23、#29 保持开放。已落地的部分不要为了关单推倒重做。

### 本单没有做的检查

- 未运行 `npm test` / `npm run build`（没有改逻辑或界面）。
- 未加载 `dist/`，未做深浅色或窄屏截图。
- 未用 BOSS / 51job 账号验证收录、空 JD、打开原岗位、立即沟通。
