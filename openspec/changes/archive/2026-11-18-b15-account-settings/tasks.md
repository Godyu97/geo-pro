# Tasks

## 1. 资料写入

- [x] 1.1 收窄 Better Auth 更新字段，复用 Unicode 称呼校验并保护会话身份。补齐真实 HTTP 校验，覆盖非法输入、账号隔离、本人持久化和并发，在双数据库上运行 `pnpm verify:maintenance` 并检查既有查写路径。

## 2. 账户设置界面

- [x] 2.1 接入账户设置导航、受保护页面、加载、语言、安全和数据管理入口。用 `pnpm check:i18n` 和 Playwright 验证中英文、无权限返回位置及现有工作台导航。
- [x] 2.2 接入称呼编辑和保存状态。用 Playwright 验证两种语言、三种宽度、键盘、字段错误、IME、切换语言保留输入、服务故障及持久化刷新。

## 3. 集成验收

- [x] 3.1 完成 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test:i18n`、`pnpm test:e2e` 和 `pnpm db:ddl:check`，记录 B15 实际验收与边界，并运行 `python docs/tools/validate_docs.py`。

## Workflow follow-up

- 同步账户设置规格，验证主规格和归档后，在当前分支提交并推送。
