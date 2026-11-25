# Issue #135 监测问题工作台

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-03](../specs/M0.md#s-m0-03) · [T-M0-03](T-M0-03-prompt-sets.md)

品牌负责人从品牌详情页「监测问题」入口进入 `/dashboard/brands/[id]/questions` 后，可在页首辨认当前品牌名称、归档只读状态、当前任务与下一步操作（空态浏览默认候选、已有草稿核对并冻结题集、已有冻结版本查看已冻结版本或编辑题集草稿）；题集预览、非品牌候选、AI 候选、建档草稿、逐行粘贴、购买问题簇、题目卡片与已冻结版本均采用共享 `Card` / `Badge` / `Input` / `Label` / `Button` 表面；提交期间以 `aria-disabled="true"` 与在途守卫拦截重复请求；读取异常时保留页面标题、安全错误提示、追踪编号与「重新载入」/「返回品牌资料」入口，并隐藏品牌名与题目内容。

## 范围与实现

- 基线 `/dashboard/brands/[id]/questions` 缺少 `loading.tsx` 加载骨架、外层统一工作台容器与页首品牌名称/任务/状态动作层级、相关入口导航、关闭或未授权状态下的虚线空态表面、共享 `Card` 与 `Input` 组件、长文本 `Badge` 在 375 像素下的换行样式、在途防重守卫，且读取失败时使用 Next `<Link>` 跳转当前路由而不易触发服务端重载。
- 改动 `src/features/prompts/service.ts`、`src/features/prompts/page.tsx`、`src/features/prompts/workspace.tsx`、新增 `src/app/(dashboard)/dashboard/brands/[id]/questions/loading.tsx` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - `readPromptWorkspace` 复用已查询的 `BrandDao.version` 补充 `brandName`，保持原有 9 条 SQL 查询不变。
  - `PromptSetsPage` 按开放状态、读取失败、归档只读、已有冻结版本、已有草稿与空态给出对应页首主/次操作及 `<nav aria-label="相关入口">`，读取失败使用原生 `<a href={currentHref}>` 重新载入并隐藏品牌名、题目与版本内容。
  - `PromptWorkspaceView` 接入共享 `Card` / `CardContent`、`Input`、`Label`、`Badge`（长文本徽章使用换行样式）、`Button`（`whitespace-normal`）与虚线空态表面，长品牌名、长题目文本与长候选文本使用 `[overflow-wrap:anywhere]` 换行，并在 `submit` 与 `postSuggestion` 中增加同步 `inFlightRef` 防重与 `aria-disabled={pending}`。
- 在 `scripts/serve-i18n-fixture.mjs` 增加 `geo-brand-questions-read=slow-unavailable` 与 `geo-brand-questions-write=slow` 夹具分支，补充 `tests/layout/workspace-landmark.test.mjs` 静态断言，并新增 `tests/e2e/brand-questions.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 空态与三视口适配 | 从 `/dashboard/brands/[id]` 键盘进入 `/dashboard/brands/[id]/questions`；在 `zh-CN` 与 `en` 的 375、768、1440 像素视口下均只有 1 个 `main`、长品牌名在页首换行、虚线空态表面与主按钮「浏览默认候选」/「Browse default candidates」位于视口内且无横向溢出。 |
| 候选、比较题、重复拦截、防重与二次冻结 | 加入 3 道非品牌候选并确认，填入问题簇受众、意图与长主页面地址，新增含长文本的品牌比较题并确认；输入空白变体触发完全相同提示后移除；在 `geo-brand-questions-write=slow` 下连续两次按 `Enter` 保存草稿，按钮展示「正在保存…」与 `aria-disabled="true"` 且仅发出 1 次 POST；冻结第 1 版并修改第 1 题为长文本后冻结第 2 版，在 `zh-CN` / `en` 三视口无横向溢出且排除清单准确显示变更题。 |
| 跨账号隔离与读取失败恢复 | 另一账号访问同一 URL 返回「找不到这个页面 / Page not found」，看不到品牌名与题目文本；中英文 375 像素注入 `geo-brand-questions-read=slow-unavailable` 先显示加载骨架，再显示 `role="alert"` 安全错误与「重新载入」入口并隐藏品牌名与题目；清除故障后键盘「重新载入」恢复页面。测试结束后临时账号与品牌已清理。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/brands/[id]/questions` 路由）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3346 个消息键与参数一致、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（23 项）。 |
| `pnpm test:prompts` | 通过（SQLite3 与 PostgreSQL 双库结构、9 SQL 查询次数与索引计划）。 |
| `pnpm verify:prompts` | 通过（SQLite3 与 PostgreSQL 双库认证/隔离/Chrome 及关闭采集状态，共 3 组）。 |
| `GEO_BRAND_QUESTIONS_SCREENSHOTS=.cache/issue-135/brand-questions pnpm test:e2e tests/e2e/brand-questions.spec.ts tests/e2e/brand-detail.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，2 项）。 |
| `python3 docs/tools/validate_docs.py` | 通过。 |

走查截图保存在本地 `.cache/issue-135/brand-questions/`（`empty-{zh-CN,en}-375.png`、`populated-{zh-CN,en}-375.png`、`loading-{zh-CN,en}-375.png`、`unavailable-{zh-CN,en}-375.png`）。

## 剩余

- Issue #135 仍保持开放及 `status:in-progress`；下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/[id]/entity-reviews`、`/dashboard/brands/[id]/entity-corrections` 及其他辅助/设置页）逐页完成 `ui-visual-v1` 对齐、读取故障恢复与三视口走查后复核关单条件。
