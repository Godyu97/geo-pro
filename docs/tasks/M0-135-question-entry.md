# Issue #135 监测问题入口

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [S-M0-03](../specs/M0.md#s-m0-03) · [T-M0-03](T-M0-03-prompt-sets.md) · [监测问题](M0-135-brand-questions.md)

品牌负责人从侧栏「提示词问题库」进入 `/dashboard/brands/questions` 后，先看到当前状态下的下一步。没有活跃品牌时，页首动作是去建档。资料收集关闭或不在开发联调名单时，页首动作是查看全部品牌，并说明原因。已有活跃品牌时，进入该品牌的监测问题。读取失败时保留标题，隐藏品牌名称，并用键盘重新载入。

## 范围

- 页首按无品牌、收集关闭、联调拒绝和读取失败给出一个主要动作，并保留相关入口。
- 已有活跃品牌时仍进入 `/dashboard/brands/[id]/questions`。题集查询次数保持 9 条。
- 路由补了加载骨架。读取失败使用原生重新载入链接，并显示追踪编号。

## 验收

隔离浏览器使用合成品牌。名称没有空格。临时账号已清理。

| 场景 | 实际结果 |
| --- | --- |
| 无品牌 | `zh-CN` 与 `en` 在 375、768、1440 像素只有一个 `main`。顶栏分区是提示词问题库或 `Question library`。页首可见任务说明，「去建档」或 `Open brands` 在 375 像素位于视口内，页面没有品牌名称，且无横向溢出。中文 375 像素从工作台用键盘打开侧栏并进入该入口，再从「去建档」进入品牌资料。 |
| 已有品牌 | 两种语言和三种宽度都从该入口进入对应品牌的监测问题，显示长品牌名称、空题目说明和「浏览默认候选」或 `Browse default candidates`。375 像素该动作位于视口内。中文 375 像素从工作台用键盘再次进入。页面无横向溢出。 |
| 收集关闭与联调拒绝 | 两种语言和三种宽度都留在入口页。关闭时显示资料收集尚未开放，拒绝时显示不在联调名单。主要动作是查看全部品牌，不显示品牌名称，也没有无品牌说明。375 像素该动作位于视口内。中文 375 像素用键盘从关闭状态进入品牌资料。页面无横向溢出。 |
| 其他账号 | 英文 375 像素打开同一入口，看到自己的无品牌说明，看不到原品牌名称。 |
| 读取失败 | 中英文 375 像素先看到加载骨架，再看到安全错误和「重新载入」。失败页不显示品牌名称和内部异常。清除故障后用键盘重新载入，进入同一品牌的监测问题并恢复品牌名称。 |

12 张 375 像素截图保存在本地 `.cache/issue-135/question-entry/`，可由 `tests/e2e/question-entry.spec.ts` 重新生成。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含 `/dashboard/brands/questions`。本次 lint 没有打印告警。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过。3423 个消息键，7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，30 项。 |
| `pnpm test:prompts` | 通过。SQLite3 与 PostgreSQL 共 5 项，零跳过。题集工作区仍是 9 条 SQL。 |
| `GEO_QUESTION_ENTRY_SCREENSHOTS=.cache/issue-135/question-entry pnpm exec playwright test tests/e2e/question-entry.spec.ts` | 通过。配置开发 PostgreSQL、fixture 服务与本机 Chrome，1 项，8.5s。临时账号已清理。 |
| `pnpm env:check` | 通过，15 项。 |
| `pnpm check:feature-map` | 通过。69 个页面、438 个代码路径、6 个地图文件。 |
| `python3 docs/tools/validate_docs.py` | 通过。173 个活跃文档、954 个本地链接、26 项需求、29 项任务、81 个验收 ID。 |

## 剩余

Issue #135 仍保持开放及 `status:in-progress`。下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/local-observations`、`/dashboard/brands/stores`、`/dashboard/content/media-reviews`）完成 `ui-visual-v1` 对齐、加载骨架、读取故障恢复与三视口走查后复核关单条件。正式题集冻结仍按 T-M0-03 的阶段前置核验。
