# M0 #173 问题簇内容计划、现有页依据与缺口视图

2026-11-26。对应 R-M0-09 / S-M0-09 / T-M0-09 第 2–3 条和 AC-M0-09-1。 [Issue #173](https://github.com/Godyu97/geo-pro/issues/173) · [内容规格](../specs/M0.md#s-m0-09) · [任务基线](M0.md#t-m0-09)

## 交付范围

- 在 `src/features/content/rules.ts` 中新增 `normalizePlanPageUrl` 与纯函数 `buildClusterPlanViews`，按已存 `content_plan`、当前 Brief 及同品牌页面依据生成各问题簇视图，严格区分：
  - **已确认现有页面**：仅当 URL 存在同品牌同负责人下的已确认归属引用（`answer_citation.ownership` 为 `owned_domain` / `owned_account` 且对应 `answer_observation.evidence_state <> 'draft_evidence'`）或未撤回/未替代的发布核验通过记录（`content_publication.status` 为 `verified_public` / `verified_manual`）时展示，并标明实际依据及回查入口；从现有主页面提供直接更新现有 Brief 或预填新建更新 Brief 的入口。
  - **待发布页面计划**：仅在 Brief 主页面或未完成公开/人工核验的发布回填中登记、尚未取得归属或发布核验证据的 URL 展示为“计划 / Planned”，不混入现有页。
  - **历史待核对记录**：旧 `coverageJson.existing` 中缺少归属与发布核验证据的 URL 展示为“待核对 / Needs verification”。
  - **待更新项与内容缺口**：同一问题簇内多个 Brief 各自保留状态与入口（`pendingUpdates` 与 `gaps`），缺主页面或材料（`primaryPageMissing`、`sourceMissing`、`factsMissing`、`boundaryMissing`、`competitorSourceMissing`）继续走原补证门禁（`EVIDENCE_REQUIRED`）。
- 在 `src/features/content/commands.ts`（`saveBriefDraft`、`listBriefs`、`readPlan`）与 `src/features/content/dao.ts` 中：
  - `saveBriefDraft` 在事务内按 `planId` 重新聚合该簇全部当前 Brief 与品牌页面依据并写回 `content_plan.coverage_json`；重复保存同一 Brief（含不传 `questionCluster` 的详情页保存）不覆盖同簇其他 Brief、不产生重复条目。
  - 消除 `listBriefs` 原有的 N+1 逐条版本查询，改为批量查询 `latestBriefVersionsBatchQuery`、`ownedPageCitationsQuery` 与 `clusterPublicationsQuery`（按 `brand_id` 与 `owner_id` 隔离，常量级查询次数）。
- 在 `/dashboard/content`（`src/features/content/list-page.tsx`）及 `zh-CN` / `en` 消息目录中替换原 `coverageJson` 原始文本，渲染双语可访问、窄屏无溢出的问题簇内容计划区，并支持从现有页预填新建 Brief 表单。

## 批量查询范围与执行计划

- `listBriefs` 固定执行 5 条 SQLite/PostgreSQL 参数化查询（`listBriefs`、`listPlans`、`ownedPageCitationsQuery`、`clusterPublicationsQuery`、`latestBriefVersionsBatchQuery`），在测试中从 2 份 Brief 增至 12 份 Brief 查询总次数保持不变。
- `EXPLAIN QUERY PLAN`（SQLite）与 `EXPLAIN (COSTS OFF)`（PostgreSQL）核对：
  - `latestBriefVersionsBatchQuery` 使用 `content_brief_version_rev_uidx` / `content_brief_version_brand_idx`。
  - `ownedPageCitationsQuery` 使用 `answer_observation_owner_idx` / `answer_observation_brand_idx` 与 `answer_citation_brand_idx` / `answer_citation_observation_idx`。
  - `clusterPublicationsQuery` 使用 `content_publication_brand_idx` / `content_publication_owner_idx`。

## 验证结果

| 检查项 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 全部通过（0 错误） |
| `pnpm check:i18n`、`pnpm test:i18n`、`pnpm check:feature-map` | 全部通过（3,942 个双语键及参数一致；7 项 i18n 原生测试通过；70/70 页面映射校验通过） |
| `pnpm test:content` | 63 项全部通过（覆盖纯函数规则、SQLite 与 PostgreSQL 隔离库下 AC 1/2/3、跨品牌隔离、重复保存、补证门禁及批量查询计划） |
| `node --conditions=react-server --test tests/continued-operations/issue-155-brand-access.test.mjs` | 3 项通过（成员权限与跨品牌隔离） |
| `pnpm test:e2e tests/e2e/content-brief.spec.ts tests/e2e/m0-flow.spec.ts tests/e2e/content-batch-export.spec.ts` | 4 项全部通过（覆盖 `zh-CN` / `en`、375/768/1440 视口、键盘访问与无横向溢出；测试品牌与账号已清理；窄屏截图保存在本地 `.cache/issue-173/content-plans/`） |
| `python3 docs/tools/validate_docs.py` | 文档一致性校验通过 |

本轮使用隔离库与合成品牌/证据完成软件与界面验收；真实品牌建档、真实模型生成质量与正式试点仍由阶段验收（[#32](https://github.com/Godyu97/geo-pro/issues/32)）跟踪，不勾选 T-M0-09。
