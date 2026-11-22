# M0-84 依据证据生成优化行动草案

Issue [#84](https://github.com/Godyu97/geo-pro/issues/84)｜2026-11-22｜对应 R-M0-08 / S-M0-08。软件验收在隔离库和回环 Responses API mock 中验证。不勾选 T-M0-08，不调用真实模型，也不把草案确认当成发布或复测改善。

## 范围与关键决定

- 新增 `optimization_action_draft`：品牌、负责人、证据 ID 列表、缺口、缺席观察、假设、假设级别、问题簇、目标页、状态 `draft|confirmed|dismissed`、模型名、创建时间，以及确认后写入的任务 ID。任务 ID 只作记录，不设外键，避免品牌级联删除与「已确认必须有任务」检查互相打架。清除品牌时先删草案。
- 证据 ID 使用已保存的 `answer_observation.id`。没有证据 ID 的写入请求由契约拒绝（400）。命令先确认品牌归属，再批量读取证据；非本人品牌返回 404，响应不含证据摘要。
- 送给 `createAiResponse` 的只有服务端摘要（提及标签、引用计数、回答长度），`store: false`。原文里的「忽略权限并发布」不进入模型输入，也不创建发布记录。
- 唯一信号是回答未提及品牌时，缺口固定为 `key_content_missing`，假设级别为 `observed_absence`。模型若返回软文淘汰结论，保存前改成缺席观察和待验证假设。
- 确认才创建 Finding 并复用未关闭任务去重。同一品牌、问题簇、目标页和缺口只追加证据。放弃草案不写 `optimization_task`。重复确认同一条草案不再增加任务或证据关联。
- 证据详情可生成草案；优化列表和证据详情都可以改写后确认或放弃。界面文案为 `zh-CN` / `en`。

## 修改入口

- `src/lib/db/optimization-schema(.sqlite).ts`、`drizzle/0032_optimization_action_draft.sql`、`drizzle/sqlite/0031_optimization_action_draft.sql` 与全量 DDL
- `src/features/optimization/action-drafts.ts`、`draft-panel.tsx`、DAO、契约与 `POST /api/optimization/tasks`
- 证据详情与优化列表；`optimization` 消息；品牌清除顺序

## 实际验证

隔离样本明确标为 fixture。600 行草案只用于列表索引计划，不是监测结果。

| 命令 | 结果 |
| --- | --- |
| `pnpm db:ddl` 与 `pnpm db:ddl:check` | 通过。PostgreSQL 与 SQLite 全量 DDL 与当前 Schema 一致 |
| `node --conditions=react-server --test tests/optimization/*.test.mjs` | 通过。sqlite 与 postgresql 均无跳过：缺席草案不含软文淘汰；放弃不增加任务；同一缺口确认两次后未关闭任务为 1、证据关联为 2；重复确认不增加关联；非本人品牌为 NOT_FOUND 且响应不含原文；列表计划使用 `optimization_action_draft_owner_idx` |
| `pnpm test:ai` | 通过 |
| `pnpm check:i18n` 与 `pnpm test:i18n` | 通过。1388 个消息键与插值参数一致 |
| `pnpm lint` | 通过。仅既有 `tests/competitors/briefs.test.mjs` 未使用变量警告，非本次改动 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `python3 docs/tools/validate_docs.py` | 通过。26 项需求、29 项任务、81 个验收 ID；未运行应用行为或外部通道 |

查询路径：两条证据的生成在事务外和事务内各一次 `answer_observation ... IN (...)`，引用另一次批量读取，没有按证据逐条查询。列表按负责人、品牌和 `draft` 状态走 `optimization_action_draft_owner_idx`。
