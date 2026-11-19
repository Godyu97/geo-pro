# Proposal

## Why

M0 需要把「真实可用且限制明确的通道」从口号变成可维护台账。没有独立通道 ID、验证有效期和双轨隔离，API 会冒充消费者入口，未验证或过期通道也可能被当成正式运行来源。本变更为 [Issue #9](https://github.com/Godyu97/geo-pro/issues/9) / B09，复用 [T-M0-04](docs/tasks/M0.md#t-m0-04) 与 [S-M0-04](docs/specs/M0.md#s-m0-04)，前置 B08（#8）已完成。

## What Changes

- 建立通道能力台账：稳定通道 ID、厂商分组、`consumer_ui` / `model_api` / `custom_pipeline` 分轨、不可变能力版本、验证记录、人工 SOP 与公开限制说明。
- 仅 `capabilities.manage` 可写入验证结果；默认验证有效期 30 天，显著变化立即失效；禁用后历史版本与联网证据仍可查看。
- 设置页展示用户可用范围；运行确认入口拒绝未验证/过期通道的正式运行，且不返回模拟成功。
- 保存回答联网证据时，配置联网但无触发证据则实际联网为 `unknown`，不得进入 required 联网合格分母。
- 官网仅投影允许公开的名称、范围、状态、限制和验证信息；无已核验公开记录时不宣称通道已支持。

Out-of-Scope：凭图标宣称接入、自动消费者采集、后台展示密钥/内部端点、覆盖历史能力版本、真实官方 API / 消费者入口核验、T-M0-05 运行执行与预算扣减、M1/M2。缺真实外部能力时保留软件已验证 / 外部受阻，不勾选 T-M0-04。

## Capabilities

### New Capabilities

- `channel-capabilities`：维护通道能力台账、双轨独立来源、验证有效期、正式运行门禁、联网证据口径及用户可见范围。

### Modified Capabilities

- 无。官网「无已核验通道不得宣称可监测、仅公开允许字段」已由 `public-product-entry` 约束；本变更提供台账数据源，不改该需求文本。维护授权边界已由 `maintenance-access` 的 `capabilities.manage` 覆盖。

## Impact

双方言 Schema/migration/全量 DDL、`src/features/capabilities/`、维护写入 API、设置/维护/运行确认双语页面、官网公开投影、专项 DAO 与 HTTP 验证。复用 Better Auth、B08 `runMaintenanceAction`、品牌归属与现有 i18n。不引入新依赖、缓存、队列或微服务。
