# Proposal

## Why

品牌负责人需要从设置中确认现有数据范围，下载自己可以读取的资料，并看见未涵盖或未能生成的部分。此变更交付 M0 [Issue #5](https://github.com/Godyu97/geo-pro/issues/5)，承接 PAGE-08、R-M0-01 / T-M0-01 的数据管理范围及 AC-M0-01-2 的下载归属验证。

## What Changes

- 在双语设置页预览并选择个人资料和当前品牌数据，显示最近一次生成的结果及缺失范围。
- 提供 UTF-8 JSON 附件。在线下载按当前会话、归属和已选数据重新核验，全量与部分结果明确区分。
- 两种数据库各保存本人最近一次导出的最小生成记录。真实品牌资料遵循既有开放条件，隔离验收使用合成资料。

本项的范围为本人数据。品牌删除与清除、公开交付包、报告格式以及未来事实、证据与用量等数据对象由各自任务交付。

## Capabilities

### New Capabilities

- `owned-data-export` 提供本人数据范围选择、生成结果和受保护下载。

### Modified Capabilities

## Impact

涉及设置页、下载及生成接口、品牌 DAO 只读查询，以及 SQLite3 和 PostgreSQL 的迁移与全量 DDL。复用 Better Auth 的会话核验和现有 UI 组件。
