# Issue #150 消费者人工存证录入与草稿补全

2026-11-25。 [Issue #150](https://github.com/Godyu97/geo-pro/issues/150) · [S-M0-06](../specs/M0.md#s-m0-06) · [T-M0-06](M0.md#t-m0-06)

## 交付范围

- 品牌负责人在 `/dashboard/monitoring/answers` 录入消费者人工存证。可以填写或选择问题，并记录通道模式、目标地区、实际地区、新会话、回答原文、引用集合状态、引用 URL、采集人和存证定位符，也可以标记待复核。
- 原文、引用状态、定位符或采集人缺一项时，同一条观察保存为 `draft_evidence`，并列出缺项。草稿不进入概览分母，也不出现在回答列表的有效样本里。
- 详情页可以补全这条草稿。字段齐全后转为 `complete`；勾选待复核则转为 `contested`，并写入 `v1` 分析版本。已完成的 `complete` / `contested` 观察拒绝再次覆盖原文。
- 同一回答的引用按去掉 `utm_*`、`fbclid`、`gclid`、`mc_*` 后的地址去重，保留第一次出现的原 URL 和位置说明。会改变内容的参数仍然保留。
- 回答或定位符里出现 `password`、`cookie`、`session_token` 等凭据文本时拒绝写入。
- `zh-CN` / `en` 都有表单、缺项和拒绝文案。本记录不勾选 T-M0-06，也不把隔离浏览器走查写成正式消费者通道验收。

## 查询路径

补全草稿时按主键更新 `answer_observation`，条件同时包含 `owner_id`、`brand_id` 和 `evidence_state = 'draft_evidence'`。命中后删除该观察的旧引用，再写入去重后的引用。没有新增表或索引。

SQLite 计划是 `SEARCH answer_observation USING INDEX sqlite_autoindex_answer_observation_1 (id=?)`。PostgreSQL 计划是 `answer_observation_owner_idx` 上的 Index Scan，索引条件为 `owner_id` 与 `id`，`brand_id` 和草稿状态作为过滤。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件仍是长期 mock。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |
| 双语与地图 | `pnpm check:i18n` 通过，3629 个消息键。`pnpm check:feature-map` 通过，69 个页面和 440 条代码路径。 |
| 隔离行为 | `pnpm test:evidence` 43 项通过，含 SQLite 与 PostgreSQL。缺引用状态和定位符的提交是 `draft_evidence`，消费者概览分母为 N/A。补全后同一观察变为 `complete`，两条只差跟踪参数的 URL 合成一条并保留首次原 URL，`id` 参数不同的地址仍分开，分析版本为 `v1`。重复提交同一操作不新增分析版本。再次覆盖原文返回 `EVIDENCE_LOCKED`，原文不变。`password`、`cookie`、`session_token` 被拒绝，观察和引用行数不变。另一账号读不到该观察。 |
| 浏览器 | `pnpm test:e2e tests/e2e/manual-evidence.spec.ts` 1 项通过。隔离账号在回答列表用键盘提交缺定位符和引用状态的存证，页面列出这两项缺项。消费者概览仍是暂无有效样本，回答列表没有该题。详情页补上两条带跟踪参数的重复 URL、采集人和定位符后，状态为完整，只保留一条规范化 URL 和第一次出现的原 URL，并有版本 1。再次提交不同原文被拒绝。消费者概览能看到该题，并下钻到同一条回答。定位符含 `session_token` 的另一次提交被拒绝，且不进入消费者列表。中英文在 375、768、1440 下表单可聚焦且无横向溢出。另一账号打开该证据地址看到 404，看不到原文。临时账号已清理。 |
| 未验证 | 浏览器样本是隔离账号里的合成品牌，不是获准消费者通道的真实走查。不把本次结果写成 T-M0-06 或阶段门禁通过。 |
