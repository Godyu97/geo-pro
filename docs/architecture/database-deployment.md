# 全量 DDL 维护与数据库部署

> 2026-11-17｜当前支持 PostgreSQL；SQLite3 DDL 随对应 Schema 与迁移适配交付。

## 权威来源与产物

Drizzle Schema 是目标结构来源，`drizzle/` 中按顺序审核过的 migration 是应用部署和升级记录。PostgreSQL 全量 DDL 位于 `drizzle/ddl/postgresql.sql`，由 `pnpm db:ddl` 生成；内容覆盖当前全部应用表、主键、唯一约束、外键与索引，不含客户数据、密钥或 Drizzle 迁移历史表。当前只有四张 Better Auth 表，没有业务表。

全量 DDL 是生成产物，不手改。`scripts/export-ddl.mjs` 调用已安装的 Drizzle Kit，复用 `drizzle.config.ts` 的 Schema 范围导出，不连接数据库、不执行迁移；生成失败不覆盖原文件。`db:ddl:check` 只比较，不改写文件。当前命令仅为 PostgreSQL 配置；新增业务 Schema 时先纳入 Drizzle 配置，不能只修改 DDL 快照。

## 每次 Schema 变更的维护闭环

1. 修改真实 Schema；涉及认证时，先修改共享认证选项并通过 `pnpm db:auth-schema` 走官方生成链。
2. 执行 `pnpm db:generate`，审核新增表、约束、索引与数据迁移，不覆盖已经应用过的历史 migration。
3. 执行 `pnpm db:ddl`，随同该次 Schema/migration 更新全量 DDL；执行 `pnpm db:ddl:check`，确认产物未过期。没有结构变更不制造无意义迁移。
4. 在明确的开发或隔离目标库执行 `pnpm db:migrate`，核验升级与空库部署；认证/Schema 变更按适用门禁验证认证行为。
5. 在交付中记录 Schema、migration、全量 DDL 与实际验证结果；三者不一致不能宣称数据库部署材料完整。

SQLite3 实施后须交付独立的全量 DDL、迁移目录、生成/检查入口与空库部署验证；不得将 PostgreSQL DDL 改名作为 SQLite 产物。表精简和索引要求仍遵循 [数据访问与缓存工程约束](data-access.md)。

## 项目数据库快速部署

正常运行 GeoPro 的新数据库和已有数据库，统一使用已审核的 migration 初始化/升级，这条路径同时维护 Drizzle 历史，后续可以继续增量迁移：

```bash
# 先明确配置目标开发/部署环境的 DATABASE_URL；不要在日志中输出连接串。
pnpm db:migrate
```

本地没有开发库时可使用仓库已有的可选 Compose：

```bash
docker compose -p geo-pro-phase0 up -d
pnpm db:migrate
```

部署使用已经纳入版本控制的 migration 与 DDL，不在目标环境临时生成结构，不用 `push` 替代迁移。上述命令是操作说明，不表示本次已改动任何现有数据库。

## 单独导入全量 DDL 的适用范围

DBA 审核、独立集成或隔离环境可直接用全量文件创建空库中的应用结构。例如使用已经安全配置连接参数的 `psql`：

```bash
psql -X -v ON_ERROR_STOP=1 --single-transaction -f drizzle/ddl/postgresql.sql
```

这条路径要求目标应用 Schema 为空；失败整批回滚，不用 `IF NOT EXISTS` 掩盖已有结构差异。它不写 Drizzle 迁移历史，因此导入后不能直接再执行完整的 `pnpm db:migrate`。需要持续由项目管理的数据库应从一开始使用上一节的迁移路径；已有直接导入库须先单独核对结构并制定迁移基线方案，不能靠伪造已执行记录跳过迁移。

## 验证边界

`pnpm db:ddl:check` 只证明文件与当前 Schema 的导出结果一致，不证明历史 migration 能到达该结构。Schema 变更还需分别验证空库迁移、已有数据升级、约束和索引；全量导入可在独立空库中执行并与迁移结果对照。未运行的环境和 SQLite 路径必须标明，不能把导出成功当作双数据库部署验收。
