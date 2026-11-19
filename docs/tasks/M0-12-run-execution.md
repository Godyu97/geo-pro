# M0-12 执行和恢复监测并核对本人用量

> Issue [#12](https://github.com/Godyu97/geo-pro/issues/12)｜2026-11-19｜R-M0-05 的执行、恢复和本人用量部分。完整 [T-M0-05](M0.md#t-m0-05) 仍未勾选，真实供应商、可信价格和真实结果留在 #31。

## 范围与关键决定

- 已登记运行可经可替换传输执行。默认验收使用明确标注的隔离传输；官方 API 端口在未接通时拒绝，不生成模拟回答。
- 每个付费单元开始前重新检查邮箱、通道、额度和可信上界。额度只够一个新单元时，只执行一个，其余暂停。同一槽位最多 2 次额外安全重试。费用未知进入待核对并保留上界，不立即重发。
- 暂停、继续和取消只改变尚未受理的单元。取消不减少计划分母。晚到原文和费用保留并标记。分析重做复用已采用原文，不增加采样费用。结算和释放在重复请求下返回原状态。
- 设置页列出本人的供应商预计、实际、预留和待核对金额，客户应付固定为 0。未知金额保持未知。列表按品牌、时间和标识分页，关联运行在一次批量查询中读取。

## 修改入口

领域在 `src/features/monitoring/`。运行详情仍由 `dashboard/monitoring/runs/[runId]` 挂载，用量明细在 `dashboard/settings/usage`。新增 `monitoring_attempt`，并放宽运行与槽位状态。专项测试为 `pnpm test:monitoring`。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `pnpm test:monitoring` | 通过。SQLite 与 PostgreSQL 覆盖 AC-M0-05-2、AC-M0-05-3、回滚、暂停/继续/取消、晚到、分析重做、越权和分页 |
| `pnpm db:ddl:check` | 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过 |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。生产构建包含 `/dashboard/settings/usage` 与 `/dashboard/monitoring/runs/[runId]` |
| 小样本下的 PostgreSQL 分页计划 | 顺序扫描。关闭顺序扫描后，同一查询使用 `quota_reservation_brand_recent_idx` |
| 真实供应商执行和价格 | 未验证，留在 #31 |

隔离验收使用合成题集、通道和调用方确认的费用上界。隔离传输结果标明合成，不作为真实采样。
