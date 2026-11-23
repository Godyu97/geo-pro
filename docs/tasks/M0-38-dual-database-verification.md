# M0-38 核心模块双库集成验证

Issue [#38](https://github.com/Godyu97/geo-pro/issues/38)｜2026-11-20｜补齐证据、优化、内容、发布核验和复测报告在 PostgreSQL 上被跳过的集成验证，以及双方言从旧迁移升级、重复迁移和全量 DDL 对照。无 Schema 变更。隔离库中的合成行和耗时不是真实客户数据、费用或性能承诺。生产备份恢复仍由 #21 负责，真实通道和试点走查仍由 #31、#32 负责。

## 范围与关键决定

- 证据、优化、内容审批/发布核验和复测测试不再在缺少 `DATABASE_URL` 时跳过 PostgreSQL。缺少本地库时对应用例失败，避免只跑 SQLite 仍显示通过。
- 本轮使用 Compose 的 `127.0.0.1:55432`。复验时按现行 [验证边界](../architecture/database-deployment.md) 显式配置 `GEO_DUAL_DB_URL`，脚本在该实例创建并清理 `geo_b08_` 前缀的隔离库。
- 升级基线取各自 journal 的第 5 条迁移（PostgreSQL `0004_mute_manta`，SQLite `0004_glamorous_zuras`），再执行完整 `pnpm db:migrate` 两次。空库全量迁移结果与 `drizzle/ddl/postgresql.sql`、`drizzle/ddl/sqlite.sql` 的结构一致。
- 列表查询仍是每条路径 1 次 SQL。现有 owner/brand 索引在关闭 PostgreSQL 顺序扫描后都能被使用。280 条观察和 80 条快照的自然计划仍可能顺序扫描，与 [M0-35](M0-35-evidence-overview-cache.md) 对小表的判断一致，因此不新增索引。
- PostgreSQL 17 在 `ANALYZE` 后，额度汇总对 `quota_reservation` 使用 `quota_reservation_brand_recent_idx`，而不一定使用主键。断言同时接受这两条已有索引。查询仍是 1 条，品牌过滤仍走 `brand_active_owner_uidx`。

## 隔离环境

| 项 | 值 |
| --- | --- |
| PostgreSQL | Compose 项目 `geo-pro-phase0`，镜像 `postgres:17-alpine`，`127.0.0.1:55432`，库 `geo` |
| SQLite | 临时文件，外键打开 |
| 未使用 | 本机 `5432` 上的既有开发库 |

## 升级与结构对照

`pnpm test:query-plans` 实测：

| 后端 | 基线 | 基线表数 | 最新表数 | 第二次迁移 | 空库迁移 vs 全量 DDL |
| --- | --- | --- | --- | --- | --- |
| SQLite | `0004_glamorous_zuras` | 14 | 52 | 结构不变 | 一致 |
| PostgreSQL | `0004_mute_manta` | 14 | 52 | 结构不变 | 一致 |

## 代表性查询计划

合成数据：280 条观察（目标品牌 200 条官方 API、40 条消费者、另一品牌 40 条）、160 条优化任务、160 条内容计划、80 条报告快照。排序断言确认目标品牌最新一行在前，另一轨道和另一品牌不进入结果。

| 路径 | 语句数 | SQLite 自然计划 | PostgreSQL 自然计划 | PostgreSQL 关闭顺序扫描 |
| --- | --- | --- | --- | --- |
| 证据 scope 列表 | 1 | `answer_observation_owner_idx`，分析版本唯一索引，排序使用临时 B-tree | 观察表顺序扫描；最大版本使用 `answer_analysis_version_uidx` | 观察表 `answer_observation_owner_idx` 位图索引扫描 |
| 优化任务列表 | 1 | `optimization_task_owner_idx` | `optimization_task_owner_idx` 反向索引扫描 | 同自然计划 |
| 内容计划列表 | 1 | `content_plan_owner_idx` | `content_plan_owner_idx` 反向索引扫描 | 同自然计划 |
| 报告快照列表 | 1 | `report_snapshot_owner_idx` | 80 行顺序扫描 | 使用已有索引。一次为 `report_snapshot_owner_idx` 反向扫描，另一次为 `report_snapshot_operation_uidx` 位图扫描后再排序 |

四条列表在 SQLite 上合计 19.7 ms，在 PostgreSQL 上合计 196.8 ms。该计时包含计划采集，只描述这次隔离 fixture。

## 实际验证

`pnpm verify:dual-db` 在上述 Compose 库上一次跑完，退出码 0。各套件跳过数均为 0。

| 命令 | 结果 |
| --- | --- |
| `pnpm db:ddl:check` | 通过。PostgreSQL 与 SQLite 全量 DDL 均与当前 Schema 一致 |
| `pnpm test:query-plans` | 通过。4 项，跳过 0 |
| `pnpm test:maintenance` | 通过。25 项，跳过 0 |
| `pnpm test:brands` | 通过。9 项，跳过 0 |
| `pnpm test:brand-facts` | 通过。3 项，跳过 0 |
| `pnpm test:prompts` | 通过。3 项，跳过 0 |
| `pnpm test:capabilities` | 通过。3 项，跳过 0 |
| `pnpm test:quotas` | 通过。3 项，跳过 0 |
| `pnpm test:monitoring` | 通过。10 项，跳过 0 |
| `pnpm test:data-exports` | 通过。6 项，跳过 0 |
| `pnpm test:support` | 通过。3 项，跳过 0 |
| `pnpm test:evidence` | 通过。9 项，跳过 0 |
| `pnpm test:optimization` | 通过。5 项，跳过 0 |
| `pnpm test:content` | 通过。32 项，跳过 0 |
| `pnpm test:reports` | 通过。5 项，跳过 0 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm check:i18n` | 通过。1153 个消息键与插值参数在 zh-CN / en 一致 |
| `python docs/tools/validate_docs.py` | 通过。只检查链接、映射与样例，不代表业务验收 |

界面、路由和文案未改，因此未做浏览器走查。本次不勾选 M0 产品任务，也不把隔离库结果写成真实通道或试点通过。
