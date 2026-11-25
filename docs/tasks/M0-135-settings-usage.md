# Issue #135 额度与费用明细

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [B10 试点额度](B10-pilot-quotas.md) · [M0-12 运行执行](M0-12-run-execution.md)

品牌负责人从「账户设置 → 试点额度 → 查看额度与费用明细」进入 `/dashboard/settings/usage` 后，可在页首根据当前额度状态直接看到主要操作（无额度返回账户设置、达到次数上限前往调整监测范围、已有流水跳至明细表），在统一卡片与表格容器内查看试点客户应付、采样次数状态、多币种汇总与供应商明细，并用键盘完成类别/状态/币种筛选、分页及读取失败恢复。

## 范围与实现

- 基线 `/dashboard/settings/usage` 缺少页首动作、卡片与表格容器、标签状态与激活筛选态，错误提示将 `<h1>` 包裹在 `role="alert"` 内且仅提供纯文本下划线重试链接。
- 改动 `src/features/monitoring/usage-page.tsx`、`src/app/(dashboard)/dashboard/settings/usage/loading.tsx` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - 页首 `<header>` 按状态提供主/次 `Button`（`backSettings`、`adjustScope`、`viewLedger`），长文本使用 `whitespace-normal` 换行。
  - 将试点客户应付（`customerPayableMinor`）与采样额度状态拆分为独立 `Card`，使用 `Badge` 区分 `ungranted` / `active` / `limitReached` / `expired` / `revoked`；按币种汇总使用卡片网格与 `tabular-nums`，`unresolved > 0` 继续显示 `unknownAmount`。
  - 筛选栏按 `filterKind`、`filterState`、`filterCurrency` 分组并用 `aria-current="page"` 与 `default` / `outline` 区分当前筛选；明细表复用共享 `Table`（`overflow-x-auto` 容器内局部滚动）、`Badge` 状态标签与可换行 `slotId`；无记录与无匹配筛选分别呈现虚线空态表面。
  - 读取失败或非法筛选时保留页首标题、`role="alert"` 安全错误提示、追踪编号与可聚焦「重新加载额度」/「返回账户设置」按钮，并隐藏成本与币种内容；加载骨架补齐 `aria-label` 与圆角卡片占位。
- 在 `scripts/serve-i18n-fixture.mjs` 为测试夹具增加 `geo-usage-read=slow-unavailable` 注入分支，新增 `tests/layout/workspace-landmark.test.mjs` 静态断言与浏览器回归 `tests/e2e/settings-usage.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 无额度空态与三视口走查 | 从 `/dashboard/settings` 键盘激活「查看额度与费用明细」进入 `/dashboard/settings/usage`；`zh-CN` 与 `en` 在 375、768、1440 像素下均只有 1 个 `main`、分区标记为 `settings`、页首主按钮完整在视口内且无横向溢出，显示「尚未授予」与虚线空态。 |
| 达上限、多币种、未知费用与筛选分页 | 写入 `CNY` 采样额度（22 次：21 条 `settled` 已知费用 + 1 条 `reserved` 未知尝试 `unknown`）与 `USD` 生成额度（1 条 `released`）后，页面显示「次数上限已用尽」、页首主按钮「调整监测范围」、`CNY`/`USD` 汇总及运行链接；长 `slotId` 在表内换行，表格局部滚动无整页溢出；键盘切换分页（20 + 3 条）、`generation + released` 筛选、空筛选清除均正常。 |
| 跨账号隔离与读取失败恢复 | 其他账号访问仅见「尚未授予」，看不到原账号币种汇总、槽位与运行。中英文 375 像素注入 `geo-usage-read=slow-unavailable` 先显示加载骨架，再显示安全错误与保留筛选参数的「重新加载额度」按钮，隐藏内部异常与应付/币种数字；清除故障后键盘激活重试恢复明细列表。测试结束后临时账号、品牌、运行、额度与流水记录均已清理并回读确认。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/settings/usage` 路由）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3284 个消息键与参数一致、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（19 项）。 |
| `pnpm test:quotas`、`pnpm test:monitoring` | 通过（SQLite3 与 PostgreSQL 全量通过）。 |
| `GEO_USAGE_SCREENSHOTS=.cache/issue-135/settings-usage/dev pnpm test:e2e tests/e2e/settings-usage.spec.ts tests/e2e/account-settings.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，10 项，1.0m）。 |
| `python3 docs/tools/validate_docs.py` | 通过。 |

走查截图保存在本地 `.cache/issue-135/settings-usage/dev/`（`empty-{zh-CN,en}-375.png`、`populated-{zh-CN,en}-375.png`、`loading-{zh-CN,en}-375.png`、`unavailable-{zh-CN,en}-375.png`）。

## 剩余

- Issue #135 仍保持开放及 `status:in-progress`；下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/monitoring/new`、`/dashboard/monitoring/capture`、`/dashboard/brands/[id]/facts`、`/dashboard/brands/[id]/questions` 等）逐页完成 `ui-visual-v1` 对齐、读取故障恢复与三视口走查后复核关单条件。
