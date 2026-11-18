# B10 受控试点额度

实现 [Issue #10](https://github.com/Godyu97/geo-pro/issues/10) 与 D1/D2 的额度基础。关联 [T-M0-05](M0.md#t-m0-05)、[S-M0-05](../specs/M0.md#s-m0-05) 和 [B08 维护权限](../architecture/maintenance-access.md)。

- 采样槽位和内容生成独立计数。新账号或活跃品牌无授权时可用次数为零。设置显示本人额度状态、预留与已结算次数、到期时间和同币种供应商费用。已确认费用与待核对费用分别展示，平台服务费和按量收费按受控试点政策为零。
- 维护授予、增减和撤销使用不可变版本。每个版本记录固定原因、操作者、时间、操作键和批准值。上一个版本保存变更前的值。
- 逻辑单元用稳定 ID 去重。每次供应商尝试另有稳定 ID、可信上界和费用状态。预留上界和实际已核实费用共同占用金额硬上限；确认后的实际费用即使超过预估仍按实记录。费用未知时保留上界。被采用的晚到结果可结算，明确不会再有结果且费用核对完毕后可释放。
- 额度下调、到期和撤销不重置历史，也不自动释放在途预留。已占用量超过新上限时，界面显示剩余次数为零。新的尝试必须仍满足当前的品牌状态、授权、数量和金额上限。

<a id="operator-workflow"></a>

## 维护输入和核对流程

通过同源 `POST /api/maintenance/quotas` 提交 JSON。使用已登录的独立维护账号。服务端校验 Better Auth 会话、同源 Origin、内容类型及 `quotas.manage`。请求中的 `actorId` 必须与当前会话一致，用于拒绝切换账号后的旧输入。权限授予方式见 [B08 维护说明](../architecture/maintenance-access.md#controlled-server-commands)。

首次授权使用 `expectedVersion: null`。增减使用 `action: "set"` 与预期版本，传入审批后的完整新限额。设置内容包含 `actorId`、UUID 格式的 `brandId` 和 `operationId`、`kind`（`sampling` / `generation`）、`expectedVersion`、`reason`、正整数 `countLimit`、非负整数 `budgetMinor`、ISO 货币代码 `currency` 和未来 UTC 时间 `expiresAt`（含毫秒，例如 `2026-12-18T08:00:00.000Z`）。金额为币种最小单位，例如 CNY 的 100 分等于 1 元。已有逻辑单元的额度类别保留原币种。接收真实或核对费用时币种不符须保持待核对，由运营确认后续处理。

撤销使用 `action: "revoke"`、目标和操作元数据，省略四项限额值（次数、金额、币种、到期时间）。原因使用 `pilot-approval`、`budget-increase`、`budget-decrease`、`pilot-ended` 或 `correction`。维护接口返回变更前后快照和审计追踪编号。网络结果未知时原参数、原操作键重试。409 版本冲突返回当前授权，核对后以新操作键和当前版本提交经确认的新值。操作键已有不同参数时返回明确冲突。授权过期或撤销不阻断已登记成本的核对。

## 存储和查询

三个表各自承载授权版本、逻辑单元和供应商尝试，避免把供应商费用计入客户次数。外键沿品牌与授权版本建立，主键按品牌、类别和版本或逻辑 ID 排列，操作键另有唯一约束。两种数据库使用独立迁移与 DDL。PostgreSQL 将写入按品牌行锁串行化，SQLite 使用现有立即事务。批准值变化和成功审计同事务，审计写入失败时回滚。设置查询按当前账号和活跃品牌过滤，同时聚合两类计数和费用。

## 验证与开放边界

| 检查 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`、`pnpm test:i18n` | 通过。 |
| `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check`、`pnpm test:quotas` | 两种数据库的增量迁移及 DDL 检查通过。测试从 B05 Schema 与已有账号、品牌升级，分别执行两次 `pnpm db:migrate`，校验空库导入的结构一致性。 |
| `pnpm test:quotas` | 3 项通过，覆盖授权失败、重试、并发版本、回滚、币种匹配、逻辑次数与费用分离、下调、到期、撤销和晚到结果。双方言在 10 与 500 个无关的合成槽位下都使用一条 SQL 查询本人额度。500 槽位样本的查询计划使用品牌归属索引及预留复合主键。 |
| `pnpm verify:quotas` | SQLite3/PostgreSQL 生产 HTTP 和 Chrome 通过。覆盖真实会话、伪造和过期会话、拒绝越权、同源和身份切换，以及中英文设置的 375/768/1440 布局、AA 正文对比度、加载（PostgreSQL）、故障后键盘恢复、语言切换、空态、待核对、到期、用尽和撤销。 |
| 相关回归 | `pnpm test:maintenance`、`pnpm test:brands`、`pnpm test:data-exports` 及三者的生产 HTTP 专项均通过。维护专项包含两种后端的 `pnpm verify:auth`。 |
| `pnpm test:e2e` | 首轮 66 项通过，账户设置导航的邮箱定位需限定到个人资料区。修正后 `pnpm test:e2e --last-failed` 单独重跑 1 项通过。 |
| `python docs/tools/validate_docs.py`、OpenSpec 严格校验 | 通过。 |

真实试点启动前，由负责人在核验权限和真实预算后明确授予次数、截止时间和金额硬上限。B11/B12 接入受理、执行、用户确认、可信价格、通道和付费动作的服务端门禁。B13 提供用户费用明细。B06/B07 后续执行冻结和清除合同以及财务保留处理。本轮验收使用隔离库中的合成品牌与金额。
