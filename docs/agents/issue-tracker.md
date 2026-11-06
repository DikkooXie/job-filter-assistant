# Issue tracker: GitHub

议题和规格保存在 `DikkooXie/offercome` 的 GitHub Issues。
使用 `gh` 时显式指定 `--repo DikkooXie/offercome`；
API 调用使用 `repos/DikkooXie/offercome/...`。
本机 `origin` 是只读上游；不同设备的远端可能不同，写入前按 `collaboration.md` 核实 `personal` 指向。

## 常用操作

- 创建议题：`gh issue create --repo DikkooXie/offercome`
- 查看议题：`gh issue view <number> --repo DikkooXie/offercome`
- 列出议题：`gh issue list --repo DikkooXie/offercome`
- 修改标签：`gh issue edit <number> --repo DikkooXie/offercome --add-label <label>`
- 关闭议题：`gh issue close <number> --repo DikkooXie/offercome`

发布到 issue tracker 时创建 GitHub issue；获取工单时查看对应 issue。
用户已授权在本仓库开展研发协作时，任务领取、进度、阻塞、交接评论和开发 PR 属于该授权范围；按 `collaboration.md` 执行。联系仓库之外的人、合并、发布等动作仍须符合当次用户授权。

## Pull requests as a triage surface

**PRs as a request surface: no.**
