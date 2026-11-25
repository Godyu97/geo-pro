# Issue #135 品牌事实与材料

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-02](../specs/M0.md#s-m0-02) · [T-M0-02](T-M0-02-brand-facts.md)

品牌负责人从品牌详情页「事实与材料」入口进入 `/dashboard/brands/[id]/facts` 后，可在页首辨认当前品牌名称、归档只读状态、当前任务与下一步操作（无事实时跳转粘贴材料、有待确认事实时核对当前事实、已有事实时查看事实版本或录入新事实）；材料原文、事实列表与编辑确认区均采用共享 `Card` / `Badge` / `Input` / `Label` / `Button` 表面；提交期间以 `aria-disabled="true"` 与在途守卫拦截重复请求；读取异常时保留页面标题、安全错误提示、追踪编号与「重新载入」/「返回品牌资料」入口，并隐藏品牌名与事实内容。

## 范围与实现

- 基线 `/dashboard/brands/[id]/facts` 缺少 `loading.tsx` 加载骨架、外层统一工作台容器与页首任务/品牌/状态动作层级、相关入口导航、关闭或未授权状态下的虚线空态表面、共享 `Card` 组件、在途防重守卫，且读取失败时使用 Next `<Link>` 跳转当前路由而不易触发服务端重载。
- 改动 `src/features/brands/dao.ts`、`src/features/brand-facts/service.ts`、`src/features/brand-facts/page.tsx`、`src/features/brand-facts/workspace.tsx`、新增 `src/app/(dashboard)/dashboard/brands/[id]/facts/loading.tsx` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - `BrandDao.ownedSummary` 以单条 SQL 补全品牌名称，`readFactWorkspace` 返回 `brandName` 并将数据库查询次数维持在 7 条。
  - `BrandFactsPage` 按开放状态、读取失败、归档只读、待确认候选、已有事实与空态给出对应页首主/次操作及 `<nav aria-label="相关入口">`，读取失败使用原生 `<a href={currentHref}>` 重新载入并隐藏品牌名、表单与事实内容。
  - `FactWorkspaceView`、`PasteEditor` 与 `FactEditor` 接入共享 `Card` / `CardContent`、`Input`、`Label`、`Badge`、`Button`（`whitespace-normal`）与虚线空态表面，长品牌名、长网址、主张文本与内容版本号使用 `[overflow-wrap:anywhere]` 换行，并在 `submit` 中增加同步 `inFlightRef` 防重与 `aria-disabled={pending}`。
- 在 `scripts/serve-i18n-fixture.mjs` 增加 `geo-brand-facts-read=slow-unavailable` 与 `geo-brand-facts-write=slow` 夹具分支，补充 `tests/layout/workspace-landmark.test.mjs` 静态断言，修改 `scripts/verify-brand-facts.mjs` 中 `/dashboard/brands/[id]` 跳转至「事实与材料」链接的歧义匹配为精确匹配，并新增 `tests/e2e/brand-facts.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 空态与三视口适配 | 从 `/dashboard/brands/[id]` 键盘进入 `/dashboard/brands/[id]/facts`；在 `zh-CN` 与 `en` 的 375、768、1440 像素视口下均只有 1 个 `main`、长品牌名在页首换行、虚线空态表面与主按钮「粘贴并切分材料」/「Paste source text」位于视口内且无横向溢出。 |
| 拆卡、补证、防重审批与撤销 | 粘贴并预览材料原文后保存并拆卡建草稿、提交待确认，页首主动作切换为「核对当前事实」；填写长 URL、出处位置、来源日期、公开许可与长期有效并保存；在 `geo-brand-facts-write=slow` 下连续两次按 `Enter` 批准，按钮展示「正在保存…」与 `aria-disabled="true"` 且仅发出 1 次 POST；完成批准后在 `zh-CN` / `en` 三视口无横向溢出，随后键盘确认并撤销版本。 |
| 跨账号隔离与读取失败恢复 | 另一账号访问同一 URL 返回「找不到这个页面 / Page not found」，看不到品牌名与事实主张；中英文 375 像素注入 `geo-brand-facts-read=slow-unavailable` 先显示加载骨架，再显示 `role="alert"` 安全错误与「重新载入」入口并隐藏品牌名、简称与主张；清除故障后键盘「重新载入」恢复页面。测试结束后临时账号与品牌已清理。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/brands/[id]/facts` 路由）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3328 个消息键与参数一致、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（22 项）。 |
| `pnpm test:brand-facts` | 通过（SQLite3 与 PostgreSQL 双库结构、事务、7 SQL 查询次数与索引计划）。 |
| `pnpm verify:brand-facts` | 通过（SQLite3 与 PostgreSQL 双库认证/隔离/Chrome 及关闭采集状态，共 3 组）。 |
| `GEO_BRAND_FACTS_SCREENSHOTS=.cache/issue-135/brand-facts pnpm test:e2e tests/e2e/brand-facts.spec.ts tests/e2e/brand-detail.spec.ts tests/e2e/m0-flow.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，3 项）。 |
| `python3 docs/tools/validate_docs.py` | 通过。 |

走查截图保存在本地 `.cache/issue-135/brand-facts/`（`empty-{zh-CN,en}-375.png`、`populated-{zh-CN,en}-375.png`、`loading-{zh-CN,en}-375.png`、`unavailable-{zh-CN,en}-375.png`）。

## 剩余

- Issue #135 仍保持开放及 `status:in-progress`；下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/[id]/questions` 及其他设置/辅助页）逐页完成 `ui-visual-v1` 对齐、读取故障恢复与三视口走查后复核关单条件。
