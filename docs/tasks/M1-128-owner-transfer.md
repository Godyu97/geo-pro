# Issue #128 负责人转移

2026-11-24。 [Issue #128](https://github.com/Godyu97/geo-pro/issues/128) · [S-M1-08](../specs/M1.md#s-m1-08)

当前负责人可以把本品牌另一名有效成员提升为负责人。提升写入审计行，目标授权角色变为 `owner`。品牌仍有其他负责人时，原负责人可以退出。只剩一名负责人时，退出和撤销继续被拒绝，该授权保持有效。不是本品牌有效成员时返回 404，不写审计，响应也不包含其他品牌的名称。本记录不勾选 T-M1-08，不改变双人审核，不发送邀请邮件，也不把代理商委托当成组织内转移。

## 交付范围

- 双方言表 `brand_owner_transfer`。字段为品牌、原负责人、新负责人、操作者和时间。原负责人与新负责人不能相同。按品牌、时间和编号索引，供审计回读。成员角色仍只使用 `brand_member_grant` 的 `owner|member`。迁移为 `drizzle/0075_material_jigsaw.sql` 与 `drizzle/sqlite/0074_brave_swarm.sql`，并已写入全量 DDL。
- 提升命令在 `src/features/team-access/`。目标必须是同一品牌未过期的有效成员。成功时把授权角色改为 `owner` 并插入一行审计。退出仍调用 `leaveWorkspace`。
- 团队设置页 `/dashboard/settings/team` 对有效成员提供中英文「提升为负责人」。只剩一名负责人时，退出按钮上方说明需要先提升。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 结构 | `pnpm db:generate` 生成上述迁移。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm db:ddl` 与 `pnpm db:ddl:check` 通过。 |
| 隔离行为 | `node --conditions=react-server --test tests/team-access/owner-transfer.test.mjs` 2 项通过。双方言都覆盖：有效成员提升后角色为 `owner` 且审计 1 行；原负责人退出成功，品牌仍有 1 名有效负责人；最后一名负责人退出失败、撤销返回 409，授权仍有效；未知授权、已撤销、已到期和另一品牌成员均为 `NOT_FOUND`，审计不增加。成功路径固定 7 条 SQL，其中 1 条插入审计。 |
| 查询计划 | 按品牌回读审计使用 `brand_owner_transfer_brand_idx`。PostgreSQL 在关闭顺序扫描后不是 `Seq Scan`。 |
| 回归 | `node --conditions=react-server --test tests/team-access/grants.test.mjs` 3 项通过。原有跨品牌导出、撤销下载和最后负责人保护仍成立。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/api/settings/team/grants/[id]/promote`。 |
| 双语 | `pnpm check:i18n` 通过，2862 个键一致。`pnpm test:i18n` 7 项通过。 |
| 开发库 | 2026-11-24。回环开发 PostgreSQL 上用两名临时负责人和各自品牌的成员核验。提升前退出原因为 `transfer_required`。提升另一品牌成员为 `NOT_FOUND`，该品牌审计 0 行。本品牌提升后角色为 `owner`，审计 1 行且原负责人、新负责人和操作者与本次操作一致。原负责人退出成功，剩余有效负责人 1 名。新负责人退出仍为 `transfer_required`，撤销为 `CONFLICT`，授权角色 `owner` 且有效。清理后临时品牌、用户和审计均为 0。未改动其他品牌。 |

页面点击、375/768/1440 视口未在浏览器中执行。当前会话没有浏览器工具。提升、退出、最后负责人保护和跨品牌 404 由双方言隔离测试与开发库命令回读覆盖。
