# Issue #164 提前停止观察

2026-11-26。 [Issue #164](https://github.com/Godyu97/geo-pro/issues/164) · [S-M1-06](../specs/M1.md#s-m1-06)

负责人或分析者在观察仍为观察中或已有检查点时，可以保存一条非空停止原因。状态变为已停止。已写入检查点的模式和槽位编号保持可读，采样槽、回答和检查点行不删除。尚未写入的 D+7、D+14、D+28 只显示已停止和这条原因，不再登记新的正式结论。空原因被拒绝，状态保持原样。另一账号读取或停止得到与不存在相同的结果，响应不含原因和槽位编号。停止不是改善、下降或因果结论。本记录不勾选 T-M1-06，不新开付费采样，也不改写基线、混杂因素或对照页。

## 交付范围

- `formal_observation` 增加可空 `stop_reason`，并允许状态 `stopped`。已停止时原因必须非空，且去空白后长度为 1 到 400。观察中或已有检查点时原因必须为空。PostgreSQL 用 `ADD COLUMN` 把该列加在表尾，与全量 DDL 的列顺序一致。SQLite 迁移从旧表复制时写入 `NULL`，再按反引号重建 `formal_observation`，避免旧表没有该列，也避免 `ALTER RENAME` 把反引号改成双引号后与全量 DDL 不一致。迁移为 `drizzle/0091_remarkable_siren.sql` 与 `drizzle/sqlite/0090_stormy_living_lightning.sql`。没有新增索引。按主键读取仍走主键，列表仍走 `formal_observation_owner_idx`。
- 停止和读取在 `src/features/formal-retest/`。`GET /api/reports/observations/[id]` 与 `POST /api/reports/observations/[id]/stop` 校验会话和来源。停止先确认本账号观察，再校验原因。另一账号在原因无效时也返回不存在。已停止后再登记检查点返回 `OBSERVATION_STOPPED`，不新增检查点，也不改已保存原因。
- `/dashboard/reports/observations` 提供停止原因表单。中文状态为「已停止」，英文为 Stopped。已停止后隐藏正式结论请求，保留已写入检查点，并列出未写入检查点的停止说明。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发库为 PostgreSQL，Redis 与对象存储探针完成写读清理。邮件长期 mock 已开启。Node v24.22.1，pnpm v12.14.0。 |
| 结构 | `pnpm db:generate` 生成上述迁移。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm db:ddl` 与 `pnpm db:ddl:check` 通过，PostgreSQL 与 SQLite 全量 DDL 与当前 Schema 一致。 |
| 隔离行为 | `node --conditions=react-server --test tests/reports/formal-stops.test.mjs` 3 项通过。双方言都覆盖：已有一条探索检查点时保存原因后状态为 `stopped`，检查点模式和编号不变，保留的槽位编号与检查点中的槽位一致；停止只产生 1 次 `UPDATE formal_observation`，没有删除、检查点写入或槽位、回答插入。再次登记 D+14 返回 `OBSERVATION_STOPPED`，检查点行数不变。另一份观察中的计划提交空原因返回 `INVALID_INPUT`，没有更新，状态仍为 `observing`。另一账号读取和停止均为 `NOT_FOUND`，响应不含原因和槽位编号。直接写成已停止但原因为空、观察中写入原因、已停止写入空白，都被检查约束拒绝。 |
| 查询计划 | 按观察主键读取使用 `formal_observation_pkey`（PostgreSQL）或 `sqlite_autoindex_formal_observation_1`（SQLite）。200 条其他观察之后，本人列表计划仍包含 `formal_observation_owner_idx`，读取仍是 1 次 `formal_observation` 查询。 |
| 回归 | `node --conditions=react-server --test tests/formal-retest/observations.test.mjs tests/reports/formal-controls.test.mjs tests/reports/formal-confounders.test.mjs tests/layout/workspace-landmark.test.mjs tests/continued-operations/issue-52.test.mjs` 43 项通过。`pnpm test:data-exports` 9 项通过。 |
| 静态与构建 | `pnpm lint` 通过，退出码 0。`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/api/reports/observations/[id]`、`/api/reports/observations/[id]/stop` 与 `/dashboard/reports/observations`。 |
| 双语 | `pnpm check:i18n` 通过，3887 个键一致。`pnpm test:i18n` 7 项通过。`pnpm check:feature-map` 通过，69/69 页面已映射。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/observation-plan.spec.ts` 1 项通过（18.9s）。临时账号在本地 PostgreSQL 上已有探索检查点后，提交空白原因看到中文无效提示，状态仍为检查点已记录。保存「客户要求在 D+28 前提前停止。」后，zh-CN 与 en 在 375 和 1440 宽度都显示已停止、停止原因、已保留槽位和原探索检查点，D+28 显示尚未写入及同一原因，正式结论按钮不再出现。另一账号页面不显示该原因和槽位编号。清理后对应用户、品牌版本和观察计数为 0。 |

未连接外部采样、邮件或发布。未把停止写成改善、下降或因果结论。T-M1-06 与 T-M1-GATE 未勾选。
