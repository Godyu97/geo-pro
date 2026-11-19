## 1. Schema 与 DAO

- [x] 1.1 新增双方言 evidence 表并注册 drizzle 配置，生成迁移与全量 DDL（`pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check`）
- [x] 1.2 实现 EvidenceDao 批量读写与归属查询；purge contents 清理证据正文

## 2. 领域命令与 API

- [x] 2.1 实现入证、人工草稿、修订分析与读取合同（Zod + 归属/冻结门禁）
- [x] 2.2 增加同站 Origin API 与监测详情原文/判定入口及 zh-CN/en 文案

## 3. 验收

- [x] 3.1 双库测试覆盖 AC-M0-06-1/2/3、越权与冻结拒绝（`pnpm test:evidence`）
- [x] 3.2 通过 `pnpm lint`、`pnpm typecheck`、`pnpm check:i18n`、`pnpm build`；记录交付文档
