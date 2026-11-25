# Issue #135 每周行动

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [T-M2-05](M2.md#t-m2-05)

品牌负责人从工作台侧栏进入 `/dashboard/assistant` 后，先看到当前状态下的下一步。没有活跃品牌时，页首动作是去建档。还没有草案时，动作是填写材料，键盘激活后焦点落在材料。已有草案时，动作是查看草案，焦点落在草案列表。确认所选条目后可以执行。预算和授权不因确认或执行而改变。读取失败时保留标题，隐藏品牌名称和草案，并用键盘重新载入。

## 范围

- 页首按无品牌、空草案和已有草案给出一个主要动作，并保留相关入口。
- 长品牌名称和长动作在内容区内换行。草案卡片使用共享卡片、标签和虚线空态。
- 生成、确认和执行在途时按钮显示「正在保存…」并带 `aria-disabled`。第二次 Enter 不再发出请求。缺少动作时保留已输入材料，并显示草案无效。
- 路由补了加载骨架。读取失败使用原生重新载入链接，并显示追踪编号。

## 验收

隔离浏览器使用合成品牌。名称和动作都没有空格。确认前预算为 2500，保证收益为 0。临时账号、事实版本和草案已清理。

| 场景 | 实际结果 |
| --- | --- |
| 无品牌 | `zh-CN` 与 `en` 在 375、768、1440 像素只有一个 `main`。页首可见任务说明，「去建档」或 `Open brands` 在 375 像素位于视口内，页面没有材料输入框，且无横向溢出。中文 375 像素从工作台用键盘打开侧栏并进入每周行动。 |
| 空草案 | 两种语言和三种宽度都显示品牌名称和「填写草案」或 `Fill in the draft`。375 像素键盘激活后，焦点落在材料。页面无横向溢出。 |
| 无效生成 | 中文 375 像素只填写材料后，对「生成草案」按 Enter。页面显示草案无效，材料仍在，没有发出 `POST /api/assistant/plans`。 |
| 已有草案 | 两种语言和三种宽度都显示长动作、预算 2,500、历史成功 1 次和不保证收益。375 像素键盘激活「查看草案」后，焦点落在主内容区的草案列表。页面无横向溢出。 |
| 慢速确认 | 中文 375 像素用键盘勾选条目后，对「确认所选」连续按两次 Enter。按钮变为「正在保存…」且 `aria-disabled="true"`，只发出 1 个确认 `POST`。页面显示已确认。数据库中计划仍是 `draft`，预算仍是 2500，保证收益仍是 0，条目为 `confirmed`。 |
| 执行 | 同一页用键盘执行。只发出 1 个执行 `POST`。页面显示已执行，预算说明仍是 2,500。数据库中计划为 `settled`，预算 2500，保证收益 0，条目为 `executed`。 |
| 其他账号 | 英文 375 像素打开同一地址，看到自己的无品牌说明，看不到原品牌名称和动作。 |
| 读取失败 | 中英文 375 像素先看到加载骨架，再看到安全错误和「重新载入」。失败页不显示品牌名称、动作和内部异常。清除故障后用键盘重新载入，恢复品牌名称和动作。 |

10 张 375 像素截图保存在本地 `.cache/issue-135/assistant-plans/`，可由 `tests/e2e/assistant-plans.spec.ts` 重新生成。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含 `/dashboard/assistant`。本次 lint 没有打印告警。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过。3408 个消息键，7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，28 项。 |
| `node --conditions=react-server --test tests/assistant/weekly-plans.test.mjs` | 通过。SQLite3 与 PostgreSQL 共 3 项，零跳过。列表查询使用 `assistant_plan_owner_idx`。 |
| `pnpm exec playwright test tests/e2e/assistant-plans.spec.ts` | 通过。配置开发 PostgreSQL、fixture 服务与本机 Chrome，1 项，9.1s。临时账号已清理，用户和草案回读为 0。 |
| `pnpm env:check` | 通过，15 项。 |
| `pnpm check:feature-map` | 通过。69 个页面、438 个代码路径、6 个地图文件。 |
| `python3 docs/tools/validate_docs.py` | 通过。171 个活跃文档、944 个本地链接、26 项需求、29 项任务、81 个验收 ID。 |

## 剩余

Issue #135 仍保持开放及 `status:in-progress`。下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/assistant/strategies`、`/dashboard/brands/questions`）完成 `ui-visual-v1` 对齐、加载骨架、读取故障恢复与三视口走查后复核关单条件。正式每周行动试点仍按 T-M2-05 的阶段前置核验。
