# Proposal

## Why

M0 受控试点需要实际授权额度和供应商预算。负责人需要看到可用次数，维护人员需要核对每次变更。关联 [Issue #10](https://github.com/Godyu97/geo-pro/issues/10)、T-M0-05、S-M0-05 与 D1/D2。

## What Changes

- 用独立维护权限授予、调整和撤销品牌的采样与生成额度，记录原因与不可变版本。
- 在账户设置展示本人额度及有效状态。未获授权时默认可用次数为零。
- 提供服务端逻辑单元预留、尝试费用核对及结算合同，供后续运行接入。运行受理、供应商调用、用户明细账、付款和充值属于后续任务。

## Capabilities

### New Capabilities

- `pilot-quotas` 管理试点额度、独立计数、金额上界与操作记录。

### Modified Capabilities

## Impact

涉及双库的业务表、迁移、全量 DDL、维护写入 API 和双语设置页面。复用 Better Auth、品牌归属与 B08 维护权限。
