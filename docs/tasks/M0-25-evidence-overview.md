# M0-25 可解释概览与证据下钻

Issue [#25](https://github.com/Godyu97/geo-pro/issues/25)｜2026-11-20｜对应 R-M0-07 / S-M0-07 / T-M0-07。AC-M0-07-1/2 已用纯函数金样与 SQLite 集成验证；轨道隔离与越权拒绝已覆盖。本环境未配置 `DATABASE_URL` 时 PostgreSQL 用例跳过。优化任务真实建议留给 #26；真实监测通道开通留给 #31。

## 范围与关键决定

- 新增 `evidence-overview`：同一 scope 下题等权主卡 + 单独标明的样本池化，空数据 N/A 与下一步，不注入演示数字。
- 主卡仅纳入 discovery/scenario/constraint（人工无题型时默认 discovery）；不跨 API/消费者轨平均。
- 工作台入口：`/dashboard/monitoring/overview`、`/dashboard/monitoring/answers`；总览增加打开概览链接。
- 无 Schema 变更；复用 #24 Observation / AnalysisVersion。

## 修改入口

- `src/features/evidence/metrics.ts`、`overview-*.ts(x)`、`dao.ts`（scope 列表）
- `src/app/(dashboard)/dashboard/monitoring/overview|answers/`、`src/app/api/monitoring/overview/`
- i18n：`evidenceOverview`；专项测试：`pnpm test:evidence`

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:evidence` | 通过（sqlite + 纯函数金样 AC-M0-07-1/2；postgresql 因无 DATABASE_URL 跳过） |
| `pnpm check:i18n` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm build` | 见提交前执行记录 |

隔离验收使用合成样本与显式标签，不代表真实供应商或试点投递结果。
