# Issue 生命周期规范

GitHub Issues 和 `docs/tasks/` 跟踪软件交付与验收。每个 Issue 由 Agent 执行验收、登记可复查证据和更新状态。开发任务和现有模块的业务验收共用一个队列。

## 状态与证据

| 状态 | 进入条件 |
| --- | --- |
| Ready（`status:ready`） | 有可独立执行的软件增量或验收步骤，必要输入和验收结果明确 |
| Backlog（`status:backlog`） | 已规划的深化需求，首版可用后按实际反馈提升；循环不派发 |
| In Progress（`status:in-progress`） | Agent 正在实现或执行验收，按 [标准任务闭环](task-lifecycle.md) 留存结果 |
| Verified | Agent 已实际运行适用质量检查和 Issue 验收场景，并保存可复核的结果 |
| Done（`status:done`） | 全部适用验收已通过，Issue 与任务文档的状态一致 |
| Blocked（`status:blocked`） | 无法继续独立推进，正文说明缺少的软件、数据、授权、通道、可信预算、实际观察窗口或待解决的契约冲突，及恢复条件 |

Agent 先核对现有实现、已交付范围及实测证据。适用验证完成后更新 Issue 和 `docs/tasks/`。确认直接依赖已经满足时，把对应工单转回 `status:ready`。验收由 Agent 使用获准账号从正常入口操作，应用按实际会话和品牌权限处理。

## Agent 验收

1. 运行 `pnpm env:check`，确认本轮实际使用的开发服务。直接读取 `./tmp/dev/`（`./tmp/dev/accounts.json`、`./tmp/dev/README.md`）中持久化的各级别真实开发账号（`admin`、`owner`、`member`、`reviewer`、`readonly`、`outsider` 等）与品牌数据，通过浏览器、CLI、API 从正常入口完成联调与核对，不再每次重复注册一次性临时账号。迁移应用于明确的目标库，破坏性场景使用隔离测试库或备份副本。
2. 按 [质量门禁](../governance/quality-gates.md) 运行适用检查。开发邮件与邮箱校验使用长期 Mock，严格邮件和安全分支继续在隔离测试执行。AI 代码使用 Responses API，单测使用回环 mock。禁止在产品代码中编写测试/试点/临时页面或产品不需要的逻辑。
3. 从正常工作台使用 `./tmp/dev/` 中的持久化真实开发账号、品牌与配置服务走完本单操作，回读结果。这次实测即可用于功能验收。记录入口、实际结果、脱敏定位和未验证动作；付费或外部发布依实际预算与授权进行。窗口只约束对应效果结论。生产变更遵循发布授权。
4. 开发轮按[二期计划](../../docs/tasks/phase-2.md)补齐各模块首版，一条主路径通后优先下个缺口。补货轮先查现有工单，只为真实用户断点建单；没有合适缺口可以零补货。延期深化项留在 backlog。

## 开放 Issue 梳理

使用 `gh issue list --state open` 找长期未推进项，核对正文、评论、源码与任务记录。仍有效的 Issue 写清 Agent 执行的验收步骤和前置条件。重复或被替代的 Issue 附承接链接后关闭，已完成的 Issue 附验证证据后关闭。在对应工单记录尚未完成的动作，复用已有开发环境证据。

## 串行循环

`scripts/run-issue-loop.py` 逐页读取开放 Issue，只调度带 `status:ready` 或 `status:in-progress` 且无阻塞标签的工单。正式试点与软件任务使用同一队列。自动补货按 `--min-backlog` 触发，尝试次数受 `--max-replenishes` 限制。空批次或额度用完后，现有可执行工单仍可继续。补货前核对已有开放和已关闭工单、任务规格和实现，脚本只计入本轮创建、含回执标记且可开发的工单。

每轮派发前快进同步 `origin/<分支>` 并记录基线。Agent 按授权处理一个可验证增量或一项验收，运行适用门禁并写入 Issue 评论。最终回复用普通文本记录，随轮次日志保存。脚本根据 Git 和 GitHub 的实际结果判定本轮状态，核对目标 Issue 本轮新增的验收评论及其中的回执标记与完整 Git SHA。开发提交须关联目标 Issue 并存在于目标远端分支。`done` 须在 GitHub 上确认该目标以完成原因关闭。纯验收可以凭现有 Git 版本和新证据推进。

实跑需要干净的工作树，同一个工作树一次只运行一个循环。未交付的本地修改默认保留并停止派发。显式传入 `--quarantine-dirty` 时，可将本轮残留的未提交修改保存到命名 stash。遇到未能核对的本轮 Git 提交时，保留现场并停止派发。每轮日志与 JSON 汇总保存在 `--log-dir`（默认 `tmp/`）。

直接启动实跑即授权所选模式执行交付。开发轮可在适用门禁通过后提交本轮增量、推送至当前分支的 `origin`、发布目标 Issue 的验收评论并更新其状态。补货轮仅授权按数量上限新建符合条件的工单。需要仅跑队列开发时加 `--prompt-mode dev`。

默认通过 `codex exec` 启动独立会话，模型为 `gpt-6.2-sol`，推理强度为 `high`。实跑的 Codex 子进程使用 Full Access，且命令执行无需交互审批。用 `--model` 或 `--reasoning-effort` 可覆盖对应设置。用 `--agent cursor` 可选择 Cursor，默认模型为 `grok-4.7-high`，`--approve-mcps` 仅用于该通道。用 `--agent agy` 可选择 Antigravity CLI，默认模型为 `gemini-4-hydrogen-high`，默认推理强度为 `high`，并以 `--dangerously-skip-permissions` 免交互审批执行；使用默认模型之外的 `--model` 时仅在显式传入 `--reasoning-effort` 时附加 `--effort`。

单次运行默认最多 30 轮，含补货轮。连续有可核验交付且仍可执行的 Issue 可推进至 30 轮。可用 `--max-rounds` 调整总轮数，用 `--max-same-issue-rounds` 调整同一 Issue 的连续推进上限。达到单项上限且还有调度轮次时，轮换到其他工单。

Agent 单轮默认不限时。收到 `Ctrl+C` 或 `SIGTERM` 时终止当前进程组并保留日志。显式传入 `--round-timeout <秒数>`（正数）可启用按时限中止，并按失败轮次处理。

用 `python3 scripts/run-issue-loop.py --dry-run --skip-preflight` 查看当前队列决策，用 `python3 scripts/test-run-issue-loop.py` 在临时 Git 仓库中验证调度和回执逻辑。
