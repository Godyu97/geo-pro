# Issue #121 演示观察与真实统计隔离

2026-11-23。 [Issue #121](https://github.com/Godyu97/geo-pro/issues/121) · [S-M0-04](../specs/M0.md#s-m0-04) · [公共 SPEC](../04-产品功能规格-SPEC.md)

演示观察写入独立表 `demo_observation`，`is_demo` 由约束固定为 1。保存和列表不写入 `answer_observation`，不创建复测或报告快照，也不调用采样。真实概览继续只读自然回答。`buildSnapshotDocument` 仍写出 `is_demo=false`。本记录不勾选 T-M0-04，也不把演示空间当成已验证渠道。

## 交付范围

- 双方言 Schema、迁移 `drizzle/0070_late_prowler.sql` 与 `drizzle/sqlite/0069_harsh_nitro.sql`，以及全量 DDL。列表索引为 `demo_observation_owner_idx`（负责人、品牌、创建时间、编号）。同一品牌的操作号唯一，重复提交回读原行。
- `POST /api/monitoring/demo-observations` 与 `GET /api/monitoring/demo-observations`。页面 `/dashboard/monitoring/demo` 在中英文都标出「演示数据 / Demo data」，并说明这不是已验证的客户结果。登录回跳允许该路径。
- 另一用户按品牌读取得到 404，响应不含演示正文。复制到自然回答、复测或正式报告的标志在写入前拒绝。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 结构 | `pnpm db:generate` 只新增 `demo_observation`。`pnpm db:ddl` 与 `pnpm db:ddl:check` 双方言通过。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。 |
| 隔离行为 | `node --conditions=react-server --test tests/monitoring/demo-observations.test.mjs` 3 项通过。SQLite 与 PostgreSQL 都确认保存后 `answer_observation`、`report_snapshot`、`report_retest` 和概览分母不变，列表 `is_demo=true`，快照构建 `is_demo=false`。PostgreSQL 计划断言未出现 `Seq Scan on demo_observation`。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/dashboard/monitoring/demo` 与 `/api/monitoring/demo-observations`。 |
| 双语 | `pnpm check:i18n` 通过，2789 个键。`pnpm test:i18n` 7 项通过。 |
| 环境 | `pnpm env:check` 14 项通过。 |

## 开发库与页面

2026-11-23。开发库既有品牌 `ef806b38-0b74-4420-aebd-701176444112` 在写入前后都是 3 条回答、0 张报告快照、概览样本数 3、推荐分母 0。临时品牌写入 1 条自然回答后保存演示观察 `0a9bf4f2-f394-48a7-99ee-d2c75ae02b81`，`is_demo=true`。该品牌回答数保持 1，报告快照保持 0，概览样本数和推荐分母保持 1。另一账号得到 `NOT_FOUND`，响应不含演示标记。快照构建结果 `is_demo=false`，观察编号只有自然回答 `9a411588-18b6-4395-961f-6d04d1d0336b`。临时账号、品牌和演示行已删除。

另用无头 Chrome 打开临时生产服务。1440 宽度下中文页显示「演示数据」和「不是已验证的客户结果」，提交后能看到刚保存的问题。切换英文后仍显示同一问题，并显示 “Demo data” 与 “not a verified customer result”。375 宽度下回答框和保存按钮可见。另一账号打开该品牌地址时看到找不到演示观察，页面不含演示正文。临时账号随后删除。
