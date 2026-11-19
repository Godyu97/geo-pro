# B14 支持定位与故障恢复演练

> Issue [#14](https://github.com/Godyu97/geo-pro/issues/14)｜2026-11-19｜只交付隔离软件与手册。生产备份、真实 Redis 集群和上线恢复不在本次验收内。

## 范围与关键决定

- 具有 `support.read` 的维护者可在 `/dashboard/maintenance/support` 和 `GET /api/maintenance/support?operationId=` 按不透明操作编号定位监测运行、品牌清除和通道状态。
- 响应只含失败分类、核对状态、剩余项、恢复入口和追踪编号。不返回客户正文、附件、私人报告、通道展示名或操作说明。
- 恢复入口沿用原权限：费用核对仍由负责人在原运行执行，清除重试仍用受控 `brands:purge`，通道复核仍要 `capabilities.manage`。`support.read` 不能代为执行。
- 公开 `GET /api/health` 只返回存活状态，不包含故障详情。
- 支持投影可缓存。默认 Redis；`GEO_CACHE_DRIVER=memory` 才使用进程内缓存。Redis 未配置或不可达时回源数据库，不改用 memory。权限每次读取数据库，撤销后的下一次请求拒绝。与数据库不一致的旧副本会被删除。

## 恢复顺序

1. 用操作编号定位。记录追踪编号、失败分类、剩余项和恢复入口。不要把页面或接口响应复制到含正文的工单。
2. 费用未知时，由运行负责人在原运行核对实际金额。重复提交同一金额返回原结果；不同金额拒绝。已成功槽位不重采。
3. 清除未完成时，在受控服务器执行 `pnpm brands:purge retry <owner-id> <brand-id>`。重试从凭证中的剩余步骤开始，不删除已经清除的正文。待核对费用仍按原账本处理。
4. 通道退化时，由具有通道维护权限的账号复核该通道。支持查看权限不能改台账。
5. 数据库事务失败时停止处置并保留追踪编号。缓存不可用时以数据库结果为准，不把进程内缓存当作共享缓存。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `pnpm test:support` | 通过。SQLite 与 PostgreSQL 覆盖费用未知、清除剩余步骤、通道退化和权限拒绝；重试不执行已完成的正文删除；撤销后拒绝；响应和审计不含隔离正文。Redis 未配置或端口拒绝时回源数据库。memory 验证空值、TTL 和 100 条容量。`monitoring_run_operation_idx` 出现在双方言查询计划中。 |
| `pnpm db:ddl:check` | 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过 |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。生产构建包含 `/dashboard/maintenance/support` 与 `/api/maintenance/support` |
| 未登录页面与接口 | 通过。生产服务上 `/api/health` 只返回存活状态；支持接口按界面语言返回登录要求；支持页面回到带原路径的登录页。英文界面切换后仍保留该路径 |
| 已登录支持表单 | 未验证。当前生产服务的账号注册返回认证暂不可用 |
| 真实 Redis 服务、多实例和上线备份恢复 | 未验证。本机演练只覆盖拒绝连接后的显式受阻 |

隔离演练使用合成品牌、题集和隔离传输。结果不能当作真实采样或生产恢复完成。
