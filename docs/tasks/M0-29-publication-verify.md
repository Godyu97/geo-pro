# M0-29 人工发布回填与公开核验

Issue [#29](https://github.com/Godyu97/geo-pro/issues/29)｜2026-11-20｜对应 R-M0-11 / S-M0-11 / T-M0-11。AC-M0-11-1/2/3 已用纯函数与 SQLite 集成验证；越权拒绝、effective_at 不回写、mismatch 维护待办与 purge 清理已覆盖。本环境未配置 `DATABASE_URL` 时 PostgreSQL 用例跳过。真实外网抓取与获准用户发布留给阶段门禁（#32）。

## 范围与关键决定

- 新增 `publication-verify`：PublicationVersion / Check / Action。
- 隔离 fixture 页核验（draft_box / login_wall / public / removed）；HTTP 成功不足。
- 人工证据 → `verified_manual`，与 `verified_public` 区分；`effective_at` 仅首次通过写入。
- mismatch 生成 `repair_mismatch` 开放待办；不实现自动登录/自动发布。
- 工作台：稿件页回填、`/dashboard/content/publications/[id]`；zh-CN/en。

## 修改入口

- `src/lib/db/content-schema(.sqlite).ts`、drizzle `0018_*` / sqlite `0017_*`、DDL
- `src/features/content/{verify,commands,dao,contracts,api,actions,version-page,publication-page}.*`
- `src/features/brands/purge-dao.ts`、i18n；专项测试：`pnpm test:content`

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:content` | 通过（sqlite + 纯函数 AC-M0-11；postgresql 因无 DATABASE_URL 跳过） |
| `pnpm check:i18n` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过 |
| `pnpm db:ddl:check` | 通过 |
| `pnpm build` | 通过 |

隔离验收使用合成公开页/受限页 fixture，不代表真实外网可达性或试点发布结果。

## 附带说明

本轮发现 #28 审批导出提交此前仅在功能分支，已 cherry-pick 到 `main` 作为 #29 软件依赖。
