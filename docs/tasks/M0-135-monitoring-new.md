# Issue #135 监测运行确认

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [B09 通道能力](B09-channel-capabilities.md) · [M0-11 运行登记](M0-11-run-registration.md)

品牌负责人从工作台总览、品牌详情、通道设置或额度明细进入 `/dashboard/monitoring/new` 后，可在页首根据当前品牌与题集状态直接看到主要操作（无品牌前往建档、无题集前往确认题目、已就绪跳至登记监测运行），在统一白色卡片内完成通道资格预检、范围预览、登记排队运行与读取失败恢复。

## 范围与实现

- 基线 `/dashboard/monitoring/new` 页首缺少语义化 `<header>` 与下一步主/次入口，通道资格预检与监测运行登记未使用统一 `Card` / `Badge` / `Input` 与虚线空态表面，且读取能力失败时仍渲染下方的运行登记区域并暴露两套独立错误块；`RunConfirmForm` 直接查询 DOM 复选框且缺少在途并发守卫。
- 改动 `src/features/capabilities/run-page.tsx`、`src/features/capabilities/run-confirm.tsx`、`src/features/monitoring/registration.tsx`、`src/features/monitoring/registration-form.tsx`、`src/app/(dashboard)/dashboard/monitoring/new/loading.tsx` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - 页首 `<header>` 按登记状态给出主操作（`no-brand` 前往 `/dashboard/brands/new`、`not-found` / `archived` 返回 `/dashboard/brands`、无冻结题集前往 `/dashboard/brands/[id]/questions`、已就绪跳转 `#monitoring-registration`）及 `outline` 次操作（`backMonitoring`、`openBrand`）和相关入口（`/dashboard/monitoring/protocols`、`/dashboard/settings#monitoring-capabilities`），按钮均使用共享 `Button` 与 `whitespace-normal`。
  - `RunConfirmForm` 与 `MonitoringRegistration` 接入共享 `Card` / `CardContent`、`Badge`、`Input` 与虚线空态表面；`RunConfirmForm` 改用受控 `selected` 状态并加入 `aria-disabled={pending}` 与在途守卫；`RegistrationForm` 复用 `Input`、选中高亮标签卡片、`tabular-nums` 预算与预览面板、`[overflow-wrap:anywhere]` 长名称换行及结构化最近运行列表。
  - 读取能力或运行登记读取失败时，页首保留 `<h1>`、`role="alert"` 安全错误提示、追踪编号及保留 `brandId` 参数的「重新加载」/「返回监测」入口并隐藏表单与品牌数据；`loading.tsx` 补齐 `aria-label` 与圆角骨架。
- 在 `scripts/serve-i18n-fixture.mjs` 为测试夹具增加 `geo-monitoring-new-read=slow-unavailable` 注入分支，新增 `tests/layout/workspace-landmark.test.mjs` 静态断言与浏览器回归 `tests/e2e/monitoring-new.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 无品牌空态与三视口走查 | 在 `zh-CN` 与 `en` 的 375、768、1440 像素视口下访问 `/dashboard/monitoring/new`，均只有 1 个 `main`、分区标记为 `monitoring`、页首主按钮「去建档」/「Create a brand」完整在视口内且无横向溢出，显示虚线空态与通道资格预检卡片。 |
| 已就绪品牌、长名称、键盘预览与排队登记 | 写入含长段落的品牌名称、已验证/候选通道、冻结 3 题题集与 `CNY` 采样额度后，三视口无横向溢出；键盘从页首跳转 `#monitoring-registration`，核验未验证通道拦截、演示空间提示、缺费用上界拦截、范围预览与排队登记跳转 `/dashboard/monitoring/runs/[runId]`，返回后从最近运行列表键盘重开同一运行。 |
| 跨账号隔离与读取失败恢复 | 另一账号访问 `?brandId=...` 仅见「找不到该品牌或运行」，看不到原品牌名称；中英文 375 像素注入 `geo-monitoring-new-read=slow-unavailable` 先显示加载骨架，再显示安全错误与保留 `brandId` 的「重新加载」按钮，隐藏内部异常、品牌名与通道名；清除故障后键盘重试恢复页面。测试结束后临时账号、品牌、题集、额度、通道与运行已清理并回读确认。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/monitoring/new` 路由）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3290 个消息键与参数一致、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（20 项）。 |
| `pnpm test:capabilities`、`pnpm test:monitoring`、`pnpm verify:capabilities` | 通过（能力 3 项、监测 25 项、双方言能力 HTTP 与 Chrome 走查通过）。 |
| `GEO_MONITORING_NEW_SCREENSHOTS=.cache/issue-135/monitoring-new/dev pnpm test:e2e tests/e2e/monitoring-new.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，1 项）。 |
| `pnpm test:e2e tests/e2e/m0-flow.spec.ts` | 通过（1 项，验证完整 M0 流程与 `/dashboard/monitoring/new` 无回归）。 |
| `python3 docs/tools/validate_docs.py` | 通过。 |

走查截图保存在本地 `.cache/issue-135/monitoring-new/dev/`（`nobrand-{zh-CN,en}-375.png`、`ready-{zh-CN,en}-375.png`、`loading-{zh-CN,en}-375.png`、`unavailable-{zh-CN,en}-375.png`）。

## 剩余

- Issue #135 仍保持开放及 `status:in-progress`；下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/monitoring/capture`、`/dashboard/brands/[id]/facts`、`/dashboard/brands/[id]/questions` 及其他设置/辅助页）逐页完成 `ui-visual-v1` 对齐、读取故障恢复与三视口走查后复核关单条件。
