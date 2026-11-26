# Issue #175 历史同步批次重放保护与并发游标边界

2026-11-26。 [Issue #175](https://github.com/Godyu97/geo-pro/issues/175) · [S-M2-04 第 2、4 条与 AC-M2-04-1、AC-M2-04-3](../specs/M2.md#s-m2-04) · [增量同步](M2-161-connection-sync.md)

## 交付范围

- 双库迁移（PostgreSQL `drizzle/0096_narrow_tyger_tiger.sql`、SQLite `drizzle/sqlite/0095_young_shriek.sql` 及全量 DDL）：新增 `data_connection_sync_batch` 表保存每条连接已处理的游标令牌（`cursor`）、前序游标（`previous_cursor`）、覆盖状态与规范化载荷摘要（`payload_digest`），并在 `(connection_id, cursor)` 建立唯一索引。游标按不透明令牌比较，不按字符串大小排序。
- `POST /api/settings/data-connections/[id]/sync` 与 `syncDataConnection`：
  - 当前游标重放沿用原有重放保护（并发重放相同荷载返回 `replayed: true`，若携带过时 `expectedCursor` 且不同荷载并发冲突则返回 `409 CONFLICT`）。
  - 延迟重放已处理的历史游标且载荷摘要一致时返回 `200 { replayed: true }`，保留当前游标与覆盖状态，不新增 `allowed` 尝试、事件或线索；载荷摘要不同时返回 `409 CONFLICT` 且零写入。
  - 支持 `expectedCursor` 前置校验（界面表单默认携带当前 `syncCursor`）。同前置状态的并发新批仅允许符合当前状态的一批推进，另一批返回 `409 CONFLICT` 且零部分写入；触发 `CONFLICT` 或 `SYNC_STOPPED` 后界面刷新最新状态，允许重试继续。
  - 已批准新批可按新令牌推进（如字典序更小的 `batch-0`）并带入迟到的 CSV 同事件键，咨询计数保持 1 且保留 `csv` 与 `connector` 两个来源。
  - 启用前已有 `sync_cursor` 且缺少完整批次链的连接暴露 `missingHistoricalReceipts: true`，`/dashboard/settings/data-connections`、`/dashboard/reports/leads` 与 `/dashboard/reports/connector-events` 在中英文下显示无法核对历史边界的提示；此类连接仍可从当前游标继续推进，但无法凭过时前置游标回写无回执的旧批。
  - 授权撤销后继续重试新批记 `stopped` 并返回 `409 SYNC_STOPPED`；跨账号请求返回 `404 NOT_FOUND` 且不泄露游标。

## 验证结果

- 静态与构建：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`、`pnpm test:i18n`（7 项）、`pnpm check:feature-map`（70/70 页面）、`pnpm db:ddl:check`、`python3 docs/tools/validate_docs.py` 均通过；开发 PostgreSQL 已应用 `0096_narrow_tyger_tiger.sql` 迁移。
- 双方言隔离回归：`pnpm test:continued-operations`（86 项通过，含扩展后的 `tests/continued-operations/issue-161.test.mjs`）、`node --conditions=react-server --test tests/data-connections/*.test.mjs tests/continued-operations/issue-161.test.mjs`（18 项通过）、`pnpm test:data-exports`（9 项通过，含旧迁移升级及全量 DDL 结构一致校验）。覆盖历史重放保留 `batch-2` / `coverageComplete: true`、不同载荷 `CONFLICT`、非字典序令牌 `batch-0` 与迟到 CSV 事件去重（计数 1、双来源）、并发抢占一胜一冲突零部分写入及重读后继、事务中失败回滚与重试恢复、缺历史回执旧连接边界、撤销停止、跨账号隔离，以及双方言索引查询计划（`data_connection_sync_batch_owner_idx` / `data_connection_sync_batch_cursor_uidx`）。
- 隔离浏览器回归：`pnpm test:e2e tests/e2e/data-connections.spec.ts tests/e2e/business-leads.spec.ts tests/e2e/connector-events.spec.ts`（4 项通过）。覆盖 `zh-CN` / `en`、375/768/1440 视口和键盘操作，在 `/dashboard/settings/data-connections` 与 `/dashboard/reports/leads` 核对 `batch-1` → `batch-2`、重放 `batch-1` 返回 `syncReplayed` 且保留 `batch-2`、异载荷返回 `409 CONFLICT`、并发请求一胜一冲突、缺历史回执边界提示、撤销停止及跨账号 404 不泄露游标。
- 本记录仅使用受控合成荷载、隔离库和本地开发库，不勾选 `T-M2-04`。
