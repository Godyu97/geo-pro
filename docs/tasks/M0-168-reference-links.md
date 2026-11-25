# Issue #168 搜索候选与分析师链接

2026-11-26。 [Issue #168](https://github.com/Godyu97/geo-pro/issues/168) · [S-M0-06](../specs/M0.md#s-m0-06) 第 3 条 · [T-M0-06](M0.md#t-m0-06)

## 交付范围

- 品牌负责人在回答证据详情对草稿、完整或待复核观察追加一条 `search_candidate` 或 `analyst_found` 链接。页面用中英文显示来源类别。
- 同一来源类别按现有规范化 URL 去重。同一规范化 URL 可以同时作为原生引用和搜索候选。追加不改原文、指纹或引用集合状态，也不改写已有分析版本。
- 官方回执的引用字段仍记为 `provider_native`。回执另有 `search_results`，或 Responses 回执里 `web_search_call` 的 `action.sources` 明确列出搜索结果时，那些 URL 记为 `search_candidate`，不参与引用字段是否完整的判断。回答正文里的 URL 不会自动入库。
- 竞品与来源页列出这些 URL 时显示来源类别。它们不进入第三方支持分子。自有页引用只读取 `provider_native` 与 `consumer_visible` 的归属。
- 另一账号不能追加或读取。已完成观察的原文仍然不能被覆盖。补全草稿时保留已经留下的这两类链接。
- 本记录不勾选 T-M0-06，也不把隔离浏览器走查写成正式阶段验收。

## 查询路径

追加链接只插入 `answer_citation`，不更新 `answer_observation`。PostgreSQL 在事务里对观察主键加 `FOR UPDATE` 后再按规范化 URL 去重。自有页归属查询仍走 `answer_citation_observation_idx`，并在索引定位后过滤来源类别。没有新增表或索引。

SQLite 计划是 `SEARCH answer_citation USING INDEX answer_citation_observation_idx (observation_id=?)`。PostgreSQL 计划是该索引上的 Index Scan，`citation_origin` 与 `brand_id` 作为过滤。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件仍是长期 mock。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |
| 双语与地图 | `pnpm check:i18n` 通过，3874 个消息键。`pnpm check:feature-map` 通过，69 个页面和 447 条代码路径。 |
| 隔离行为 | `pnpm test:evidence` 45 项通过，含 SQLite 与 PostgreSQL。官方完整空引用入证后带一条搜索候选，原生引用仍为空，官网引用保持 false。回答正文中的 URL 不产生引用行。同一规范化 URL 的原生引用与搜索候选同时可回读；原生引用只计一次，搜索候选不进入第三方支持分子。重复操作不新增行。另一账号追加返回 `NOT_FOUND`，也读不到观察。`pnpm test:competitors` 21 项通过。`tests/monitoring/official-sampling.test.mjs` 10 项通过。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/reference-links.spec.ts` 1 项通过。隔离账号在详情看到完整空引用和没有原生引用，正文 URL 没有变成引用行。保存搜索候选后仍是未引用，官网引用为否，并显示搜索候选和规范化 URL。同一规范化 URL 的消费者可见引用和搜索候选同时在来源页出现；两边都标成页面支持后，支持率是 1/1。英文 375 与 1440 下表单可聚焦且无横向溢出。另一账号打开该证据地址看不到正文。临时账号已清理。 |
| 未验证 | 不把本次结果写成 T-M0-06 或阶段门禁通过。没有改已生成报告快照。 |
