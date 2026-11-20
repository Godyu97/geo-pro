# Design

## 范围位图

保留现有位：`profile = 1`、`brands = 2`。新增 `factsAndMaterials = 4`、`monitoringAndEvidence = 8`、`content = 16`、`reports = 32`、`usageAndCosts = 64`。`user_data_export` 的检查上限从 3 调整为 127，仍要求 `included` 是 `requested` 的子集，失败记录的指纹为空。双方言用迁移修改检查约束，并刷新全量 DDL。

品牌业务位掩码为 126。到期清除继续删除该掩码下、生成时间不晚于冻结时间的导出记录。仅含个人资料的记录保留。

## 读取

每个业务域在保存点内按每页 64 行键集分页，用一条 SQL 连接 `brand`，条件为当前负责人、未冻结、状态为 active 或 archived。单域累计超过 8 MiB 或查询失败时，该域记为缺失，不写入截断结果。下载按已包含范围重读并核对指纹。响应保持 `private, no-store`。

域内容：

- 事实与材料：粘贴、事实版本、事实使用。
- 监测与证据：运行、槽位、尝试、回答、引用、分析、优化发现、任务、任务证据、页面检查、采样网络记录。
- 内容：计划到发布动作的内容表；`visibility = internal` 的素材不进入导出。
- 报告：复测、待办、快照。
- 用量与费用：授予、预留、尝试的原始 minor 金额与币种。

不读取维护审计、会话、凭据或全局通道目录。界面 locale 只影响导出语言和文件名。

常规环境继续用现有品牌验收开关关闭全部品牌业务范围。本地 `GEO_BRANDS_FIXTURE=1` 的回环验收可以选择这些范围。

## 清除顺序

`clearContents()` 在删除品牌行之前显式清理会阻挡级联的正文：

1. `page_check_record`、`optimization_task_evidence`、`optimization_task`、`optimization_finding`。
2. `sampling_answer_network`、`monitoring_attempt`、`monitoring_slot`、`monitoring_run`。
3. 既有内容、报告和题集删除顺序保持不变，因其已经先删 RESTRICT 子行。
4. `brand_fact_use`、`brand_fact_version`，将粘贴的 `previous_id` 置空后再删除 `brand_fact_paste`，然后删除 `brand_version`。

额度行仍随品牌删除级联。未核对费用继续阻止 `clearLedger()`。`brand_purged_cost` 只保留最小凭证。

## 验证

`pnpm db:generate` 后审核 SQL，再执行 `pnpm db:ddl` 与 `pnpm db:ddl:check`。双库测试覆盖分页次数、查询计划、部分失败、越权、冻结、内部附件、优化任务清除和幂等重跑。
