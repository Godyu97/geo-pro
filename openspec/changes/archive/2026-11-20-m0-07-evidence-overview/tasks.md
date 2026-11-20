## 1. 指标与查询

- [x] 1.1 实现题等权/池化/N/A 纯函数与 overview 合同（Zod scope）
- [x] 1.2 扩展 EvidenceDao 按归属与 scope 批量读取 Observation+最新分析（含 slot/question 关联）

## 2. 命令、页面与 i18n

- [x] 2.1 实现 `readEvidenceOverview` / 回答列表命令与同站 Origin 只读 API
- [x] 2.2 工作台总览与回答列表 UI（筛选、KPI、逐题明细、下钻、空态/任务入口），补齐 zh-CN/en

## 3. 验收

- [x] 3.1 双库或纯函数+集成测试覆盖 AC-M0-07-1/2、轨道隔离、越权拒绝（`pnpm test:evidence`）
- [x] 3.2 通过 `pnpm lint`、`pnpm typecheck`、`pnpm check:i18n`、`pnpm build`；记录交付文档并归档 OpenSpec
