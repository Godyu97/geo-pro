# Issue #123 按品牌已用字节阻止新的资料原件

2026-11-24。 [Issue #123](https://github.com/Godyu97/geo-pro/issues/123) · [SPEC §6 数据管理](../04-产品功能规格-SPEC.md)

资料原件写入前，按品牌已配置的字节上限核对已用字节。已用字节是该品牌 `stored_object` 中 `pending` 与 `ready` 且 `deleted_at` 为空的 `byte_size` 合计。新原件加上已用字节大于上限时返回 `capacity`，不插入对象，也不把已有行改成删除。等于上限时允许。没有上限行时不套用品类上限，现有上传保持原行为。其他对象类别不走这条合计。本记录不勾选 T-M1-04，不提高单文件 10 MiB 上限，也不发送容量邮件。

## 交付范围

- 双方言表 `brand_storage_limit`：每个品牌一行，保存 `byte_limit`（1 至 2147483647）。迁移为 `drizzle/0072_salty_nehzno.sql` 与 `drizzle/sqlite/0071_careful_johnny_blaze.sql`，并已写入全量 DDL。SQLite 重建 `source_original` 时先复制旧行，再按全量 DDL 的引号建回，避免重命名改写表定义。
- 已用字节查询走 `stored_object_brand_live_idx`。上限行在 PostgreSQL 上以 `FOR UPDATE` 与插入放在同一事务。
- 资料原件上传把 `capacity` 记为失败原因，页面使用 `reasonCapacity`。失败响应不含对象键。另一用户仍得到 `NOT_FOUND`。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 结构 | `pnpm db:generate`、`pnpm db:migrate`（回环开发 PostgreSQL）、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。 |
| 隔离行为 | `node --conditions=react-server --test tests/storage/brand-capacity.test.mjs` 5 项通过。双方言都覆盖：无上限行可写入；上限 4 时两次 2 字节成功且已用字节为 4；再写 1 字节返回 `capacity`，对象行、状态、字节和摘要不变，存储写入次数不增加。同一事务里 3 字节加 3 字节只保留第一份。`failed` 行不计入已用字节。内部附件在原件已满时仍可写入。升级前插入的失败原件在迁移后仍在，且不产生上限行。 |
| 查询计划 | 合计使用 `stored_object_brand_live_idx`，上限读取使用 `brand_storage_limit_pkey` 或 `sqlite_autoindex_brand_storage_limit_1`。计划中没有 Seq Scan。 |
| 回归 | `tests/asset-reuse/source-originals.test.mjs` 4 项通过。`tests/storage/stored-object-metadata.test.mjs` 的 SQLite 结构对照与 PostgreSQL 写入通过。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过，2806 个键一致。`pnpm test:i18n` 7 项通过。 |
| 环境 | `pnpm env:check` 14 项通过。 |

## 开发库与私有桶

2026-11-24。回环开发 PostgreSQL 已迁移。临时账号和品牌的上限设为 4 字节。两份 2 字节原文写入开发私有桶并成为 `ready`，已用字节为 4。下一份 1 字节返回 `capacity`，响应不含 `v1/`。第一份原文经原件读取回到 2 字节。两个探针对象已从桶中删除，对象行、品牌行和临时账号行数均为 0。未改动其他品牌的对象。
