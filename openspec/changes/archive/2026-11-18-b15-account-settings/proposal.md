# Proposal

## Why

工作台已有账号会话，但用户没有可编辑的个人资料页，也没有统一入口了解账号安全和数据管理能力。M0 可选增强 [B15](https://github.com/Godyu97/geo-pro/issues/15) 按 D6 和 PRD PAGE-08 补齐这一入口。

## What Changes

- 工作台增加受保护的账户设置页，显示只读登录邮箱，允许本人编辑称呼，并提供界面语言、登录安全及数据管理入口。
- 沿用注册的称呼校验，去除首尾空白后接受 1–80 个 Unicode 字符。Better Auth 的资料更新入口收窄为仅接收称呼，按当前服务端会话写入。
- 中英文覆盖设置、加载、校验、保存失败、重新登录和当前数据管理状态。保存成功后刷新工作台的称呼。
- 本次范围排除邮箱修改、头像、额外身份字段、公开资料、密码找回、邮箱验证及数据导出或删除的实现。

## Capabilities

### New Capabilities

- `account-settings` 提供本人资料更新、账户设置入口和可核验的双语言状态。

### Modified Capabilities

无。现有会话授权及恢复合同适用于新增设置页。

## Impact

新增工作台设置路由及账户功能组件，复用 Better Auth 的更新接口与 PostgreSQL、SQLite3 适配器。数据库结构、迁移和现有界面语言 Cookie 可直接复用。涉及认证写入与双语言验收，沿用现有 HTTP 验证和 Playwright。
