# Issue #135 采集助手

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M2-01](../specs/M2.md#s-m2-01) · [T-M2-01](M2.md#t-m2-01)

品牌负责人从「AI 监测 → 证据概览 → 打开采集助手」进入后，可按当前品牌与题单状态从页首跳至冻结题单或查看已有采集题单；提交期间显示进行中状态并拦截在途重复提交；验证码/登录墙交接停在 `handoff` 且不显示确认控制，缺引用停在 `partial` 且确认后完整标记仍为否，入口结构变化退回 `manual` 后保留原冻结题目并可继续记录人工尝试；读取异常时保留标题、安全错误与「重新载入」入口并隐藏品牌名与题目 ID。

## 范围与实现

- 基线 `/dashboard/monitoring/capture` 仅使用原始 `<form action={...Action}>` 与原生 `<input>` / `<textarea>` / `<select>`，缺少 `loading.tsx` 加载骨架、页首任务主/次操作与相关入口导航、共享 `Card` / `Badge` / `Input` / `Label` 表面、客户端在途防重守卫与输入保留，且数据库读取失败未做页内恢复处理（出错时会继续渲染创建表单与品牌名或崩溃到全局错误页）。
- 改动 `src/features/assisted-capture/commands.ts`、`src/features/assisted-capture/capture-page.tsx`、新增 `src/features/assisted-capture/capture-panel.tsx`、`src/app/(dashboard)/dashboard/monitoring/capture/loading.tsx` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - 新增 `readCaptureWorkspace` 统一读取活跃品牌与采集题单，`capture-page.tsx` 捕获异常并返回唯一追踪编号 `traceId`、安全 `role="alert"` 错误、可聚焦「重新载入」与「返回监测概览」入口，同时隐藏品牌名、表单与题目 ID；`loading.tsx` 提供 `role="status"`、`aria-label` 与圆角骨架。
  - 页首 `<header>` 按品牌与题单状态给出主要动作（无品牌「去建档」、已有题单「查看采集题单」、无题单「冻结采集题单」）与次级/相关入口（`backOverview`、`viewBrand`、`/dashboard/monitoring/plans`、`/dashboard/monitoring/protocols`、`/dashboard/monitoring/new?brandId=...`），按钮均使用共享 `Button` 与 `whitespace-normal`。
  - `CapturePanel` 接入共享 `Card` / `CardContent`、`Badge`、`Input`、`Label` 与虚线空态表面，通过 `/api/monitoring/capture/{sheets,attempts,attempts/[id]/confirm,sheets/[id]/degrade}` 提交操作并配置 `aria-disabled={pending}` 与在途守卫；客户端按 Zod 契约预检并保留错误输入；长品牌名与题目 UUID 使用 `[overflow-wrap:anywhere]` 换行；`handoff` 尝试隐藏确认按钮，仅展示「不绕过/不可确认」提示；将降级与确认状态提升至卡片层，确保 `router.refresh()` 刷新模式后提示仍稳定可读。
- 在 `scripts/serve-i18n-fixture.mjs` 为测试夹具增加 `geo-capture-read=slow-unavailable` 与 `geo-capture-write=slow` 注入分支，新增 `tests/layout/workspace-landmark.test.mjs` 静态断言与浏览器回归 `tests/e2e/assisted-capture.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 无品牌与空题单三视口 | 在 `zh-CN` 与 `en` 的 375、768、1440 像素视口下访问 `/dashboard/monitoring/capture`，均只有 1 个 `main`、分区标记为 `monitoring`、页首主按钮（「去建档」/「冻结采集题单」）完整位于视口内且无横向溢出，长品牌名在页首换行。 |
| 校验保留、在途防重与状态流转 | 从 `/dashboard/monitoring/overview` 用键盘进入采集助手；非法题目 ID 在客户端拦截并保留输入、发出 0 次 POST；慢速保存期间按钮显示「正在保存…」且 `aria-disabled="true"`，途中再按 `Enter` 仅发出 1 次 POST；保存后显示节省 18 分钟及冻结 UUID；依次记录 `login` 交接（无确认按钮、API 确认仍未保存且 `complete=false`）、0 引用 `partial`（键盘确认后已保存且完整标记为否）、2 引用 `preview`（键盘确认后完整标记为是）；退回人工模式后显示提示并保留冻结题目，且继续记录人工尝试成功。 |
| 跨账号隔离与读取失败恢复 | 另一账号仅见无品牌提示，看不到原品牌名与题目 ID，直接调用降级接口返回 404；中英文 375 像素注入 `geo-capture-read=slow-unavailable` 先显示加载骨架，再显示安全错误与「重新载入」入口并隐藏品牌名、题目 ID 与内部异常；清除故障后键盘重新载入恢复列表。测试结束后临时账号、品牌、题单与尝试已清理并回读确认。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/monitoring/capture` 路由）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3312 个消息键与参数一致、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（21 项）。 |
| `node --conditions=react-server --test tests/assisted-capture/capture.test.mjs tests/continued-operations/issue-58.test.mjs` | 通过（SQLite3 与 PostgreSQL 双库合同及规则测试共 6 项，零跳过）。 |
| `GEO_CAPTURE_SCREENSHOTS=.cache/issue-135/monitoring-capture/dev pnpm test:e2e tests/e2e/assisted-capture.spec.ts tests/e2e/m0-flow.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，2 项，1.0m）。 |

走查截图保存在本地 `.cache/issue-135/monitoring-capture/dev/`（`nobrand-{zh-CN,en}-375.png`、`empty-{zh-CN,en}-375.png`、`populated-{zh-CN,en}-375.png`、`loading-{zh-CN,en}-375.png`、`unavailable-{zh-CN,en}-375.png`）。

## 剩余

- Issue #135 仍保持开放及 `status:in-progress`；下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/[id]/facts`、`/dashboard/brands/[id]/questions` 及其他设置/辅助页）逐页完成 `ui-visual-v1` 对齐、读取故障恢复与三视口走查后复核关单条件。
