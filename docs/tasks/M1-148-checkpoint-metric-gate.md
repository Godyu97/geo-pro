# Issue #148 检查点分指标覆盖门禁

2026-11-25。 [Issue #148](https://github.com/Godyu97/geo-pro/issues/148) · [S-M1-06 第 3 条与 AC-M1-06-1/2](../specs/M1.md#s-m1-06) · [指标与证据合同第 5 节](../07-指标与证据合同.md) · [M1 任务](M1.md#t-m1-06)

## 交付范围

- 数据库结构与双方言迁移（PostgreSQL `drizzle/0084_soft_the_santerians.sql`、SQLite `drizzle/sqlite/0083_motionless_wrecking_crew.sql` 及全量 DDL）：在 `formal_checkpoint` 末尾新增可空 `evaluation_json` 列保存检查点分指标门禁快照，保持已有检查点行不可变且不改写历史约束。
- 规则与持久化计算（`src/features/formal-retest/rules.ts`、`dao.ts`、`commands.ts`、`contracts.ts`、`actions.ts`）：
  - 未到期检查点（`checkpointDue === false`）保持 `mode = "progress"`、`conclusion = null`、`evaluation = null`。
  - 到期检查点仅按当前登录负责人、当前品牌与 `monitoring_run.prompt_set_id === observation.frozenSetId` 读取已保存非品牌槽位（`natural_question = 1` 且非探索题）、观察记录与最新分析版本；另一用户的同题集运行不参与计算，越权访问返回 `404`。
  - 按第 5 节合同核对双方总体 `E/P >= 90%`、纳入题双窗 `E_q/P_q >= 80%`、三项指标各自共同非品牌题 `>=` 冻结非品牌集 `80%`，以及双窗整体和逐题 `Jm/E`、`Jr/E`、`Jc/E` 均 `>= 80%`；同时计算引用 `C/E` 与 `Jc/C`。
  - 缺少匹配槽位或任一门槛不足均落为 `exploratory`，手填可比题数不再决定模式，已有检查点行不改写；探索题（`natural_question = 0`）不抬高或阻断非品牌门槛。
- 页面与双语文案（`src/features/formal-retest/observations-page.tsx`、`zh-CN.json`、`en.json`）：移除手填可比题数入口；在到期检查点卡片内按中英文展示模式、双方 `E/P`、提及 `Jm/E`、推荐 `Jr/E`、官网引用 `Jc/E` 与 `C/E` / `Jc/C`、缺分母或无官网 `N/A`、不足指标与原因、已匹配槽位编号以及排除题与逐题原因。

## 验证结果

- 静态、文档、多语言与 DDL：`pnpm lint`、`pnpm typecheck`、`pnpm check:i18n`（3581 键）、`pnpm test:i18n`（7 项）、`pnpm check:feature-map`、`pnpm db:ddl:check`、`python3 docs/tools/validate_docs.py`、`pnpm build` 均通过。
- 双库与领域回归：`pnpm test:continued-operations`（72 项，含新增 `issue-148.test.mjs` 5 项）、`node --conditions=react-server --test tests/formal-retest/*.test.mjs`（7 项，SQLite3 与本地 PostgreSQL 双库覆盖未到期进度、缺槽位拒绝 `formal`、跨用户隔离、23/30 推荐不足、官网引用 `C/E` / `Jc/C` 与 `Jc/E < 80%`、探索题不干扰、全达标 `formal` 且二次提交不改写原行及查询计划检查）、`pnpm test:reports`、`pnpm test:data-exports`、`tests/layout/workspace-landmark.test.mjs` 与 `workspace-location.test.mjs`（32 项）均通过。
- 隔离浏览器：`pnpm exec playwright test tests/e2e/observation-plan.spec.ts`（1 项，隔离 Chrome 覆盖 `zh-CN` / `en`、375/768/1440 视口无横向溢出、未到期进度、注入已保存不足样本后登记到期检查点保持 `exploratory` 且卡片不含 `formal`、保留槽位编号、展示 `C/E` 与 `Jc/C` 及排除题原因、读取失败恢复与跨账号 `404` 隔离）。
- 本记录使用隔离与合成样本，不勾选 `T-M1-06`。
