# AGENTS.md

给接手开发的人和 agent 的项目上下文。修改前先读这一页；设计相关的改动再读 `DESIGN.md` 和 `docs/settings-ui-spec.md`。

## 需求与协作入口

- 用户用自然语言提需求即可。按 `docs/agents/workflow.md` 自动选择澄清、规格、拆分、实现与审查流程；有可自动调用的 skill 就使用，没有则按仓库流程执行，不要求用户逐步敲命令。
- 开发、领取任务、提交 PR 或跨设备交接前，读 `docs/agents/collaboration.md`，从 GitHub 查询依赖和占用状态，通过原子创建远端任务分支领取。进度、阻塞和交接写回 issue / PR。
- 云端首次接手读 `docs/agents/cloud-start.md`。本机、云端和其他厂商的 Agent 都以仓库文档与 GitHub 状态为准，不依赖私人 skill 或聊天记忆。

## 这个项目是什么

Chrome / Edge 扩展（Manifest V3）：浏览 BOSS直聘 时被动收录岗位，结合本机保存的个人画像，调用用户自己配置的 AI 接口逐个分析岗位匹配度。

技术栈：Vite 6 + React 19 + Tailwind CSS v4 + shadcn/ui（Radix）。扩展页面在 `extension-pages/`，业务代码在 `src/`，别名 `@` 指向 `src`。

## 常用命令

```bash
npm run build     # 构建到 dist/，开发产物名称带 · dev；发布脚本使用正式名称
npm run dev       # Vite 开发服务器（只方便调样式，扩展能力需要构建后加载 dist/）
npm test          # 逻辑测试：node scripts/test_logic.mjs
npm run release   # 打包发布，需先确认 build 通过
```

验证界面改动的标准流程：`npm run build` → 浏览器扩展管理页对已加载的 `dist/` 点「重新加载」→ 打开设置页截图。改完跑一次 `npm test`。

## 必须遵守的硬约束

- **存储字段不能改名或改结构**。设置的 key 是 `STORAGE_KEYS.settings`，画像、岗位、AI 接口各有自己的 key。用户已经有数据，改名会直接丢数据。
- **`showBadge` 字段被内容脚本硬编码读取**。`src/content/` 下的文件不经过打包（被原样复制），不能 `import` 常量文件，所以键名是字面量写死的。改这个字段名必须同时改内容脚本。
- **不引入代码分割、不改构建输出文件名**。构建产物用固定文件名（`assets/[name].js`，无哈希），扩展内自动更新靠覆盖同名文件完成；加哈希会让每次发版都残留旧文件。
- **后台消息类型名不变**：`SETTINGS_GET/SAVE`、`PROFILE_GET/SAVE/CLEAR`、`AI_PROVIDERS_GET/SAVE`、`AI_PROVIDER_TEST/MODELS`、`AI_RESUME_EXTRACT`、`JOB_LIST_REQUEST`、`JOB_EXPORT_REQUEST`、`JOB_CLEAR_REQUEST`。界面重构不应该新增或改名消息。
- **保存节奏**：设置 200ms、画像 600ms、AI 接口 500ms 防抖。保存失败且没有更新的编辑时，按原间隔重新排队。页面隐藏、`pagehide`、`beforeunload` 时立即发出未保存内容，不能只靠组件卸载。实现在 `src/pages/options/saveQueue.js`。
- **更新流程里有一处不能动的顺序**：点击安装后必须立即弹出文件夹选择窗口（保留用户点击手势），中间不能先 `await` 其他异步操作。

## 现有模块速查

`src/` 按「谁在用」分层：`common/` 纯逻辑（不碰 DOM、不直接碰 chrome API），`extension/` 扩展 API 适配，`background/`、`content/` 是扩展运行时脚本，`pages/` 是三个 React 页面，`components/ui/` 是 shadcn 组件，`vendor/` 是第三方产物。

- `src/pages/options/` — 设置页（React）：`OptionsApp.jsx` 是框架与业务编排，四个标签页、共享控件、初始加载及保存队列同目录。入口是 `extension-pages/options.html`，构建后由 `dist/options.html` 加载。
- `src/pages/options/UpdatePanel.jsx` — 设置页里的「关于与更新」。
- `src/pages/sidepanel/` — 侧栏：`SidepanelApp.jsx` 编排，`views.jsx` 视图、`browseModel.js` 列表/详情模型、`batchQueue.js` 批量队列、`commTab.js` 沟通页。
- `src/pages/popup/PopupApp.jsx` — 工具栏浮窗。
- `src/common/constants.js` — 存储 key、消息类型、默认设置与默认筛选条件。
- `src/common/profile.js` — 画像结构、清洗、合并、完整度评分（11 项）。
- `src/common/ai/providers.js` — 4 种协议、预设供应商、清洗与校验。
- `src/common/text.js` — 文本小工具（分隔字符串转数组等）。
- `src/extension/messages.js` — 页面 → background 的消息发送与超时处理。
- `src/extension/update.js` — 扩展内更新（下载、校验、覆盖安装）。
- `src/extension/resumeParser.js` — PDF / DOCX 解析。
- `src/components/ui/` — shadcn/ui 组件。
- `scripts/test_logic.mjs` — 唯一的测试入口，只测逻辑，不测界面。内容脚本用 `vm` 加桩测试。

## 安全与提交规矩

这个仓库是公开的，且用户会拿它求职。

- 不提交简历、个人画像、真实 API Key、真实联系方式。
- 不发消息、不投递到任何真实招聘方；不做反检测相关的功能。
- 以下路径已在 `.gitignore` 中，不要强行提交：`PRODUCT.md`、`.impeccable/`、`.playwright-cli/`、`docs/screenshots/ui-audit/`。
- `origin` 是上游仓库，只读；不要往 `origin` 推送。
- 提交信息用中文，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Agent skills

### Issue tracker

议题和规格保存在个人 GitHub 仓库。操作前参见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认分诊标签。分诊时参见 `docs/agents/triage-labels.md`。

### Domain docs

领域文档采用单上下文布局。探索领域代码前参见 `docs/agents/domain.md`。
