# Issue #134 到期采样窗口与质量优先提醒

2026-11-24。 [Issue #134](https://github.com/Godyu97/geo-pro/issues/134) · [S-M1-01](../specs/M1.md#s-m1-01) · [品牌管理与监测计划](brand-monitoring-next.md)

## 交付范围

- 活跃计划按调用方给出的 IANA 时区判断槽位是否到期。同一计划、通道、本地日历窗口和槽位只保留一行 `sampling_due_run`。官方槽先写入 `reserved`，受控执行返回运行编号后再改为 `accepted` 并记下本次费用。再次处理回读该行，不再调用执行器。
- 预算不够只暂停官方轨道上尚未执行、且时间不早于当前时刻的槽。通道失效或降级只暂停该通道的未来槽。已经失败的槽仍留在覆盖分母。消费者到期槽写入人工题单，费用为 0，不记成自动采集。
- 窗口关闭后读取已入证回答。覆盖按计划槽位；若已登记官方运行，则改用该运行的监测槽位数。证据完整、引用完整，且要求联网时必须有触发证据，才算合格。推荐未知不进入推荐率。覆盖不足、引用字段不完整或模式变化只产生 `data_quality`，`claim_brand_decline` 为 0。可比窗口少于两个时保留质量读数，不产生趋势提醒。同品牌、同类型、同窗口的未关闭提醒继续合并，确认状态保留。
- 站内计划页可以处理到期窗口。该按钮不调用供应商。页面路径是 `/dashboard/monitoring/plans`，提醒仍在 `/dashboard/monitoring/alerts`。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs`。`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过，2898 个键。 |
| 结构 | `pnpm db:generate` 生成 `drizzle/0077_wooden_gorgon.sql` 与 `drizzle/sqlite/0076_reflective_ronan.sql`。`pnpm db:ddl` 后 `pnpm db:ddl:check` 双方言通过。`pnpm db:migrate` 已在回环开发 PostgreSQL 应用。 |
| 隔离行为 | `node --conditions=react-server --test tests/sampling-plans/*.test.mjs` 6 项通过，覆盖 SQLite 与 PostgreSQL。到期窗口覆盖未到期、重复执行不新增运行和费用、单轨预算暂停、通道失效只暂停自身、失败槽留在分母、覆盖不足不产生趋势、重复触发合并且确认后状态不变。查找计划使用 `sampling_due_run_owner_idx`。 |
| 监测与证据 | `pnpm test:evidence` 19 项通过。`pnpm test:monitoring` 与串行重跑都有 1 项失败：未改动的 `sampling_protocol` 最新冻结版本查询在 `ANALYZE` 后走了 `sampling_protocol_operation_uidx`，断言仍要求 `sampling_protocol_owner_idx`。同文件的行为断言在该检查之前已经通过。单独重跑该测试曾通过一次。本轮没有修改采样协议表或这条查询。 |

## 开发库到期窗口

2026-11-24。品牌 `ef806b38-0b74-4420-aebd-701176444112` 仍为 active。计划 `b5aaeac5-df7d-4023-85bf-4b05c426f78d`，时区 `Asia/Shanghai`，槽位时间 `2026-11-23T14:23:39.977Z`，处理时刻 `2026-11-24T16:00:00.000Z`，窗口 `2026-11-23`。

官方槽登记到既有运行 `db6cb290-ccec-4c6c-b63b-7fa3fab1d287`。到期行 `8f77bf2a-34d0-4896-aaad-330ab4e0b63d`，状态 `accepted`，费用 3（CNY 最小单位），来自该运行 3 条已知费用的尝试。第一次处理调用执行器 1 次，第二次为 0 次。处理前后该运行已知费用仍是 3 次尝试、合计 3；品牌额度尝试仍是 6 次、合计 6。没有新增供应商调用。

该运行的 3 条原文都是 `complete` 引用、请求联网 `off`、实际联网 `not_triggered`。最新分析的推荐都是 `unknown`。质量读数计划 3、合格 3、覆盖足够，可比窗口 0，`waiting_for_trend` 为真。窗口 `2026-11-23` 没有质量告警，也没有趋势告警。

本记录不勾选 T-M1-01，也不把 AC-M1-GATE 记为通过。第二个完整可比窗口和正式 10 题 × 2 轮仍待后续观察。

页面点击、375/768/1440 视口未在浏览器中执行。当前会话没有浏览器工具。到期、暂停、重放、题单和提醒由双方言隔离测试覆盖；开发库由上述命令回读。
