# Design

## Context

#25/#29/#7 已交付。S-M0-12 要求立即探索复测、D+7 站内待办、共同题比较、不可变快照与本人下载。

## Goals / Non-Goals

- Goals：Retest 状态机；共同题 Comparison；不可变 ReportSnapshot（HTML+JSON）；诊断 vs 经营闭环门禁；D+7 进度；归属隔离；AC-M0-12-1/2/3。
- Non-Goals：正式观察窗口、因果显著性、匿名分享、自动付费复测、真实外网采样（阶段门禁）。

## Decisions

1. **表**：`report_retest`、`report_todo`、`report_snapshot`；双方言 Schema + migration + 全量 DDL；purge 按依赖序清理。
2. **比较纯函数**：输入前后窗样本与冻结题集；匹配键=queryVersion+track+channelVersion+protocol+analysis+region+entityVersion；共同可判断题≥3 才输出探索 pp，否则 `incomparable`。
3. **闭环门禁**：存在 `verified_*` 的 `effective_at` 才允许 `business_loop` 报告；否则仅 `diagnostic`，明确未闭环。
4. **D+7**：以品牌时区 `effective_at` 次日起累计 7 个完整日；到期前只返回进度，不创建付费运行。
5. **快照**：写入后 JSON/HTML 字节不可变；纠正标签创建 successor 并标记前版 `superseded`；源证据缺失设 `source_missing` 提示。
6. **归属**：全部读写按 `owner_id`；越权 NOT_FOUND。

## Risks / Trade-offs

- 本轮用显式 fixture 样本验收软件合同，不代替真实通道采样。
- 报告域独立表，避免把不可变快照耦合进监测运行表。

## Migration Plan

新增 PG/SQLite 迁移；同步全量 DDL；`pnpm db:ddl:check`。验证：`pnpm test:reports`、`check:i18n`、`typecheck`、`lint`、`build`。
