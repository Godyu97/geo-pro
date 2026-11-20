# Design

## Context

#24/#25 已提供 Observation、Citation、AnalysisVersion 与概览下钻。S-M0-08 要求把缺口转成可完成的少量动作：六类建议、证据回链、去重、优先序、最多 5 页只读检查；任务状态与复测结论独立。

## Goals / Non-Goals

- Goals：Finding/Task/PageCheck Schema 与 DAO、诊断与去重纯函数、生成/检查/状态命令、任务 UI、概览回接、AC-M0-08-1/2/3 测试、双库迁移与 DDL。
- Non-Goals：内容 Brief/稿件、自动改网页、付费流量、抓取私有页、真实客户发布核验、通用 SEO 教程批量生成。

## Decisions

1. **表**：`optimization_finding`、`optimization_task`、`optimization_task_evidence`、`page_check_record`；双方言 Schema + migration + `pnpm db:ddl`。
2. **缺口类型**：`fact_error` | `name_confusion` | `key_content_missing` | `page_unreadable` | `citation_gap` | `needs_evidence`。
3. **缺席口径**：`mentioned=false` 且无其它硬证据时仅生成「观察到缺席」+ 待验证假设（`assumption_level=observed_absence`），不得声称引擎因软文淘汰品牌（AC-M0-08-1）。证据不足时生成 `needs_evidence` / 补采，不凑满条数。
4. **去重键**：`brand_id + question_cluster + target_page + gap_type` 对未关闭任务唯一；重复发现追加 evidence 关联，不新建任务（AC-M0-08-2）。
5. **优先序**：`privacy_risk` 或已确认 `fact_error` → `urgent`；其余按 `business_importance` 降序、`verified_evidence` 优先、`estimated_effort` 升序、`created_at` 升序。用户改序须留理由。
6. **页面检查**：输入最多 5 个公网 URL；只读解析文本/标题；检测「发布/改权限」类指令仅作文本标记；不可访问 → `restricted`/`pending_verification`，不推断收录（AC-M0-08-3）。隔离验收允许注入 `fixture` 响应，不发起真实外网依赖。
7. **状态**：`todo → doing|blocked → implemented → retest_pending → closed`；可 `dismissed`（理由必填）；`retest_conclusion` 独立字段。完成须附说明/证据引用。
8. **归属**：所有读写校验 `owner_id` + 未冻结品牌；越权返回 NOT_FOUND/FORBIDDEN，无内容泄露。
9. **概览回接**：`readEvidenceOverview` 读取最多 3 条开放优先任务填入 `suggestions`。

## Risks / Trade-offs

- 问题簇默认用规范化问题文本哈希；后续可接 prompt 簇 ID。
- 隔离 fixture 页面检查不代表真实客户站可达性。

## Migration Plan

新增迁移；执行 `pnpm db:generate`（或手写对齐）、`pnpm db:ddl`、`pnpm db:ddl:check`。验证：`pnpm test:optimization`、`pnpm check:i18n`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。

## Open Questions

无；内容批次与发布核验留给 #27–#29。
