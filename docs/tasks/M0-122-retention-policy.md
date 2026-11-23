# Issue #122 建档时保存已接受的保留策略版本

2026-11-24。 [Issue #122](https://github.com/Godyu97/geo-pro/issues/122) · [SPEC §6 数据管理](../04-产品功能规格-SPEC.md)

创建品牌时展示当前已发布保留策略的中文和英文摘要。接受动作与品牌写入同一事务，只记录当时的版本。之后新发布的版本不改写已有接受记录，品牌页只预览新摘要。没有已发布策略，或提交的版本不是当前版本时，不创建品牌。既有品牌没有接受记录时展示缺失，不回填同意。本记录不勾选 T-M0-01，不打开正式品牌准入，也不删除事实、内容或报告。`GEO_PILOT_RETENTION_DISCLOSED` 不代替已发布策略或接受记录。

## 交付范围

- 双方言表 `retention_policy` 与 `brand_retention_acceptance`。政策按递增版本追加，字段为中英文摘要、默认可恢复天数和发布时间。每个品牌最多一行接受记录，保存品牌、策略版本和接受时间。迁移为 `drizzle/0071_cynical_quasimodo.sql` 与 `drizzle/sqlite/0070_polite_moonstone.sql`，并已写入全量 DDL。
- 建档命令在尚无当前策略时返回 `RETENTION_UNPUBLISHED`，提交版本与当前版本不一致时返回 `RETENTION_NOT_ACCEPTED`，两者均为 HTTP 409，且不插入品牌行。草稿和既有品牌的修改不重写接受记录。
- 新建页在两种界面语言下都展示两种摘要，并在保存品牌时写入接受版本。品牌页显示已接受版本；若已有更新的策略，只预览该摘要。另一用户读取品牌和接受记录均不可见，接口返回 404 `NOT_FOUND`。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 结构 | `pnpm db:generate`、`pnpm db:migrate`（回环开发 PostgreSQL）、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。PostgreSQL 将过长外键名截断为 `brand_retention_acceptance_policy_version_retention_policy_vers`，迁移与全量 DDL 截断一致。 |
| 隔离行为 | `node --conditions=react-server --test tests/brands/retention-policy.test.mjs` 2 项通过。未发布策略时建档失败且品牌行数为 0；接受版本 1 后仅有该行，重复提交不新增接受行；发布版本 2 后旧品牌仍读版本 1，并读到版本 2 摘要。环境变量 `GEO_PILOT_RETENTION_DISCLOSED=true` 在没有政策行时仍是 `RETENTION_UNPUBLISHED`。直接插入的旧品牌 `acceptedVersion` 为 null。另一用户的 `retentionView` 与 `version` 均为 null。 |
| 查询计划 | 品牌保留读取为一条 SQL。PostgreSQL 用 `retention_policy_pkey` 的 Index Only Scan Backward 取最大版本，接受行走 `brand_retention_acceptance_pkey`。SQLite 接受行走 `sqlite_autoindex_brand_retention_acceptance_1`，政策版本走整数主键；`max(version)` 对 `retention_policy` 做 SEARCH。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过。`pnpm test:i18n` 7 项通过。 |
| 环境 | `pnpm env:check` 14 项通过。 |

## 开发库与页面

2026-11-24。回环开发 PostgreSQL 已迁移。当前已发布策略为版本 1，`published_at` 为 `2026-11-23T16:03:37.772Z`，默认可恢复 30 天。摘要说明活跃品牌的事实、内容和报告默认保留，确认删除后默认可在 30 天内恢复，接受该版本不删除事实、内容或报告。`brand_retention_acceptance` 行数为 0，既有品牌不回填。

另用无头 Chrome 对隔离 PostgreSQL 的 `next start`（`127.0.0.1:3122`，`GEO_BRANDS_FIXTURE=1`）走完建档。1440 宽度下中文页同时显示两种摘要，勾选接受后保存，品牌页显示「已接受版本 1」。切换英文后显示 “Accepted version 1” 和英文摘要。375 宽度下页面未出现横向溢出。再发布版本 2 并刷新后，已接受版本仍为 1，并出现版本 2 的预览说明和摘要。另一账号请求 `GET /api/brands?id=` 得到 404 `NOT_FOUND`；打开品牌地址时看到 “Page not found”，页面不含品牌名和策略摘要。该找不到页由工作台壳层展示，文档响应状态沿用既有页面行为。临时库、服务和账号已清理。
