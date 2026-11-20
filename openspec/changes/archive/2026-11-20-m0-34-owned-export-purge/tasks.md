# Tasks

- [x] 1.1 扩大导出范围位图和双方言检查约束，并用 `pnpm db:generate`、`pnpm db:ddl:check` 核对迁移与全量 DDL。
- [x] 2.1 按页读取五个已交付业务域，接入生成、下载、设置页双语预览和验收开关，并用 `pnpm test:data-exports` 验证完整、部分失败、越权和容量结果。
- [x] 3.1 按外键顺序清除优化任务和其余 M0 正文，并用 `pnpm test:brands` 验证含优化任务的到期清除与幂等重跑。
- [x] 4.1 运行 `pnpm lint`、`pnpm typecheck`、`pnpm check:i18n` 和 `pnpm build`，把验收记录写入 `docs/tasks/`。
