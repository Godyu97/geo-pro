# 公开网页只读抓取

## Why

页面检查和发布核验目前只接受隔离 fixture，未提供 fixture 时固定退化为不访问网络。#32 的真实试点需要一个默认关闭、带 SSRF 防护的只读抓取器，同时不能把 HTTP 成功写成公开核验通过。

## What Changes

- 增加服务端公开页抓取。仅当 `GEO_PUBLIC_PAGE_FETCH=true` 时启用；否则页面检查和发布核验保持受控关闭。
- 抓取只允许 http/https，解析后阻断私网、回环、链路本地和元数据地址，并限制跳转、超时和正文大小。
- 结果接入既有页面分类和发布分类。显式 fixture 继续优先。HTTP 200 本身不产生 `verified_public`。
- 用本机受控服务验证正常页、登录墙、草稿、404、内网重定向、超大响应和指令标记。不勾选真实试点。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `optimization-tasks`：页面检查在 fixture 之外增加默认关闭的只读抓取和地址阻断。
- `publication-verify`：发布核验可抓取已保存 URL，传输失败不写生效时间，也不把 HTTP 成功单独当成公开通过。

## Impact

影响 `src/lib/http/`、优化页面检查和内容发布核验。无 Schema 变更，无新依赖。真实外网站点仍由 #32 验收。
