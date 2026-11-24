# M0 #135 登录与密码找回回归

2026-11-24 · [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉合同与验收清单](../08-验收场景与样例.md#ui-visual-checks) · [B02 会话恢复](B02-auth-session.md) · [B17 密码找回](B17-account-email-recovery.md)

未登录的品牌负责人从工作台深链接进入登录和密码找回时，应该能用键盘修正表单、重设密码，并回到原来的筛选和页内位置。本轮覆盖 `ui-visual-v1` 的账号入口、校验和状态反馈、双语响应式及登录恢复流程，对应 [S-M0-01 自助入口](../specs/M0.md#s-m0-01) 的账号前置。

## 缺口与交付

- 在基线 `04551fc0193ca6e4e324885ada83a083215a1ec8`，使用 Chrome 打开 `/dashboard/settings?tab=security#security`。未登录的浏览器进入 `/login` 时仍有 `#security`。从中文 1440 像素页面按 Enter 打开「忘记密码」后，回归断言失败，找回页的 `returnTo` 只有 `/dashboard/settings?tab=security`。
- 登录成功和找回入口复用安全返回地址处理。由会话校验引导至登录时，找回链接将浏览器保留的页内片段写入既有 `returnTo`。显式返回地址已有片段时优先用显式片段，且返回地址仍经过工作台白名单校验。
- 涉及 `/login` 的页面接线、`AuthForm` 的返回地址处理，以及 `verify-account-email` 的浏览器走查。复用原有登录、找回、邮件令牌、会话验证和样式。

## 验收范围

| 场景 | 核验方法 |
| --- | --- |
| 登录、找回的字段校验和键盘路径 | `zh-CN` 和 `en` 分别使用 375、768、1440 像素宽视口，按 Enter 空提交，检查邮箱焦点和可访问描述。用 Tab 到找回入口并打开，检查地址、页面标题和横向溢出。 |
| 找回请求、重设与重新登录 | 两种语言分别经浏览器提交找回，使用该次请求在回环接收器收到的链接。重设后旧密码返回 401 并显示本地化错误，新密码登录后核对安全区地址。 |
| 会话恢复及拒绝 | 浏览器隔离副本核对会话过期、恢复原位置、无自动重放、服务故障提示及重试。开发 PostgreSQL 用临时账号核对注册、读写权限、过期和撤销。 |

Chrome 的 375 像素登录与找回校验截图保存在 `.cache/account-email-results/`，文件名为 `<locale>-login-validation.png` 与 `<locale>-recovery-validation.png`。截图在空表单校验后生成，画面没有账号、密码或令牌。

## 检查记录

| 命令 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3033 个消息键与 7 项测试。 |
| `pnpm test:e2e tests/e2e/i18n.spec.ts tests/e2e/auth-session.spec.ts` | 23 项通过。本机 Chrome 使用临时 PostgreSQL、memory 缓存和开发邮件 Mock。临时账号及库已清理。 |
| `pnpm env:check` | 15 项通过，开发 PostgreSQL、Redis、对象存储和邮件 Mock 配置完成实测。 |
| `pnpm verify:auth` | 通过。回环应用和开发 PostgreSQL 上核对持久化、错误密码、本人和另一账号隔离，以及伪造、过期和撤销会话。两个临时账号已清理。 |
| `pnpm verify:account-email` | 通过。SQLite3 和 PostgreSQL 隔离库核对一次性链接、限流、会话撤销和未配置反馈。PostgreSQL 的 Chrome 双语走查核对了原链接找回和重新登录。隔离库和回环接收器已清理。 |
| `python3 docs/tools/validate_docs.py` | 通过，26 项需求、29 项任务、81 个验收 ID 和 733 个本地链接。 |

账号邮件专项在补充走查时先出现等待回执超时，随后因 Next.js 路由播报和表单同时存在 `role=alert` 导致断言失败。现已等待找回页标题再填表，并将拒绝提示断言限定在登录表单内。

## 剩余范围

继续核对工单尚未覆盖的工作台路由及其加载、失败、空态和权限状态。下一轮可从优化入口进入，用两种语言及三种宽度检查页面任务、主要动作和键盘路径，并补全全站覆盖记录。消息投递专项使用回环接收器。正式 M0 试点由对应的阶段验收工单记录。
