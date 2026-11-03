# 岗位列表整治：跨设备开发交接

设计确认日期：2026-11-03。材料发布：2026-11-04。

用户已确认 A · 紧凑清单，后续只实现 A。四项确认调整：统一“应用筛选规则”与简短说明及设置入口；修复主按钮悬停对比；压缩岗位行并将流程入口与匹配结果同排；以竖向步骤条承载“打招呼”第一步。无需重新选择视觉方案。

## 共享材料与开发基线

规格、原型和截图保存在个人仓库 `agent/issue-30` 分支。它是 THROWAWAY 原型分支，不整体合入正式页面；正式开发仍从 GitHub 当前默认集成分支开始，目前为 `feat/vite-ui-roadmap`。

- [已确认交互和视觉规格](https://github.com/DikkooXie/job-filter-assistant/blob/agent/issue-30/docs/job-list-remediation/README.md)
- [八个开发切片及验收](https://github.com/DikkooXie/job-filter-assistant/blob/agent/issue-30/docs/job-list-remediation/implementation-plan.md)
- [原型走查和可共享截图](https://github.com/DikkooXie/job-filter-assistant/blob/agent/issue-30/docs/job-list-remediation/verification.md)
- [原型源代码](https://github.com/DikkooXie/job-filter-assistant/blob/agent/issue-30/src/react/sidepanel-prototype.jsx)
- [原型样式](https://github.com/DikkooXie/job-filter-assistant/blob/agent/issue-30/src/react/sidepanel-prototype.css)

每张开发工单另附发布提交的永久链接。集成分支暂时没有本目录时，按上述分支链接或工单永久链接读取，不能因此误判规格缺失。规格优先于原型探索源码；原型保留的 B/C 仅为历史，不是候选。

需要亲自运行原型时，先核实 `personal` 指向 `DikkooXie/job-filter-assistant`，再在独立目录检出，避免覆盖正式任务的工作区：

```sh
git fetch personal agent/issue-30
git worktree add --detach ../job-list-prototype-preview personal/agent/issue-30
```

在新建预览目录执行 `npm ci`、`npm run prototype:list`，访问 `http://127.0.0.1:5291/sidepanel-prototype.html?variant=A`。只有此分支提供 `prototype:list`。端口已占用时先核实现有服务；不要终止其他 session 的进程。GitHub 源码链接不是可直接交互的网页部署。

## 开工范围

第一项为 [#31](https://github.com/DikkooXie/job-filter-assistant/issues/31)；先核实其最新正文、评论、原生依赖、关联 PR、标签和任务分支占用。按 `docs/agents/collaboration.md` 原子创建 `agent/issue-31` 领取。不要从原型分支开始生产开发，也不要以任务分支存在为理由另建分支绕过领取。

后续依赖：#34 ← #31；#35 ← #34；#32 ← #31；#36 ← #32；#37 ← #34、#26；#33 ← #34、#36；#38 ← #34。#25/#26 原范围保持，不重复开发。共享侧栏模块可能冲突，应串行合入或先约定边界。

## 稳定定位和兼容约束

以下为定位提示，接手时核实最新代码：

- 正式入口：`extension-pages/sidepanel.jsx` → `src/react/sidepanel.jsx`。旧 `dev/sidepanel.html` 不是当前 React 正式页面。
- 正式侧栏编排包含列表、详情、分析、招呼语和批量队列；后台处理在 `src/background/background.js`，消息与存储常量在 `src/common/constants.js`。
- 规则开关使用既有 `settings.filters.enabled`，设置入口位于 `src/react/settings/FiltersTab.jsx`。#34 统一正式侧栏、设置页、`docs/settings-ui-spec.md`、`docs/job-list-and-preference-spec.md` 的旧文案。
- 沿用既有岗位读取、更新、分析、收藏、删除、招呼语保存、导出消息；不得新增或改名消息协议来实现布局重写。不要改存储字段名称、结构、进度 key、保存节奏、固定构建输出文件名或安装目录选择顺序。
- 岗位筛选决定可见性，AI 匹配分和雷点不隐藏岗位，风险词只提醒。流程继续使用无记录 / `prepared` / `opened` / `sent`；打开沟通不等于发送，只有用户手动确认才能记为发送。
- S1/#31 展示已有结果和状态；搜索组合筛选及规则同步、收藏删除、主动分析、流程推进、反馈、批量、导出分别由后续切片接入。不得为收窄当前工单而删除既有能力；需要暂时保留旧入口时在 PR 说明过渡方式。

## 验证与交付

原型内置八条虚构岗位，作为文案长度、风险/排除、长标题、匹配和流程状态的参考。生产集成验证使用隔离数据与模拟消息，不依赖真实简历、Key、招聘账号，不触达真实招聘方。

每项运行 `npm test`、`npm run build`。UI 需检查 320/390/480px、浅深色、键盘及本工单交互；#31 重点是列表 → 详情 → 返回、查询/选择/滚动/标题焦点恢复、加载/失败/空库、长标题和按钮悬停。390×820 默认至少完整显示三条普通岗位；密度不以裁掉风险信息换取。

2026-11-04 发布前重新运行：`npm test` 为 123 通过、0 失败；`npm run build` 通过，2214 modules，固定输出保留且未加入原型入口。PDF vendor 的 Node 模块浏览器外部化提示仍存在。历史原型浏览器证据见 verification.md；本次发布没有重跑其全部 UI 场景，也没有进行真实扩展验收。

任务完成后推送独立任务分支、创建面向最新集成分支的 PR，附 `Closes #<N>`、规格依据、验证证据与未执行项，在 issue 留交接记录。未经当次授权不自动合并。原型分支仅保存设计材料，不承担正式实现。
