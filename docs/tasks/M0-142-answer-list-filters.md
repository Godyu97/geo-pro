# Issue #142 回答列表筛选

2026-11-24。 [Issue #142](https://github.com/Godyu97/geo-pro/issues/142) · [PRD 第 3 节](../02-产品需求文档-PRD.md) · [S-M0-07](../specs/M0.md#s-m0-07) 第 4 条 · [S-M0-06](../specs/M0.md#s-m0-06) 独立判定

## 交付范围

- 品牌负责人在 `/dashboard/monitoring/answers` 用题目或原文关键词、问题簇，以及提及、推荐、官网引用的 `true` / `false` / `unknown` 收窄当前列表。
- 计数显示筛出的条数。没有命中时说明没有匹配，并可以清除列表筛选。清除后仍保留轨道、目标地区、请求联网和采集时间。
- 打开证据详情再返回时，关键词、问题簇、判定和原有范围都在，并回到刚才那条回答。返回概览的链接不带列表关键词。
- 关键词只匹配当前品牌已保存的题目和该回答的原文。未知不会进入对应判定的 false。没有采样槽位时，问题簇取该品牌最新一份可解析题集里的相同题目；已关联采样运行时，用该运行钉住的题集版本。
- 概览指标仍按轨道、地区、请求联网和采集时间计算，不因列表关键词改变。
- `zh-CN` / `en` 都有控件、计数、空匹配和无效筛选文案。本记录不勾选 T-M0-06 或阶段门禁。

## 查询路径

列表原文和问题簇按已出现的证据 id 分块读取，每块最多 100 条。观察行走 `answer_observation` 主键或 `answer_observation_owner_idx`，槽位和运行按主键左连接。归属不一致时不采用该题号或题集。已关联的题集按 `prompt_set` 主键分块读取；没有关联运行时再取该品牌最新一份题集。没有新增表或索引。

SQLite 计划是 `SEARCH o USING INDEX sqlite_autoindex_answer_observation_1 (id=?)`，槽位和运行都是主键左连接。PostgreSQL 计划是 `answer_observation_owner_idx` 上按 `owner_id` 与 `id` 的 Index Scan，槽位和运行分别走各自主键。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件仍是长期 mock。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过，3021 个键。 |
| 隔离行为 | `pnpm test:evidence` 37 项通过，`pnpm test:prompts` 5 项通过。4 条同品牌回答里，关键词「安装」为 1，同一问题簇为 2，推荐 unknown 为 1，推荐 false 不包含这条 unknown。只出现在原文里的「密封圈」也能命中。另一负责人的同文题目不进入当前列表。概览样本数仍是 4。带 `&` 的关键词和轨道、地区、联网、时间可以往返解析，筛出的 id 不变。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/answer-list-filter.spec.ts` 1 项通过。隔离账号的合成品牌在官方轨道、CN、请求联网关和 2026-11-20 时间窗内先看到 4 条。关键词「安装」后为 1 条，返回概览的链接不含 `q`，概览仍能看到其他题目。证据详情返回后查询串和计数仍是 1，并带有该回答的位置锚点。清除列表筛选后回到 4 条，问题簇筛选为 2 条。推荐 unknown 不显示推荐为否的题目，再选 false 时未知题目消失。英文界面显示 “1 matching answer”，证据链接仍是同一条，375、768、1440 无横向溢出。临时账号已清理。 |
| 未验证 | 浏览器样本由测试直接写入隔离账号，不是获准品牌的真实采样。不把本次结果写成 AC-M0-GATE 或 T-M0-06 通过。 |
