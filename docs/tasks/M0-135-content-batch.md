# M0-135 内容批次

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-09](../specs/M0.md#s-m0-09)

品牌负责人打开内容批次后，应能先看到当前任务和下一步。生成中可以暂停，已暂停可以继续，有失败项时只重试失败项，全部成功后打开仍待审的稿件。读取失败时保留标题，不显示单元和账本，并用键盘重新载入。

基线 `cc953ed34546d2eafea421cb2bdf22f3d7e55992` 在隔离 Chrome 中文 375 像素复现。部分成功的批次标题是「批次详情」，单元写着 `attempts=1 · error=fixture_forced_failure`。暂停、继续、终止和仅重试失败项排在单元列表后面，页面没有说明下一步。

- `/dashboard/content/batches/[batchId]` 留在工作台唯一的 `main#main-content` 内。标题是批次详情。任务说明、已保存状态和批次编号放在同一内容区。相关入口换行，包含返回内容列表、事实与材料和资料原件。
- 状态为 `queued` 或 `running` 时，主要动作是暂停。`paused` 时是继续。存在失败单元时是仅重试失败项。没有失败单元且已有成功稿件时是查看稿件。其余当前允许的控制留在单元列表之后，不适用的控制不显示。
- 单元显示已保存的状态、按界面语言计数的尝试次数，以及失败或阻塞原因的原文。成功单元可以打开对应稿件。批次编号和账本快照在内容区内换行。费用模式仍是已保存的 `unknown_pending` 或 `quota`，不把待核对写成 0。
- 读取失败时标题仍是批次详情，提示可重试，主要动作是重新载入当前地址。不显示单元、失败原因和账本。其他账号打开同一地址仍是找不到页面，看不到这些内容。

## 隔离验收

Chrome 使用开发用回环 PostgreSQL、memory 缓存、回环 S3 和邮件 Mock。品牌、事实、Brief 和批次编号都是合成数据。本轮没有请求供应商。生成使用隔离模板，不调用付费模型。

| 场景 | 实际结果 |
| --- | --- |
| 部分成功 | `zh-CN` 与 `en` 在 375、768、1440 像素无横向溢出，且只有一个 `main`。中文可见「有稿件没有生成。只重试失败项，已成功的版本保持不变。」和「费用待核对」。主要动作「仅重试失败项」只出现一次，375 像素在视口内。没有暂停或继续。两个单元是 `succeeded`，一个单元保留 `fixture_forced_failure`，尝试次数为 1。账本仍显示 `CNY` 最小单位上限。 |
| 已暂停 | 同一两种语言和三种宽度无横向溢出。任务说明是继续处理未完成项且不重写已成功稿件。主要动作是继续，375 像素在视口内。单元状态是 `queued`。没有暂停，也没有仅重试失败项。终止仍在列表之后。 |
| 仅重试失败项 | 中文 375 像素用 Enter 提交后，状态为 `completed`，失败原因消失。原有两个成功稿件的地址仍在。被重试的单元尝试次数为 2，其余为 1。「查看稿件」在视口内，「仅重试失败项」消失。 |
| 读取失败 | 英文 375 像素保留标题 Batch detail 和失败提示，看不到失败原因、Brief 编号和 `CNY`。重新载入在视口内。清除故障标记后用 Enter 回到原批次，状态仍是 `completed`。 |
| 其他账号 | 英文 375 像素显示 Page not found，看不到失败原因、Brief 编号和批次编号。 |

七张 375 像素截图使用合成数据，保存在本地 `.cache/issue-135/content-batch/`，可由 `tests/e2e/content-batch.spec.ts` 重新生成。清理后回读，邮箱前缀 `content-batch-` 的账号是 0 行。生成请求在返回前就结束，浏览器没有单独打开仍处于 `running` 的批次；暂停按钮只在 `queued` 或 `running` 时渲染。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。lint 本次没有打印告警 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3106 个消息键、7 项测试 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，12 项 |
| `pnpm exec playwright test tests/e2e/content-batch.spec.ts` | 通过，隔离 Chrome 1 项。基线找不到任务说明；改动后再次通过 |
| `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` | 通过，1 项。合成品牌仍能生成批次、看到 2 次成功和 1 次失败，并只重试失败项 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过。开发预检 15 项。文档 26 项需求、29 项任务、81 个验收 ID、784 个本地链接 |

## 剩余验收

全站路由、双语视口和状态覆盖仍待继续。稿件版本的页首动作和读取失败见 [稿件版本](M0-135-content-version.md)。正式阶段验收仍待对应试点条件。本轮不勾选 T-M0-09。
