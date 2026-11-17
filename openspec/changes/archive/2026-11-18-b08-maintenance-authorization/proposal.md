# Proposal

## Why

M0 的 B08（GitHub #8，PRD §4、R-M0-04/T-M0-04 的维护前置）需要可撤销的真实维护身份。当前只有普通账号会话，不能安全开放后续通道、额度或支持操作。

## What Changes

- 增加通道维护、试点额度、支持元信息三项默认不授予的独立服务端权限；仅受控服务器命令可授予/撤销，不提供在线提权。
- 增加持久授权和最小审计，授权变化与成功动作原子记录，拒绝和失败也可追踪；日志只接受固定动作/原因与不透明 ID。
- 提供本人维护权限页面和直接调用的权限检查接口，双语言显示授权、未授权和服务故障，不读取客户正文或附件。
- 为该用例接入 SQLite3/PostgreSQL DAO、官方 Better Auth Drizzle 双 provider 与独立迁移/全量 DDL；沿用 PostgreSQL 默认，不增加依赖或缓存。
- Out-of-Scope：B04–07、B09–14 的业务实体/操作，团队 RBAC、用户冒充、在线管理员授权、真实维护账号配置、部署和完整 M0 上线验收。

## Capabilities

### New Capabilities

- `maintenance-access`: 三项最小维护授权、受控变更、审计、本人权限提示和故障拒绝。

### Modified Capabilities

无。`account-session` 的身份、撤销和安全返回合同保持；将同一合同实测扩展到 SQLite，并将新增的现有维护页面纳入返回白名单。

## Impact

影响 `src/features/maintenance/`、私有页面/API、工作台导航、消息目录、数据库/Auth 基础设施、迁移/DDL 和本地验证工具。新增两张精简业务表，SQLite 认证表使用同版本官方 CLI 生成。不引入缓存、队列或新依赖；不接触生产库，不给真实账号自动授予权限。
