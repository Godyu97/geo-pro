# Proposal

## Why

同渠道结果也可能因截断、缺引用或同名误判失真。负责人需要从结论回到原问题、原回答与当时条件，并在不覆盖原文的前提下纠正独立判定。Issue #24 / R-M0-06 / S-M0-06 / T-M0-06。

## What Changes

- 新增不可变 Observation、Citation 与 AnalysisVersion 证据合同，承接 Run/Slot/Attempt 的采用原文与消费者人工存证。
- 支持草稿/完整/争议证据状态，原生引用完整空集合与缺字段/partial/unsupported 分开。
- 提供提及/推荐/官网引用独立三态判定与可追加修订版本；报告可钉住旧 analysis_version。
- 负责人可查看原文详情、提交人工草稿、纠正误判；跨品牌/越权访问拒绝。
- 清除品牌 contents 时删除证据正文；冻结品牌拒绝新的证据写入。

## Capabilities

### New Capabilities

- `answer-evidence`：双轨回答原文、引用完整性与独立分析修订的证据合同。

### Modified Capabilities

无。

## Impact

影响 `src/features/evidence/`（新建）、`src/features/citations/` 占位说明、监测详情入口、品牌 purge contents、PostgreSQL/SQLite schema 与迁移、i18n。真实消费者自动采集与正式报告快照不在本次范围；软件验收可用显式双轨 fixture。
