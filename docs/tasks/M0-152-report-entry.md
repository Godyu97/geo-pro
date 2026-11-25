# Issue #152 复测页发起同口径对比、D+7 待办与后继快照

2026-11-25。 [Issue #152](https://github.com/Godyu97/geo-pro/issues/152) · [S-M0-12](../specs/M0.md#s-m0-12) · [指标合同](../07-指标与证据合同.md) 第 5 节

品牌负责人在 `/dashboard/reports` 选择轨道、意图和前后日期。服务端只读取当前品牌、当前轨道、窗口内已保存的 `answer_observation` 及其最新分析版本。表单不接受观察编号、分子或分母。没有核验生效点时，经营闭环申请记为诊断复跑，`loop_completed = false`。D+7 没有生效点时返回 `LOOP_NOT_READY`，不创建待办，也不发起付费采样。已完成的对比可以生成不可变快照；标签纠正后从同一窗口重读证据，生成关联前版的后继快照，旧文件字节和 SHA-256 不变。

## 范围

- 新增 `src/features/reports/actions.ts` 与页面表单。对比、提醒、生成和修订都走已有 `requestRetest`、`generateReport`、`reviseReport` 与 `loadSnapshotComparisons`。
- 窗口查询按 `owner_id`、`brand_id`、`source_mode` 和 `captured_at` 限定，最多 500 条。超过或任一窗没有观察时拒绝，不截断后继续比较。
- 关联发布时只采用本人、本品牌发布记录上的 `effective_at`。未到期的 D+7 待办展示已过和剩余的完整日，`autoCharge = 0`。
- 同一复测已有仍有效快照时再次生成返回 `CONFLICT`。已取代的快照再次修订返回 `CONFLICT`。

## 本轮核验

- AC-M0-12-1。隔离样本前后各 4 道题，其中 1 道题文已修改。页面发起对比并生成快照后，提及、推荐、官网引用的共同题依次为 3、3、1。推荐为探索口径。修改题出现在排除项。快照中的推荐分子只有 0 或 1，没有调用方样本里的 50。其他品牌的观察编号不进入文件。
- AC-M0-12-2。申请经营闭环但没有生效点时，复测意图为 `diagnostic`，快照 `loop_completed` 为 false。页面显示诊断降级说明。申请 D+7 且不选择已核验发布时，页面返回 `LOOP_NOT_READY`，待办列表仍为空。
- AC-M0-12-3。保存分析版本 2 后，页面创建后继快照。推荐变化为 +100.0pp，`predecessor_id` 指向前版，前版 JSON 与 HTML 字节不变。对已取代快照再次修订返回 `CONFLICT`。
- 窗口查询在 SQLite 与 PostgreSQL 都使用 `answer_observation_owner_idx`。PostgreSQL 计划对夹具前窗返回 4 行。
- `pnpm test:reports` 19 项通过，覆盖 SQLite 与 PostgreSQL。`pnpm exec playwright test tests/e2e/report-snapshot.spec.ts` 2 项通过。浏览器在中英文和 375/768/1440 视口核对表单、诊断降级、`LOOP_NOT_READY`、排除题、后继快照和跨账号拒绝。既有下载回归的快照为 `83670d48-f1ec-440c-9ac7-acf3a5b3cd2d` → `480ce756-9862-47de-8459-7e229bf5f645`，历史快照 `f2080b24-33a2-472d-b73e-75c369946df9`。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`、`pnpm check:feature-map`、`pnpm env:check`（15 项）与 `python docs/tools/validate_docs.py` 通过。
- 已有核验生效发布时的 D+7 成功路径仍由既有 `requestRetest` 保证 `autoCharge = 0`。本轮浏览器没有已核验发布记录，因此没有在页面上点出一条到期前的完整日待办。

T-M0-12 保持未勾选。正式验收仍需要获准品牌、已核验公开发布和真实前后窗口。
