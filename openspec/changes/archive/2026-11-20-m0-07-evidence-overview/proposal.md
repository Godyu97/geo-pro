# Proposal

## Why

负责人需要在同一冻结过滤条件下理解提及/推荐/官网引用指标，并从总览下钻到原文样本，才能决定下一步。Issue #25 / R-M0-07 / S-M0-07 / T-M0-07。前置 #24 已交付双轨 Observation 与独立判定。

## What Changes

- 新增可解释概览：按品牌/时间窗/轨道/联网/地区等同一 scope 计算题等权主卡与样本池化明细。
- 展示数据质量（覆盖、未知比例、小样本、N/A 原因）与最多 3 条后续建议/任务入口占位（优化任务未交付时给明确空态）。
- 提供同口径回答列表下钻，保留筛选；直接请求详情仍校验归属。
- 机器金样验证 AC-M0-07-1/2（题等权 75% / 池化 80%）及轨道隔离；界面 zh-CN/en。

## Capabilities

### New Capabilities

- `evidence-overview`：同口径指标聚合、数据质量摘要与回答下钻合同。

### Modified Capabilities

- `answer-evidence`：补充按 scope 批量读取 Observation+最新分析用于概览（不改写入合同）。

## Impact

影响 `src/features/evidence/`（metrics/overview）、工作台总览与回答列表路由、i18n、专项测试 `pnpm test:evidence`。不新增 Schema。真实监测通道开通、优化任务生成与报告快照不在本次范围；软件验收使用显式标注 fixture。
