# Issue 生命周期规范

GitHub Issues 和 `docs/tasks/` 跟踪软件交付与验收。每个 Issue 由 Agent 执行验收、登记可复查证据和更新状态。软件交付、真实服务联调或正式阶段试点均可作为可执行工单。

## 状态与证据

| 状态 | 进入条件 |
| --- | --- |
| Ready（`status:ready`） | 有可独立执行的软件增量或验收步骤，必要输入和验收结果明确 |
| In Progress（`status:in-progress`） | Agent 正在实现或执行验收，按 [标准任务闭环](task-lifecycle.md) 留存结果 |
| Verified | Agent 已实际运行适用质量检查和 Issue 验收场景，并保存可复核的结果 |
| Done（`status:done`） | 全部适用验收已通过，Issue 与任务文档的状态一致 |
| Blocked（`status:blocked`） | 无法继续独立推进，正文说明缺少的软件、数据、授权、通道、可信预算、实际观察窗口或待解决的契约冲突，及恢复条件 |

Agent 先核对现有实现、已交付范围及实测证据。适用验证完成后更新 Issue 和 `docs/tasks/`。确认直接依赖已经满足时，把对应工单转回 `status:ready`。正式试点直接进入相同的状态流程，参与浏览器操作、发起采样和验证结果的角色由 Agent 使用获准账号扮演，应用继续使用现有会话、资源、审批和操作权限。

## Agent 验收

1. 运行 `pnpm env:check`，确认本轮实际使用的开发服务。Agent 可用浏览器、CLI、API 和参数化查询自行准备、核对和清理本轮测试范围。迁移应用于明确的目标库，破坏性场景使用隔离测试库或备份副本。
2. 按 [质量门禁](../governance/quality-gates.md) 运行适用检查。开发邮件与邮箱校验使用长期 Mock，严格邮件和安全分支继续在隔离测试执行。AI 代码使用 Responses API，单测使用回环 mock。
3. 正式试点用获准真实品牌、授权账号、有效通道和硬预算走业务路径，保留冻结范围、原文定位、实际费用、角色操作与时间窗记录。消费者轨道按平台允许的交互流程取证，应用内确认和审批走原角色。隔离样本、真实开发结果与生产发布各自记录。 [真实联调](../../docs/tasks/brand-monitoring-next.md#dev-live-data) · [阶段验收计划](../../docs/05-里程碑与验收计划.md)
4. 记录实际命令、版本、脱敏定位、通过项和待验证项。外部能力或观察条件缺失时，完成独立可跑的检查；全部验收完成后再关单。生产变更遵循现有发布授权。

## 开放 Issue 梳理

使用 `gh issue list --state open` 找长期未推进项，核对正文、评论、源码与任务记录。仍有效的 Issue 写清 Agent 执行的验收步骤和前置条件。重复或被替代的 Issue 附承接链接后关闭，已完成的 Issue 附验证证据后关闭。阶段验收缺少实际证据时保留独立追踪。

## 串行循环

`scripts/run-issue-loop.py` 逐页读取开放 Issue，只调度带 `status:ready` 或 `status:in-progress` 且无阻塞标签的工单。正式试点与软件任务使用同一队列。自动补货按 `--min-backlog` 触发，尝试次数受 `--max-replenishes` 限制。空批次或额度用完后，现有可执行工单仍可继续。补货前核对已有开放和已关闭工单、任务规格和实现，脚本只计入本轮创建、含回执标记且可开发的工单。

每轮派发前快进同步 `origin/<分支>` 并记录基线。Agent 按授权处理一个可验证增量或一项验收，运行适用门禁并写入 Issue 评论。最终回复用普通文本记录，随轮次日志保存。脚本根据 Git 和 GitHub 的实际结果判定本轮状态，核对目标 Issue 本轮新增的验收评论及其中的回执标记与完整 Git SHA。开发提交须关联目标 Issue 并存在于目标远端分支。`done` 须在 GitHub 上确认该目标以完成原因关闭。纯验收可以凭现有 Git 版本和新证据推进。

实跑需要干净的工作树，同一个工作树一次只运行一个循环。未交付的本地修改默认保留并停止派发。显式传入 `--quarantine-dirty` 时，可将本轮残留的未提交修改保存到命名 stash。遇到未能核对的本轮 Git 提交时，保留现场并停止派发。每轮日志与 JSON 汇总保存在 `--log-dir`（默认 `tmp/`）。

Agent 单轮默认不限时。收到 `Ctrl+C` 或 `SIGTERM` 时终止当前进程组并保留日志。显式传入 `--round-timeout <秒数>`（正数）可启用按时限中止，并按失败轮次处理。

用 `python3 scripts/run-issue-loop.py --dry-run --skip-preflight` 查看当前队列决策，用 `python3 scripts/test-run-issue-loop.py` 在临时 Git 仓库中验证调度和回执逻辑。
