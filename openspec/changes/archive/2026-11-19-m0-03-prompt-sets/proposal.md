# Proposal

## Why

监测和复测需要可冻结的购买问题版本。Issue #23 对应 R-M0-03、S-M0-03、T-M0-03。现有品牌建档只保存问题草稿。

## What Changes

- 提供购买问题簇、本地非品牌候选、手工与逐行粘贴，以及可继续编辑的题集草稿。
- 冻结题集版本、题型和范围，保留旧版本与引用，并输出变更题供复测排除。

## Capabilities

### New Capabilities

- `prompt-sets` 管理购买问题簇、快测题集版本和预算预览输入。

### Modified Capabilities

## Impact

涉及品牌资料双语页面、服务端接口、本人导出和 SQLite3/PostgreSQL 迁移。沿用本人会话和回环收集门禁，不增加依赖、缓存或外部候选服务。

## Out-of-Scope

40+10 正式题库、搜索量估算、周期执行、付费采样、重复次数与通道冻结、内容 Brief 的强制补齐，以及 M1/M2。
