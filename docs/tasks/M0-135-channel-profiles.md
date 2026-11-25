# Issue #135 渠道画像

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-05](../specs/M1.md#s-m1-05)

品牌负责人从「内容 → 渠道画像」进入后，可从页首用键盘开始填写画像或查看已发布版本，发布期间显示进行中状态并拦截在途重复提交，发布后保留旧版本字数上限并展示新旧版本；读取失败时隐藏业务内容与内部异常，可用键盘重新载入同一品牌。

## 范围与实现

- 基线在 375 像素下表单位于顶部且缺少页首任务动作与读取失败恢复入口（见 `.cache/issue-135/channel-profiles/baseline/form-zh-CN-375.png`）。
- 改动 `src/features/channel-variants/profiles-page.tsx`、`src/features/channel-variants/profile-publish-form.tsx`、`src/features/channel-variants/actions.ts` 与 `src/lib/i18n/messages/{zh-CN,en}.json`：
  - 页首按状态给出主要动作（无品牌「前往品牌」、可写「填写画像」、有版本「查看已发布版本」、返回同一品牌的「返回内容」），并使用共享 `Card`、`Badge`、`Button` 与 `Input` 样式及长渠道键/说明换行。
  - 发布表单改为客户端显式受控提交流程（`useActionState` + `startTransition`），校验或服务错误时保留当前输入与错误提示；发布成功后通过随版本集合变化更新的表单 `key` 重置表单并显示成功状态。
  - 读取异常时保留标题与可聚焦的「重新载入」链接（携带原 `brandId`），隐藏已发布版本与内部错误信息。
- 在 `scripts/serve-i18n-fixture.mjs` 为测试夹具增加 `geo-channel-profiles-read=slow-unavailable` 与 `geo-channel-profiles-write=slow` 注入分支，并新增浏览器回归 `tests/e2e/channel-profiles.spec.ts`。

## 验收场景

| 场景 | 浏览器实际结果 |
| --- | --- |
| 无品牌、空清单与只读归档 | `zh-CN` 与 `en` 在 375、768、1440 像素下均只有 1 个 `main`，页首主入口完整位于视口内，无横向溢出。归档后显示只读提示、隐藏发布表单并保留历史版本。 |
| 键盘发布、校验保留与在途防重 | 从「内容 → 渠道画像」用键盘进入后可从页首跳至渠道键输入。非法渠道键与超限字数触发浏览器校验，空白说明返回错误提示并保留输入、未写库。慢速提交期间按钮显示进行中并置为 `aria-disabled="true"`，途中再按 `Enter` 仅发出 1 个 `POST`；发布 v1（上限 1,234）与 v2（不限字数）后新旧版本各自保留，SQL 回读一致，64 字符渠道键与长说明在卡片内换行。 |
| 权限隔离与读取失败恢复 | 其他账号打开同品牌地址显示无权提示且不显示渠道键、说明与发布按钮。中英文 375 像素注入慢速读取故障时先显示加载提示，再显示安全错误与携带原 `brandId` 的「重新载入」链接，清除故障后用键盘重新载入回到同一品牌并恢复版本列表。测试结束后回读确认临时账号、品牌、画像与版本记录均已清理。 |

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过（含 `/dashboard/content/channel-profiles` 路由）。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过（3277 个消息键、7 项测试）。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过（17 项）。 |
| `node --conditions=react-server --test tests/content/channel-profiles.test.mjs tests/channel-variants/persistence.test.mjs` | 12 项中 10 项通过；`tests/content/channel-profiles.test.mjs` 中双库升级起点测试（`previousTag` 取 `journal.entries.at(-2)`）因后续已有新增迁移未命中历史起点而失败 2 项（既有迁移测试漂移，本轮未改动该测试）。 |
| `node --conditions=react-server .cache/issue-135/channel-profiles/run-isolated.mjs tests/e2e/channel-profiles.spec.ts tests/e2e/m0-flow.spec.ts` | 通过（隔离 PostgreSQL、memory 缓存与本机 Chrome，2 项）。 |
| `GEO_CHANNEL_PROFILE_SCREENSHOTS=.cache/issue-135/channel-profiles/dev pnpm exec playwright test tests/e2e/channel-profiles.spec.ts` | 通过（配置开发 PostgreSQL 与本机 Chrome，1 项）。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 开发预检 15 项通过；文档检查通过。 |

隔离与开发走查截图保存在本地 `.cache/issue-135/channel-profiles/{isolated,dev}/`（如 `start-zh-CN-375.png`、`published-zh-CN-375.png`、`browse-en-375.png`、`unavailable-en-375.png`）。

## 剩余

- 本记录仅覆盖渠道画像页的双语三视口、键盘与读取恢复走查，不勾选 T-M1-05；跨页变体钉选、导出与真实资料走查继续按既有多渠道变体任务核验。
- `tests/content/channel-profiles.test.mjs` 中的历史升级起点标签（`previousTag`）需在后续独立清理中固定到渠道画像迁移之前。
