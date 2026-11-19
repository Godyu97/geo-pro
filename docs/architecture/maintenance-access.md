# 维护身份与受控授权

> B08 / Issue #8｜2026-11-18｜本地基础边界，不代表真实维护账号已配置。

## 授权范围

普通账号默认没有维护权限。项目负责人应在受控服务器核对实名对应的独立维护账号和数据库 ID；使用独立身份，禁止共享账号。客户端角色、邮箱、名称、请求中的用户 ID 和界面可见性都不能授予权限。

| 权限 | 允许接入的后续操作 | 不包含 |
| --- | --- | --- |
| `capabilities.manage` | B09 通道能力维护 | 额度和支持权限 |
| `quotas.manage` | B10 试点额度操作 | 通道和支持权限 |
| `support.read` | B14 运行/删除等支持元信息 | 客户正文、附件、私人报告 |

可分别授予多项，单项撤销不影响其他项。维护身份没有用户冒充、客户内容批准或代发布权限。B10 通过独立维护接口校验 `quotas.manage` 并执行额度变更。 [运营输入和核对流程](../tasks/B10-pilot-quotas.md#operator-workflow)

<a id="controlled-server-commands"></a>

## 受控服务器命令

先按 [数据库部署](database-deployment.md) 明确后端、完成迁移，安全配置认证环境。服务器访问本身是授权边界；命令没有在线 HTTP/Server Action 入口。操作前由负责人核对 `GEO_OPERATOR_ID`（实际操作者账号）和 `GEO_MAINTAINER_ID`（目标独立维护账号），不要把凭据作为参数。

```bash
pnpm maintenance:access grant "$GEO_OPERATOR_ID" "$GEO_MAINTAINER_ID" capabilities.manage initial-setup
pnpm maintenance:access grant "$GEO_OPERATOR_ID" "$GEO_MAINTAINER_ID" support.read scope-change
pnpm maintenance:access revoke "$GEO_OPERATOR_ID" "$GEO_MAINTAINER_ID" capabilities.manage offboarding
```

原因只接受 `initial-setup`、`scope-change`、`access-review`、`offboarding`、`incident-response`，避免自由文本混入客户正文或凭据。操作者和目标账号均须存在。返回安全的 `status` 和 `traceId`；重复授予/撤销状态幂等，每次尝试仍留审计。失败不自动重放；未知写入结果先按追踪 ID 核对，再决定是否明确重试。

上线前需负责人实际配置独立维护账号、对应权限、服务器操作权限及审计输出采集。仓库不预置真实账号或默认超级管理员。

## 页面与直接接口

`/dashboard/maintenance` 展示本人三项当前授权、限制、刷新及返回入口，提供 zh-CN/en。已授予 `capabilities.manage` 时可进入 `/dashboard/maintenance/capabilities` 维护通道台账。普通用户看到无权限提示；服务不可用显示明确错误和追踪 ID，不冒充无权限或授权成功。 B09 写入契约见 [通道能力记录](../tasks/B09-channel-capabilities.md)。

`GET /api/maintenance/access` 返回本人的授权列表；可选 `permission` 检查单项。未知/重复参数拒绝。接口独立执行服务端会话及数据库授权校验，始终 `private, no-store`；不接收其他用户 ID 或角色。

| 结果 | HTTP |
| --- | --- |
| 有效会话且具有所需授权 | 200，仅权限和追踪 ID |
| 匿名、伪造、过期或撤销会话 | 401 |
| 普通或已撤销维护身份 | 403 |
| 非法/多余/重复输入 | 400 |
| 配置、数据库或审计不可用 | 503，安全本地化提示 |

每个新请求读取持久授权，不使用角色 Cookie 或跨请求权限缓存。撤销成功后的新动作立即拒绝；撤销与已进入事务的动作串行，不能宣称撤回此前已完成的动作。后续维护业务应使用 `runMaintenanceAction`，在同一事务内执行对应领域 DAO 和成功审计；不能在浏览器先检查后自行操作。

## 数据与审计边界

`maintenance_grant` 以用户和权限为联合主键，保留授予/撤销时间及操作者；用户外键级联。`maintenance_audit` 只追加不透明 actor/subject ID、固定 action/permission/reason/result、UTC ISO 时间和 UUID，不记录密码、令牌、请求原文或客户正文。审计无用户级联外键，避免删除账号同时抹掉操作记录；不透明 ID 仍需按实际批准政策处理，未在本项虚构具体保留期限。

关键动作/授权与成功审计同事务；失败回滚后独立记录失败。数据库整体不可用时拒绝动作，输出 `maintenance-audit-unavailable` 或命令故障的安全追踪事件，不输出异常原文。运维需采集这些服务端输出；数据库不可用期间无法声称已持久化数据库审计。

PostgreSQL 锁定相关用户行（固定批量、稳定顺序），SQLite 使用 `BEGIN IMMEDIATE` 和单连接事务队列。授权一次集合查询至多三项；主键用于用户/权限读取，`maintenance_audit_actor_time_idx` 用于受控按操作者/时间查验。SQLite 和 PG 的实际验证及 SQL 证据见 [B08 交付记录](../tasks/B08-maintenance-access.md)。未引入缓存或新依赖。
