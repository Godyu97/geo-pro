# Issue #172 用生成时冻结的题集重开历史人工题单

2026-11-26。 [Issue #172](https://github.com/Godyu97/geo-pro/issues/172) · [R-M1-01](../02-产品需求文档-PRD.md) · [S-M1-01](../specs/M1.md#s-m1-01) · [指标与证据合同](../07-指标与证据合同.md) §1

品牌负责人在 `/dashboard/monitoring/plans` 生成或重开消费者人工题单时，新的到期人工题单由服务端按本品牌明确的冻结题集版本校验所选题目并固化 `prompt_set_id` 与 `prompt_set_version`。后续无论题集是否继续冻结新版、改写题干或移除旧题，重开原题单仍按当时的冻结版本、原题顺序和原文回读；缺少可验证版本的旧题单保留题目编号并清楚标明版本或正文无法核对。

## 交付范围

- **数据库与迁移**：`sampling_due_run` 在表尾增加可空的 `prompt_set_id` 与 `prompt_set_version`，更新 `sampling_due_run_state_check`（允许人工题单同时兼容历史双空记录，或同时保存 36 位 `prompt_set_id` 与正整数 `prompt_set_version`；官方槽位保持双空）。迁移为 `drizzle/0095_large_frank_castle.sql` 与 `drizzle/sqlite/0094_stiff_lady_deathstrike.sql`（SQLite 复制旧表时写入 `NULL, NULL` 并按反引号表名重建以匹配全量 DDL），同步更新 `drizzle/ddl/postgresql.sql` 与 `drizzle/ddl/sqlite.sql`。
- **服务端生成校验与固化**：`driveDueWindowSchema` 支持可选 `promptSetId`。当存在待新建的到期人工槽位时，服务端在事务内使用本品牌指定的 `prompt_set`（未传时取本品牌最新冻结 `prompt_set`），拒绝跨品牌 `promptSetId`、无冻结题集、重复题目编号、非 `confirmed` 或未出现在该冻结版本中的题目编号（含另一品牌题目编号），返回 `INVALID_INPUT` 且不写入任何到期行或暴露他品牌正文。重跑已生成的旧槽位直接复用原题单，不新增记录也不再调用执行器。
- **按冻结版本回读与历史兼容**：`manualSheetsForBrand` 不再读取品牌最新题集，而是按人工题单保存的 `promptSetId` 批量调用 `PromptDao.clusterSources`（`WHERE brand_id = ? AND id IN (...)`，双方言执行计划使用 `prompt_set` 主键索引 `prompt_set_brand_id_id_pk` / `sqlite_autoindex_prompt_set_1`）。校验 `promptSetId` 与 `promptSetVersion` 一致后，按原 `promptIds` 顺序解析当时的题干；仅有历史编号列表的旧记录保持 `versionVerified: false`，保留编号顺序且不猜测正文；没有人工题单或仅有历史无版本记录时执行 0 次 `prompt_set` 查询。
- **计划页与双语文案**：`/dashboard/monitoring/plans` 在处理到期窗口表单中列出本品牌已冻结题集版本（默认最新冻结版，无冻结题集时提示先冻结），并在每个人工题单卡片展示对应的冻结题集版本与 ID，或清楚提示缺少可验证版本/正文；同步补全 `zh-CN` / `en` 消息键。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发库为 PostgreSQL，Redis 与对象存储探针通过，邮件长期 mock 已开启。 |
| 迁移与 DDL | `pnpm db:ddl` 与 `pnpm db:ddl:check` 双方言通过。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm test:query-plans` 4 项通过，验证 SQLite 与 PostgreSQL 从基线升级、幂等重迁与全量 DDL 结构一致。 |
| 静态与构建 | `pnpm lint`（0 error）、`pnpm typecheck`、`pnpm build` 通过，包含 `/dashboard/monitoring/plans`。 |
| 双语与地图 | `pnpm check:i18n` 通过（3948 个键与参数一致）；`pnpm test:i18n` 7 项通过；`pnpm check:feature-map` 通过（70/70 页面已映射）。 |
| 隔离双库测试 | `pnpm exec node --conditions=react-server --test tests/sampling-plans/*.test.mjs` 9 项通过（含 `tests/sampling-plans/due-window.test.mjs` 6 项）；`pnpm test:prompts` 9 项、`pnpm test:monitoring` 37 项、`pnpm test:evidence` 46 项全部通过。覆盖 v2 建单后冻结 v3（改题+删题）仍按原顺序与 v2 原文/版本回读、v3 新建单读 v3、重跑旧槽保持 `manual=1 / official=1` 且执行器调用次数不变（1 次）、旧无版本记录标明不可核对、跨品牌题目与跨品牌题集拒绝且不暴露他品牌正文，以及 `EXPLAIN` 索引计划验证。 |
| 浏览器 E2E | `pnpm test:e2e tests/e2e/manual-sheet.spec.ts tests/e2e/quality-alerts.spec.ts` 2 项通过。在 `/dashboard/monitoring/plans` 实测跨品牌题目被拒绝（`runs=0, attempts=0`）、v2 建单后冻结 v3 仍回读 v2 原顺序与原文、重跑旧槽保持 `manual=1, attempts=0`、v3 建新单、历史无版本记录标明无法核对，并在 `zh-CN` / `en`、1440/768/375 视口与键盘导航下无横向溢出。 |

未发起真实消费者渠道人工采样；T-M1-01 与真实阶段门禁（`T-M1-GATE`）仍待后续真实样本与连续观察窗口，本记录不勾选 T-M1-01。
