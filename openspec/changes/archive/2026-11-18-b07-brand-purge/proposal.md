# 品牌到期清除

## Why

B06 已实现冻结与恢复。M0 的 [Issue #7](https://github.com/Godyu97/geo-pro/issues/7) 要求在披露期限后清除品牌正文，并让恢复环境重新应用清除记录。

## What Changes

- 用受控服务端批次清除到期品牌，记录进度并重试剩余步骤。
- 移除正文、草稿和受影响的导出记录，保留可核对的最小费用和清除凭证。
- 提供隔离库恢复演练和后续证据、附件、报告接入合同。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `brand-deletion` 增加到期清除、最小凭证和备份重放要求。

## Impact

涉及品牌、B05 导出、B10 费用、SQLite3/PostgreSQL 迁移与全量 DDL。覆盖 S-M0-01、S-M0-12 与 T-M0-01 的本地清除合同。真实备份轮换、真实收集、外部副本、自助账户注销和通用调度均在本次范围外。
