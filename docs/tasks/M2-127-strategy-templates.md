# Issue #127 策略模板

2026-11-24。 [Issue #127](https://github.com/Godyu97/geo-pro/issues/127) · [S-M2-05](../specs/M2.md#s-m2-05) · AC-M2-05-3

负责人可以保存一条不可保证收益的策略模板。历史只有一次成功时，证据强度只能是 `single_observation`，读回的 `guaranteed` 为 0，标签为 `observation`。失败案例为空时不插入行。起草说明调用 Responses API；材料或模型输出里含「高胜率」「必有效」或 guaranteed improvement 的句子不写入说明。另一用户读取行业、采样条件和失败案例得到 404。本记录不勾选 T-M2-05，不创建 `assistant_plan`，不确认行动，不发布、不授权、不删除，也不调用真实线上模型。

## 交付范围

- 双方言表 `strategy_template`。字段覆盖品牌、负责人、行业、采样条件、证据强度、失败案例、说明、固定标签和 `guaranteed=0`。成功次数小于 2 时不能写入 `repeated_observation`；一次成功只能是 `single_observation`；零次成功只能是 `insufficient`。迁移为 `drizzle/0079_superb_nuke.sql` 与 `drizzle/sqlite/0078_panoramic_vermin.sql`，并已写入全量 DDL。列表查询使用 `strategy_template_owner_idx`（`owner_id, brand_id, created_at, id`）。
- 保存和起草在 `src/features/assistant/`。起草调用 `createAiResponse`，单测使用回环 `fetch`。保存和起草都不写每周行动。
- `POST /api/assistant/strategy-templates`、`POST /api/assistant/strategy-templates/draft` 和按品牌或编号的 GET。站内页 `/dashboard/assistant/strategies` 提供中英文保存、起草和列表。每周行动页可以进入该页。登录回跳已登记该路径。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 结构 | `pnpm db:generate` 生成上述迁移。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm db:ddl` 与 `pnpm db:ddl:check` 通过。 |
| 隔离行为 | `node --conditions=react-server --test tests/assistant/strategy-templates.test.mjs` 3 项通过。双方言都覆盖：一次成功保存为 `single_observation` 且 `guaranteed` 读回为 0；缺少失败案例或一次成功配 `repeated_observation` 时没有新行；回环模型返回保证收益句子后，说明只保留「先按采样条件记录一次观察。」；只返回保证收益句子时不插入；另一用户为 404，响应不含行业、条件和失败案例；`assistant_plan` 行数保持 0。 |
| 查询计划 | 品牌列表使用 `strategy_template_owner_idx`。PostgreSQL 计划没有 `Seq Scan on strategy_template`。 |
| 回归 | `node --conditions=react-server --test tests/assistant/weekly-plans.test.mjs` 中 SQLite 与纯函数通过。PostgreSQL 的既有 `assistant_plan` 列表计划断言失败：200 行上 `EXPLAIN` 为 `Seq Scan`。同一语句在只迁移到 `0078_oval_iron_monger` 的空库上结果相同，不是本表引入的。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/dashboard/assistant/strategies` 与两个策略模板 API。 |
| 双语 | `pnpm check:i18n` 通过，2935 个键一致。`pnpm test:i18n` 7 项通过。 |
| 开发库 | 2026-11-24。临时账号在开发 PostgreSQL 保存一次成功。读回强度为 `single_observation`，`guaranteed` 为 0，标签为 `observation`，说明不含「高胜率」「必有效」或 guaranteed improvement。空失败案例和 `repeated_observation` 均为 `INVALID_INPUT`。另一临时用户为 `NOT_FOUND`，响应不含行业名。该品牌 `assistant_plan` 为 0，模板为 1。清理后模板、品牌和两个用户计数为 0。未调用真实模型。 |

页面点击、375/768/1440 视口和真实品牌走查未在浏览器中执行。当前会话没有浏览器工具。保存、起草、越权和读回由双方言隔离测试和开发库临时品牌覆盖。
