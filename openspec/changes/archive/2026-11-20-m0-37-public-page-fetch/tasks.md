# 公开网页只读抓取任务

- [x] 1.1 实现地址阻断、正文分类和 fail-closed HTTP 抓取，并用受控服务验证回环、元数据、重定向、超限和超时。验证：`pnpm test:pages`
- [x] 1.2 接入最多 5 个 URL 的页面检查和发布核验，保留 fixture，关闭时不访问网络。验证：`pnpm test:optimization`、`pnpm test:content`
- [x] 1.3 补齐双语提示和交付记录，并执行 lint、typecheck 与 build。验证：`pnpm check:i18n`、`pnpm lint`、`pnpm typecheck`、`pnpm build`
