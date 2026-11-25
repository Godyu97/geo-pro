# Issue #135 品牌删除影响与恢复

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [B06 品牌删除](B06-brand-deletion.md) · [S-M0-01](../specs/M0.md#s-m0-01)

品牌负责人从品牌详情进入 `/dashboard/brands/[id]/delete` 后，先看到删除影响、当前品牌名称和下一步。下一步是确认删除并冻结访问，取消则返回当前品牌。确认后进入 `/dashboard/brands/[id]/recovery`。恢复页只显示不透明品牌标识和恢复截止时间，不显示品牌名称。需要重新登录时，页首动作是退出并重新登录；已在冻结后重新登录时，页首动作是恢复品牌访问。读取失败时保留标题，隐藏品牌名称、标识和影响计数，并用键盘重新载入。

## 范围

- 删除影响页把确认和取消放在页首。长品牌名在卡片内换行。影响计数仍来自原来的一条预览查询。
- 恢复页保持待删除列表的口径：只提供不透明标识和日期。页首按登录状态给出退出重登、验证邮箱、返回品牌资料或恢复访问。
- 提交期间按钮显示「正在保存…」并带 `aria-disabled`，在途守卫拦截第二次确认。
- 两个路由补了加载骨架。读取失败使用原生重新载入链接，并显示追踪编号。

## 验收

隔离浏览器使用合成品牌。名称是 61 字且没有空格。临时账号已清理。

| 场景 | 实际结果 |
| --- | --- |
| 删除影响 | `zh-CN` 与 `en` 在 375、768、1440 像素只有一个 `main`。页首可见任务说明和唯一的确认按钮，375 像素确认按钮在视口内，长品牌名可见，页面无横向溢出。中文 375 像素从品牌详情用键盘进入。 |
| 慢速确认 | 中文 375 像素对确认连续按两次 Enter。按钮变为「正在保存…」且 `aria-disabled="true"`，只发出 1 个 `POST /api/brands`，随后进入恢复页。 |
| 恢复页 | 两种语言和三种宽度都不显示品牌名称。区域内可见不透明标识和恢复截止时间。重新登录前没有「恢复品牌访问」，「退出以重新登录」在视口内，页面无横向溢出。 |
| 重新登录后恢复 | 中文 375 像素退出并重新登录后，「恢复品牌访问」在视口内且仍不显示品牌名称。确认后回到品牌详情，标题是该合成品牌名。 |
| 其他账号 | 英文 375 像素打开删除影响和恢复地址都是「Page not found」，看不到品牌名称；恢复地址也看不到品牌标识。 |
| 读取失败 | 中英文 375 像素先看到加载骨架，再看到安全错误和「重新载入」。失败页不显示品牌名称、标识和截止时间。清除故障后用键盘重新载入，删除页恢复品牌名，恢复页恢复截止时间且仍不显示品牌名。 |

12 张 375 像素截图保存在本地 `.cache/issue-135/brand-deletion/`，可由 `tests/e2e/brand-deletion.spec.ts` 重新生成。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含 `/dashboard/brands/[id]/delete` 与 `/dashboard/brands/[id]/recovery`。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过。3389 个消息键，7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，26 项。 |
| `GEO_BRAND_DELETION_SCREENSHOTS=.cache/issue-135/brand-deletion pnpm exec playwright test tests/e2e/brand-deletion.spec.ts` | 通过。配置开发 PostgreSQL、fixture 服务与本机 Chrome，1 项，12.5s。 |
| `pnpm exec playwright test tests/e2e/brand-onboarding.spec.ts -g "brand deletion"` | 通过。同一产品代码下 `zh-CN` / `en` 的 375、768、1440 像素删除与恢复回归 6 项。 |
| `pnpm env:check` | 通过，15 项。 |
| `python3 docs/tools/validate_docs.py` | 通过。169 个活跃文档、935 个本地链接、26 项需求、29 项任务、81 个验收 ID。 |

## 剩余

Issue #135 仍保持开放及 `status:in-progress`。下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/new`、`/dashboard/brands/questions`、`/dashboard/assistant`）完成 `ui-visual-v1` 对齐、加载骨架、读取故障恢复与三视口走查后复核关单条件。正式品牌删除试点仍按 B06 的阶段前置核验。
