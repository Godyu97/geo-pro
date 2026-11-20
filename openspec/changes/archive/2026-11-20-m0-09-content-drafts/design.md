# Design

## Context

#26 提供优化任务（问题簇、目标页、缺口）；#22 提供批准事实与 `withEligibleFacts` / `brand_fact_use`；#10 提供 `generation` 额度账本；题集 `briefGaps` 校验主页面/承接。S-M0-09 要求确认 Brief 后小批次产出始终待审的草稿。

## Goals / Non-Goals

- Goals：ContentPlan/Brief/Batch/Unit/ContentVersion Schema 与 DAO；门禁与模板纯函数；ConfirmBrief / GenerateBatch / Pause|Resume|Cancel|RetryFailed；事实与额度接线；最小工作台 UI；AC-M0-09-1/2/3 测试；双库迁移与 DDL。
- Non-Goals：逐稿审核与导出包（#28）、发布回填核验（#29）、真实 LLM/付费调用、多渠道日历、自动批准。

## Decisions

1. **表**：`content_plan`、`content_brief`、`content_brief_version`、`content_batch`、`content_batch_unit`、`content_version`；双方言 Schema + migration + `pnpm db:ddl`。
2. **Brief 状态**：`draft → confirmed → invalidated`；确认须 gaps=[]（来源、适用边界、可用 fact IDs、主页面/承接）；缺项返回补证列表，不写正文。
3. **模板**：`fact_faq` | `scenario_solution` | `verifiable_comparison`；比较模板要求对方来源字段；标题最多 3 候选可编辑。
4. **批次**：默认 1、上限 5 个已确认 Brief；状态 `queued/running/paused/partial/completed/cancelled`；unit `queued/running/succeeded/failed/blocked`；成功 unit 冻结 `content_version_id`，重试仅失败项、不改成功正文；同 reservation 内新 attempt 不新扣 `generation` 次数。
5. **生成**：隔离确定性模板填充（fixture transport）；无真实 Provider；输出 ContentVersion.status=`draft`，无 Approve 命令。
6. **事实**：生成时 `withEligibleFacts(..., stage=review)`；撤销后 Resume 重验，受影响 unit → `blocked`，相关 confirmed Brief → `invalidated`，其余继续。
7. **额度**：GenerateBatch 对 `kind=generation` 走 `reserve → start → reconcile → settle/release`；费用未知时按监测同等待核对规则阻塞该项。
8. **归属**：全部读写校验 `owner_id` + 未冻结品牌；越权 NOT_FOUND，无内容泄露。
9. **幂等**：命令带 `operationId`；同键同参 replay，异参 conflict。
10. **覆盖视图**：按问题簇聚合优化任务与已有 ContentVersion 目标页 → 已有/待更新/缺口；优先更新已有主页面。

## Risks / Trade-offs

- 隔离模板填充不代表真实模型质量；正式生产需后续验证生成能力。
- Brief 与优化任务弱关联（可选 `optimization_task_id`），不强制任务状态机联动。

## Migration Plan

新增迁移；`pnpm db:generate`（或手写对齐）、`pnpm db:ddl`、`pnpm db:ddl:check`。验证：`pnpm test:content`、`pnpm check:i18n`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。

## Open Questions

无；审核与发布留给 #28/#29。
