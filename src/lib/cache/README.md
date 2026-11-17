# cache

缓存扩展位置，当前尚无实现。已确认后续通过统一服务端入口适配 memory 与 Redis，默认 Redis；memory 需显式选择，仅在单进程内有效。

合同、TTL、容量、品牌/版本隔离、写后失效与故障行为见 [数据访问与缓存工程约束](../../../docs/architecture/data-access.md)。依具体用例落地，不因缓存选型引入队列或 Worker。
