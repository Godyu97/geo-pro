# Issue #181 线索反馈记录与报告汇总回跳

2026-11-27。 [Issue #181](https://github.com/Godyu97/geo-pro/issues/181) · [S-M1-07](../specs/M1.md#s-m1-07) · [AC-M1-07-1 / AC-M1-07-2](../specs/M1.md#s-m1-07)

在 `/dashboard/reports/leads` 为具体脱敏线索按已冻结的有效性规则记录三态判定与跟进结果，保存递增反馈版本（`lead_feedback`），并将汇总与版本定位写入新建 `report-v4` 报告快照的 `business_feedback.lead_feedback`，支持从 `/dashboard/reports` 直接打开快照当时采用的反馈版本。本记录不勾选 `T-M1-07`。

## 交付范围

- **数据库与迁移**：PostgreSQL / SQLite 新增 `lead_feedback` 表（关联 `business_lead` 与 `lead_validity_rule`，`(lead_id, revision)` 唯一约束），保留 `real_need`、`target_industry`、`can_follow_up` 可空三态与 `status`（`qualified` / `disqualified` / `unknown`）、`outcome`（`unknown` / `pending` / `contacted` / `won` / `lost`）；同步更新全量 DDL。
- **业务写入与并发控制**：仅对目标品牌的已冻结规则开放保存（未冻结返回 `409 RULE_NOT_FROZEN`），并发修改返回 `409 FEEDBACK_CHANGED`；`unknown` 保持未知而不推断为合格或已跟进。
- **页面、导出与报告联动**：台账列表支持进入单条线索记录并编辑/查看反馈版本；本人数据导出 `reports` 域新增 `leadFeedback` 切片；新报告快照汇总有效/无效/未知及跟进结果并保留 `records` 列表，历史快照字节不变。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境与静态门禁 | `pnpm env:check` 15 项通过。`pnpm lint`（0 错误，8 条既有告警）、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`（4093 键）、`pnpm test:i18n`（7/7）、`pnpm check:feature-map`（70/70）与 `pnpm db:ddl:check` 均通过。 |
| 迁移与双库测试 | 开发 PostgreSQL 执行 `pnpm db:migrate` 成功。`pnpm test:reports`、`pnpm test:data-exports`（9/9）、`node --conditions=react-server --test tests/business-feedback/*.test.mjs`（9/9）、`pnpm test:query-plans`（4/4）与 `pnpm test:continued-operations`（86/86）均通过（SQLite3 与 PostgreSQL 隔离库）。 |
| 隔离 Chrome E2E | `pnpm exec playwright test tests/e2e/business-leads.spec.ts tests/e2e/lead-quality.spec.ts tests/e2e/report-snapshot.spec.ts` 4 项通过，覆盖中英文与 375/768/1440 视口下键盘记录线索反馈（`unknown` 保留未知）、生成快照回跳到对应反馈版本、历史快照字节不变及跨账号 404 隔离。 |
| 开发环境入口核验 | `http://fedora.local:3000` 使用持久化 `owner`、`readonly`、`outsider` 账号打开 `/dashboard/reports/leads`、`/dashboard/reports/lead-quality` 与 `/dashboard/reports` 均返回 HTTP 200；`outsider` 访问主品牌返回不存在提示。 |
| 未验证 / 阻塞项 | `pnpm verify:auth` 因 `BETTER_AUTH_URL` 为 `http://fedora.local:3000`（脚本限定 loopback）环境受阻；开发品牌 `GeoPro 智搜监测` 尚未导入获准脱敏反馈及取得第二窗口报告，相关真实业务验收待获准反馈与后窗数据就绪后补走。 |
