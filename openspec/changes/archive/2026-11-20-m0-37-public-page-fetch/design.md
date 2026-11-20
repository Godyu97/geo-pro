# 公开网页只读抓取设计

## 决策

- 抓取实现放在 `src/lib/http/public-page-fetch.ts`，地址和正文分类放在无网络副作用的 `public-page-policy.ts`。开关只认 `GEO_PUBLIC_PAGE_FETCH=true`。
- 回环白名单是 `fetchPublicPage` 的测试参数。命令默认调用不传该参数，环境变量不能打开回环。
- 每跳先判断协议、凭据和主机名，再解析全部地址。任一地址非公开即整跳阻断，并固定连接到已通过校验的地址，避免 DNS 重绑定。
- 最多 3 次跳转，整次预算 8 秒，正文 1 MiB。不发送 Cookie、Authorization 或平台凭据。超限和超时丢弃已读正文。
- 元数据主机名在解析前拒绝。失败结果只保留稳定原因码，不记录解析地址或重定向目标。
- 页面检查仍以显式 fixture 为优先。发布核验只抓取该发布记录已保存的 URL。传输失败不覆盖已有 `verified_public` / `verified_manual` 等已判定状态，也不改写 `effective_at`。
- 抓取发生在既有发布事务内，上限为 8 秒。当前没有批量巡检。

## 数据

不新增表。页面检查沿用 `page_check`。发布核验沿用 `publication_check`，实时抓取的证据只保留分类、摘录、robots 线索和指令标记。

## 风险

本机受控服务不代表任何客户站点已可抓取。默认关闭时工作台勾选实时抓取也只会记录受控关闭。
