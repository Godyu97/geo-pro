## 1. 邮件流程与身份边界

- [x] 1.1 接入事务、双方言滚动限流、Better Auth 验证/重设与隔离投递；审核生成的 SQL，在双库迁移并执行 `pnpm db:ddl` 与 `pnpm db:ddl:check`。
- [x] 1.2 接入双语请求、确认与安全返回页，以及 B06 既有权限边界；运行 `pnpm check:i18n` 和 `pnpm test:i18n`。

## 2. 核验与交付

- [x] 2.1 以隔离 SQLite3/PostgreSQL 验收令牌、到期、限流、投递失败、会话和 B06 回归；执行 `pnpm verify:auth`。
- [x] 2.2 执行 lint、typecheck、生产构建和双语 Chrome 场景；记录真实结果，执行 `python docs/tools/validate_docs.py` 并归档 OpenSpec。
