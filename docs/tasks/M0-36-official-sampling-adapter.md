# M0-36 官方 HTTP 采样适配器

Issue [#36](https://github.com/Godyu97/geo-pro/issues/36)｜2026-11-20｜对应 R-M0-04 / R-M0-05 / R-M0-06 的软件适配缺口。AC-M0-04-2/3 与 AC-M0-05-2 的相关行为已在隔离库和 loopback mock 上验证。真实官方 API 权限、可复查账单和消费者入口仍由 #31 负责。本记录不勾选 T-M0-04、T-M0-05 或 AC-M0-GATE。

## 范围与关键决定

- 官方采样使用独立环境变量 `GEO_OFFICIAL_SAMPLING_BASE_URL`、`GEO_OFFICIAL_SAMPLING_API_KEY`、`GEO_OFFICIAL_SAMPLING_PRODUCT_ENTRY`、`GEO_OFFICIAL_SAMPLING_PRICE_TABLE`。不读取 `OPENAI_*`，避免内容生成配置打开采样通道。
- 请求只发往配置的 `/responses`。`redirect: error`。429/5xx 且没有受理 id 时，同一次采样最多再试一次。超时、重定向和已受理失败进入待核对，不重发。
- 产品入口必须与通道版本一致，模型不能是 `unknown`，通道必须是未过期的 verified。否则拒绝且不写额度扣减。
- 引用空数组记 `complete`，缺字段记 `missing` 或 `partial`，显式不支持记 `unsupported`。联网触发与引用分开；`unknown` 不进入 required 联网分母。
- 单价按模型的每百万 token 最小货币单位向上取整。响应模型不一致、缺价或超过运行上界时保留原文上界并待核对，不把未知金额写成 0。
- 不新增表。官方 Attempt 使用既有 `official_api` / 非合成约束，联网证据写入既有 `sampling_answer_network`。工作台 API 仍不启动采样。

## 隔离验收

`tests/monitoring/official-sampling.test.mjs` 在 SQLite 与 PostgreSQL 上各执行一次。10 题×2 轮的 loopback 响应覆盖完整引用、完整空引用、缺失字段、不支持引用、未知联网、429 后成功、无受理 id 的 500、超时、模型不在单价表和超上界的部分引用。再次执行不会重发超时请求。未配置端口和过期通道都不产生 HTTP 请求，也没有 `quota_attempt`。重定向不会访问 Location。密钥不出现在采样结果或错误日志中。这些结果是合成契约，不是 #31 的真实开通证据。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test:monitoring` | 通过。10 项均通过，含 SQLite 与 PostgreSQL 的登记、隔离执行和本任务官方契约 |
| `pnpm check:i18n` | 通过。1150 个消息键和插值参数在 zh-CN / en 对齐 |
| `pnpm build` | 通过 |
| `python docs/tools/validate_docs.py` | 通过 |

无 Schema 变更，未运行 `pnpm db:ddl:check`。没有真实供应商密钥，未验证外部 API 费用或联网触发。
