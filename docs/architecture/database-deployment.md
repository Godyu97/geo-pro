# 全量 DDL 维护与数据库部署

> 2026-11-18｜支持 PostgreSQL / SQLite3；当前范围为认证和 B08 维护授权。

## 权威来源与产物

Drizzle Schema 是目标结构来源，按顺序审核过的 migration 是应用部署和升级记录。两种后端各有四张 Better Auth 生成表、`maintenance_grant` 与 `maintenance_audit` 两张维护表。

| 后端 | Schema 配置 | 迁移 | 全量 DDL |
| --- | --- | --- | --- |
| PostgreSQL | `drizzle.config.ts` | `drizzle/*.sql`、`drizzle/meta/` | `drizzle/ddl/postgresql.sql` |
| SQLite3 | `drizzle.sqlite.config.ts` | `drizzle/sqlite/*.sql`、`drizzle/sqlite/meta/` | `drizzle/ddl/sqlite.sql` |

两份 DDL 均由 `pnpm db:ddl` 生成，覆盖当前全部应用表、约束和索引，不含客户数据、密钥或迁移历史表。认证表来自同版本官方 CLI，不手改生成表。

全量 DDL 不手改。`scripts/export-ddl.mjs` 调用已安装的 Drizzle Kit，复用双方言配置离线导出，不连接数据库或执行迁移；某方言生成失败不覆盖其原文件。`db:ddl:check` 只比较，不改写文件。新增 Schema 须先纳入各自配置。

## 每次 Schema 变更的维护闭环

1. 修改真实 Schema；涉及认证时，通过 `pnpm db:auth-schema` 从共享认证选项生成两套官方 Schema。
2. 执行 `pnpm db:generate` 生成双方言，分别审核新增表、约束、索引与数据迁移，不覆盖历史 migration。
3. 执行 `pnpm db:ddl`，随同该次 Schema/migration 更新全量 DDL；执行 `pnpm db:ddl:check`，确认产物未过期。没有结构变更不制造无意义迁移。
4. 在明确的开发或隔离目标库分别执行 `pnpm db:migrate`；该命令只迁移显式选择的后端。核验升级与空库部署；认证/Schema 变更执行适用门禁。
5. 在交付中记录 Schema、migration、全量 DDL 与实际验证结果；三者不一致不能宣称数据库部署材料完整。

SQLite3 已提供独立生成、迁移、全量 DDL 与对照测试，不共用 PostgreSQL SQL。表精简和索引要求继续遵循 [数据访问与缓存工程约束](data-access.md)。

## 项目数据库快速部署

正常运行 GeoPro 的新数据库和已有数据库，统一使用已审核的 migration 初始化/升级，这条路径同时维护 Drizzle 历史，后续可以继续增量迁移：

```bash
# PostgreSQL 为默认；先安全配置目标开发环境 DATABASE_URL。
pnpm db:migrate

# SQLite 必须显式选择；文件父目录须存在，迁移命令可创建新文件。
DATABASE_PROVIDER=sqlite SQLITE_PATH=/absolute/path/geo-pro-dev.sqlite pnpm db:migrate
```

本地没有开发库时可使用仓库已有的可选 Compose：

```bash
docker compose -p geo-pro-phase0 up -d
pnpm db:migrate
```

部署使用已经纳入版本控制的 migration 与 DDL，不在目标环境临时生成结构，不用 `push` 替代迁移。上述命令是操作说明，不表示本次已改动任何现有数据库。

运行时的 `DATABASE_PROVIDER` 只接受 `postgresql` / `sqlite`；SQLite 使用 `SQLITE_PATH`，不读取 `DATABASE_URL`。两者共享现有 Auth URL/Secret 配置。SQLite 使用 Node 24 内置驱动、启用外键和 3 秒 busy timeout；文件不存在时运行请求失败，不自动建库。SQLite 迁移使用 Drizzle journal/parser/checksum，在一个 `BEGIN IMMEDIATE` 事务中创建/升级并记录历史，已有历史校验和不匹配时拒绝执行。应用不会在连接失败时切库。

## 单独导入全量 DDL 的适用范围

DBA 审核、独立集成或隔离环境可直接用全量文件创建空库中的应用结构。例如使用已经安全配置连接参数的 `psql`：

```bash
psql -X -v ON_ERROR_STOP=1 --single-transaction -f drizzle/ddl/postgresql.sql
```

这条路径要求目标应用 Schema 为空；失败整批回滚，不用 `IF NOT EXISTS` 掩盖已有结构差异。它不写 Drizzle 迁移历史，因此导入后不能直接再执行完整的 `pnpm db:migrate`。需要持续由项目管理的数据库应从一开始使用上一节的迁移路径；已有直接导入库须先单独核对结构并制定迁移基线方案，不能靠伪造已执行记录跳过迁移。

SQLite 的全量文件同样只用于空库结构导入，并须在启用外键的显式事务中整批执行；它同样不建立迁移历史。常规 SQLite 开发库直接使用上方 `db:migrate` 命令。

## 验证边界

`pnpm db:ddl:check` 只证明两份文件与 Schema 一致。`pnpm test:maintenance` 在临时 SQLite 文件及随机本地 PostgreSQL 隔离库中对照全量导入和 migration 的列/约束/索引，并覆盖 PG 旧认证数据升级、SQLite 外键与迁移校验和。PostgreSQL 测试角色需要本地创建/删除隔离库权限；只清理本轮随机库。

`pnpm verify:maintenance` 需要先构建，使用独立 3103 端口和上述隔离库，对两个后端运行真实 HTTP、受控 CLI 和 `pnpm verify:auth`。浏览器入口仍为 `pnpm test:e2e`（本地 PostgreSQL、3100 端口）。这些结果仅覆盖认证与维护授权，具体证据见 [B08 记录](../tasks/B08-maintenance-access.md)，不代表未来业务实体或完整 M0 验收。
