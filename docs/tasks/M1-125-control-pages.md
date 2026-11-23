# Issue #125 观察对照页

2026-11-24。 [Issue #125](https://github.com/Godyu97/geo-pro/issues/125) · [S-M1-06](../specs/M1.md#s-m1-06)

负责人或分析者在正式观察还没有任何检查点时，可以登记一个对照页。标签只能读回 `observation`。写出任一检查点后再登记返回 409，对照表不增加行。因果标签被拒绝，数据库约束也不接受其他标签。另一用户读取或登记得到 404，响应里没有页面标识。对照页不改检查点模式，探索结论仍是探索。本记录不勾选 T-M1-06，不计算对照提升，不改 D+7/D+14/D+28 到期规则，也不连接外部采样、邮件或发布。

## 交付范围

- 双方言表 `formal_control_page`。字段为观察、品牌、负责人、页面标识、固定标签 `observation` 和登记时间。同一观察和页面标识唯一。列表索引是 `formal_control_page_observation_idx`（负责人、观察、登记时间、主键）。迁移为 `drizzle/0080_yummy_outlaw_kid.sql` 与 `drizzle/sqlite/0079_awesome_king_cobra.sql`，并已写入全量 DDL。既有 Drizzle 配置已经加载 `formal-observation-schema`。
- 登记和读取在 `src/features/formal-retest/`。`GET` 与 `POST /api/reports/observations/[id]/controls` 都校验会话和来源。同一页面在检查点出现前再次提交不增加第二行。
- 站内页 `/dashboard/reports/observations` 在中文显示「观察对照」，并说明这不是因果试验。英文对应为 Observation control，并说明这不是因果试验。已有检查点后表单关闭，已登记页面仍可查看。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 14 项通过。开发库为 PostgreSQL，Redis 与对象存储探针完成写读清理。邮件长期 mock 已开启。 |
| 结构 | `pnpm db:generate` 生成上述迁移。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm db:ddl` 与 `pnpm db:ddl:check` 通过，PostgreSQL 与 SQLite 全量 DDL 与当前 Schema 一致。 |
| 隔离行为 | `node --conditions=react-server --test tests/reports/formal-controls.test.mjs` 3 项通过。双方言都覆盖：无检查点时标签读回 `observation`；重复同一页面不增加行；D+7 进度检查点之后再登记为 `CHECKPOINT_EXISTS`（409），行数仍为 1；随后 D+14 在 23/30 可比题时仍为探索，进度行不被改成正式；因果标签为 `INVALID_INPUT` 且没有该行；直接写入 `causal` 或空白页面标识被检查约束拒绝；另一用户为 `NOT_FOUND`，响应不含页面标识。 |
| 查询计划 | 对照列表使用 `formal_control_page_observation_idx`。200 条其他负责人的对照行之后，本人列表仍是 1 次 `formal_control_page` 查询。 |
| 回归 | `node --conditions=react-server --test tests/formal-retest/observations.test.mjs tests/reports/formal-confounders.test.mjs` 6 项通过。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/api/reports/observations/[id]/controls` 与 `/dashboard/reports/observations`。 |
| 双语 | `pnpm check:i18n` 通过，2945 个键一致。`pnpm test:i18n` 7 项通过。中文标题为「观察对照」，说明含「不是因果试验」。英文标题为 Observation control，说明含 “not a causal experiment”。 |
| 开发库 | 2026-11-24。临时账号在无检查点时登记 1 行，标签为 `observation`。写入 D+7 进度检查点后再次登记返回 `CHECKPOINT_EXISTS`，行数仍为 1。因果标签未入库。另一临时用户为 `NOT_FOUND`。清理后该品牌的对照行计数为 0。未改动其他品牌。 |

页面点击、375/768/1440 视口和键盘操作未在浏览器中执行。当前会话没有浏览器自动化工具。登记、拒绝、隔离和双语文案由双方言隔离测试与开发库探针覆盖。
