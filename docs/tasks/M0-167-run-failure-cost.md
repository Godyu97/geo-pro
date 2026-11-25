# Issue #167 监测运行失败时的重试与供应商费用

2026-11-26。 [Issue #167](https://github.com/Godyu97/geo-pro/issues/167) · [公共 SPEC](../04-产品功能规格-SPEC.md) 第 3.2 节 · [S-M0-05](../specs/M0.md#s-m0-05) 第 4、5 条与异常恢复

品牌负责人在运行确认或 `/dashboard/monitoring/runs/[runId]` 预览、登记、暂停、继续、取消、执行、重做分析或核对费用。动作失败时，响应说明能不能重试，以及这次失败是否可能已经产生供应商费用。

## 范围

- 监测运行预览、接受、暂停、继续、取消、执行、分析重做和费用核对的失败响应包含 `message`、`retryable`、`nextStep`、`externalCostPossible`。运行详情使用同一组 `zh-CN` / `en` 文案。
- 还没有采样尝试时，校验、预览过期、额度不足、通道未核验和权限错误的 `externalCostPossible` 为 false。
- 运行已有 pending 或 unknown 的采样尝试，或费用上下文读不出来时，`externalCostPossible` 为 true，`retryable` 为 false，下一步指向费用核对。未知金额显示为待核对，不写成 0。
- 已知安全失败且没有新增未知费用时，按每槽位最多 2 次额外尝试说明能否重试。已到上限时不建议再发一次远端请求。
- 其他账号使用该运行编号时返回 404，响应不含费用金额和回答原文。客户应付仍保持原口径。不勾选 T-M0-05，也不替代 #31。

## 本轮核验

- 隔离合同：未核验通道的预览失败为 `externalCostPossible: false`、`retryable: false`，下一步是核验通道。额度、预览过期、校验和权限错误同样不标成可能已产生供应商费用。服务中断且尚无采样尝试时可以稍后重试。
- 隔离执行：一个槽位费用为 unknown 时，再次执行不增加采样调用。成功响应和随后的 `REAL_CHANNEL_CLOSED` 都是 `externalCostPossible: true`、`retryable: false`，下一步为先核对费用。未知金额保持 null；即使库存成 0，页面文案仍是待核对而不是 0。已到 3 次安全失败时下一步是重试上限，不建议再发远端请求。
- 另一账号的控制失败体只有错误码、说明、`retryable`、`nextStep` 和 `externalCostPossible: false`，不含金额字段或原文。
- 浏览器在隔离「北岸设备」流程中核对：未核验通道预览返回核验下一步且费用不可能；把失败槽标成 unknown 后，375 与 1440 宽度的运行详情提示先核对费用，未知尝试显示「实际费用未知」/ “Actual cost unknown”，不显示 CNY 0.00。再次点击执行官方采样后，状态文案同样要求先核对且不要再发远端请求。恢复原失败状态后，中英文 375/768/1440 走查无横向溢出。另一账号调用执行接口得到 404，响应不含合成回答、品牌名或金额字段。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`（3831 个消息键）和 `pnpm test:monitoring`（33 项，SQLite 与 PostgreSQL，无跳过）通过。`pnpm exec playwright test tests/e2e/m0-flow.spec.ts` 通过。

T-M0-05 保持未勾选。正式通道核验仍由 #31 跟踪。
