# Issue #165 计划趋势阈值

2026-11-26。 [Issue #165](https://github.com/Godyu97/geo-pro/issues/165) · [S-M1-01](../specs/M1.md#s-m1-01) 第 3 条 · [指标合同](../07-指标与证据合同.md) 第 5 节

品牌负责人在采样计划还是草稿时，把连续两个可比窗口的推荐率下降提醒从默认 10 个百分点改成自己的口径。计划生效后，该版本保持当时的阈值。已经写下的提醒不因为后来把阈值调高或调低而消失、改写或另起一条。新的预算版本只影响此后尚未结束的窗口。

## 交付范围

- `sampling_plan` 增加 `trend_threshold_pp`，非空，默认 10，检查约束要求大于 0。PostgreSQL 用 `ADD COLUMN` 加在表尾。SQLite 从旧表复制时写入 10，再按反引号重建 `sampling_plan`，避免 `ALTER RENAME` 改掉全量 DDL 的引号。迁移为 `drizzle/0092_bouncy_bruce_banner.sql` 与 `drizzle/sqlite/0091_goofy_spacker_dave.sql`。没有新增索引。品牌计划列表仍走 `sampling_plan_owner_idx`；按计划编号读取版本走主键 `(id, version)`。
- 草稿可以改当前版本的阈值。变成进行中之后，同一行不再改这个数；预算修订新增版本，未填写时沿用上一版。到期窗口用最新窗口结束时刻之前已经存在的版本做趋势判断，比较仍是严格大于阈值。覆盖不足、引用字段变化、模式变化和质量优先规则保持原样。
- `/dashboard/monitoring/plans` 用 zh-CN / en 显示当前版本和各版本的阈值。新建、草稿保存和新预算版本都能填写；留空分别表示 10 或沿用当前版本。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发库为 PostgreSQL，Redis 与对象存储探针完成写读清理。邮件长期 mock 已开启。Node v24.22.1，pnpm v12.14.0。 |
| 结构 | `pnpm db:generate` 生成上述迁移。SQLite 复制语句改为写入默认 10，并重建反引号表。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm db:ddl` 与 `pnpm db:ddl:check` 通过。 |
| 隔离行为 | `pnpm test:monitoring` 37 项通过，含 `tests/monitoring/trend-threshold.test.mjs`。双方言都覆盖：草稿把阈值改成 15 后生效，版本仍是 1；进行中再改当前版本被拒绝。下降 12pp 不产生趋势提醒，下降 16pp 且覆盖足够时产生趋势提醒，`claimBrandDecline` 为 true。未设置阈值时下降 10pp 不提醒，下降 20pp 才提醒。已按 10pp 写下的趋势提醒，在新版本改为 30 后种类仍是 `trend`、原因仍是 `recommendation_drop`，同一窗口不新增第二条；此后窗口下降 20pp 仍不新增，下降 40pp 才为新窗口另写一条，旧提醒不变。已结束窗口把阈值降到 5 也不补写。0 被检查约束拒绝，省略列时读回 10。 |
| 查询计划 | 计划列表的 `EXPLAIN` 仍包含 `sampling_plan_owner_idx`。阈值列随该行读出，没有额外查询。`tests/sampling-plans/*.test.mjs`、`tests/quality-alerts/*.test.mjs` 与 `tests/continued-operations/issue-42.test.mjs` 共 14 项通过，含迁移库与全量 DDL 的结构对照。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/dashboard/monitoring/plans`。 |
| 双语 | `pnpm check:i18n` 通过，3895 个键一致。`pnpm test:i18n` 7 项通过。`pnpm check:feature-map` 通过，69/69 页面已映射。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/manual-sheet.spec.ts tests/e2e/quality-alerts.spec.ts` 2 项通过。新建计划填写 15 后，zh-CN 与 en 在 375、768 和 1440 宽度都显示该版本的 15 个百分点。未填写的计划显示 10 个百分点，英文页在 375 和 1440 宽度同样可读。 |

未发起真实采样。T-M1-01 与真实通道核验未勾选。
