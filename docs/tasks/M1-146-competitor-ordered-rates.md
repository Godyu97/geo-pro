# Issue #146 有序推荐上榜率、首位率与条件平均位置

2026-11-25。 [Issue #146](https://github.com/Godyu97/geo-pro/issues/146) · [S-M1-02 第 4 条与 AC-M1-02-3](../specs/M1.md#s-m1-02) · [指标与证据合同第 6 节](../07-指标与证据合同.md) · [交付记录](T-M1-02-competitor-sources.md)

## 交付范围

- 数据库约束与双库迁移（PostgreSQL `drizzle/0083_ambiguous_quentin_quire.sql`、SQLite `drizzle/sqlite/0082_whole_crusher_hogan.sql` 及全量 DDL）：允许 `mention_state` 为 `false` / `unknown` 的行在有序观察中保留 `ordered = 1` 且 `position IS NULL`；`ordered = 0` 或非 `true` 状态仍禁止写入位置。
- `recordCompetitorMentions` 与 `recordMentionsAction`：有序样本的 `ordered` 标记统一保存至所有固定集成员（含 `false` 与 `unknown`）；未勾选有序或非 `true` 状态传入位置直接校验拒绝（`INVALID_INPUT`）；同一观察已保存的无序提及不能被改写为有序（`OPERATION_CONFLICT`）。
- `orderedRankBreakdown` 与 `shareFromMentions`：在固定竞品集当前版本内，仅对明确有序观察按品牌统计同一可判断有序分母下的**上榜率**、**首位率**与仅计算已上榜样本的**条件平均位置**；`unknown` 不进分母，缺席不记为 `0` 或队尾，全缺席时平均位置为 `N/A` 且分母可见；无序观察（含正文带数字标题）保持不排名；份额计算口径保持不变。
- `/dashboard/monitoring/competitors` 在 `zh-CN` / `en` 双语下按品牌展示上榜率、首位率和条件平均位置（仅在存在有序观察时展示，并标明为样本内位置而非搜索引擎排名）、缺席名单、无序排除说明以及保留观察编号和位置的有序观察明细；另一账号访问返回 `404` / 未找到隔离提示。

## 验证结果

- 静态、多语言与 DDL：`pnpm lint`、`pnpm typecheck`、`pnpm check:i18n`（3547 键）、`pnpm test:i18n`（7 项）、`pnpm db:ddl:check`、`pnpm check:feature-map`（69/69 页面）、`pnpm build` 均通过。
- 双库与领域回归：`pnpm test:competitors`（13 项，SQLite3 与本地 PostgreSQL 均含旧迁移升级、4 条有序 2 上榜 1 首位 2 缺席、无序数字标题不排名与拒绝位置/改写、全缺席有序样本 `0/1` 与 `N/A` 及越权 `NOT_FOUND`）、`pnpm test:continued-operations`（67 项）、`pnpm test:data-exports`（9 项，含双库旧迁移升级后结构一致核对）、`tests/layout/workspace-landmark.test.mjs`（30 项）均通过。
- 隔离浏览器：`pnpm exec playwright test tests/e2e/competitors-entry.spec.ts`（2 项，隔离 Chrome 覆盖 `zh-CN` / `en`、375/768/1440 视口无横向溢出、未勾选有序拒绝写入位置、无序带数字标题不排名且不可改写为有序、4 条有序观察 `50.0% (2/4)` / `25.0% (1/4)` / `2` 与全缺席 `0.0% (0/4)` / `0.0% (0/4)` / `N/A`、版本 2 全缺席 `0.0% (0/1)` / `N/A`、保留观察编号和位置以及跨账号 404/隔离）。
- 本记录使用隔离与合成样本，不勾选 `T-M1-02`。
