# M0-26 证据诊断、页面检查与行动任务

Issue [#26](https://github.com/Godyu97/geo-pro/issues/26)｜2026-11-20｜对应 R-M0-08 / S-M0-08 / T-M0-08。AC-M0-08-1/2/3 已用纯函数与 SQLite 集成验证；越权拒绝已覆盖。本环境未配置 `DATABASE_URL` 时 PostgreSQL 用例跳过。内容批次与发布核验留给 #27–#29；真实通道开通留给 #31。

## 范围与关键决定

- 新增 `optimization-tasks`：六类 Finding、任务去重、优先序、最多 5 URL 只读页面检查。
- Schema：`optimization_finding` / `optimization_task` / `optimization_task_evidence` / `page_check_record`（双方言迁移与全量 DDL）。
- 缺席仅输出观察与待验证假设；同品牌+簇+目标页+缺口合并证据；页面指令只读标记，不宣称收录。
- 工作台：`/dashboard/optimization`、详情页；证据详情可生成任务；概览回接最多 3 条优先任务。

## 修改入口

- `src/lib/db/optimization-schema(.sqlite).ts`、drizzle 迁移与 DDL
- `src/features/optimization/*`、`src/app/(dashboard)/dashboard/optimization/`、`src/app/api/optimization/`
- 证据概览回接与详情生成入口；i18n：`optimization`；专项测试：`pnpm test:optimization`

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:optimization` | 通过（sqlite + 纯函数 AC-M0-08-1/2/3；postgresql 因无 DATABASE_URL 跳过） |
| `pnpm test:evidence` | 通过（回归） |
| `pnpm check:i18n` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm db:ddl:check` | 通过 |
| `pnpm build` | 通过 |

隔离验收使用合成样本与 fixture 页面，不代表真实客户站或试点投递结果。
