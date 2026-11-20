## 1. Schema 与规则

- [x] 1.1 新增 optimization Finding/Task/Evidence/PageCheck 双方言 Schema，注册 drizzle 配置并生成迁移与全量 DDL
- [x] 1.2 实现缺口诊断、去重键、优先序比较与只读页面检查纯函数（覆盖 AC-M0-08-1/2/3 输入输出）

## 2. DAO、命令与 API

- [x] 2.1 实现 OptimizationDao 批量读写（归属过滤、去重查询、证据追加）
- [x] 2.2 实现生成建议、页面检查、状态/改序/完成命令与同站 Origin API

## 3. UI、概览回接与验收

- [x] 3.1 工作台任务列表/详情页与 zh-CN/en；证据概览回接最多 3 条优先任务
- [x] 3.2 `pnpm test:optimization` 覆盖 AC-M0-08-1/2/3、去重与越权；通过 lint/typecheck/check:i18n/build；交付文档并归档 OpenSpec
