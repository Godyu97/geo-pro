# 品牌删除、冻结与恢复

## Why

M0 的品牌负责人需要在确认删除前了解影响，在确认后停止普通访问，并在到期前验证身份后恢复。本变更实现 Issue #6，复用 T-M0-01、S-M0-01、AC-M0-01-2 和公共 SPEC §6。

## What Changes

- 提供双语删除影响预览、显式确认、受限恢复入口和 30 天默认恢复期限。
- 冻结立即覆盖品牌、历史版本、草稿下载、旧导出和新额度动作，保留既有费用核对。
- 受控服务端可记录已另行核验的提前处理期限。B07 负责到期后物理清除及备份，B17 负责邮箱验证流程。

## Capabilities

### New Capabilities

- `brand-deletion` 提供影响确认、冻结和限期恢复。

### Modified Capabilities

- `brand-onboarding` 冻结品牌退出普通读写及活跃品牌选择。
- `owned-data-export` 冻结撤销关联旧下载权限。
- `pilot-quotas` 冻结拒绝新额度动作并保留在途费用核对。

## Impact

涉及品牌页面和 API、导出和试点额度 DAO 的访问边界，以及 PostgreSQL / SQLite3 迁移。复用 Better Auth 权威会话，沿用回环合成资料验收入口。无需新增依赖或业务缓存。
