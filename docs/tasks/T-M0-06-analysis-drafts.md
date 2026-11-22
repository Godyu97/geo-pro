# 提及推荐引用草案

2026-11-22 · [Issue #83](https://github.com/Godyu97/geo-pro/issues/83) · [T-M0-06](M0.md#t-m0-06)

证据详情可以为一条已保存回答生成提及、推荐和官网引用草案。服务端只把回答原文和当前品牌实体版本里的别名作为数据交给 Responses API，`store` 为 false。系统指令固定在服务端：回答正文里的指令不能改判定口径，出现品牌名本身不算推荐。草案写入 `answer_analysis_draft`，状态为 `draft`。负责人可以改写三态后再走现有分析修订，追加一条 `answer_analysis_version`；放弃只改变草案状态。两条路径都不改回答原文，也不回写报告快照。未应用前，概览继续使用已保存的分析版本。

模型缺字段、多出状态或值不是 `true|false|unknown` 时，事务回滚，草案表和分析版本都没有新行。另一账号读取、生成、应用或放弃时返回 404，响应体不含原文。界面文案有 `zh-CN` / `en`；回答原文不随界面语言改变。

## 存储

`answer_analysis_draft` 保存观察、品牌、负责人、提及/推荐/官网引用、`draft|applied|dismissed`、模型名和创建时间。索引 `answer_analysis_draft_observation_idx` 为 `(observation_id, created_at)`。品牌清除时删除这些行。详情读取固定 4 条 SQL：观察、引用、分析版本，以及最多 20 条开放草案。双方言在 0 条开放草案和另插入 640 条合成草案后仍为 4 条。SQLite3 约 0.37 / 0.71 ms，PostgreSQL 约 2.47 / 2.69 ms。开放草案列表使用 `answer_analysis_draft_observation_idx`。这些时间来自隔离库中的合成数据，不是客户监测结果。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 回环模型 | 夹具返回提及 true、推荐 false、官网引用 true。草案三条独立保存。应用后新增分析版本，旧版本仍可按版本号读到，回答原文字节不变。改写后的官网引用写入新版本，草案行仍保留模型原值。放弃不增加分析版本。非法输出不写草案。另一账号返回不含原文的 404。 |
| 概览 | 应用前概览仍是已保存的 false/false/false。应用后变为 true/false/true。概览 SQL 不读取草案表。 |
| 双库 | `pnpm test:evidence` 11 项通过，覆盖 SQLite3 与 PostgreSQL。`tests/db/dual-database.test.mjs` 4 项通过，升级后双方言均为 60 张表。 |
| Schema | `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。 |
| AI 合同 | `pnpm test:ai` 通过。单测使用回环 `fetchImpl`，不访问外网。 |
| 双语 | `pnpm check:i18n`（1370 键）和 `pnpm test:i18n` 通过。 |
| 工程 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |

未调用真实模型或真实采样，未勾选 T-M0-06。邮件仍按长期 mock 处理，本增量不发信。详情页的点击路径没有在浏览器里走查。
