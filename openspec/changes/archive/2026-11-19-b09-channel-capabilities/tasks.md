# Tasks

## 1. Schema 与合同

- [x] 1.1 新增双方言 `capability_channel`、`capability_version`、`sampling_answer_network` Schema，并接入 drizzle 配置。验证：类型可导入且无循环依赖。
- [x] 1.2 运行 `pnpm db:generate`，审核增量 SQL 后执行 `pnpm db:ddl` 与 `pnpm db:ddl:check`。验证：双方言 DDL 检查通过。
- [x] 1.3 定义 Zod 合同：kind/status/联网枚举、维护写入、运行确认、公开投影字段。验证：非法输入被拒绝。

## 2. DAO 与规则

- [x] 2.1 实现通道最新版本批量读取、按 ID 锁定写入、幂等操作键与不可变追加。验证：`pnpm test:capabilities` 覆盖升级、并发、回滚。
- [x] 2.2 实现正式运行资格（仅未过期 verified）与联网证据派生（无触发则 unknown，不进 required 分母）。验证：对应单测。
- [x] 2.3 实现禁用后历史证据仍可按品牌归属读取，且查询不含正文列。验证：双库 DAO 测试。

## 3. 维护与用户入口

- [x] 3.1 以 `runMaintenanceAction("capability.write")` 接入 `POST /api/maintenance/capabilities`，独立校验会话与同源。验证：越权/伪造会话被拒绝。
- [x] 3.2 增加维护能力页（含 SOP、版本，不含客户正文）并在已授权时从维护首页进入。验证：无 `capabilities.manage` 时拒绝写入。
- [x] 3.3 设置页展示监测能力范围；运行确认页/API 阻止未验证或过期正式运行且不模拟成功。验证：`pnpm verify:capabilities` HTTP 场景。
- [x] 3.4 官网仅投影允许公开的 verified 字段；无记录时保持未开放文案。验证：无公开通道时营销文案不变。

## 4. 双语、安全返回与文档

- [x] 4.1 同步 zh-CN/en 消息，覆盖空/加载/失败/权限不足，并把新路径加入 `safeReturnTo`。验证：`pnpm check:i18n`。
- [x] 4.2 记录 `docs/tasks/B09-channel-capabilities.md`，更新项目事实、质量门禁、数据访问与维护说明；不勾选 T-M0-04。验证：`python docs/tools/validate_docs.py`。

## 5. 集成门禁

- [x] 5.1 执行 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test:i18n` 与适用回归。验证：命令实际通过。
- [x] 5.2 在双方言隔离库运行 `pnpm test:capabilities` 与 `pnpm verify:capabilities`（含 375/768/1440）。验证：软件合同通过；真实外部通道标为受阻。
