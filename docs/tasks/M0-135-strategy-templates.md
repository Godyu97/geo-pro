# Issue #135 策略模板

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [策略模板](M2-127-strategy-templates.md)

品牌负责人从每周行动进入 `/dashboard/assistant/strategies` 后，先看到当前状态下的下一步。没有活跃品牌时，页首动作是去建档。还没有模板时，动作是填写模板，键盘激活后焦点落在适用行业。已有模板时，动作是查看模板，焦点落在模板列表。一次成功只能保存为单次观察。说明里的高胜率、必有效或 guaranteed improvement 不会写入模板，也不会生成每周行动。读取失败时保留标题，隐藏品牌名称和模板，并用键盘重新载入。

## 范围

- 页首按无品牌、空模板和已有模板给出一个主要动作，并保留相关入口。
- 长品牌名称、长行业名和长失败案例在内容区内换行。模板卡片使用共享卡片、标签和虚线空态。
- 保存和起草在途时按钮显示「正在保存…」并带 `aria-disabled`。第二次 Enter 不再发出请求。一次成功配成重复观察时保留已输入内容，并显示模板无效。
- 路由补了加载骨架。读取失败使用原生重新载入链接，并显示追踪编号。

## 验收

隔离浏览器使用合成品牌。名称、行业和失败案例都没有空格。保存前说明含有「高胜率必有效。」。临时账号和模板已清理。起草成功仍由既有回环单测覆盖；本轮浏览器核对的是无效起草不发出请求。

| 场景 | 实际结果 |
| --- | --- |
| 无品牌 | `zh-CN` 与 `en` 在 375、768、1440 像素只有一个 `main`。页首可见任务说明，「去建档」或 `Open brands` 在 375 像素位于视口内，页面没有行业输入框，且无横向溢出。中文 375 像素从工作台用键盘打开侧栏并进入每周行动，随后打开策略模板。 |
| 空模板 | 两种语言和三种宽度都显示品牌名称和「填写模板」或 `Fill in the template`。中文 375 像素从每周行动用键盘进入策略模板。375 像素键盘激活「填写模板」后，焦点落在适用行业。页面无横向溢出。 |
| 无效保存 | 中文 375 像素把一次成功标成重复观察后，对「保存模板」按 Enter。页面显示模板无效，行业仍在，没有发出 `POST /api/assistant/strategy-templates`。 |
| 无效起草 | 中文 375 像素只填写起草行业后，对「起草并保存」按 Enter。页面显示模板无效，行业仍在，没有发出起草 `POST`。 |
| 已有模板 | 两种语言和三种宽度都显示长行业名、长失败案例、观察案例、不保证收益和成功观察 1 次。375 像素键盘激活「查看模板」后，焦点落在模板列表。页面无横向溢出。 |
| 慢速保存 | 中文 375 像素填写含「高胜率必有效。」的说明后，对「保存模板」连续按两次 Enter。按钮变为「正在保存…」且 `aria-disabled="true"`，只发出 1 个保存 `POST`。列表里两份说明都是「先按采样条件记录一次观察。」，没有「高胜率」。数据库中新模板为 `observation`，保证收益为 0，成功次数为 1，证据强度为 `single_observation`。该品牌的每周行动仍是 0 条。 |
| 其他账号 | 英文 375 像素打开同一地址，看到自己的无品牌说明，看不到原品牌名称、行业和失败案例。 |
| 读取失败 | 中英文 375 像素先看到加载骨架，再看到安全错误和「重新载入」。失败页不显示品牌名称、行业、失败案例和内部异常。清除故障后用键盘重新载入，恢复品牌名称和行业。 |

10 张 375 像素截图保存在本地 `.cache/issue-135/strategy-templates/`，可由 `tests/e2e/strategy-templates.spec.ts` 重新生成。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含 `/dashboard/assistant/strategies`。本次 lint 没有打印告警。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过。3420 个消息键，7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，29 项。 |
| `node --conditions=react-server --test tests/assistant/strategy-templates.test.mjs` | 通过。SQLite3 与 PostgreSQL 共 3 项，零跳过。列表查询使用 `strategy_template_owner_idx`。 |
| `GEO_STRATEGY_SCREENSHOTS=.cache/issue-135/strategy-templates pnpm exec playwright test tests/e2e/strategy-templates.spec.ts` | 通过。配置开发 PostgreSQL、fixture 服务与本机 Chrome，1 项，8.5s。临时账号已清理，用户和模板回读为 0。 |
| `pnpm env:check` | 通过，15 项。 |
| `pnpm check:feature-map` | 通过。69 个页面、438 个代码路径、6 个地图文件。 |
| `python3 docs/tools/validate_docs.py` | 通过。172 个活跃文档、948 个本地链接、26 项需求、29 项任务、81 个验收 ID。 |

## 剩余

Issue #135 仍保持开放及 `status:in-progress`。下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/questions`）完成 `ui-visual-v1` 对齐、加载骨架、读取故障恢复与三视口走查后复核关单条件。正式策略模板试点仍按既有阶段前置核验。
