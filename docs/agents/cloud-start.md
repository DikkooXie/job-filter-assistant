# 从 GitHub 接手

本机、云端与 Gorkbot 等执行端共用此入口。规格和执行规则都在仓库内，不需要复制用户目录中的 skill、简历或浏览器配置。

## 环境

- Node.js 22、npm、Git 和 GitHub CLI `gh`；仓库内 `package-lock.json` 固定依赖，使用 `npm ci`。
- 通过 GitHub 集成或 `gh` 的已登录身份获得本仓库的代码和 issue / PR 读写能力。公共代码可以匿名拉取；领取任务、评论和推送需要 GitHub 授权，clone 本身不会赋予写权限。
- 浏览器验证需要 Chromium / Chrome / Edge。逻辑测试和构建不需要真实 AI Key 或求职账号；界面使用合成数据。没有浏览器时报告验证缺口，不虚构截图或扩展功能测试。

首次 clone：

```bash
git clone https://github.com/DikkooXie/job-filter-assistant.git
cd job-filter-assistant
git remote add personal https://github.com/DikkooXie/job-filter-assistant.git
npm ci
npm test
npm run build
```

已有 clone 先检查 `git status` 与 `git remote -v`；`personal` 已存在时核实 URL，无需重复添加。不要清理其他 session 的工作区。Git 提交身份使用执行平台配置或用户提供的公开 / noreply 身份，不复制其他开发者的邮箱。

## 启动指令

把下面这段交给新 Agent 即可；平台能自动读取 `AGENTS.md` 时也适用：

> 读取仓库根目录 AGENTS.md，按 docs/agents/workflow.md 自动选择流程，按 docs/agents/collaboration.md 查询并领取任务。从 GitHub 父计划 #10 及子任务的最新状态确定可开工项；如已指定 issue，先检查依赖及占用情况。读取规格和全部交接评论，在独立任务分支实施，推送代码和验证证据，通过 issue / PR 汇报。已有任务被占用时，选择另一项符合条件的任务。遵守用户给你的实现范围和合并权限。

指定任务时，在上面补 `本次执行 #<N>`；接手旧 session 时补它的 issue / PR 链接。没有未阻塞且空闲的任务就汇报阻塞，不绕过依赖。

## 恢复与验收

新 session 以远端任务分支、issue 评论和关联 PR 为准。`docs/settings-ui-spec.md` 是这轮界面改造的视觉依据；本机被忽略的原型不作为前置材料。

`dev/browse-preview-chrome.js` 是岗位浏览预览页（`extension-pages/sidepanel-browse-preview.jsx`）用的合成数据和模拟消息服务，不能据此声称 React 设置页或真实扩展已验收。React 入口为 `extension-pages/`；扩展验证从构建出的 `dist/` 加载。界面工单需要补充规格要求的深浅色与宽窄屏证据，以及相关数据 / 交互检查。

GitHub Actions 的 `Checks` 自动运行 `npm ci`、`npm test`、`npm run build`；它验证构建和逻辑，不替代扩展浏览器验收。它也不会自动运行 AI Agent。
