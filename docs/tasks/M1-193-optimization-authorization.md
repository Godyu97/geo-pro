# Issue #193 优化任务与行动草案品牌授权

2026-11-27。 [Issue #193](https://github.com/Godyu97/geo-pro/issues/193) · [S-M0-08](../specs/M0.md#s-m0-08) · [S-M1-08](../specs/M1.md#s-m1-08) · [AC-M1-08-1 / AC-M1-08-2](../specs/M1.md#s-m1-08)

将优化任务与页面检查的读取、生成、状态更新和行动草案统一接入品牌授权（`authorizeBrandActor` / `workspaceBrand`），使 group 内获准 `member` 可从已有证据生成或合并优化任务、更新任务状态并跳转 `/dashboard/content` 创建 Brief，`read_only` 仅可查看，无权账号不可见。本记录不勾选 `T-M1-08`。

## 交付范围

- **领域授权与防越权**：`src/features/optimization/commands.ts`、`src/features/optimization/action-drafts.ts` 与 `src/features/optimization/dao.ts`（新增 `taskIdentity`）统一校验品牌读/写授权（`owner` / `member` 可写，`read_only` 返回 `403 FORBIDDEN`，无权或已撤销成员返回 `404 NOT_FOUND`），并保持以品牌 `ownerId` 写入任务、去重键与缓存失效。同时修复 `updateTask` 在非终态状态更新（如 `doing`）附带 `completionNote` 时被静默丢弃的问题。
- **页面与控件边界**：`/dashboard/monitoring/evidence/[observationId]`（`src/features/evidence/detail-page.tsx`）对获准 `member` 开放优化任务生成入口；`/dashboard/optimization`（`list-page.tsx`）接入 `workspaceBrand` 并对 `read_only` 隐藏页面检查表单与草案确认/放弃控件；`/dashboard/optimization/[taskId]`（`detail-page.tsx`）对 `read_only` 隐藏状态更新表单与「从此任务创建内容 Brief」入口并保留只读详情查看。
- **双库隔离测试**：新增 `tests/optimization/brand-authorization.test.mjs`，在 SQLite3 与 PostgreSQL 隔离库覆盖 `member` 生成与合并去重、状态更新、页面检查、Brief 关联保存、行动草案确认/放弃、`read_only` 只读与写入 `FORBIDDEN`、`outsider` 全链路 `NOT_FOUND` 不泄露品牌或任务名称，以及撤销授权后立即失权。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境与静态门禁 | `pnpm env:check` 15 项通过。`pnpm lint`（0 错误，8 条既有测试/临时脚本告警）、`pnpm typecheck`、`pnpm check:i18n`（4167 键）、`pnpm test:i18n`（7/7）、`pnpm check:feature-map`（71/71 页、460 路径）与 `pnpm build` 均通过。 |
| 双库隔离回归 | `pnpm test:optimization`（10/10，含 `brand-authorization.test.mjs` SQLite3 与 PostgreSQL）、`pnpm test:evidence`（48/48）与 `pnpm test:content` 全部通过。 |
| 开发环境真实走查（Chrome + HTTP） | 基于 `./tmp/dev/accounts.json` 持久化账号在品牌 `674a4755-73c4-4784-94d6-1d2f129bbfcd`（`GeoPro 智搜监测`）实测：`member`（`dev-member@geopro.test`）从 `/dashboard/monitoring/evidence/4073e936-a4da-410d-8f20-f5e780a5e879` 生成优化任务 `f06deea9-9ac2-4c7c-bc8a-ca1fb6c626cb`，从同簇证据 `f2c824e5-12d2-4c78-8dfc-7912ce629042` 合并入同一任务，在 `/dashboard/optimization/f06deea9-9ac2-4c7c-bc8a-ca1fb6c626cb` 更新状态为 `doing` 并保存说明后刷新回读一致，点击「从此任务创建内容 Brief」进入 `/dashboard/content` 预填同一 `taskId` 与问题簇，且中英文与 `375px` / `1440px` 无横向溢出；`readonly`（`dev-readonly@geopro.test`）可读列表与详情且隐藏写入控件，向 `POST /api/optimization/tasks` 发起写入返回 HTTP `403 FORBIDDEN`；`outsider`（`dev-outsider@geopro.test`）访问列表/详情/证据页显示无权或未找到且不泄露品牌或任务文本，调用接口均返回 HTTP `404 NOT_FOUND`。 |
| 未验证 / 剩余项 | 本单未改动表结构或 DDL；真实 AI 行动草案在线模型调用（仅用回环 mock 覆盖 `draftFromEvidence`）及完整整站串联走查继续由 #190 跟踪。 |
