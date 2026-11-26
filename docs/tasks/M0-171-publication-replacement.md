# M0 #171 发布更新与前版追溯

2026-11-26。对应 R-M0-11 / S-M0-11 / T-M0-11 和 AC-M0-11-1/2/3。 [Issue #171](https://github.com/Godyu97/geo-pro/issues/171) · [发布规格](../specs/M0.md#s-m0-11) · [指标与证据合同 §7](../07-指标与证据合同.md)

负责人在已批准稿件的发布回填表单选定前版。建议项显示账号、URL 与首次核验时间，详情页上的记录 ID 可直接粘贴。服务端以同一负责人、品牌、目标账号及 URL 的已核验记录判断可否替代。账号和 URL 使用保存值精确比较。留空时保存为独立发布。

新记录保存 `predecessor_id`，旧记录的 `superseded_by` 在新版首次核验成功时写入，与新记录的核验回执和 `effective_at` 同事务提交。并行更新同一前版时，先通过核验的一条完成替代，另一条提示重新选择。双方详情各显示证据等级、首次核验时间、批准稿件和审批 ID。迁移新增可空列，升级保留既有 `superseded_by` 和历史证据。

| 范围 | 隔离验收结果 |
| --- | --- |
| AC-M0-11-1 | 独立 URL 或账号各自回填。选定前版后，提交、草稿、受限和事实不匹配均保留前版关系和首次核验时间。跨品牌、不同目标和已被替代的前版请求受控拒绝。 |
| AC-M0-11-2 | 公开 fixture 首次成功后双向关系可回读。前版生效于 `2026-11-20T12:00:00.000Z`，新版生效于 `2026-11-20T13:00:00.000Z`，分别关联独立批准稿件。重放和再核验保留首次时间。回滚故障注入保留原状态和核验条数，两条并发核验只有一条完成替代。 |
| AC-M0-11-3 | 人工证据不完整或不匹配时前版保持原关系。人工复核通过后旧版仍为 `public`，新版为 `verified_manual` / `manual`。再次提交人工证据保留首次时间。 |

公开核验的隔离回读证据采用 ID 前八位。SQLite 旧发布/审批为 `1e987b01` / `27a1edd8`，新版为 `7c7ce00b` / `f910f036`。PostgreSQL 旧发布/审批为 `6d239666` / `61ea3f52`，新版为 `ebacfb5b` / `bbcedc91`。核验前旧版替代字段均为空。人工证据回读在 SQLite 对应 `32e9735b` → `15476b80`，审批 `4943d048`，在 PostgreSQL 对应 `5c349245` → `8c74394a`，审批 `81755283`。

- `pnpm test:content` 60 项通过、零跳过，覆盖双方言升迁、历史记录、前版归属、核验与全量 DDL 对照。`pnpm test:reports` 34 项通过，`pnpm test:brand-facts` 10 项通过。
- `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。`pnpm db:migrate` 在双方言隔离库内通过。`pnpm verify:maintenance` 通过，并在双方言隔离库运行 `pnpm verify:auth`。
- `pnpm test:e2e tests/e2e/content-publication.spec.ts` 在 PostgreSQL 和 SQLite 隔离库各通过 1 项。覆盖 `zh-CN` / `en`、375/768/1440 视口、键盘提交和双向追溯、长 URL 换行、非归属拒绝及读取失败恢复。首次运行发现 SQLite 测试账号清理触发外键限制，改用品牌内容的既有清理顺序后双方言重跑通过。窄屏截图留在本地 `.cache/issue-171/content-publication/`。
- `pnpm env:check` 15 项通过。`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`、`pnpm test:i18n`、`python docs/tools/validate_docs.py` 与 `git diff --check` 通过。
- 1,200 条合成发布的隔离查询使用 `EXPLAIN QUERY PLAN` 与 `EXPLAIN (ANALYZE, COSTS OFF)` 核对。候选列表每次一条查询，最多 30 条，双方言均使用 `content_publication_owner_idx`。前版的定位和写入按发布主键，固定审批按现有索引定位。候选单次往返在本地分别约为 SQLite 0.08 ms、PostgreSQL 0.64 ms。新增读写次数与候选数量无关。

浏览器经 API 回读时，提交后的新版为 `submitted` 且生效时间为空，登录墙检查后为 `access_limited`。人工核验完成后旧版关联新版，旧版的 `public` 等级和首次生效时间保留，新版为 `manual`。下表采用 ID 前八位，时间为 UTC。

| 隔离库 | 旧发布 ID / 首次生效 | 新发布 ID / 首次生效 | 审批 ID |
| --- | --- | --- | --- |
| PostgreSQL | `abddbcf3` / `03:10:29.112Z` | `90d57ba6` / `03:10:29.718Z` | `44124bd1` |
| SQLite | `4a397b0c` / `03:10:45.485Z` | `d78de062` / `03:10:46.120Z` | `fb2df9cb` |

阶段核验另由获准真实站点的 M0 试点记录，本轮以隔离合成页完成 #171 软件验收。 [#32](https://github.com/Godyu97/geo-pro/issues/32)
