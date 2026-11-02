# AGENTS.md

给接手开发的人和 agent 的项目上下文。修改前先读这一页；设计相关的改动再读 `DESIGN.md` 和 `docs/settings-ui-spec.md`。

## 这个项目是什么

Chrome / Edge 扩展（Manifest V3）：浏览 BOSS直聘 或 前程无忧 时被动收录岗位，结合本机保存的个人画像，调用用户自己配置的 AI 接口逐个分析岗位匹配度。

技术栈：Vite 6 + React 19 + Tailwind CSS v4 + shadcn/ui（Radix）。扩展页面在 `extension-pages/`，业务代码在 `src/`，别名 `@` 指向 `src`。

## 常用命令

```bash
npm run build     # 构建到 dist/，然后把 manifest、icons、background、content、common、vendor 原样复制过去
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
- **保存节奏**：设置 200ms、画像 600ms、AI 接口 500ms 防抖；失败后重新排队；页面关闭前把未保存的内容写出去。改动保存逻辑时要保住这几点。
- **更新流程里有一处不能动的顺序**：点击安装后必须立即弹出文件夹选择窗口（保留用户点击手势），中间不能先 `await` 其他异步操作。

## 现有模块速查

- `src/react/options.jsx` — 设置页（React）。四个标签页的界面代码集中在文件末尾。
- `src/react/UpdatePanel.jsx` — 设置页里的「关于与更新」。
- `src/ui/options.js` — 旧版（非 React）设置页，只被仓库根目录和 `dev/` 的 HTML 引用。改设置项的文案时不要漏掉它，直到它被删除。
- `src/common/constants.js` — 存储 key、消息类型、默认设置与默认筛选条件。
- `src/common/profile.js` — 画像结构、清洗、合并、完整度评分（11 项）。
- `src/common/ai/providers.js` — 4 种协议、预设供应商、清洗与校验。
- `src/ui/resumeParser.js` — PDF / DOCX 解析。
- `src/components/ui/` — shadcn/ui 组件。
- `scripts/test_logic.mjs` — 唯一的测试入口，只测逻辑，不测界面。内容脚本用 `vm` 加桩测试。

## 安全与提交规矩

这个仓库是公开的，且用户会拿它求职。

- 不提交简历、个人画像、真实 API Key、真实联系方式。
- 不发消息、不投递到任何真实招聘方；不做反检测相关的功能。
- 以下路径已在 `.gitignore` 中，不要强行提交：`PRODUCT.md`、`.impeccable/`、`.playwright-cli/`、`docs/screenshots/ui-audit/`。
- `origin` 是上游仓库，只读；不要往 `origin` 推送。
- 提交信息用中文，结尾加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
