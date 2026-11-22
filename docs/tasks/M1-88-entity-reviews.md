# M1-88 人工复核样本与抽样错误率

Issue [#88](https://github.com/Godyu97/geo-pro/issues/88)｜2026-11-22｜对应 R-M1-03 / S-M1-03 的 AC-M1-03-2。软件验收使用隔离库里的复核夹具。不勾选 T-M1-03，不把夹具当成真实品牌样本。

## 范围与关键决定

- 新增双库表 `entity_review`：品牌、负责人、观察、分析版本、是否计入复核、是否确认错误、事实状态、抽样方法、总体条数和创建时间。
- 复核只追加。同一观察和分析版本的当前结果取创建时间最新的一行；唯一约束带上创建时间，因此更正可以新增一行，旧行保持不变。
- 总体条数写在每条追加记录上。看板从全表一次读出后，只用最新一条的总体条数，不逐条 `COUNT`，也不保存或返回总体错误率。
- 确认错误必须是人工 `confirmed`。过期或冲突事实即使带上确认标记也会被拒绝，表不增加。`reviewClaim` 的 `autoError` 不会写入分子。
- 确认数大于复核数、或复核数大于总体条数时，请求返回 400，不插入。
- 页面 `/dashboard/brands/[id]/entity-reviews` 与 `GET`/`POST /api/brands/[id]/entity-reviews` 只展示 `2/10` 和覆盖 `10/50`。复核数为 0 时标签为样本不足。非负责人得到 404，响应里没有复核 ID。

## 修改入口

- `src/lib/db/entity-review-schema.ts` 与 SQLite 对照、双方言迁移和全量 DDL
- `src/features/entity-accuracy/` 的契约、DAO、命令、API 与双语页面
- 品牌页入口、品牌清除时删除 `entity_review`、登录回跳允许该路径

## 实际验证

隔离复核明确标为 fixture，不是真实监测样本或总体错误率。

| 命令 | 结果 |
| --- | --- |
| `pnpm db:ddl` 与 `pnpm db:ddl:check` | 通过。PostgreSQL 与 SQLite 全量 DDL 与当前 Schema 一致 |
| `node --conditions=react-server --test tests/entity-accuracy/*.test.mjs` | 通过。3 项无跳过。夹具为 2/10、覆盖 10/50，`populationRate` 为 null；复核数改为 0 后标签为 `insufficient` 且响应无百分号；确认数大于复核数、过期或冲突事实被标为确认错误时不插入；另一用户写入与读取均为 `NOT_FOUND`，响应不含复核 ID；更正新增一行且旧行不变 |
| `pnpm lint` | 通过。仅既有 `tests/competitors/briefs.test.mjs` 未使用变量警告，非本次改动 |
| `pnpm typecheck` | 通过 |
| `pnpm check:i18n` 与 `pnpm test:i18n` | 通过。1503 个消息键与插值参数一致；登录回跳接受品牌复核页 |
| `pnpm build` | 通过。已生成 `/dashboard/brands/[id]/entity-reviews` 与 `/api/brands/[id]/entity-reviews` |
| `node --conditions=react-server --test tests/brands/purge.test.mjs` | 通过。SQLite 与 PostgreSQL 各 1 项 |
| `python3 docs/tools/validate_docs.py` | 通过。26 项需求、29 项任务、81 个验收 ID；未运行应用行为或外部通道 |

本轮没有在浏览器里登录并提交复核表单。页面渲染的是上述看板字段。
