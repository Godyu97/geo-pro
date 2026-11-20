# 官方 API HTTP 采样适配器

## Why

监测执行已经能用隔离传输保存 Attempt 和费用，但官方端口仍是始终拒绝的空实现。#31 需要的真实密钥和预算还没有，仓库却缺少可在凭据到位后直接使用的 HTTP 采样、引用完整性和费用解析合同。

## What Changes

- 增加服务端官方 API 配置解析和 Responses API HTTP 客户端。未配置、入口不匹配或能力版本不可用时保持 fail-closed。
- 官方采样返回原文、模型回执、联网触发、原生引用和引用集合状态，并按可信单价表计算实际金额。
- 监测执行在显式官方端口上保存非合成 Attempt，并把联网证据写入既有答案网络表。超时、缺价和超上界进入待核对，不盲目重发。
- 用 loopback mock 覆盖 10 题×2 轮契约。不启用生产通道，不勾选 T-M0-04 / T-M0-05。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `monitoring-runs`：在隔离执行之外增加 fail-closed 的官方 HTTP 采样合同。

## Impact

影响 `src/lib/ai/`、监测执行和通道联网证据写入。无 Schema 变更，无新依赖。公共界面仍不启动采样。真实供应商开通仍由 #31 负责。
