# M0-30 同口径复测与报告快照

Issue [#30](https://github.com/Godyu97/geo-pro/issues/30)｜2026-11-20｜对应 R-M0-12 / S-M0-12 / T-M0-12。AC-M0-12-1/2/3 已用纯函数与 SQLite 集成验证；越权拒绝、快照不可变 successor、D+7 进度-only 与 purge 清理已覆盖。本环境未配置 `DATABASE_URL` 时 PostgreSQL 用例跳过。真实通道采样与获准试点留给 #31/#32。

## 范围与关键决定

- 新增 `report-retest`：Retest / D+7 Todo / 不可变 ReportSnapshot。
- 共同题匹配键含题版本、轨道、通道、协议、分析语义、地区与实体版本；修改题排除；≥3 共同可判断题才输出探索 pp。
- 无 `effective_at` 时仅诊断报告，不得声称经营闭环完成。
- D+7 为站内待办且 `autoCharge=0`；窗口未到期只给进度。
- 工作台：`/dashboard/reports`；下载 `/api/reports/snapshots/[id]?format=json|html`；zh-CN/en。

## 修改入口

- `src/lib/db/report-schema(.sqlite).ts`、drizzle `0019_*` / sqlite `0018_*`、DDL
- `src/features/reports/*`、`src/features/brands/purge-dao.ts`、i18n、module-links
- OpenSpec：`openspec/specs/report-retest`，归档 `openspec/changes/archive/2026-11-20-m0-12-report-retest`
- 专项测试：`pnpm test:reports`

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:reports` | 通过（sqlite + 纯函数 AC-M0-12；postgresql 因无 DATABASE_URL 跳过） |
| `pnpm check:i18n` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm db:ddl:check` | 通过 |
| `pnpm build` | 通过 |

隔离验收使用显式 fixture 与固定时钟，不代表真实监测费用或正式观察窗口结果。
