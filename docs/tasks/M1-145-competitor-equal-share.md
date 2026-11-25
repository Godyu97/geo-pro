# Issue #145 竞品题等权份额与池化份额

2026-11-25。 [Issue #145](https://github.com/Godyu97/geo-pro/issues/145) · [S-M1-02 第 2 条与 AC-M1-02-1](../specs/M1.md#s-m1-02) · [指标与证据合同第 6 节](../07-指标与证据合同.md) · [交付记录](T-M1-02-competitor-sources.md)

## 交付范围

- `competitor_mention` 新增 `mention_state`（`true` / `false` / `unknown`，默认 `true`），保留已有记录语义并支持零提及回答与未知提及。
- `competitorShareBreakdown` 与 `shareFromMentions` 在固定竞品集当前版本内，仅对固定集全体成员提及都可判断的共同回答计算：
  - **题等权份额**：有槽位题目编号（`monitoring_slot.question_id`）时按题目编号归并重复回答，逐题计算各品牌提及次数 / 全体集合成员提及之和，再对有提及的共同题等权平均；零提及题份额为 `N/A`、保留在覆盖中、不计为 `0` 且不进入题等权分母。
  - **池化份额**：按回答统计全体集合成员提及总和并单独列出池化计次、池化分母与池化份额。
  - **缺失题目编号与未知排除**：没有槽位题目编号的回答单独列入缺失题目，不进入题等权均值；任一集合成员为 `unknown` 的回答不进入共同可判断子集，整题无共同可判断回答时保留在排除与覆盖说明中。
  - **版本与权限隔离**：竞品集换版不改变旧版本份额；另一账号请求返回 `NOT_FOUND`。无序样本排名规则保持不变。
- `/dashboard/monitoring/competitors` 在中英文界面并列显示「题等权份额 / Question-equal-weighted share」与「池化份额 / Pooled share」，展示版本号、逐题明细（题号、覆盖与排除）、缺失题目回答与未知排除回答，并将提及表单扩展为 `true` / `false` / `unknown` 三态。

## 验证结果

- 静态与契约：`pnpm lint`、`pnpm typecheck`、`pnpm check:i18n`（3534 键）、`pnpm test:i18n`（7 项）、`pnpm db:ddl:check`、`pnpm build` 均通过。
- 双库与领域回归：`pnpm test:competitors`（10 项，SQLite3 与本地 PostgreSQL 均含旧迁移升级、查询计划、`q1=1` / `q2=5`、零提及题 `N/A` 与未知排除、换版隔离与越权拒绝）、`pnpm test:continued-operations`（67 项）、`pnpm test:data-exports`（9 项）均通过。
- 隔离浏览器：`pnpm exec playwright test tests/e2e/competitors-entry.spec.ts` 在隔离 Chrome 通过（`zh-CN` / `en`、375/768/1440 视口无横向溢出、版本号、题号、题等权 `50.0%` 与池化 `16.7%` / `83.3%`、零提及题 `N/A` 与覆盖说明、未知排除、缺失题号列表及跨账号隔离）。
- 本记录使用隔离与合成样本，不勾选 `T-M1-02`。
