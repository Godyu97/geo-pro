# Proposal

## Why

负责人已完成证据概览（#25）、发布核验生效点（#29）与清除合同（#7），但仍无法按同口径发起探索复测 / D+7 站内待办，并下载不可变、可复算的 HTML/JSON 报告快照。Issue #30 / R-M0-12 / S-M0-12 / T-M0-12。

## What Changes

- 新增 Retest：立即探索、D+7 站内待办（不自动付费）、无发布核验时的诊断复跑。
- 新增 Comparison：按题版本/通道/轨道/协议/分析语义匹配共同题，排除变更题，题等权重算与探索 pp。
- 新增不可变 ReportSnapshot：同源 HTML/JSON；纠错生成 successor，原字节不变；来源证据缺失可标记。
- 经营闭环与诊断复跑分离：无核验生效不得声称闭环完成。
- 隔离 fixture + 固定时钟验收 AC-M0-12-1/2/3；本人下载权限。

## Capabilities

### New Capabilities

- `report-retest`：同口径复测、比较与报告快照合同。

### Modified Capabilities

- （无规格级变更）消费 publication `effective_at`、evidence 样本与 brand 清除语义。

## Impact

影响 `src/features/reports/`、Schema/migration/DDL、导航与 i18n、`pnpm test:reports`、品牌 purge 清理。不包含正式 14 天基线、D+14/28、匿名分享或因果结论。
