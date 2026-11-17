# B02 认证入口与会话恢复交付记录

关联：[Issue #2](https://github.com/Godyu97/geo-pro/issues/2)；M0 / R-M0-01、T-M0-01、S-M0-01 的认证基础子项；日期：2026-11-17。

本项完成现有账号和工作台的认证增量。品牌引导、非敏感业务草稿持久化及跨品牌资源归属仍由 B04（#4）联调；T-M0-01 与 M0 保持未完成，不声明真实试点、邮件或 GEO 渠道已开放。

## 实现与文件

- `src/lib/auth/session.ts` 集中区分有效会话、匿名、未配置、服务不可用。`auth.api.getSession` 是服务端权威；React cache 仅在同一请求内供页面/布局复用，不跨请求缓存身份。
- `src/app/(auth)/login/page.tsx` 按真实会话跳转。当前只有 `/dashboard`，不推测未实现的品牌状态；未配置或故障显示不同的双语言提示、禁用表单，并提供显式重试。
- `src/lib/auth/return-to.ts` 统一安全返回目标和带稳定原因的登录地址；仅允许现有工作台，拒绝外站、未知/畸形路径及控制字符。保留筛选及可得片段，HTTP 登录重定向继承的片段也能恢复。
- `src/components/layout/session-monitor.tsx` 与 `src/lib/auth/client.ts` 复用 SDK 聚焦/周期检查。确认失效后返回登录；网络或服务错误显示可重试提示，不假称退出。账号变更时整页刷新，丢弃上一账号的服务端界面。
- `auth-form.tsx` / `sign-out-button.tsx` 在成功后整页替换，失败保留界面和错误。主动退出关闭该请求的 SDK signal，避免退出地址和失效提示并发跳转；其他标签在聚焦或下一次周期检查时发现撤销。客户端检查不能替代接口会话与归属校验。
- 两种语言新增会话恢复、会话检查失败与账号服务重试消息。认证字段只留在当前页面内存，不写应用草稿、localStorage 或 sessionStorage；语言切换仍保留当前输入和焦点。
- `scripts/verify-auth.mjs` 扩展真实 HTTP/PostgreSQL 权限检查，限制应用和数据库均为本机；仅精确修改及清理随机临时账号。`tests/e2e/auth-session.spec.ts` 新增浏览器验收，`auth-helpers.ts` 在明确 429 后按服务端等待时间准备测试账号，不降低生产限流。
- `scripts/serve-i18n-fixture.mjs` 的故障入口只注入忽略的测试副本；正式应用无故障 Cookie 分支或测试路由。不新增依赖、Schema、migration、业务 DAO 或缓存后端。

SDK 行为核对当前安装的 Better Auth 1.7.25 代码，并参考官方 [客户端说明](https://better-auth.com/docs/concepts/client) 和 [会话管理](https://better-auth.com/docs/concepts/session-management)。

## Issue 验收证据

| 条件 | 实际验证 | 结果 |
| --- | --- | --- |
| 注册→登录→退出→旧会话拒绝 | 本地 HTTP/PostgreSQL 注册、密码哈希、真实登录与两次退出；旧 Cookie 读写拒绝 | 通过 |
| 伪造/过期会话不能读写 | 直接请求工作台、会话读取和账号修改；精确将临时会话设为过期；拒绝后数据库姓名未变 | 通过 |
| 账号隔离 | 两个临时账号；替换读取/修改请求的 userId/id 仍只能操作会话本人，另一账号数据不变；浏览器切换身份后刷新为新账号 | 通过 |
| 退出失败不显示成功 | 两种语言 × 375/768/1440，模拟 503 后仍留在工作台，真实会话有效；显式重试后退出；后退不能恢复私有界面 | 通过 |
| 返回地址不能跳外站 | Node 恶意输入负例、已登录服务端跳转；深链接筛选及片段往返 | 通过 |
| 恢复不自动提交动作 | 浏览器使真实会话到期后检查请求记录：恢复前没有写请求；用户提交后只出现登录 POST | 通过（当前无收费业务接口） |
| 密码/令牌不进草稿 | 浏览器检查持久存储无凭据；刷新后密码为空；既有双语言切换仍保留页面内输入 | 通过 |
| U/A | 中英正常、失效、故障、未配置、加载/边界及权限检查；三种宽度无溢出，键盘登录/重试、焦点、标签和 AA 配色回归 | 通过（现有账号/工作台范围） |

## 实际执行的检查

| 命令/检查 | 真实结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；正式路由不包含测试探针 |
| `pnpm test:i18n` | 通过：6 个基础/负例测试，包含扩展的返回地址负例 |
| `pnpm check:i18n` | 通过：132 个消息 key 及参数一致 |
| `pnpm test:e2e` | 通过：22 个 Chrome 场景，约 1.5 分钟 |
| `pnpm test:e2e tests/e2e/auth-session.spec.ts -g 'auth outages'` | 通过：补充故障界面三种宽度与键盘重试后，两个 locale 定向复核，17.6 秒；并人工查看 375 英文及 1440 中文截图 |
| `BETTER_AUTH_URL=http://localhost:3101 pnpm verify:auth` | 通过：真实本地 PostgreSQL 账号生命周期、输入/来源校验、无效会话读写拒绝、安全返回及账号隔离；临时账号已清理 |
| 真实未配置服务 HTTP 断言 | 3102 端口、空 `BETTER_AUTH_SECRET`；两个 locale 的登录提示、禁用提交、安全重定向及 API 503/no-store 均通过 |
| OpenSpec 严格检查 | `openspec validate b02-auth-session-recovery --strict`、`openspec validate --specs --strict` 通过；5 项任务完成，主规格与 delta 的 5 条要求、8 个场景一致，已归档到 `openspec/changes/archive/2026-11-17-b02-auth-session-recovery/` |
| `python docs/tools/validate_docs.py` | 通过：26 项需求、29 项任务、81 个验收 ID、27 个活动 Markdown、245 个本地链接及样例核对 |

首轮验证曾发现测试定位、整页导航后的响应读取和认证限流准备问题；已修正。退出监听与主动退出的并发跳转也已修复，最终全量和针对性回归结果如上。故障副本中的预期异常日志不等同于测试失败。

环境：Node 24.22.0、pnpm 12.14.0、本机 Chrome、本地已迁移 PostgreSQL。测试应用使用独立端口，已有 3000 服务未停止；本轮启动的临时生产服务已停止。截图/构建副本位于忽略的 `test-results/` 与 `.cache/i18n-app`，不提交凭据或测试生成物。

## 未覆盖范围与下一步

- 本项没有 Schema/认证表选项变更，不适用生成迁移、迁移应用或 DDL 更新。SQLite、memory/Redis、业务 DAO 仍未配置，不声明双后端通过。
- B04 需接入真实品牌分流、允许恢复的非敏感草稿和业务资源归属；当前不能用工作台通过替代 AC-M0-01-1/2/3 的品牌验收。
- 当前无收费业务动作；已验证认证恢复只导航、不会重放写入。未来收费接口仍须独立检查会话、邮箱验证、有效额度、通道和硬预算，不依赖客户端监测。
- B16/B17 的真实邮件、令牌、账号冻结恢复以及真实试点开放条件不在本项范围。服务故障使用隔离副本注入验证，未进行真实外部邮件/GEO 或线上故障演练；未测 Firefox/Safari。
- 当前 GitHub token 缺少 Projects 的 `read:project` 权限，使用现有 `status:in-progress` / `status:done` Labels；Commit SHA、Push 和关闭结果记录在 Issue 交付评论。本轮不部署、不创建分支或 PR，不自动领取下一项。
