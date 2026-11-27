# Issue #194 采样计划、到期窗口与质量提醒品牌授权

2026-11-27。 [Issue #194](https://github.com/Godyu97/geo-pro/issues/194) · [S-M1-01](../specs/M1.md#s-m1-01) · [S-M1-08](../specs/M1.md#s-m1-08) · [R-M1-01 / R-M1-08](../02-产品需求文档-PRD.md)

将采样计划、人工题单生成、到期窗口登记与质量提醒的读写统一接入品牌授权（`authorizeBrandActor` / `workspaceBrand`），使 group 内获准 `member` 可按选中品牌保存或查看计划、勾选冻结题集生成人工题单、处理到期窗口并确认提醒；`read_only` 仅可查看，无权账号不可访问。本记录不勾选 `T-M1-01` 或 `T-M1-08`。

## 交付范围

- **领域授权与防越权**：`src/features/sampling-plans/dao.ts`（新增 `planIdentity` / `planIdentities`）、`src/features/sampling-plans/commands.ts`、`src/features/sampling-plans/due-commands.ts`、`src/features/quality-alerts/dao.ts`（新增 `alertIdentity`）与 `src/features/quality-alerts/commands.ts` 统一按品牌读/写授权校验（`owner` / `member` 可读写，`read_only` 写入返回 `403 FORBIDDEN`，无权或已撤销成员返回 `404 NOT_FOUND`），并保持以品牌 `ownerId` 写入计划、到期运行、窗口读数与质量提醒。未关联执行器或已有官方运行时不创建新的 `monitoring_run` 或产生供应商费用。
- **页面上下文与只读门禁**：`/dashboard/monitoring/plans`（`src/features/sampling-plans/plans-page.tsx`、`actions.ts`）与 `/dashboard/monitoring/alerts`（`src/features/quality-alerts/alerts-page.tsx`、`actions.ts`）接入 `brandId` 查询上下文，无权 `brandId` 触发 `notFound()` 不泄露品牌名或窗口数据，只读成员隐藏全部新建/预算/阈值/阶段/到期处理/提醒确认与稍后处理控件；所有表单重定向保留 `brandId` 与错误码；`src/features/evidence/overview-page.tsx` 在显式 `brandId` 上下文中同步透传 `brandId` 至计划与提醒入口。
- **双库隔离测试**：新增 `tests/sampling-plans/brand-authorization.test.mjs`，在 SQLite3 与 PostgreSQL 隔离库覆盖 `member` 创建计划、保存趋势阈值、修订预算、生成冻结题集人工题单、登记既有官方运行、读取窗口明细与确认提醒、`read_only` 只读查看与写入 `FORBIDDEN`、`outsider` 全链路 `NOT_FOUND` 不泄露品牌/窗口文本，以及撤销授权后立即失权。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境与静态门禁 | `pnpm env:check` 15 项通过。`pnpm lint`（0 错误，8 条既有测试/临时脚本告警）、`pnpm typecheck`、`pnpm check:i18n`（4167 键）、`pnpm test:i18n`（7/7）、`pnpm check:feature-map`（71/71 页、460 路径）、`pnpm build` 与 `python3 docs/tools/validate_docs.py` 均通过。 |
| 双库隔离回归 | `tests/sampling-plans/*.test.mjs` 与 `tests/quality-alerts/*.test.mjs`（18/18，含 `brand-authorization.test.mjs` SQLite3 与 PostgreSQL）、`pnpm test:monitoring`（37/37）、`pnpm test:continued-operations`（86/86）与 `pnpm test:evidence`（48/48）全部通过。 |
| 开发环境真实走查（Chrome + HTTP） | 基于 `./tmp/dev/accounts.json` 持久化账号在品牌 `674a4755-73c4-4784-94d6-1d2f129bbfcd`（`GeoPro 智搜监测`）实测：`member`（`dev-member@geopro.test`）打开 `/dashboard/monitoring/plans?brandId=674a4755-73c4-4784-94d6-1d2f129bbfcd` 回读已有计划 `3843a237-47d5-4406-a89b-6ea5f6cac303`、窗口 `2026-11-26`（P 3 / E 3）、可登记运行 `7f74ee06-fa2f-4ae8-8b1c-dbe1b3980f43` 与冻结题集选项并下钻窗口明细；新建含人工槽位计划 `c65f6655-2372-4bb7-ba1c-3ed9e65a308c`、勾选冻结题集 v1 生成人工题单并修订预算至 `CNY 150` 后刷新回读一致（`monitoring_run` 计数保持 `2`，未产生新供应商费用）；记录质量提醒 `2c1d8ba1-6d0c-44ba-af45-cca5bbf3af02`（窗口 `w-dev-194-1795768707366`）后在 `/dashboard/monitoring/alerts?brandId=674a4755-73c4-4784-94d6-1d2f129bbfcd` 确认并刷新回读为「已确认」；`owner`（`dev-owner@geopro.test`）回读一致；中英文与 `375px` / `1440px` 无横向溢出。`readonly`（`dev-readonly@geopro.test`）可读计划与提醒且写表单数为 0，调用 `POST /api/monitoring/plans`、`POST /api/monitoring/plans/3843a237-47d5-4406-a89b-6ea5f6cac303/budget` 与 `POST /api/monitoring/alerts` 均返回 HTTP `403 FORBIDDEN`。`outsider`（`dev-outsider@geopro.test`）访问品牌页与窗口深链接均呈现无权页面（`找不到这个页面`）且不泄露品牌或窗口文本，调用计划与提醒 API 均返回 HTTP `404 NOT_FOUND`。 |
| 未验证 / 剩余项 | 本单未改动表结构或 DDL；真实多周期自然观察窗口与其余模块串联验收继续由 #190 跟踪。 |
