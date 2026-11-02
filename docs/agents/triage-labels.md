# Triage labels

| 角色 | 仓库标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 等待维护者评估 |
| `needs-info` | `needs-info` | 等待补充信息 |
| `ready-for-agent` | `ready-for-agent` | 规格完整，可交由 agent 实施 |
| `ready-for-human` | `ready-for-human` | 需要人工实施 |
| `wontfix` | `wontfix` | 不予处理 |

技能提到某个分诊角色时，使用表中对应的仓库标签。

以下是执行状态，可与上面的材料就绪标签同时使用：

| 标签 | 含义 |
| --- | --- |
| `in-progress` | 已领取并正在实施；执行者和分支见 issue 评论 |
| `in-review` | 代码已推送，等待审查或验收；不表示 issue 已完成 |
| `blocked` | 有明确阻塞；原因和解除条件见 issue 评论 |

互斥领取依靠 `collaboration.md` 的原子远端分支创建，标签和 assignee 只用于展示。
