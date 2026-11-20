# Issue 生命周期规范（Issue Lifecycle）

本规范定义基于 GitHub Issues（及 `docs/tasks/` 拆分任务）开展增量开发的标准状态流转与门禁。应用内不实现 GitHub API、队列或 Webhook。仓库外的串行循环见文末「串行循环」，固定提示词在 `scripts/run-issue-loop.py` 的 `FIXED_PROMPT`。

## 状态模型

```text
Ready ──▶ In Progress ──▶ Implemented ──▶ Verified ──▶ Done
  │            │               │              │
  └────────────┴───────────────┴──────────────┴──▶ Blocked
```

- **Ready**：目标明确、所属阶段已获授权（如当前聚焦 M0 单一子任务）、前置依赖已满足、输入与验收条件（如 `AC-*`）可核验。
- **In Progress**：已由单一 Agent 认领并正在按 [标准任务闭环](task-lifecycle.md) 执行发现、规划与实现。
- **Implemented**：最小必要代码与配置改动已完成，覆盖正常路径与已知失败/恢复边界，且无伪造业务数据。
- **Verified**：[质量门禁](../governance/quality-gates.md) 中的适用检查通过，且 Issue 对应的验收场景已完成实测（或明确区分本地契约验证与真实外部渠道门禁）。
- **Done**：变更自审（Review）通过、交付报告完整，且所有必需验收条件均已满足。
- **Blocked**：因缺少外部账号凭证、第三方渠道、运行环境、前置 Issue 未完成或权威文档存在未决冲突而无法推进。

## 状态转换与执行规则

1. **单任务聚焦**：一个 Agent 同一时刻只处理一个明确的 Issue；禁止在未完成当前 Issue 时顺带实现后续里程碑功能（如顺带实现 M1/M2）。
2. **准入核对（`Ready → In Progress`）**：
   - 先核对 Issue 目标、验收条件与依赖（如参考 `docs/product-map.json` 或前置 Issue 状态）。
   - 前置依赖未完成或未授权越级时，不得进入 `In Progress`，应保持等待或标为 `Blocked`。
3. **实现约束（`In Progress → Implemented`）**：
   - 全程遵循 [task-lifecycle.md](task-lifecycle.md)；保护现有文件与未提交改动，不擅自修改产品文档以适配实现。
4. **严格验收（`Implemented → Verified → Done`）**：
   - 仅当所有适用的质量门禁通过且验收标准真实核验后，才允许标记为 `Done`。
   - **失败或受阻的任务严禁直接标记为 `Done`**；环境受阻但本地代码已完成时，应停留在 `Implemented` 或 `Blocked` 并明确标注未验证外部能力。
5. **受阻处理（`→ Blocked`）**：
   - 记录具体阻塞原因、报错摘要与解除条件（例如需要数据库、外部 API Key 或用户决策）；条件解除后再恢复到原推进状态。
6. **子 Issue 拆分与防扩散**：
   - 仅当发现明确超出当前 Issue 范围的独立缺口且确有必要时，才建议拆建新 Issue。
   - 创建前必须先检查已有 Issue 与 `docs/tasks/`，防止重复创建；禁止 Agent 在缺乏明确目标与边界的情况下自动批量或无限生成任务。

## 串行循环

`scripts/run-issue-loop.py` 每一轮新建 session，并注入同一份 `FIXED_PROMPT`。轮与轮之间不共享对话，只共享仓库、Git 历史和 Issue 评论。外层只在该轮进程退出码为 0 且 stream-json 结果为 success、`is_error=false` 时进入下一轮；任一失败中止后续轮次。进程成功只表示本轮干净收束，不表示 Issue 已 Done。

固定提示词因此要保证下面四件事：

1. **选任务**：Open Issue 按创建时间从早到晚。他人正在改的跳过；本循环留下的 `In Progress` 要续作，先读评论和提交，不重做已推送增量。`Blocked` 先对照最新代码，原因已消失则解阻。只有缺密钥、未授权付费或无法用代码推进的真人试点才算硬阻塞。
2. **一轮一件事**：只做一个 Issue 的一个可验证增量，然后退出。不能把外层循环要做的“下一轮”提前在同一 session 里做掉。
3. **验收后再交接**：适用质量门禁通过后才 commit 和 push。未通过不得标 `Done`。部分完成保持 `In Progress` 并评论 commit、已验证命令和剩余验收。本轮做不出增量时标 `Blocked` 并写解除条件，避免下一轮重复选中它空转。
4. **不伪造完成**：隔离 fixture 不能勾选真实验收。评论使用提示词中的 `loop-round` 字段，让下一轮新 session 能接着做。
