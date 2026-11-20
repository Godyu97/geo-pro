# M0-35 概览批量读取与读缓存

Issue [#35](https://github.com/Godyu97/geo-pro/issues/35)｜2026-11-20｜对应 R-M0-07 / S-M0-07 / T-M0-07 的读路径性能。AC-M0-07 题等权、池化与轨道隔离口径不变。无 Schema 变更。隔离 fixture 的查询次数和耗时不是真实客户延迟或优化比例。

## 范围与关键决定

- 概览先确认负责人且品牌未冻结，再按 `slotId` / `promptSetId` 分块读取采纳尝试和题型。未命中的题型仍视为 discovery。
- 聚合结果写入 `src/lib/cache/store.ts`。键包含负责人、品牌、scope、规则版本 `s-m0-07-v1` / `s-m0-06-v1` 和数据库新鲜度，不含界面 locale。值按 3500 字符分片，TTL 60 秒。
- 证据入证、分析修订、品牌更新/冻结/清除和优化任务在事务提交成功后删除已知键。新鲜度变化使删除失败也不会继续返回旧聚合。
- Redis 失败时记录 `evidence-overview-cache-unavailable` 并回源数据库，不切换到 memory。
- 不新增索引。现有 `answer_observation_owner_idx`、分析版本唯一索引和 `monitoring_attempt_adopted_uidx` 已覆盖主要过滤。PostgreSQL 在 120 行 fixture 上顺序扫描分析版本表，不为此另建索引。

## 隔离查询证据

`tests/evidence/overview-cache.test.mjs` 在升级后的 SQLite 与 PostgreSQL 上装入 30 与 120 条合成样本。120 条含 12 道 comparison，主卡样本数为 108，说明题型批量读取生效。

| 后端 | 30 条 SQL 次数 | 120 条 SQL 次数 | 缓存命中 SQL 次数 | 30 条耗时 | 120 条耗时 |
| --- | --- | --- | --- | --- | --- |
| SQLite | 6 | 7 | 1 | 21.0 ms | 9.2 ms |
| PostgreSQL | 6 | 7 | 1 | 26.2 ms | 35.9 ms |

SQLite 列表计划使用 `answer_observation_owner_idx`，槽位和最新分析走主键/唯一索引，排序使用临时 B-tree。采纳尝试走主键查找。PostgreSQL 列表计划对观察表使用 `answer_observation_owner_idx`，最大版本使用 `answer_analysis_version_uidx`，分析版本表在该 fixture 上为顺序扫描。采纳尝试使用 `monitoring_attempt_adopted_uidx`，运行表在少量行上为顺序扫描。

同一次测试还覆盖 memory 命中、TTL 过期回源、越权不读缓存、品牌隔离、分析修订、任务状态变更、100 条 memory 容量淘汰、Redis 端口不可用回源、冻结与清除后的拒绝。本机 `127.0.0.1:6379` 可用，两个 Redis 客户端在修订后不再读到旧推荐率。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:evidence` | 通过。9 项均通过，含 SQLite 与 PostgreSQL 的 AC-M0-06、AC-M0-07 和本任务缓存/批量查询用例 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm check:i18n` | 通过。1150 个消息键与插值参数在 zh-CN / en 一致 |
| `pnpm db:ddl:check` | 通过。无 Schema 变更，双方言全量 DDL 与当前 Schema 一致 |
| `pnpm build` | 通过 |
| `python docs/tools/validate_docs.py` | 通过。只检查链接、映射与样例，不代表业务验收 |

界面文案、路由和视口未改，因此未做浏览器走查。缓存键不含 locale，语言切换不会复制或串用另一套指标值。真实供应商采样与试点走查不在本次范围。
