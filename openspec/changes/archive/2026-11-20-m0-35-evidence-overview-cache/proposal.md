# Proposal

## Why

证据概览在每条回答上串行查询采纳尝试和题集版本，样本变多时 SQL 次数线性增长。高频读路径也还没有接入已有的 memory/Redis 读缓存。Issue #35 在不改变 AC-M0-07 指标口径的前提下消除这条 N+1，并让提交后的读取看到新结果。

## What Changes

- `readEvidenceOverview` 先核验品牌归属，再用集合查询装载采纳尝试与题型。
- 概览聚合结果写入 `src/lib/cache/store.ts`。缓存键包含负责人、品牌、统计 scope、规则版本和数据库新鲜度，不按界面语言分键。
- 证据入证、分析修订、品牌实体更新/冻结/清除和优化任务提交成功后删除已知缓存键；新鲜度变化保证失效失败时也不会返回旧聚合。
- Redis 不可用时回源数据库，不改用 memory 冒充共享缓存。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `evidence-overview`：补充批量读取、读缓存、品牌隔离和写后可见性，不改变题等权与轨道隔离口径。

## Impact

影响 `src/features/evidence/`、优化任务与品牌写路径的缓存失效调用，以及 `pnpm test:evidence`。不新增 Schema、依赖、队列或 Worker。真实通道与试点验收不在本次范围。
