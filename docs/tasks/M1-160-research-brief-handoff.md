# Issue #160 支持主张与研究 Brief 转任务

2026-11-26。 [Issue #160](https://github.com/Godyu97/geo-pro/issues/160) · [S-M1-02 第 3、5 条与 AC-M1-02-2、AC-M1-02-3](../specs/M1.md#s-m1-02) · [竞品与来源](T-M1-02-competitor-sources.md)

## 交付范围

- 双库迁移（PostgreSQL `drizzle/0088_smooth_meteorite.sql`、SQLite `drizzle/sqlite/0087_sloppy_tombstone.sql` 及全量 DDL）：`source_inspection` 增加可空 `supported_claim`、`fact_version_id`；`research_brief` 增加可空 `content_brief_id`、`optimization_task_id`。主张与事实版本只在 `support = supports` 且主张非空时允许同时存在。内容草稿和优化任务外键仅在 Brief 状态为 `accepted` 时允许写入。迁移不回填既有行。
- `inspectCitationSource`：页面失效、不可读、作者不明或不支持品牌时，即使表单带了主张或事实版本，也只保存 `null`。正向支持且主张为空、同时选了本品牌已批准未撤销的事实版本时，用该版本主张文本补齐（截断至 500 字）并保存版本编号。事实版本不存在、已撤销或不属于本品牌时拒绝。
- 已接受的研究 Brief 可生成内容草稿或优化任务。内容草稿保持 `draft`，不自动确认；`competitorSource` 只写入本品牌引用 URL，事实版本只绑定与 Brief 事实行完全一致的本品牌已批准主张，不复制对方页面或品牌替换文案。优化任务按品牌、问题簇、目标页和 `citation_gap` 去重。重复操作返回已有编号。未接受、跨账号或不存在时分别返回冲突或 `NOT_FOUND`（HTTP 404）。
- `/dashboard/monitoring/competitors` 与 `zh-CN` / `en`：引用行展示已记录主张；复核表单可填写主张并选择事实版本；已接受 Brief 提供生成内容草稿、生成优化任务，以及打开已生成条目的链接。

## 验证结果

- 静态与构建：`pnpm lint`、`pnpm typecheck`、`pnpm build` 退出码均为 0。`pnpm check:i18n` 通过。`pnpm db:ddl:check` 在刷新全量 DDL 后通过。`python3 docs/tools/validate_docs.py` 在补上本记录后通过。
- 双库回归：`pnpm test:competitors`（21 项，含旧迁移升级后主张与转交列为空、正向支持写入主张、未接受拒绝、重复转交不新建、对方文案不进入来源字段、跨账号 `NOT_FOUND`）、`pnpm test:content`（54 项）、`pnpm test:data-exports`（9 项，含旧迁移升级后结构与全量 DDL 一致）均通过。
- 隔离浏览器：`pnpm exec playwright test tests/e2e/competitors-entry.spec.ts` 3 项通过。开发库已应用本轮 PostgreSQL 迁移后再跑；页面在长名称、有序推荐和引用复核流程中仍可打开。本轮没有在浏览器里单独点击「生成内容草稿 / 生成优化任务」，这两条路径由上面的双库用例覆盖。
- 本记录使用隔离库与合成样本，不勾选 `T-M1-02`。没有真实竞品样本，也没有抓取外部引用页。
