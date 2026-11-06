# GitHub 协作

GitHub 是跨设备的进度来源：规格说明目标，issue 记录任务与交接，任务分支保存代码，PR 记录审查和合并。多端执行同一约定；本地终端、会话名和聊天记忆不充当共享状态。

## 仓库与基线

- 唯一写入目标：`DikkooXie/offercome`。使用 `gh` 时显式写 `--repo DikkooXie/offercome`，API 路径也显式指定仓库。
- 推送使用 `personal` remote，并先确认 URL 指向这个仓库。本机的 `origin` 是 `goehou/job-filter-assistant` 只读上游；云端 clone 后 `origin` 可能指向个人仓库，也仍使用验证后的 `personal`，不依赖 remote 名字猜仓库身份。
- 通过 `gh repo view DikkooXie/offercome --json defaultBranchRef --jq .defaultBranchRef.name` 读取默认集成分支；当前为 `feat/vite-ui-roadmap`，不要假定名为 `main`。
- 新任务从最新集成分支开始。已有任务从它的远端任务分支恢复；开始前检查工作区，保留其他会话的未提交修改。

## 选择任务

读父计划及子 issue 的正文、评论、原生依赖和关联 PR。只领取范围已授权、标记 `ready-for-agent`、没有未关闭 blocker 的开放任务；跟踪计划本身不作为开发切片领取。`ready-for-agent` 表示材料齐备，不表示当前空闲。

原生依赖是开工条件。父计划的复选框用于展示，不能替代依赖查询：

```bash
gh issue list --repo DikkooXie/offercome --state open --label ready-for-agent
gh issue view <N> --repo DikkooXie/offercome --comments
gh api repos/DikkooXie/offercome/issues/<N>/dependencies/blocked_by
```

## 领取：先建远端分支，再改代码

一个 issue 对应一个固定远端分支 `agent/issue-<N>`。**通过 GitHub 创建 ref 的原子操作领取**，避免两个使用同一 GitHub 账号的 Agent 同时开工。assignee、标签或先读后写的评论都不能提供互斥。

1. 确认依赖已完成、没有其他关联 PR 正在实施。从 GitHub 读取集成分支当前 SHA。
2. 用该 SHA 创建 `refs/heads/agent/issue-<N>`。示例中的占位值由 Agent 现场查询并替换：

   ```bash
   gh api --method POST repos/DikkooXie/offercome/git/refs \
     -f ref=refs/heads/agent/issue-<N> -f sha=<integration-sha>
   ```

   仅创建成功的 Agent 获得任务。失败时先区分网络 / 认证错误和 ref 已存在；ref 已存在即表示已领取，不能换一个分支绕过，也不能自动删除或强推。
3. 在 issue 评论记录 `claimed`：Agent 名称、设备或平台、唯一 session 标识、UTC 时间、分支、基线 SHA、工作范围、下一步。成功后设 `in-progress`。用户已授权在本仓库开展协作时，这些进度记录属于任务执行，不必逐条重新询问。
4. fetch 远端任务分支，在独立 clone / worktree 中跟踪它，然后开始修改。一个任务分支只由一个 session 写入。

领取期间进程退出或评论发布失败，分支仍视为保留；接手前读取远端分支、issue 评论与 PR，明确交接。GitHub ref 只是协作约定，不是权限隔离。

## 更新与交接

在完成一个可验证步骤、遇到阻塞、准备交接时，先推送代码，再写 issue 评论。长任务至少每个实际工作小时补一次记录；记录过期仅表示需要核实，不自动授予其他 Agent 接管权。

评论使用以下字段，能让新 session 直接恢复即可，不复制完整 diff：

```text
状态：claimed / working / blocked / handoff / review / done
执行者：<Agent> · <设备或平台> · <session-id>
时间：<UTC ISO 8601>
分支：agent/issue-<N>
提交：<已经推送的 SHA>
完成：<可核实的结果，附 PR 或证据链接>
验证：<命令与结果；未执行的检查明确说明>
下一步：<接手者第一步>
阻塞：<issue 链接或无>
```

- 暂停：推送可恢复的 WIP（不含秘密），设 `blocked` 并写原因。需要人做决定时再加 `needs-info` 或 `ready-for-human`。
- 交接：原执行者先停止写分支，发布 `handoff` 并列出未提交内容是否已清空；新执行者读记录、确认旧 session 已停，再以同一分支继续。失联时由维护者明确接管，不用“超过某个时间”自动抢占。
- 两端需要并行时选择不同的未阻塞 issue。不同 issue 也可能修改相同文件；动共享模块前记录影响，必要时加原生依赖串行推进。

## 审查与完成

1. 在任务分支合入最新集成分支，处理冲突，完成针对改动的验证和差异审查。
2. 推送并开 PR，base 为集成分支；写 `Closes #<N>`、规格依据、已执行的测试及未执行项。设 `in-review`，移除 `in-progress`。评审期间仍由原 session 维护分支。
3. PR 已合并、验收满足后再关闭 issue，更新父计划。验收仍缺浏览器证据或功能不符合时保留开放状态，并写清缺口；`npm test` 通过不能代替 UI 验收。
4. 合并后下一项从最新集成分支开始。合并、发布 Release、修改历史等动作依据当次用户授权执行；创建任务分支、进度评论和 PR 属于已授权研发协作的常规步骤。

现存直接提交到集成分支的工作，按实际 SHA、验证与剩余缺口登记，不为了补流程改写历史。`in-progress` / `in-review` / `blocked` 的定义见 `triage-labels.md`。
