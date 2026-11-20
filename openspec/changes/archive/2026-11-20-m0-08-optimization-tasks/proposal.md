# Proposal

## Why

负责人需要把回答与页面证据转成可复测的少量优化任务，避免泛 SEO 列表。Issue #26 / R-M0-08 / S-M0-08 / T-M0-08。前置 #22 批准事实与 #25 同口径下钻已完成；隔离测试页即可验收自有页检查。

## What Changes

- 新增六类 Finding 与优化任务：事实错误、同名混淆、关键内容缺失、公开页不可读、引用来源差距、需要补证；每条含证据、假设、目标页、步骤、完成标准与复测方法。
- 按品牌+问题簇+目标页+缺口类型去重合并证据；优先序（urgent / 业务重要度 / 已核实证据 / 工作量 / 创建时间）可解释，支持改序留理由。
- 单次最多 5 个指定公开 URL 的只读页面检查：记录访问条件与受限/待核验，不执行页面指令、不宣称引擎收录。
- 工作台任务列表/详情与证据概览最多 3 条优先建议回接；非负责人拒绝读写。
- 机器验收 AC-M0-08-1/2/3；界面 zh-CN/en。

## Capabilities

### New Capabilities

- `optimization-tasks`：诊断建议、任务去重、页面检查与优先序合同。

### Modified Capabilities

- `evidence-overview`：任务区由空态改为回接最多 3 条开放优先任务（仍禁止演示数字）。

## Impact

影响 `src/features/optimization/`、证据概览建议区、Schema/migration/DDL、i18n、专项测试 `pnpm test:optimization`。真实客户发布与监测通道开通不在本次范围；软件验收使用隔离 fixture。
