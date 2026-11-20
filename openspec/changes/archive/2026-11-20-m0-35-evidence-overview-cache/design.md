# Design

## 查询

`EvidenceDao.listScopedObservations` 仍是一条带最新分析版本的范围查询。循环内的 `adoptedAttempt` 与 `PromptDao.version` 改为按 `slotId`、`promptSetId` 分块 `IN` 查询，每块 100 个 ID。题型只在内存中按问题 ID 取首次命中，和原来的循环缓存一致。未命中的题型仍按 discovery 处理。

不新增索引。隔离库计划显示回答列表走 `answer_observation_owner_idx`，采纳尝试走主键或 `monitoring_attempt_adopted_uidx`。PostgreSQL 在本次 120 行 fixture 上对分析版本表做了顺序扫描，并用 `answer_analysis_version_uidx` 取最大版本。小表扫描不另建索引。

## 缓存

先执行归属查询：负责人不匹配或品牌已冻结时直接拒绝，不读缓存。通过后用一条 SQL 汇总实体版本、品牌修订、回答/分析/任务计数与时间，以及任务状态长度和手工排序的校验和，得到新鲜度令牌。

缓存键是这些材料与 scope、`s-m0-07-v1`、`s-m0-06-v1` 的哈希，不含 locale。值按 3500 字符分片，以适配现有 4000 字符上限；清单记录分片数和 SHA-256。TTL 为 60 秒。memory 仍只有 100 条容量，淘汰后下次读取回源。

写路径在事务提交成功后删除该品牌的已知缓存键。键本身包含新鲜度，所以删除失败或另一个进程未见删除时，下一次读取也会错过旧值。Redis 连接失败只记录 `evidence-overview-cache-unavailable` 并回源，不切换到进程内 memory。

## 验证

`pnpm test:evidence` 在 SQLite 与 PostgreSQL 上比较 30 与 120 条样本的 SQL 次数，并检查命中、TTL、品牌隔离、修订、任务状态、冻结/清除拒绝、memory 容量和 Redis 中断。本机 Redis 可用时再用两个客户端核对共享失效。
