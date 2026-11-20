# Design

## Context

#24 已提供不可变 Observation、Citation 与 AnalysisVersion。S-M0-07 / 指标合同要求：主卡为非品牌题题等权，池化单独标明；API/消费者轨与联网条件不得平均；无有效样本显示 N/A 与下一步，不得伪造分数。

## Goals / Non-Goals

- Goals：纯函数指标聚合、DAO 范围查询、概览命令、总览/回答列表 UI、AC-M0-07-1/2 金样与轨道隔离测试、双语文案、任务入口空态。
- Non-Goals：综合 GEO 分、跨轨平均、优化任务生成、报告快照、真实供应商采样、演示数字注入真实空间。

## Decisions

1. **无新表**：在现有 evidence 表上按 scope 批量读取；最新分析取 max(version)。
2. **样本行**：每条有效 Observation + 最新分析组成 Sample；`questionKey` 优先 slot→question_id，否则规范化 questionText；`questionType` 经 slot/prompt 解析，缺省时 fixture 可显式传入。
3. **主卡范围**：仅 `discovery|scenario|constraint`（primaryTypes）；comparison/brand_fact/exploration 排除出主卡但可在明细列出。
4. **题等权**：逐题比率算术平均；缺数题不按 0。池化 = Σnum/Σden，单独标记 `pooled`。
5. **官网引用**：无登记官网整项 `not_applicable`；仅 citation complete 计入 C/Jc。
6. **轨道隔离**：scope.sourceMode 必选或默认单轨；禁止一次查询混合 model_api 与 consumer_ui。
7. **任务入口**：optimization 未交付时返回 `suggestions: []` 与 `nextActions`（补采/查看证据），最多预留 3 槽。
8. **演示隔离**：overview 命令不注入合成 KPI；测试 fixture 仅在测试库。

## Risks / Trade-offs

- 人工入证缺 question_id 时按文本聚合，同文不同题可能合并——验收 fixture 使用稳定 questionKey。
- 未配置官网时官网引用为不适用，避免误显示 0%。

## Migration Plan

无 Schema 变更。验证：`pnpm test:evidence`、`pnpm check:i18n`、`pnpm typecheck`、`pnpm lint`、`pnpm build`。

## Open Questions

无；优化任务真实建议留给 #26。
