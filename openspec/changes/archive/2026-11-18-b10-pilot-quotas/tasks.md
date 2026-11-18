# Tasks

## 1. 双库与业务规则

- [x] 1.1 实现授权版本、预留和尝试账本，执行 `pnpm db:generate`、审核 SQL、`pnpm db:ddl`、`pnpm db:ddl:check`、隔离库 `pnpm db:migrate` 与 `pnpm test:quotas`。

## 2. 接口与界面

- [x] 2.1 复用维护授权接入写入接口，把本人额度接入双语设置。用 `pnpm check:i18n`、双库 HTTP 及 Playwright 验证权限、状态及布局。

## 3. 交付

- [x] 3.1 执行 `pnpm lint`、`pnpm typecheck`、`pnpm build` 和适用回归。记录实际交付和外部边界，运行 `python docs/tools/validate_docs.py`。
- [x] 3.2 严格验证变更，归档并验证主规格。
