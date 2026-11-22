# M1-89 同名消歧修订与纠错效果状态

Issue [#89](https://github.com/Godyu97/geo-pro/issues/89)｜2026-11-22｜对应 R-M1-03 / S-M1-03 的 AC-M1-03-1、AC-M1-03-3。软件验收使用隔离库里的同名夹具。不勾选 T-M1-03，不把夹具当成真实品牌样本或真实复测。

## 范围与关键决定

- 新增双库表 `entity_disambiguation` 与 `entity_correction`。消歧保存观察、旧分析版本、新分析版本和 `count_as_target_mention`。纠错把动作 `open|actioned` 与效果 `open|pending_retest|unresolved` 分列保存。
- 确认混淆时调用 `sameNameConfusion`。只有表面同名且人工确认是另一实体，才把旧分析标成 `revised` 并追加新版本。这与证据修订一样只改状态、不改提及值，也不改回答原文或 `report_snapshot`。新版本的提及为 false，消歧行的 `count_as_target_mention` 固定为 0。
- 只勾选同名、未确认不同实体时返回 400，分析版本数不变。非负责人返回 404。请求里不能带模型确认字段代替人工勾选。
- 纠错调用 `correctionStatus`。动作完成且复测仍错误时两列是 `actioned` 与 `unresolved`。客户端不能提交 `resolved`。后续再记一行不会改写旧行。
- 页面 `/dashboard/brands/[id]/entity-corrections` 与 `POST /api/brands/[id]/entity-disambiguations`、`POST /api/brands/[id]/entity-corrections` 把动作和效果分成两列。品牌清除会删掉这两张表。分析版本追加后失效该品牌的证据概览缓存。

## 修改入口

- `src/lib/db/entity-revision-schema.ts` 与 SQLite 对照、双方言迁移和全量 DDL
- `src/features/entity-accuracy/` 的契约、DAO、命令、API 与双语页面
- 品牌页入口、品牌清除、登录回跳允许该路径

## 实际验证

隔离观察明确标为夹具，不是真实监测样本。

| 命令 | 结果 |
| --- | --- |
| `pnpm db:ddl` 与 `pnpm db:ddl:check` | 通过。PostgreSQL 与 SQLite 全量 DDL 与当前 Schema 一致 |
| `node --conditions=react-server --test tests/entity-accuracy/*.test.mjs` | 通过。6 项无跳过。确认另一实体后旧版本仍可按 ID 读到且提及值仍为 true，新版本提及为 false，消歧行 `count_as_target_mention` 为 0；只勾选同名、未确认不同实体或分析版本不匹配时不插入，版本数不变；非负责人写入为 `NOT_FOUND` 且响应不含观察 ID；动作完成且复测仍错误时两列为 `actioned` 与 `unresolved`，再追加等待复测的一行不改旧行；检查约束拒绝把提及记成 1、把效果写成 resolved，以及动作已完成配效果未开始 |
| `pnpm lint` | 通过。仅既有 `tests/competitors/briefs.test.mjs` 未使用变量警告，非本次改动 |
| `pnpm typecheck` | 通过 |
| `pnpm check:i18n` 与 `pnpm test:i18n` | 通过。1538 个消息键与插值参数一致；登录回跳接受品牌纠错页 |
| `pnpm build` | 通过。已生成 `/dashboard/brands/[id]/entity-corrections`、`/api/brands/[id]/entity-disambiguations` 与 `/api/brands/[id]/entity-corrections` |
| `node --conditions=react-server --test tests/brands/purge.test.mjs` | 通过。SQLite 与 PostgreSQL 各 1 项 |
| `python3 docs/tools/validate_docs.py` | 通过。26 项需求、29 项任务、81 个验收 ID；未运行应用行为或外部通道 |

本轮没有在浏览器里登录并提交消歧或纠错表单。页面分别渲染动作状态和效果状态。
