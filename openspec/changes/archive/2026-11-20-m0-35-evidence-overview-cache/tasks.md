# Tasks

- [x] 1.1 为概览增加按 slot 与题集的批量读取，并用 `pnpm test:evidence` 确认 120 条样本的 SQL 次数不随样本线性增长。
- [x] 2.1 在归属校验之后接入 memory/Redis 读缓存，覆盖命中、TTL、品牌隔离、Redis 中断回源和写后新鲜度。
- [x] 3.1 在证据、分析、品牌和优化任务提交成功后失效概览缓存，并用冻结/清除拒绝旧读取。
- [x] 4.1 记录双方言查询计划与耗时，运行 `pnpm lint`、`pnpm typecheck`、`pnpm check:i18n` 和 `pnpm build`。
