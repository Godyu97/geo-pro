# Proposal

## Why

负责人已能批准并导出交付包（#28），但仍无法回填自行发布的 URL、区分草稿/受限页，以及记录可复查的公开或人工核验生效时间。Issue #29 / R-M0-11 / S-M0-11 / T-M0-11；前置 #28 已完成。

## What Changes

- 新增 PublicationVersion：回填 URL/账号/发布人/申报时间/渠道声明，绑定批准指纹。
- 状态机：`prepared|submitted → draft_only|pending_check|access_limited|verified_public|verified_manual|mismatch|removed`；核验历史追加；`effective_at` 仅首次通过写入。
- 隔离公开核验（fixture 页）与人工证据核验；mismatch 生成维护待办；不冒充自动发布。
- 工作台发布记录页与 zh-CN/en；机器验收 AC-M0-11-1/2/3。

## Capabilities

### New Capabilities

- `publication-verify`：人工发布回填与公开/人工核验合同。

### Modified Capabilities

- （无规格级变更）`content-approval-export` 的批准指纹被发布核验消费。

## Impact

影响 `src/features/content/`、Schema/migration/DDL、导航与 i18n、`pnpm test:content`、品牌 purge 清理。不包含自动登录外部账号、自动发布或真实外网抓取（阶段门禁）。
