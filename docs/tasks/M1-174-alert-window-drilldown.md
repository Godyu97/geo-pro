# Issue #174 从提醒打开触发它的采样窗口与已关联运行

2026-11-26。 [Issue #174](https://github.com/Godyu97/geo-pro/issues/174) · [R-M1-01](../02-产品需求文档-PRD.md) · [S-M1-01](../specs/M1.md#s-m1-01) · [指标与证据合同](../07-指标与证据合同.md) §1–2

品牌负责人在 `/dashboard/monitoring/alerts` 查看覆盖不足或趋势提醒时，可以直接核对触发该提醒的采样计划、窗口 ID、统计时区、保存的 `P` / `E` / 可判断样本数以及仅属于该窗口的已关联获准运行，并跳转到对应的采样窗口详情与运行详情（再沿已有运行入口下钻回答原文或失败槽明细）；缺失绑定读数的旧提醒继续展示提醒与发生记录并给出明确来源缺失说明。

## 交付范围

- **批量查询与来源解析**（`src/features/sampling-plans/due-dao.ts`、`src/features/sampling-plans/due-commands.ts`、`src/features/sampling-plans/contracts.ts`）：
  - 新增 `SamplingDueDao.readingsForAlerts`、`readingForWindow`、`runsForWindow`、`runsForWindows` 及对应的导出查询构造函数，按 `owner_id` 与 `brand_id` 批量加载 `sampling_window_reading` 与 `sampling_due_run`，复用既有索引 `sampling_window_reading_owner_idx`、`sampling_window_reading_window_uidx` 与 `sampling_due_run_owner_idx`，无需新增数据库迁移。
  - 新增 `listAlertWindowSources`，将提醒列表的 `alert_id` 精确匹配到其绑定的 `(planId, windowId)` 读数与该窗口下 `kind = 'official'` 且 `status = 'accepted'` 的 `monitoringRunId`；未绑定读数的提醒不编造来源。
  - 新增 `readSamplingWindowDetail`，校验 `ownerId`、`planId` 与 `windowId` 后加载该窗口读数、所属计划、仅属于该窗口与时区的 `sampling_slot`（保留失败槽在 P 分母）及仅属于该窗口的 `sampling_due_run`，并批量汇总关联 `monitoring_run` 状态、失败槽计数与 `answer_observation` 已入证回答计数。
- **站内提醒与窗口下钻界面**（`src/features/quality-alerts/alerts-page.tsx`、`src/features/sampling-plans/plans-page.tsx`、`src/lib/i18n/messages/zh-CN.json`、`src/lib/i18n/messages/en.json`）：
  - `/dashboard/monitoring/alerts` 在每条提醒卡片内展示绑定的计划 ID、窗口 ID、统计时区、保存的 `P` / `E` / 可判断样本数、前往 `/dashboard/monitoring/plans?planId=...&windowId=...` 的入口与已关联获准运行链接（无运行或无关联读数时各自明确说明）。重复触发与确认/稍后处理后仍保留发生记录与可复核入口。
  - `/dashboard/monitoring/plans?planId=...&windowId=...` 在校验归属后聚焦展示该具体计划窗口，仅列真实关联运行，保留失败槽在 P 分母，无运行或无已入证回答时明确说明；越权或无效深链接触发 `notFound()` 不泄露任何他品牌数据。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境与 DDL | `pnpm env:check` 15 项通过；`pnpm db:ddl:check` 双方言一致。 |
| 静态与构建 | `pnpm lint`（0 error）、`pnpm typecheck`、`pnpm build` 通过，包含 `/dashboard/monitoring/alerts` 与 `/dashboard/monitoring/plans`。 |
| 双语与地图 | `pnpm check:i18n`（3978 键）、`pnpm test:i18n`（7 项）、`pnpm check:feature-map`（70/70 页面）与 `python docs/tools/validate_docs.py` 通过。 |
| 隔离双库测试 | `pnpm exec node --conditions=react-server --test tests/sampling-plans/due-window.test.mjs tests/quality-alerts/alerts.test.mjs`（11 项，含 SQLite3 与 PostgreSQL）及 `pnpm test:monitoring`（37 项）全部通过，零跳过。验证多计划与双日期窗口精确归属、失败槽保留在 P、零运行窗口与旧无关联提醒说明、越权拒绝、重复触发与确认后保留入口，以及 500 规模下 `EXPLAIN` 命中预期索引。 |
| 浏览器 E2E | `pnpm test:e2e tests/e2e/quality-alerts.spec.ts` 2 项通过，覆盖无关联旧提醒来源缺失说明、多计划双日期窗口点击导航到具体窗口与已关联运行详情（含失败槽与无已入证回答明确提示）、重复触发与确认后保留入口、双语 `zh-CN` / `en`、375/768/1440 视口无横向溢出、键盘操作与越权访问窗口/运行深链接拒绝。 |

## 脱敏 ID 对照说明

以本次 `tests/e2e/quality-alerts.spec.ts` 实测生成的合成夹具输出为准（每次运行使用隔离临时账号与品牌并在结束后自动清理）：记录同一品牌的 `planA`（含 `2026-11-22` 足够窗口 `runA22` 与 `2026-11-23` 覆盖不足窗口 `runA23` + 1 个失败槽）与对照计划 `planB`（`runB22`），验证提醒卡片与 `/dashboard/monitoring/plans?planId=<planA>&windowId=2026-11-23` 仅展示 `planA`、`2026-11-23`、`Asia/Shanghai`、`P 2 / E 0 / 可判断 0` 与 `runA23`，不出现 `planB`、`runA22` 或 `runB22`。

未发起真实连续采样；`T-M1-01` 与真实阶段门禁（`T-M1-GATE`）仍待真实采样窗口与连续观察，本记录不勾选 `T-M1-01`。
