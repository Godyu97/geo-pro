# Design

## Context

#28 已交付 ContentVersion 审核、Approval 与正式/审阅交付包。S-M0-11 要求人工发布回填、公开/人工核验、effective_at 与 mismatch 维护待办。

## Goals / Non-Goals

- Goals：PublicationVersion；隔离公开核验与人工证据；核验历史；effective_at 仅首次通过；mismatch/removed 维护待办；归属隔离；AC-M0-11-1/2/3。
- Non-Goals：自动登录外部账号、自动发布、代改网页、真实外网抓取（阶段门禁）、M1 双人复核。

## Decisions

1. **表**：`content_publication`、`content_publication_check`、`content_publication_action`；双方言 Schema + migration + 全量 DDL；purge 按依赖序清理。
2. **回填**：需当前批准指纹匹配；`claimed_published_at` 与 `effective_at` 分列；`operationId` 幂等。
3. **隔离核验**：`fixturePage.accessClass` 区分 draft_box / login_wall / public / removed；HTTP 成功不足；公开且 claims 全匹配 → `verified_public`。
4. **人工证据**：截图引用、页面标识、观察时间、正文摘录齐全且 claims 匹配 → `verified_manual`；证据等级与公开核验区分。
5. **effective_at**：仅首次 `verified_public|verified_manual` 写入；重核验追加 check，不回写。
6. **mismatch**：生成 `repair_mismatch` 开放待办；旧证据与申报时间可追溯。
7. **归属**：全部读写按 `owner_id`；越权 NOT_FOUND。

## Risks / Trade-offs

- 隔离 fixture 不代表真实页面可达性；阶段门禁补真实抓取。
- 维护待办为内容域轻量表，不直接写入优化任务域，避免跨域耦合。

## Migration Plan

新增 PG/SQLite 迁移；同步全量 DDL；`pnpm db:ddl:check`。验证：`pnpm test:content`、`check:i18n`、`typecheck`、`lint`、`build`。
