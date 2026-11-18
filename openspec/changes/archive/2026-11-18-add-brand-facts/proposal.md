# Proposal

## Why

M0 内容交付需要由品牌负责人逐条确认的可追溯事实。Issue #22 对应 R-M0-02、S-M0-02、T-M0-02，复用 B04 隔离品牌建档。

## What Changes

- 交付结构化事实、保留原文的位置化粘贴预览、候选版本、补证和撤销。
- 提供版本资格校验、依赖登记和受影响版本读取，以显式测试依赖验证交付联动。

## Capabilities

### New Capabilities

- `brand-facts` 管理事实来源、确认、复核与使用资格。

### Modified Capabilities

## Impact

涉及品牌资料双语页面、服务端接口和 SQLite3/PostgreSQL 迁移。沿用本人会话和回环收集门禁，不增加依赖或缓存。

## Out-of-Scope

真实资料开放、外部候选服务、内容生产与发布、附件库、模板及监测采样接入。
