# Proposal

## Why

负责人已有待审草稿（#27），但缺少逐稿显式批准与可核验单渠道交付包，无法把内容动作推进到可发布交付。Issue #28 / R-M0-10 / S-M0-10 / T-M0-10；前置 #27 已完成。

## What Changes

- 扩展 ContentVersion 状态机：`draft → in_review → approved|rejected → invalidated`；标题/正文/图片/事实版本/渠道/标识任一变更使批准失效。
- 新增 Approval 记录（显式自审）、可选授权图片资产、不可变交付包（正式/审阅）与批量导出作业（预检 + 显式合格子集）。
- 正式包仅含允许公开的内容、来源与授权公开图；禁止内部附件、凭证与跨品牌内容；HTML 净化不执行脚本。
- 标识 profile 未核实仅可导出带「非发布用」标记的审阅稿；导出成功不等于公开发布。
- 工作台「稿件详情/审核/导出」、zh-CN/en；机器验收 AC-M0-10-1/2/3。

## Capabilities

### New Capabilities

- `content-approval-export`：逐稿审核、批准失效、单渠道交付包与批量导出预检合同。

### Modified Capabilities

- `content-drafts`：放宽 ContentVersion 仅 `draft` 的限制说明，允许后续审核状态（草稿生成行为不变，仍不自动批准）。

## Impact

影响 `src/features/content/`、Schema/migration/DDL、导航与 i18n、`pnpm test:content`、品牌 purge 清理。不包含发布回填核验（#29）、多渠道变体、自动发布或去标识工具。
