# B15 账户设置交付

本项按 D6 补齐 M0 的个人资料入口。[Issue #15](https://github.com/Godyu97/geo-pro/issues/15) · [PRD PAGE-08](../02-产品需求文档-PRD.md)

OpenSpec 已归档 `b15-account-settings`，主规格包含 3 条要求和 9 个场景。[账户设置规格](https://github.com/Godyu97/geo-pro/blob/main/openspec/specs/account-settings/spec.md) · [变更归档](https://github.com/Godyu97/geo-pro/blob/main/openspec/changes/archive/2026-11-18-b15-account-settings/proposal.md)

## 实现与决策

- `/dashboard/settings` 由工作台导航进入。页面独立核验服务端会话，显示只读登录邮箱，支持本人称呼编辑，并提供界面语言、当前会话退出及数据管理状态。
- `src/features/account/` 负责页面、表单与 Better Auth 请求校验。称呼沿用注册规则，先去首尾空白再按 Unicode 码点计 1–80 个字符。认证入口拒绝所有额外字段，写入目标由服务端会话决定。表单标识用于检测会话切换后仍打开的旧页面。
- 写入沿用认证适配器和 `user` 主键，两种后端使用同一业务校验。会话和工作台在保存后重新读取称呼。数据库失败返回安全错误，服务端记录固定事件 `auth-api-unavailable`。
- 语言切换复用界面偏好 Cookie，保留设置页位置、会话及页内称呼输入。失效会话沿用 B02 的白名单恢复位置，用户可以重新登录后主动编辑。
- 数据访问沿用现有认证表与迁移，无新增依赖、索引、迁移或缓存。

## 验证记录

| 检查 | 实际结果 |
| --- | --- |
| 基础门禁 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。生产构建显式清空数据库及认证配置后通过 |
| 认证与资料 | `pnpm verify:maintenance` 在隔离 SQLite3 和 PostgreSQL 上运行真实 HTTP 与 `pnpm verify:auth`。覆盖本人写入与持久化、80/81 字符边界、非法输入、额外字段、账号切换、并发重试、会话撤销和实际数据库写入失败，均通过 |
| 维护及 DDL 回归 | `pnpm test:maintenance` 25 项通过。`pnpm db:ddl:check` 双方言通过。隔离 PostgreSQL 和独立 SQLite 测试库应用了现有迁移 |
| 多语言基础 | `pnpm check:i18n` 校验 190 个消息键与参数。`pnpm test:i18n` 6 项通过 |
| Chrome 浏览器 | `pnpm test:e2e` 全量 50 项通过。最终表单调整后，`pnpm test:e2e tests/e2e/account-settings.spec.ts` 9 项通过。覆盖双语 375/768/1440、字段错误与焦点、IME、语言切换、加载、503 保存反馈、刷新持久化、无效会话与登录恢复 |
| 产品文档 | `python docs/tools/validate_docs.py` 通过 |

首次全量浏览器运行有一条中文会话恢复用例在清理浏览器上下文时超时。补上首次会话读取同步点后完整复跑通过。

### 资料查询证据

在隔离库使用现有 Better Auth 与 Drizzle 适配器记录新鲜会话的 SQL。每次读取检查会话和本人账号，共 2 条查询。每次保存增加 1 次按本人主键更新，共 3 条。按批次录入 10 和 500 个合成账号后，查询数一致。以下为单次调用观测，不作为响应承诺。

| 后端 | 10 个合成账号读取 / 保存 | 500 个合成账号读取 / 保存 | 写入计划 |
| --- | --- | --- | --- |
| SQLite3 | 7.51 / 10.59 ms | 3.43 / 5.10 ms | `sqlite_autoindex_user_1`，按 `id` 定位 |
| PostgreSQL | 8.00 / 12.66 ms | 7.38 / 11.21 ms | `user_pkey`，按 `id` 定位 |

## 验收边界

资料和语言请求只操作当前账号称呼及界面偏好。真实品牌归属场景待 B04 落地后联调。数据管理区如实显示自助导出和删除尚未开放，功能由 B05–07 承接。验证在隔离本地环境执行，浏览器范围为 Chrome，未做线上部署。本项不勾选完整 M0。
