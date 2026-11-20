# M0-27 问题驱动内容计划与小批次草稿

Issue [#27](https://github.com/Godyu97/geo-pro/issues/27)｜2026-11-20｜对应 R-M0-09 / S-M0-09 / T-M0-09。AC-M0-09-1/2/3 已用纯函数与 SQLite 集成验证；越权拒绝与幂等 replay 已覆盖。本环境未配置 `DATABASE_URL` 时 PostgreSQL 用例跳过。审核导出与发布核验留给 #28/#29；真实生成能力留给后续通道验证。

## 范围与关键决定

- 新增 `content-drafts`：ContentPlan / Brief(+Version) / Batch(+Unit) / ContentVersion（始终 draft）。
- Schema 双方言迁移与全量 DDL；purge 清理新表。
- Brief gaps 门禁；三类隔离模板填充；`fixtures.failBriefIds` / `pauseAfter` 供验收。
- 接线 `withEligibleFacts(stage=review)` 与 `applyQuotaLedger(kind=generation)`；无 grant 时 `unknown_pending`。
- 工作台：`/dashboard/content`、Brief/批次详情；模块导航与 zh-CN/en。

## 修改入口

- `src/lib/db/content-schema(.sqlite).ts`、drizzle `0016_*` / sqlite `0015_*`、DDL
- `src/features/content/*`、`src/app/(dashboard)/dashboard/content/`、`src/app/api/content/`
- `src/features/brands/purge-dao.ts`、`module-links`、i18n；专项测试：`pnpm test:content`

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:content` | 通过（sqlite + 纯函数 AC-M0-09-1/2/3；postgresql 因无 DATABASE_URL 跳过） |
| `pnpm check:i18n` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm db:ddl:check` | 通过 |
| `pnpm build` | 通过 |

隔离验收使用合成 Brief/事实与 fixture 失败/暂停，不代表真实模型质量或试点投递结果。
