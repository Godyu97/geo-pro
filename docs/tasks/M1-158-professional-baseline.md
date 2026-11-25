# Issue #158 专业题集模板与基线未干预校验

2026-11-26。 [Issue #158](https://github.com/Godyu97/geo-pro/issues/158) · [S-M1-06](../specs/M1.md#s-m1-06) · [指标合同 §7](../07-指标与证据合同.md)

分析者或品牌负责人在监测问题页载入 40+10 专业题集，冻结前可以改题。主指标只计非品牌核心题。观察计划以生效日为品牌时区的 D0，基线是 D0 前 14 个完整日且不含 D0。窗口内已有核验生效的干预时，页面标明基线不合规，检查点不能记成正式结论，并提示重新安排生效日。本记录不勾选 T-M1-06，也不代替正式阶段复测。

## 交付范围

- 监测问题 `/dashboard/brands/[id]/questions` 可以载入本地模板 `template:professional-v1`：30 道非品牌核心题（发现、场景、约束各 10）、5 道比较题、5 道品牌事实题、10 道探索题。中英文各一套。载入替换编辑器里尚未保存的题目。比较、品牌事实和探索不进入主指标。快测仍最多 10 道未停用题；带该来源说明的专业草稿最多 60 道未停用题，题集正文最多 80 行。没有新增表。
- 观察计划 `/dashboard/reports/observations` 用最近一份冻结采样协议的时区；没有协议时用 `Asia/Shanghai`。创建和记录检查点时读取本品牌已生效的干预批次，以及 `verified_public` / `verified_manual` 且带 `effective_at` 的发布。其他品牌、未生效批次和 D0 当天不计入。污染基线仍可保存为探索观察。请求正式结论时，即使覆盖和三项门槛都达到，模式也保持探索，并写入 `baseline_intervention`。生效日不能事后改写。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发库为 PostgreSQL，邮件长期 mock 开启。 |
| 题集 | `pnpm test:prompts` 9 项通过。中英文模板均为 30/5/5/10。冻结前改一道核心题后，双方言冻结结果的主指标为 30，比较、品牌事实和探索均为非主指标。快测 11 题仍被拒绝。含品牌词的核心题不进主指标。 |
| 基线 | `node --conditions=react-server --test tests/formal-retest/*.test.mjs` 10 项通过。上海时区下 `2026-11-10T04:00:00.000Z` 的生效干预使 `effectiveOn = 2026-11-17` 的基线为 `2026-11-03`（含）至 `2026-11-17`（不含），不合规，最早可改到 `2026-11-25`。同一时点的其他品牌干预和未生效批次不计入。D0 当天的上海时间不污染；同一时刻在 `America/Los_Angeles` 落入 `2026-11-16` 并污染。已保存槽位本可形成正式检查点时，结果仍是探索，结论 kind 为 exploratory。 |
| 查询计划 | 发布查询在 SQLite 使用 `content_publication_operation_uidx` 的 `brand_id` 前缀。PostgreSQL 在本次少量干预行上顺序扫描 `intervention_batch`，过滤 `owner_id`、`brand_id` 和 `status = 'effective'`。既有索引 `intervention_batch_owner_idx` 覆盖 owner 与 brand。 |
| 回归 | `pnpm test:continued-operations` 84 项通过。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。`pnpm check:i18n` 3733 个键一致。没有 Schema 变更。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/brand-questions.spec.ts tests/e2e/observation-plan.spec.ts tests/e2e/question-entry.spec.ts` 3 项通过。中文 1440 下从页首链入专业题集，载入后分类为非品牌核心 30、比较 5、品牌事实 5、探索 10，主指标 30；改第一题后计数不变。观察计划在中英文和 375、768、1440 下显示 14 日基线窗口，以及窗口内没有已核验干预。 |

未插入一条完整内容发布链。发布与干预共用同一基线日期判定，发布查询只取已核验且有生效时间的行。T-M1-06 的客户成功计划冻结、真实观察窗口和阶段门禁不在本记录内。
