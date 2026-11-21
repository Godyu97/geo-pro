# Issue 生命周期规范（Issue Lifecycle）

本规范定义基于 GitHub Issues（及 `docs/tasks/` 拆分任务）开展增量开发的标准状态流转与门禁。应用内不实现 GitHub API、队列或 Webhook。仓库外的串行循环见文末「串行循环」，提示词在 `scripts/run-issue-loop.py` 的 `DEV_PROMPT` 与 `BACKLOG_REPLENISH_PROMPT`。

## 状态模型

```text
Ready ──▶ In Progress ──▶ Implemented ──▶ Verified ──▶ Done
  │            │               │              │
  └────────────┴───────────────┴──────────────┴──▶ Blocked / Awaiting Pilot
```

- **Ready**：目标明确、软件层前置依赖已满足、输入与软件验收条件可核验，可立即认领编码。
- **In Progress**：已由单一 Agent 认领并正在按 [标准任务闭环](task-lifecycle.md) 执行发现、规划与实现。
- **Implemented**：最小必要代码与配置改动已完成，覆盖正常路径与已知失败/恢复边界，且无伪造业务数据。
- **Verified**：[质量门禁](../governance/quality-gates.md) 中的适用检查通过，且 Issue 对应的软件验收场景已完成实测（或明确区分本地契约验证与真实外部渠道门禁）。
- **Done**：变更自审（Review）通过、交付报告完整，且所有软件验收条件均已满足。
- **Awaiting Pilot（`status:awaiting-pilot`）**：软件层前置与代码增量均已合入 `main`，仅剩余真人试点走查、外部商业签核或生产准入记录；保持 Open 等待外部签核，**自动开发循环将其排除出代码开发队列，不再重复认领或触发空转**。
- **Blocked（`status:blocked`）**：因真实前置代码未合并或权威文档存在未决冲突而无法编码；**禁止**把「邮件网关未接入（已约定长期 Mock 永远成功）」「M0/M1/M2 真实试点门禁未勾选」「本地 LLM 测试通道」标为 Blocked。

## 状态转换与执行规则

1. **单任务聚焦**：一个 Agent 同一时刻只处理一个明确的 Issue；M0/M1/M2 软件层增量可按软件前置依赖有序推进，不受真人试点门禁勾选阻塞。
2. **准入核对（`Ready → In Progress`）**：
   - 先核对 Issue 目标、验收条件与软件层前置代码（如 `src/features/` 与 Schema）。
   - 仅当软件前置代码本身缺失或需求存在未决冲突时才标为 `Blocked`；外部真人试点门禁（`T-M0-GATE` 等）只限制真实验收勾选，不阻止软件增量进入 `In Progress`。
3. **实现约束（`In Progress → Implemented`）**：
   - 全程遵循 [task-lifecycle.md](task-lifecycle.md)；保护现有文件与未提交改动，不擅自修改产品文档以适配实现。
   - 邮件相关功能长期遵循 Mock 永远成功策略（`GEO_AUTH_MAIL_MOCK=true`、`GEO_AUTH_EMAIL_VERIFIED_MOCK=true`），不接入真实邮件网关；AI 功能统一通过 `src/lib/ai/responses.ts` 接入 OpenAI Responses API。
4. **严格验收（`Implemented → Verified → Done`）**：
   - 仅当所有适用的质量门禁通过且软件验收标准真实核验后，才允许标记为 `Done`（若正文额外包含真人试点签核且软件已全量落地，改标 `status:awaiting-pilot` 移出开发队列）。
   - **失败或受阻的任务严禁直接标记为 `Done`**；不得用隔离 fixture 或 mock 勾选 `docs/tasks/M*.md` 中的真实试点 `AC-*`。
5. **受阻处理（`→ Blocked` / `→ Awaiting Pilot`）**：
   - 缺软件前置或需人工决策 → `status:blocked`，写明根因与解除条件；
   - 软件已全量落地、仅待真人试点 → `status:awaiting-pilot`，移出自动开发队列以免阻塞后续补货与开发。
6. **子 Issue 拆分与防扩散**：
   - 仅当发现明确超出当前 Issue 范围的独立缺口且确有必要时，才建议拆建新 Issue。
   - 自动补货由 `scripts/run-issue-loop.py` 外层水位控制（默认每批 12 个、上限 3 批），创建前必须先检查已有 Issue 与 `docs/tasks/`，防止重复创建。

## 串行循环

`scripts/run-issue-loop.py` 由外层状态机驱动：先做开发环境预检（含 Node 24、PostgreSQL、Redis、AI Responses API、邮件 Mock、gh CLI），再拉取 GitHub Open Issues 过滤掉 `status:awaiting-pilot` / `status:blocked` / 本轮跳过列表，按可开发队列水位自动选择 `DEV_PROMPT` 或 `BACKLOG_REPLENISH_PROMPT`（当可开发队列低于 `--min-backlog` 时自动补货）。

轮与轮之间不共享对话，只共享仓库、Git 历史、Issue 评论与外层注入的运行时上下文。外层每轮客观核验 `git HEAD` 变化、GitHub Issue 变更及 `loop-round:` 结构化结果：

1. **外层预筛与锁定目标**：外层按 `status:in-progress` > 优先级 > 里程碑 > 编号排序并注入目标与排除列表，避免重复扫描或死磕已无代码增量的 Issue。
2. **软件/试点解耦与长期 Mock**：邮件长期 Mock 永远成功、LLM Responses API 已就绪、试点门禁不阻塞软件开发；若选中单仅剩真人试点，改标 `status:awaiting-pilot` 立即移出开发队列。
3. **一轮一件事、客观验推进**：每轮推进一个 Issue 的一个可验证软件增量，门禁通过后 commit + push + `loop-round` 评论；无推进则自动加入本轮跳过表并触发轮换或补货，杜绝连续空转。
4. **失败隔离不整批崩溃**：单轮偶发超时/网络异常自动清理进程组与隔离脏改动，最多容忍 `--max-consecutive-failures`（默认 3）次连续失败后才中止，保障整批推进足够数量的需求开发。
5. **水位自动补货**：可开发队列耗尽时自动切入 `BACKLOG_REPLENISH_PROMPT`，每次生成 `--replenish-count`（默认 12）个可独立编码验证的纵向切片 Issue，随后立即继续开发。
