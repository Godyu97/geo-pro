# Tasks

## 1. 数据与业务规则

- [x] 1.1 实现 B04 校验、双方言 Schema、DAO 与事务，审核 `pnpm db:generate` 生成的 SQL，运行 `pnpm db:ddl` 和 `pnpm db:ddl:check`。

## 2. 产品入口与服务端鉴权

- [x] 2.1 接入品牌页面、三步引导、读写 API、安全返回及正式资料停收，运行 `pnpm typecheck`、`pnpm lint` 和 `pnpm check:i18n`。

## 3. 验收与记录

- [x] 3.1 对隔离 SQLite3 与 PostgreSQL 执行 `pnpm db:migrate`、全量 DDL、读写并发与回滚、查询计划、HTTP 归属及 `pnpm verify:auth` 检查。
- [x] 3.2 执行生产构建和 Playwright，覆盖两种界面的三宽度、草稿恢复、归属拒绝、失败状态和归档恢复。
- [x] 3.3 记录 B04 实际结果和正式开放条件，执行 `python docs/tools/validate_docs.py` 与 OpenSpec 严格验证。
