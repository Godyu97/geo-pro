# Issue #161 连接器增量游标与跨源去重

2026-11-26。 [Issue #161](https://github.com/Godyu97/geo-pro/issues/161) · [S-M2-04 第 1、2、4 条与 AC-M2-04-1、AC-M2-04-3](../specs/M2.md#s-m2-04) · [数据连接预览](M0-135-data-connections.md)

## 交付范围

- 双库迁移（PostgreSQL `drizzle/0089_light_vin_gonzales.sql`、SQLite `drizzle/sqlite/0088_jazzy_quentin_quire.sql` 及全量 DDL）：`data_connection` 增加可空 `sync_cursor`、可空 `coverage_complete` 和默认 0 的 `sync_stopped`。游标与覆盖必须同时为空或同时有效；预览状态不能带游标，也不能标记为已停止。迁移保留既有连接和字段，新列按未同步写入。
- 已批准连接的 `POST /api/settings/data-connections/:id/sync` 只接受受控荷载，不访问外部主机。连接名称必须与同一品牌下未撤销的同步授权来源名称一致。没有匹配授权时拒绝且不写审计；授权已撤销时记一条 `stopped` 尝试、把连接标为同步停止，不推进游标、不写新事件。同一游标重放不写新行、不合并新证据。新游标写入 `connector` 来源，并按既有线索去重合并证据。直接电话或邮箱会整批拒绝，响应不回显该标识。
- CSV 导入仍写入 `csv` 来源。同一事件键无论先 CSV 还是后连接器，咨询计数保持 1，两条来源都保留；摘要不同记冲突，不另计一条。线索主分类仍按既有互斥优先级，不新增第二套指标。
- `/dashboard/settings/data-connections`、`/dashboard/reports/connector-events`、`/dashboard/reports/leads` 在 `zh-CN` / `en` 显示游标、覆盖是否完整、同步已停止，以及 csv / connector 来源。一次预览拉取的原行为不变。

## 验证结果

- 静态与构建：`pnpm lint`、`pnpm typecheck`、`pnpm build` 退出码均为 0。`pnpm check:i18n` 通过。`pnpm db:ddl:check` 通过。`python3 docs/tools/validate_docs.py` 通过。
- 双库回归：`pnpm test:continued-operations` 含本轮用例，SQLite 与 PostgreSQL 均通过。同一事件先 CSV 再连接器后计数为 1，来源为 csv 与 connector，证据合并；重放同一游标不增加允许尝试、也不并入新证据；晚到的新游标仍只保留 1 条线索和 1 条事件；撤销后下一次拉取返回停止，游标停在上一档，历史仍可查。含电话的荷载整批拒绝。跨账号返回 `NOT_FOUND`。`pnpm test:data-exports` 9 项通过，含旧迁移升级后结构与全量 DDL 一致。数据连接、咨询事件、线索和同步撤销相关 19 项双库测试通过。
- 隔离浏览器：`pnpm exec playwright test tests/e2e/data-connections.spec.ts tests/e2e/connector-events.spec.ts tests/e2e/business-leads.spec.ts` 3 项通过。开发库已应用本轮 PostgreSQL 迁移。覆盖中文与英文的 375、768、1440 像素，以及跨账号 404。浏览器沿用原登记、导入和批准路径；游标推进、重放和撤销止损由上面的双库用例覆盖。
- 本记录使用隔离库、开发库和合成荷载，不勾选 `T-M2-04`。没有连接真实站点、日志或业务系统。
