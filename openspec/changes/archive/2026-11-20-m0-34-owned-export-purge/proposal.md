# Proposal

## Why

M0 的事实、监测证据、内容、报告和用量已经落地，但本人导出仍把这些范围标为 `unavailable`，负责人无法取回自己的业务数据。含优化任务的品牌在到期清除时会因 `optimization_task_finding_fk` 的 `ON DELETE RESTRICT` 失败，清除无法幂等完成。

## What Changes

- 将已交付的五个 M0 业务域纳入本人导出的可选范围、范围位图、设置页双语预览和下载 JSON。单域失败或超限记为 `partial`/`failed`，不再把已交付域列入 `unavailable`。
- 导出只读取本人未冻结品牌，按页批量查询；排除内部附件、维护审计和其他账号数据。下载前继续复核会话、归属和指纹。
- 按外键安全顺序清除优化任务、页面检查及尚未显式覆盖的 M0 业务正文，保留最小费用凭证，并让清除前包含这些品牌数据的旧导出失效。
- 扩大 `user_data_export` 的范围位图检查，并同步双方言迁移与全量 DDL。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `owned-data-export`: 已交付 M0 业务域可预览、选择并导出；失败隔离、归属和内部附件边界随之更新。
- `brand-deletion`: 到期清除覆盖优化任务与页面检查等 M0 正文，并在外键约束下保持幂等。

## Impact

- 范围：M0 / R-M0-01 的 AC-M0-01-2 与 B07 清除合同。依据 Issue #34。不开放 #21 的正式试点，不接入 #31 的真实通道，不实现账户注销或跨账号共享导出。
- 代码：`src/features/data-exports/`、`src/features/brands/purge-dao.ts`、设置页文案、导出与清除测试。
- 数据：双方言 `user_data_export` 检查约束。不新增依赖，不引入缓存作为唯一状态。
