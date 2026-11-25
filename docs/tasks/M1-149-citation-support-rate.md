# Issue #149 引用可判断非支持与第三方支持率

2026-11-25。 [Issue #149](https://github.com/Godyu97/geo-pro/issues/149) · [S-M1-02 第 3 条与 AC-M1-02-2](../specs/M1.md#s-m1-02) · [指标与证据合同第 3 节](../07-指标与证据合同.md) · [交付记录](T-M1-02-competitor-sources.md)

## 交付范围

- 数据库约束与双库迁移（PostgreSQL `drizzle/0085_misty_timeslip.sql`、SQLite `drizzle/sqlite/0084_fair_tyger_tiger.sql` 及全量 DDL）：`source_inspection.support` 扩展为 `'supports' | 'does_not_support' | 'unknown'`；仅当 `page_live = 1`、`readable = 1` 且 `author_known = 1` 时允许写入正向支持（`supports_brand = 1`）或可判断非支持（`supports_brand = 0`）；迁移不回填既有 `unknown` 历史记录。
- `inspectSource`、`pageSupport` 与 `thirdPartySupportSummary`（`src/features/source-opportunities/rules.ts` / `src/features/competitors/commands.ts`）：页面有效、正文可读且作者归属明确时，勾选支持记 `supports`，未勾选记 `does_not_support`；失效、不可读、作者不明或仅保存 URL 均保持 `unknown`；第三方支持率 `Js` 以正向支持为分子、以可判断条数（`supports + does_not_support`）为分母，未知与未复核仅单独计数与列出原因，不进入分子或分母，无可判断复核时返回 `null` 与具体原因（`no_citations` / `uninspected_only` / `no_judgable_inspections`）。
- `/dashboard/monitoring/competitors` 与 `zh-CN` / `en` 双语文案：在引用来源区展示第三方支持率（含 `1/2` 等可判断比率或 `N/A` 及原因）、可判断明细、单独列出的未知条数与未进入分母原因拆解；引用卡片保留 `citationId · observationId` 并明确区分「页面支持品牌 / Page supports the brand」、「页面明确不支持 / Page does not support」与「支持性未知 / Support unknown」；另一账号访问返回 `404` / 未找到隔离提示。

## 验证结果

- 静态、多语言与 DDL：`pnpm lint`、`pnpm typecheck`、`pnpm check:i18n`（3593 键）、`pnpm test:i18n`（7 项）、`pnpm db:ddl:check`、`pnpm check:feature-map`（69/69 页面）、`python3 docs/tools/validate_docs.py`、`pnpm build` 均通过。
- 双库与领域回归：`pnpm test:competitors`（16 项，覆盖 SQLite3 与本地 PostgreSQL 旧迁移升级保留历史 `unknown` 行、`N/A` 仅 URL 态、1 正向 + 1 非支持 + 2 不可读 = `1/2`、作者不明仍为 `unknown` 及越权 `NOT_FOUND`）、`pnpm test:continued-operations`（72 项）、`pnpm test:data-exports`（9 项，含双库旧迁移升级后结构一致核对）、`tests/layout/workspace-landmark.test.mjs`（30 项）均通过。
- 隔离浏览器：`pnpm exec playwright test tests/e2e/competitors-entry.spec.ts`（3 项，隔离 Chrome 覆盖 `zh-CN` / `en`、375/768/1440 视口无横向溢出、仅 URL 时显示 `N/A`、提交正向/非支持/不可读后显示 `50.0% (1/2)` 与 `未知 2 条`、保留 4 条引用编号与三态标签以及跨账号隔离）。
- 本记录使用隔离与合成样本，不勾选 `T-M1-02`。
