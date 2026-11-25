# Issue #135 实体复核与同名消歧纠错

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-03](../specs/M1.md#s-m1-03) · [M1-88](M1-88-entity-reviews.md) · [M1-89](M1-89-entity-disambiguation.md)

品牌负责人从品牌详情页进入 `/dashboard/brands/[id]/entity-reviews` 与 `/dashboard/brands/[id]/entity-corrections` 后，可在页首辨认当前品牌名称、归档状态、页面任务与对应下一步操作；复核摘要、已计入样本、消歧记录、纠错状态与录入表单均采用共享 `Card` / `Badge` / `Input` / `Label` / `Button` 表面，不显示总体错误率百分比或「已解决 / Resolved」字样；提交期间以 `aria-disabled="true"` 与同步在途守卫拦截重复请求，失败时保留已填表单输入；读取异常时保留页面标题、安全错误提示、追踪编号与原生 `<a href={currentHref}>`「重新载入 / Reload」及返回品牌入口，并隐藏品牌名、样本与修订数据。

## 范围与实现

- 基线 `/dashboard/brands/[id]/entity-reviews` 与 `/dashboard/brands/[id]/entity-corrections` 缺少 `loading.tsx` 加载骨架、统一页首任务/品牌/状态动作层级与 `<nav aria-label="相关入口">`、共享 `Card`/`Input`/`Label`/`Badge` 组件、在途防重守卫与输入保留，且读取失败时仍将空态与表单渲染在错误提示下方，缺少原生重载链接与 `traceId`。
- 改动 `src/features/entity-accuracy/commands.ts`、`src/features/entity-accuracy/revisions.ts`、`src/features/entity-accuracy/reviews-page.tsx`、`src/features/entity-accuracy/corrections-page.tsx`，新增 `src/features/entity-accuracy/reviews-workspace.tsx`、`src/features/entity-accuracy/corrections-workspace.tsx`、`src/app/(dashboard)/dashboard/brands/[id]/entity-reviews/loading.tsx`、`src/app/(dashboard)/dashboard/brands/[id]/entity-corrections/loading.tsx` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - `readEntityReviewWorkspace` 与 `readEntityRevisionWorkspace` 复用 `BrandDao.ownedSummary` 返回 `brandName` 与 `brandStatus`，保持原有 `listEntityReviews` / `listEntityRevisions` 契约与查询次数不变。
  - `EntityReviewsPage` 与 `EntityCorrectionsPage` 在页首展示品牌名、归档状态徽章、当前状态对应主/次锚点与 `<nav aria-label="相关入口">`，读取失败使用原生 `<a href={currentHref}>` 提供「重新载入」并隐藏品牌名、样本与修订数据。
  - `ReviewsWorkspace` 与 `CorrectionsWorkspace` 接入共享 `Card`、`Input`、显式 `htmlFor`/`id` `Label`、`Badge`（长文本与长编号使用 `[overflow-wrap:anywhere]`）及 `Button`（`whitespace-normal`），通过对应 JSON API 提交并加入同步 `inFlightRef` 与 `aria-disabled` 防重守卫，校验拒绝时保留已输入内容并在 `role="alert"` 展示安全错误；动作状态与效果状态仍分开渲染且不出现百分号或「已解决 / Resolved」。
- 在 `scripts/serve-i18n-fixture.mjs` 增加 `geo-entity-reviews-read=slow-unavailable`、`geo-entity-reviews-write=slow`、`geo-entity-corrections-read=slow-unavailable`、`geo-entity-corrections-write=slow` 夹具分支，补充 `tests/layout/workspace-landmark.test.mjs` 静态断言，并新增 `tests/e2e/entity-accuracy.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 空态与三视口适配 | 从 `/dashboard/brands/[id]` 键盘进入 `/entity-reviews` 与 `/entity-corrections`；在 `zh-CN` 与 `en` 的 375、768、1440 像素视口下均只有 1 个 `main`、长品牌名换行、虚线空态表面与页首主操作位于视口内且无横向溢出，复核页不含 `%`。 |
| 复核校验、防重与摘要展示 | 提交 `expired + confirmed` 被 `INVALID_INPUT` 拒绝且已输入 ID 与长抽样方法保留在输入框；在 `geo-entity-reviews-write=slow` 下连续两次按 `Enter` 保存，按钮展示「正在保存…」与 `aria-disabled="true"` 且仅发出 1 次 POST；保存后显示 `1/1`、`1/20` 与长抽样方法并无横向溢出或 `%`。 |
| 同名消歧、纠错分列与防重 | 仅勾选表面同名提交被拒绝并保留输入；勾选同名与人工确认另一实体并在 `geo-entity-corrections-write=slow` 下连续两次 `Enter`，仅发出 1 次消歧 POST 并展示「这次提及不算作目标品牌」；随后登记「动作已完成 + 复测仍然错误」并在慢写下双 `Enter` 仅发出 1 次纠错 POST，页面分开显示动作状态与效果未解决且不含「已解决 / Resolved」。 |
| 跨账号隔离与读取失败恢复 | 另一账号访问两页均返回「找不到这个页面 / Page not found」，看不到品牌名与观察编号；中英文 375 像素注入慢读失败先显示加载骨架，再显示 `role="alert"` 安全错误与「重新载入」入口并隐藏品牌名与业务数据；清除故障后键盘「重新载入」恢复页面。测试结束后临时账号与品牌已清理。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/brands/[id]/entity-reviews` 与 `/dashboard/brands/[id]/entity-corrections`）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3383 个消息键与参数一致、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（25 项）。 |
| `node --conditions=react-server --test tests/entity-accuracy/*.test.mjs` | 通过（SQLite3 与 PostgreSQL 双库结构、约束与索引计划，共 6 项）。 |
| `GEO_ENTITY_ACCURACY_SCREENSHOTS=.cache/issue-135/entity-accuracy pnpm test:e2e tests/e2e/entity-accuracy.spec.ts tests/e2e/brand-detail.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，2 项）。 |
| `python3 docs/tools/validate_docs.py` | 通过。 |

走查截图保存在本地 `.cache/issue-135/entity-accuracy/`（`reviews-{empty,populated,loading,unavailable}-{zh-CN,en}-375.png` 与 `corrections-{empty,populated,loading,unavailable}-{zh-CN,en}-375.png`，共 16 张）。

## 剩余

- Issue #135 仍保持开放及 `status:in-progress`；下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/[id]/delete`、`/dashboard/brands/[id]/recovery`、`/dashboard/brands/new`、`/dashboard/brands/questions`、`/dashboard/assistant` 等）逐页完成 `ui-visual-v1` 对齐、加载骨架、读取故障恢复与三视口走查后复核关单条件。
