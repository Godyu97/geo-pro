# Tasks

## 1. 数据与生成

- [x] 1.1 实现双方言记录、批量读取、生成与指纹重核，执行 `pnpm db:generate`、SQL 审核、`pnpm db:ddl`、`pnpm db:ddl:check` 和隔离库 `pnpm db:migrate`，用 `pnpm test:data-exports` 验证升级、回滚、并发、查询和导出范围。

## 2. 页面与接口

- [x] 2.1 接入本人生成接口和受保护下载，生产构建后运行 `pnpm verify:data-exports`，分别核验两种数据库的会话、授权、UTF-8、失效及部分失败。
- [x] 2.2 接入双语设置区和生成反馈，用 `pnpm check:i18n` 和 Playwright 验证语言切换、文件下载、键盘及失败态。

## 3. 集成验收

- [x] 3.1 执行 `pnpm lint`、`pnpm typecheck`、`pnpm build`、认证和品牌回归，记录 B05 验收与正式开放边界。运行 `python docs/tools/validate_docs.py` 和 OpenSpec 严格检查。

## Workflow follow-up

- 同步主规格，归档并执行已归档规格校验。
