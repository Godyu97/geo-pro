# Design

## Context

见 proposal.md。仓库已完成 B02，会话由 Better Auth 官方 Drizzle adapter 校验；只有 PostgreSQL 四张生成认证表。B08 前置 #2 已关闭，D3 已确定；更早的 #4–7 带 needs:decision/未完成依赖，未纳入本轮。已有 Node 原生测试、Playwright、本地 PostgreSQL，Node 24 提供内置 SQLite。

## Goals / Non-Goals

**Goals:** 用一个小型领域 DAO 承接维护授权和审计，将现有会话合同扩展到两个数据库；每个新请求读取权威授权。控制接口仅返回本人授权，可供后续真实维护动作复用事务守卫。

**Non-Goals:** 不产生通道、额度、品牌、附件或报告业务表；不假设维护者可读取客户数据。无缓存、通用 RBAC、线上授权入口或真实账号预置。

## Decisions

1. `src/features/maintenance/` 放合同、DAO、用例和 Server Component；`src/app/` 仅组合页面/Handler。入口通过 `auth.api.getSession` 确认本人，Zod 严格限制权限和查询，拒绝角色/目标账号等多余字段。`/dashboard/maintenance` 纳入精确返回白名单。
2. 两张表：`maintenance_grant` 按 `(user_id, permission)` 唯一，带授予/撤销时间、操作者，用户外键级联；`maintenance_audit` 只追加不透明 actor/subject、固定 action/permission/reason/result、UTC ISO 时间与 UUID。审计不外键级联删除，避免账号移除抹掉记录；本轮无正文，保留期限不得臆造承诺。审计只按操作者及时间查验，单个复合索引支持验证/受控运维；不开放在线审计内容浏览。
3. PostgreSQL 沿用现有驱动，SQLite 使用 `node:sqlite` + Drizzle 官方 proxy 回调，认证仍使用官方 adapter/provider 和官方 CLI 生成 Schema。`DATABASE_PROVIDER` 默认 postgresql，sqlite 需要显式 `SQLITE_PATH`，不自动切库或建表。SQLite 启用外键和有限 busy timeout；单进程串行连接防止异步事务交叉，维护事务使用 BEGIN IMMEDIATE；PG 锁定目标用户行串行同一用户的授权及动作。原生驱动避免增加第三方 native 依赖；大规模 SQLite 写入不在本切片承诺范围。
4. 维护 DAO 以参数化查询封装两种方言。检查一次集合读取至多三项授权，不逐权限串行查询；访问检查/状态读取与审计共享事务。授权变更和关键动作回调与成功审计同事务；回滚后独立追加失败记录。审计失败则动作不提交。数据库整体失败时输出固定安全字段、追踪 ID 的故障事件并返回 503，不输出原始异常。
5. 受控 CLI 要求项目负责人对应账号 ID、目标独立账号 ID、一个权限及白名单原因；OS/服务器访问是授权边界，不能通过 HTTP 调用。原因使用受控枚举，避免自由文本写入密码或客户正文。重复 grant/revoke 状态幂等，仍记录每次尝试。
6. 提供只读维护权限页与 `/api/maintenance/access`（可选单项 permission 检查），没有权限返回 403、无会话 401、无配置/故障 503，全部 no-store；不提供客户资料字段或通用对象读取。后续关键动作复用领域事务守卫，不以本次权限检查代替其业务实现。
7. PostgreSQL 和 SQLite 分别维护 Drizzle 配置、migration 和全量 DDL。现有 PostgreSQL 历史不改；新增 SQLite 四张认证表和两张维护表。离线 DDL 两者生成/检查；迁移应用只连接明确的本地/隔离库，另验证现有 PG 认证数据升级。Node 测试覆盖 DAO 两后端、SQL 次数/计划、竞争/回滚；HTTP 与浏览器覆盖真实身份、直接调用、撤销和双语言。

## Risks / Trade-offs

- [SQLite 同步驱动阻塞事件循环] → 操作规模固定且查询有限，不用于长任务；busy timeout 有界，失败拒绝。
- [数据库不可用无法写入数据库审计] → 不执行动作，输出最小安全故障事件；明确需要运维采集服务端输出。
- [受控服务器操作者可管理授权] → 要求独立实名账号映射和受控服务器权限，完整记录 operator；上线前由项目负责人配置，代码不自动赋权。
- [客户正文/附件尚未实现] → 实测现有账号隔离和维护接口字段边界，后续实体需单独完成归属验收，不能伪造不存在的接口结果。

## Migration Plan

先生成并审核双方言 migration，更新并检查双方言全量 DDL；在隔离库核对空库迁移、DDL 导入、约束与真实认证，再对本地开发 PG 做增量升级。回退应用时保留新增表和审计，避免破坏性 down migration。没有配置和迁移的环境只返回受控错误；本轮不部署、不授予真实账号权限。
