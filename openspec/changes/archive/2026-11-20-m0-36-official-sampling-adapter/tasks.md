# 官方 HTTP 采样任务

- [x] 1.1 实现服务端配置解析、引用/联网/费用解释和 fail-closed HTTP 客户端，并用 loopback 验证拒绝重定向与已受理失败不重试。验证：`node --conditions=react-server --test tests/monitoring/official-sampling.test.mjs`
- [x] 1.2 把官方端口接入监测执行，过期或未配置时不扣额度，10 题×2 轮结果写入 Attempt 与联网证据。验证：`pnpm test:monitoring`
- [x] 1.3 记录交付边界，并执行 lint、typecheck 与 build。验证：`pnpm lint`、`pnpm typecheck`、`pnpm build`
