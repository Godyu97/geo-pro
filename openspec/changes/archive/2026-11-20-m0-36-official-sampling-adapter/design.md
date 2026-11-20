# 官方 HTTP 采样设计

## 决策

- HTTP 客户端放在 `src/lib/ai/official-sampling-http.ts`，配置、引用、联网和费用解析放在无密钥副作用的 `src/lib/ai/official-sampling.ts`。端口适配放在 `src/features/monitoring/official-port.ts`。
- 凭据只读取 `GEO_OFFICIAL_SAMPLING_BASE_URL`、`GEO_OFFICIAL_SAMPLING_API_KEY`、`GEO_OFFICIAL_SAMPLING_PRODUCT_ENTRY` 和 `GEO_OFFICIAL_SAMPLING_PRICE_TABLE`。不复用 `OPENAI_*`，避免内容生成配置悄悄打开采样通道。
- 请求只发往配置的 `${baseUrl}/responses`。能力版本提供模型名和产品入口；入口不一致、模型为 `unknown`、状态不是未过期 `verified` 时拒绝。`redirect: error`，超时不重试。
- 429/5xx 且响应没有受理 id 时，同一次采样最多再试一次。已有 id、超时或重定向进入 `unknown` / 待核对。
- 单价表按模型给出每百万 token 的最小货币单位。响应模型与请求模型不一致、缺 usage、缺价或超过运行上界时不写成已知费用。
- 引用状态优先看显式 `geo_sampling`：空数组是 `complete`，缺字段是 `missing` 或 `partial`，`citation_support=unsupported` 是 `unsupported`。没有引用载荷时，通道能力为 unsupported 才记 unsupported，否则记 missing。
- 联网触发与引用分开。`triggered` 写入 `actual_network=true` 且 `trigger_evidence=observed`；`unknown` 不进入 required 联网分母。
- 执行仍在现有运行事务内逐槽采样，和隔离传输一样。工作台 API 不调用该端口，因此未配置环境不会产生外部请求。

## 数据

不新增表。官方 Attempt 使用已有 `transport=official_api`、`synthetic=0` 约束。联网证据复用 `sampling_answer_network`。引用明细留在采样返回值，供 #31 和证据入证继续使用，避免为契约测试增加 JSON 列。

## 风险

loopback 契约不代表任何供应商已开通。同步采样会占用运行事务直到超时或返回；当前没有用户入口触发它。
