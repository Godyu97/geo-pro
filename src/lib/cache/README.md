# cache

支持定位使用这里的服务端缓存入口，同时覆盖 memory 与 Redis。默认驱动是 Redis。只有显式设置 `GEO_CACHE_DRIVER=memory` 时才使用进程内 memory。Redis 未配置或不可达时回源数据库并记录受阻，不会静默改用 memory。

缓存只保存已鉴权后的支持元信息投影，不保存客户正文、附件或私人报告。键包含 `support:v1` 与操作编号。权限每次从数据库读取。投影与当前数据库不一致时删除旧副本。memory 最多 100 条并带 TTL，只在单个进程内有效。

合同见 [数据访问与缓存工程约束](../../../docs/architecture/data-access.md)。此处不引入队列或 Worker。
