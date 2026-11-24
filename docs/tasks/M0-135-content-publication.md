# M0-135 发布回填

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-11](../specs/M0.md#s-m0-11)

品牌负责人打开发布记录后，应能先看到当前任务和下一步。尚未核验时先运行公开核验。草稿箱或页面受限时提交人工证据。公开核验通过或人工核验通过后，页首说明生效时间的口径。读取失败时保留标题，不显示网址、稿名和申报时间，并用键盘重新载入。

基线 `ef43d783727d6bd813a10a74b9b84893fd296a21` 在隔离 Chrome 中文 375 像素复现。页面没有说明下一步。180 字无空格网址和长稿名占满首屏，公开核验按钮在核验历史之后。

- `/dashboard/content/publications/[publicationId]` 留在工作台唯一的 `main#main-content` 内。标题是发布核验详情。任务说明、已保存状态和发布编号放在同一内容区。相关入口换行，包含返回稿件、返回内容列表和事实与材料。
- 状态为 `prepared`、`submitted`、`pending_check`、`mismatch` 或 `removed` 时，主要动作是运行公开核验。`draft_only` 或 `access_limited` 时，主要动作是提交人工证据，公开核验改到记录后面，只出现一次。`verified_public` 或 `verified_manual` 时，页首说明生效时间，不再把人工证据当作下一步。归档只读时不提供这些写入动作。
- 公开网址和稿名在内容区内换行。状态仍显示已保存的值。用户申报发布时间单独保留。没有生效时间时显示「无（草稿/受限不计生效）」。
- 读取失败时标题仍是发布核验详情，提示可重试，主要动作是重新载入当前地址。不显示网址、稿名、发布编号和申报时间。其他账号打开同一地址仍是找不到页面，看不到这些内容。

## 隔离验收

Chrome 使用开发用回环 PostgreSQL、memory 缓存、回环 S3 和邮件 Mock。品牌、事实、Brief、稿件和发布编号都是合成数据。本轮没有请求供应商。生成使用隔离模板，不调用付费模型。页面提示服务端已开启公开抓取；键盘提交时没有勾选只读抓取，观察来自登录墙隔离页，没有访问该长网址。

| 场景 | 实际结果 |
| --- | --- |
| 待核验回填 | `zh-CN` 与 `en` 在 375、768、1440 像素无横向溢出，且只有一个 `main`。中文可见「这是发布回填，还不是公开核验。先运行公开核验。HTTP 成功本身不会写成已生效。」主要动作「运行公开核验（隔离页）」只出现一次，375 像素在视口内。没有提交人工证据。状态是 `submitted`。生效时间是「无（草稿/受限不计生效）」。申报时间仍是 `2026-11-20T10:00:00.000Z`。180 字网址和长稿名留在记录区内。 |
| 登录墙 | 中文 375 像素把访问类别选成 `login_wall` 后，用 Enter 运行公开核验。状态变为 `access_limited`。同一两种语言和三种宽度无横向溢出。任务说明写明不能按公开发布成功处理，也没有生效时间。主要动作是提交人工证据，375 像素在视口内。公开核验只出现一次，留在记录后面。申报时间不变。 |
| 读取失败 | 英文 375 像素保留标题 Publication verification 和失败提示，看不到长网址、长稿名、发布编号和申报时间。重新载入在视口内。清除故障标记后用 Enter 回到原记录，状态仍是 `access_limited`，长网址仍在。 |
| 其他账号 | 英文 375 像素显示 Page not found，看不到长网址、长稿名和发布编号。 |

六张 375 像素截图使用合成数据，保存在本地 `.cache/issue-135/content-publication/`，可由 `tests/e2e/content-publication.spec.ts` 重新生成。清理后回读，邮箱前缀 `content-publication-` 的账号是 0 行，名称为「合成发布品牌」的版本是 0 行。本轮浏览器没有单独打开草稿箱、已公开核验、人工核验通过、内容不一致或已撤下的记录；这些下一步写在页面分支中。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。lint 本次没有打印告警 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3119 个消息键、7 项测试 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，14 项 |
| `pnpm exec playwright test tests/e2e/content-publication.spec.ts` | 通过，隔离 Chrome 1 项。基线找不到下一步说明；改动后再次通过 |
| `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` | 通过，1 项。合成品牌仍能走完隔离主流程 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过。开发预检 15 项。文档 26 项需求、29 项任务、81 个验收 ID、798 个本地链接 |

## 剩余验收

全站路由、双语视口和状态覆盖仍待继续。已公开核验、人工核验通过、内容不一致和已撤下的记录尚未按两种语言和三种宽度单独走查。内容日历的页首动作和读取失败见 [内容日历](M0-135-content-calendar.md)。正式阶段验收仍待对应试点条件。本轮不勾选 T-M0-11。
