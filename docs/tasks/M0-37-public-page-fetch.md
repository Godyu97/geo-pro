# M0-37 公开网页只读抓取

Issue [#37](https://github.com/Godyu97/geo-pro/issues/37)｜2026-11-20｜对应 R-M0-08 / R-M0-11 的软件抓取缺口。AC-M0-08-2/3 与 AC-M0-11-1/2/3 的相关行为已在隔离 fixture 和本机受控测试服务上验证。真实外网站点、登录墙绕过和试点发布仍由 #32 负责。本记录不勾选 T-M0-11 或 AC-M0-GATE。

## 范围与关键决定

- 公开抓取只在服务端 `GEO_PUBLIC_PAGE_FETCH=true` 时开启。其他值保持关闭。关闭时页面检查记为 `public-fetch-disabled`，发布核验记为 `pending_check`，不写 `effective_at`，也不发出请求。
- 回环放行只存在于测试函数参数。生产调用不读取任何放行开关，因此回环、私网、链路本地、云元数据和解析到这些地址的主机名都会阻断。
- 显式 fixture 优先于网络。发布核验的实时抓取只使用已保存的 `pageUrl`。
- 最多跟随 3 次跳转，每跳重新校验。超时 8 秒，正文上限 1 MiB。不发送 Cookie 或平台凭据。超限正文直接丢弃。
- HTTP 200 仍要经过草稿、登录墙、撤下和主张匹配分类。可执行指令只写入只读标记。失败结果不保存解析出的内网地址。
- 无 Schema 变更，无新依赖。

## 隔离验收

`pnpm test:pages` 用本机受控服务覆盖公开页、登录墙、草稿、404、重定向到元数据和私网、DNS 二次解析到私网、超大响应、非文档类型、过多跳转和超时。直接请求回环或元数据主机名时测试服务收到的请求数不增加。`pnpm test:optimization` 覆盖 5 个 URL 上限、关闭时不调用抓取器，以及开启后的指令标记和阻断码。`pnpm test:content` 覆盖关闭时的 `pending_check`、首次公开匹配写入 `effective_at`、再次核验不改写、登录墙、草稿、撤下和 HTTP 200 但不匹配主张。这些都是受控结果，不是真实站点可达性。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:pages` | 通过。5 项均通过，含地址阻断和受控测试服务 |
| `pnpm test:optimization` | 通过。SQLite 与 PostgreSQL 均通过，含关闭抓取和 5 个 URL 上限 |
| `pnpm test:content` | 通过。32 项均通过，含双方言库上的实时核验与既有 AC-M0-11 |
| `pnpm check:i18n` | 通过。1153 个消息键和插值参数在 zh-CN / en 对齐 |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `python docs/tools/validate_docs.py` | 通过 |

无 Schema 变更，未运行 `pnpm db:ddl:check`。没有对公网页面发起抓取。
