# Issue #129 成员邀请

2026-11-24。 [Issue #129](https://github.com/Godyu97/geo-pro/issues/129) · [S-M1-08](../specs/M1.md#s-m1-08)

负责人可以给已有用户创建一条站内成员邀请。邀请和列表只带品牌编号和固定文案键 `inviteMember`，不返回品牌名称。库里只保存令牌哈希。到期后的接受返回 409，不给受邀人新增授权。重发把旧行标为 `expired` 并写入新哈希和更晚的到期时间；旧令牌不能接受，新令牌接受后才写入 `member` 授权。本记录不勾选 T-M1-08，不调用发信函数，也不改变已有授权的撤销和双人审核。

## 交付范围

- 双方言表 `team_invitation`。字段为品牌、受邀人、创建人、角色 `member`、令牌哈希、到期时间、状态 `open|accepted|expired|revoked` 和重发占位 `replaced_by`。不保存品牌名称，不保存明文令牌。按令牌哈希唯一索引供接受查找，按受邀人和品牌加时间索引供列表。迁移为 `drizzle/0076_melted_havok.sql` 与 `drizzle/sqlite/0075_needy_wolfpack.sql`，并已写入全量 DDL。
- 创建、重发和接受命令在 `src/features/team-access/`。创建时如果负责人还只有隐式归属，会先补上本人的 `owner` 授权，避免品牌出现其他授权后负责人从访问查询中消失。受邀人的 `member` 授权只在接受成功时写入。
- `GET/POST /api/team/invitations`、`POST /api/team/invitations/[id]/resend`、`POST /api/team/invitations/[id]/accept`。团队设置页 `/dashboard/settings/team` 用中英文显示邀请状态。列表展示品牌编号和固定文案，不套用品牌名称。令牌只出现在创建或重发的当次响应里。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 结构 | `pnpm db:generate` 生成上述迁移。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm db:ddl` 与 `pnpm db:ddl:check` 通过。 |
| 隔离行为 | `node --conditions=react-server --test tests/team-access/invitations.test.mjs` 2 项通过。双方言都覆盖：创建响应和列表不含品牌名称或明文令牌；受邀人在接受前没有成员授权；非受邀人接受为 `NOT_FOUND`；到期接受为 `INVITE_EXPIRED`（409）且成员授权仍为 0；重发后旧行 `expired`，旧令牌仍被拒绝，新令牌接受后成员授权为 1。测试期间 `deliverAccountMail` 未被引用，也没有出现邮件日志或 `fetch`。 |
| 查询计划 | 按令牌哈希查找使用 `team_invitation_token_uidx`。受邀人列表使用 `team_invitation_invitee_idx`。按品牌列表使用 `team_invitation_brand_idx`。PostgreSQL 在关闭顺序扫描后不是 `Seq Scan`。 |
| 回归 | `node --conditions=react-server --test tests/team-access/grants.test.mjs tests/team-access/owner-transfer.test.mjs` 5 项通过。跨品牌导出、撤销下载、最后负责人保护和负责人提升仍成立。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/api/team/invitations`、`/api/team/invitations/[id]/resend` 和 `/api/team/invitations/[id]/accept`。 |
| 双语 | `pnpm check:i18n` 通过，2884 个键一致。`pnpm test:i18n` 7 项通过。 |
| 环境 | `pnpm env:check` 14 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件长期 Mock 为开启。 |
| 开发库 | 2026-11-24。回环开发 PostgreSQL 上用三名临时用户和一条合成品牌核验。创建后成员授权 0，响应和列表都不含合成品牌名，列表不含令牌。到期接受为 `INVITE_EXPIRED`，非受邀人为 `NOT_FOUND`。重发后旧状态为 `expired`，旧令牌仍拒绝且成员授权仍为 0。新令牌接受后有效成员授权 1，库内仍是哈希而不是明文。清理后临时品牌、用户和邀请均为 0。未改动其他品牌。 |

页面点击、375/768/1440 视口未在浏览器中执行。当前会话没有浏览器工具。邀请创建、到期拒绝、重发、旧令牌拒绝、品牌名保护和未发信由双方言隔离测试与开发库命令回读覆盖。
