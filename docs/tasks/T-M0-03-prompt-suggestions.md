# 购买问题候选

2026-11-22 · [Issue #82](https://github.com/Godyu97/geo-pro/issues/82) · [T-M0-03](M0.md#t-m0-03)

题集工作台可以为一张已保存的品牌资料生成购买问题候选。服务端只把业务描述、地区、业务语言和已有题目作为数据交给 Responses API，`store` 为 false。系统指令固定在服务端。完全重复的候选不落库；近似候选以 `draft` 写入 `prompt_ai_suggestion` 并带 `similar` 警告。负责人接受后，题目才进入 `prompt_draft`；放弃只改变候选状态。两条路径都不冻结题集，也不创建监测运行。

模型输出不是 JSON、或服务端没有配置 `OPENAI_API_KEY` 时，接口返回稳定错误，候选表和题集都没有新行。另一账号读取或接受时返回 404，响应体不含题干。界面文案有 `zh-CN` / `en`；题目原文不随界面语言改变。

## 存储

`prompt_ai_suggestion` 保存品牌、负责人、可选题集、`draft|accepted|dismissed`、模型名、候选 JSON 和创建时间。索引 `prompt_ai_suggestion_owner_idx` 为 `(brand_id, owner_id, created_at)`。品牌清除时删除这些行。

工作台读取现为 9 条 SQL。其中候选列表是 1 条，过滤本人品牌的 `draft` 并限制 20 行。双方言在合成的 500 个题集版本前后都保持 9 条。SQLite3 约 6.29 / 1.49 ms，PostgreSQL 约 61.25 / 13.79 ms。版本分页仍使用 `prompt_set_recent_idx`；候选列表使用 `prompt_ai_suggestion_owner_idx`。这些时间来自隔离库中的合成数据，不是客户监测结果。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 回环模型 | 相同题被丢弃，近似题以 `draft` 和 `similar` 保存，题集条数不变。接受后草稿只出现一次，放弃不进入草稿。另一账号读取和接受返回不含题干的 404。非法输出和未配置 AI 都不写新行。 |
| 双库 | `pnpm test:prompts` 5 项通过，覆盖 SQLite3 与 PostgreSQL。 |
| Schema | `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。 |
| AI 合同 | `pnpm test:ai` 通过。单测使用回环 `fetchImpl`，不访问外网。 |
| 双语与布局 | `pnpm check:i18n`（1353 键）、`pnpm test:i18n` 和 `pnpm verify:prompts` 通过。Chrome 覆盖 375/768/1440，切换到 `en` 后题目原文仍在。 |
| 工程 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |

未调用真实采样通道，未勾选 T-M0-03 或 T-M0-GATE。邮件仍按长期 mock 处理，本增量不发信。
