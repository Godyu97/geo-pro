# Issue #200 经营助理周计划与策略模板品牌授权

2026-11-27。[Issue #200](https://github.com/Godyu97/geo-pro/issues/200) · [受控经营助理与策略复用](../specs/M2.md#s-m2-05) · [团队品牌权限](../specs/M1.md#s-m1-08)

## 交付

- **品牌授权与归属收敛**：新增 `src/features/assistant/brand-access.ts`，并在 `commands.ts`、`strategy-commands.ts`、`dao.ts`、`strategy-dao.ts`、`api.ts`、`strategy-api.ts` 与 `actions.ts` 接入 `authorizeBrandActor`、`workspaceBrand` 与 `authorizePlatformAdmin`。`owner` 与组内获准 `member` 可读写同一品牌的周计划与策略模板（以品牌 `ownerId` 落库与批量读取）；`read_only` 与仅具平台管理员身份账号可只读查看，写入在校验前与事务锁内均返回 HTTP `403 FORBIDDEN`（模型起草请求在鉴权失败时不触发模型调用）；无权或已撤权账号返回 `404 NOT_FOUND`。
- **`brandId` 上下文与流式 404 拦截**：`/dashboard/assistant`、`/dashboard/assistant/plans`（`plans-page.tsx`）与 `/dashboard/assistant/strategies`（`strategies-page.tsx`）支持 `?brandId=...` 显式切换品牌或按组默认品牌进入，并在内部交叉链接保留 `brandId` 上下文；`src/app/(dashboard)/layout.tsx` 接入 `assistantBrandUnavailable`，在 `loading.tsx` 流式输出前对非法或无权 `brandId` 返回 HTTP `404`；`PlansWorkspace` 与 `StrategiesWorkspace` 对只读访问隐藏生成、确认、执行、复盘与模板写入表单。

## 验证

| 场景 | 实测结果 |
| --- | --- |
| 开发环境 Chrome 与 HTTP | 使用 `./tmp/dev/accounts.json` 持久化账号实测：`member` 默认打开自有品牌 B（尾号 `c9b5f854ae`），带 `?brandId=` 切换到品牌 A（尾号 `129bbfcd`）后在 `/dashboard/assistant?brandId=...` 回读 3 条已批准事实选项（含 `ea20528a`、`4c426485`），点击「策略模板」进入 `/dashboard/assistant/strategies?brandId=...` 保留同一品牌上下文，保存单次观察模板（尾号 `948dccb61da`）并刷新回读，在 `/dashboard/assistant/plans?brandId=...` 与只读/负责人账号均可回读既有已结算计划（尾号 `e7b4f93e1183`）与复盘（尾号 `9c9bfe31d`）；中英文与 `375px` / `1440px` 视口无横向溢出。 |
| 开发环境权限边界 | `read_only` 与 `admin` 访问 `/dashboard/assistant?brandId=...`、`/dashboard/assistant/plans?brandId=...` 与 `/dashboard/assistant/strategies?brandId=...` 返回 HTTP 200 且隐藏写入表单；`read_only` 请求 `POST /api/assistant/plans`、`confirm`、`execute`、`review` 及 `strategy-templates` / `draft` 均返回 HTTP 403 `FORBIDDEN`。`outsider` 访问带 `brandId` 的三个页面及上述读写接口均返回 HTTP 404 `NOT_FOUND` 且不泄露品牌或计划内容；不带 `brandId` 时展示无品牌空态。 |
| 双库隔离回归 | `node --conditions=react-server --test tests/assistant/*.test.mjs` 8/8 通过（含新增 `tests/assistant/brand-authorization.test.mjs` 覆盖 SQLite3 与 PostgreSQL 的 `member`、`read_only`、`admin`、`outsider`、默认与显式 `brandId` 切换及撤权失权；`weekly-plans.test.mjs` 覆盖 `0091`/`0092` 带旧数据升级与查询计划命中索引）。 |
| 隔离浏览器 E2E | `pnpm exec playwright test tests/e2e/assistant-plans.spec.ts tests/e2e/strategy-templates.spec.ts` 3/3 通过，覆盖双语与 `375/768/1440` 视口、`member` 保存策略与计划复盘、`read_only` 隐藏表单及 403、`outsider` 带 `brandId` 返回 404。 |
| 静态与构建门禁 | `pnpm env:check`（15/15）、`pnpm lint`（0 错误、8 条既有无关测试/临时脚本告警）、`pnpm typecheck`、`pnpm check:i18n`（4200 键）、`pnpm test:i18n`（7/7）、`pnpm check:feature-map`（71/71 页、461 路径）、`python3 docs/tools/validate_docs.py` 与 `pnpm build` 全部通过。 |

## 未验证与说明

本轮开发库实测以无外部模型费用消耗的策略观察保存与既有已结算计划复盘回读为主；`member` 在线调用真实 Responses API 起草仅保持配置约束，模型起草与完整周计划闭环已在双库隔离测试中使用回环 mock 覆盖。本单未改动数据库表结构或 DDL；`T-M2-05` 仍按二期计划待 #190 整体验收后再勾选。
