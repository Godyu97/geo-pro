# Tasks

## 1. 数据与登记

- [x] 1.1 增加双方言 Run/Slot 表、迁移和全量 DDL，并用 `pnpm db:ddl:check` 核对。
- [x] 1.2 实现预览、签名受理、幂等冲突、额度预留和消费者免付费路径，并用双方言测试覆盖 AC-M0-05-1。

## 2. 界面与恢复

- [x] 2.1 在运行确认页增加双语预览和登记，并提供可刷新的排队详情。
- [x] 2.2 保持旧通道资格检查，运行 `pnpm test:monitoring`、`pnpm check:i18n`、`pnpm lint`、`pnpm typecheck` 和 `pnpm build`。
