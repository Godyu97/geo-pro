# Proposal

## Why

负责人已有可复测优化任务与批准事实，但缺少「确认 Brief → 有事实依据的小批次草稿」路径，无法把缺口转成可审核的内容动作。Issue #27 / R-M0-09 / S-M0-09 / T-M0-09；前置 #26、#22、#10、#12、#17 已完成。

## What Changes

- 新增内容域：按问题簇覆盖视图（ContentPlan）、BriefVersion（draft/confirmed/invalidated）、小批次生成（默认 1、上限 5）、逐稿 ContentVersion（始终 draft）与事实绑定。
- 三类自写模板（事实 FAQ / 场景方案 / 可核验比较）只提供结构；缺来源或适用边界转补证，不造无据营销断言。
- 批次支持暂停/继续/终止/仅失败项重试；成功稿件与批次原记录不变；接 `generation` 额度账本与 `withEligibleFacts`。
- 未配置真实生成能力时用隔离模板填充，不发起付费模型调用。
- 工作台「内容」导航与 zh-CN/en；机器验收 AC-M0-09-1/2/3。

## Capabilities

### New Capabilities

- `content-drafts`：Brief 确认、小批次草稿生成、事实绑定与批次控制合同。

### Modified Capabilities

- （无规格级变更）`brand-facts` / `pilot-quotas` 既有钩子被内容域首次正式消费，不改其 REQUIREMENTS 文本。

## Impact

影响 `src/features/content/`、Schema/migration/DDL、导航与 i18n、`pnpm test:content`、品牌 purge 清理。不包含审核导出（#28）、发布核验（#29）或真实 LLM Provider。
