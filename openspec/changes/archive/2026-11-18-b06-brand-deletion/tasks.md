# 品牌删除实施任务

## 1. 双库持久化与访问边界

- [x] 1.1 实现品牌冻结、期限、版本、幂等及期限调整。执行 pnpm db:generate、审核 SQL、双方言 pnpm db:migrate、pnpm db:ddl、pnpm db:ddl:check 和双库 DAO 测试。
- [x] 1.2 阻止普通品牌、导出和额度访问，保留既有费用核对。执行 pnpm test:brands、pnpm test:data-exports、pnpm test:quotas。

## 2. 界面与验收

- [x] 2.1 接入双语预览、确认、恢复、重新登录和受限元信息入口。执行 pnpm check:i18n、HTTP、认证和 Chrome 验收。
- [x] 2.2 记录隔离验收及真实开放条件。执行 pnpm lint、pnpm typecheck、pnpm build、python docs/tools/validate_docs.py、OpenSpec 严格校验及归档。
