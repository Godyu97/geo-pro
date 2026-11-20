# 工程架构与实施边界

## 定位与范围

GeoPro 面向中国大陆品牌经营者，将 AI 中的品牌观察连接到真实证据和可核验动作。产品定义以 [Intent](../00-PRODUCT-INTENT.md)、[PRD](../02-产品需求文档-PRD.md)、[公共 SPEC](../04-产品功能规格-SPEC.md) 和 [指标合同](../07-指标与证据合同.md) 为准。

当前完成 [Phase 0](../CODEX_INIT.md)，以及 [M0 任务基线](../tasks/M0.md) 中记录到 #39 的隔离软件。[M0-40](../tasks/M0-40-operations-baseline.md) 提供运行手册和空白试点模板。**产品 M0 与 AC-M0-GATE 尚未通过。** 常规环境的品牌资料入口保持关闭；官方采样和公开抓取默认 fail-closed。#21、#31、#32 仍因缺少真实发信、可授权通道和获准试点而阻塞。

## 需求分层

| 层次 | 权威输入与范围 | 实施状态 |
| --- | --- | --- |
| 产品方向与公共合同 | Intent / PRD / 公共 SPEC / 指标合同；真实回答 → 证据 → 内容动作 → 公开核验 → 同口径复测 | 已定义，不能用页面、构建或演示代替业务验收 |
| 首期界面语言 | [Web 多语言](i18n.md)：zh-CN / en，默认 zh-CN；界面语言与业务 scope 独立 | 官网、账号、工作台和已交付业务页已接入。隔离浏览器检查见 [M0-39](../tasks/M0-39-browser-e2e.md)。阶段门禁仍要按双语言矩阵单独记录 |
| M0 | [12 项任务](../tasks/M0.md)：单品牌自助、事实/问题、双轨采样、证据诊断、内容交付、人工发布核验和探索复测 | 隔离软件已有 #1–#30 与 #34–#39 的交付记录。已勾选的只有 T-M0-07 和 T-M0-08。T-M0-09 至 T-M0-12 已有隔离实现，因缺少真实生成、发布或前后采样而保持未勾选 |
| M1 / M2 | [M1 的 8 项任务](../tasks/M1.md)：持续经营与团队；[M2 的 6 项任务](../tasks/M2.md)：代理交付、授权连接与受控助理 | 全部待实施，先满足前级门禁和场景条件 |
| 数据工程要求 | [数据访问与缓存](data-access.md)：SQLite3 / pg DAO；memory / Redis（默认）；批量 SQL；精简表结构与索引 | 已交付业务 DAO 按任务适配双库。证据概览和支持定位使用统一缓存，默认 Redis。只有 `GEO_CACHE_DRIVER=memory` 才使用进程内缓存；Redis 未配置或不可达时回源数据库 |
| 数据库部署材料 | [全量 DDL 与部署](database-deployment.md)：随 Schema/migration 更新完整表、约束和索引 | PostgreSQL / SQLite 均有独立迁移、全量 DDL 与检查 |

产品对象是业务语义，不直接决定表数量。工程要求、当前事实与实际验收分别记录；详细需求追溯仍由 [追溯矩阵](../06-需求追溯矩阵.md) 和 `product-map.json` 维护。

旧技术架构文件已在 v3.0 停用；当前沿用初始化技术栈。已授权任务按需使用 OpenSpec。工作台首页的模块卡片仍显示未开放；品牌只在回环隔离开关下显示可测状态。竞品域和独立引用域没有页面。监测、证据、优化、内容、报告和维护能力通过各自路由进入，首页卡片上的“未开放”不表示这些路由不存在。

## 运行架构与边界

单 Next.js App Router 应用，采用模块化单体。TypeScript strict；Tailwind CSS 与官方 shadcn registry 组件共用浅色、中性和蓝青主题；Lucide 提供图标。Recharts 仅安装，尚无图表和模拟数据。使用系统字体，构建无需下载 Google Fonts。

| 目录 | 职责 |
| --- | --- |
| `src/app/` | 路由、布局、页面组合和 Route Handlers |
| `src/features/` | `marketing`、`account`、`brands`、`brand-facts`、`prompts`、`capabilities`、`quotas`、`monitoring`、`evidence`、`optimization`、`content`、`reports`、`data-exports`、`support`、`maintenance`。`citations` 仍是占位说明 |
| `src/components/ui/` | 从官方 registry 安装的基础 UI；移动端 Hook 适配当前 React lint 规则 |
| `src/components/layout/` | 品牌标识、导航元数据、侧栏、认证表单和退出按钮 |
| `src/lib/db/` | 双后端连接与当前 Schema/迁移，仅服务端使用 |
| `src/lib/auth/` | Better Auth 服务端工厂、环境校验、客户端、会话门禁和表单校验 |
| `src/lib/ai/`、`src/lib/cache/`、`src/lib/http/` | Responses API 客户端、默认关闭的官方采样适配器、memory/Redis 缓存，以及默认关闭的公开页只读抓取。采样和抓取在配置不齐时拒绝执行 |
| `drizzle/` | 纳入版本控制的 SQL migration、快照和迁移日志 |

`pnpm-workspace.yaml` 仅配置依赖安装脚本许可和两项有范围的安全补丁 override，不声明 workspace packages，也不构成 Monorepo。仅允许必要的 esbuild 安装脚本；保留脚手架对 sharp 与 unrs-resolver 安装脚本的禁用设置。已将间接依赖中受公告影响的 minimatch 与 esbuild 固定到修复版，完整验证见任务记录。

## Server / Client 原则

页面和工作台布局默认使用 Server Components；表单、退出、侧栏等交互最小化客户端边界。公开入口按真实会话分流，维护页面/API 分别鉴权；完整会话令牌不进入展示数据。`next.config.ts` 保留仓库自有 `AGENTS.md`，关闭自动生成规则。

数据库和认证实例在首次需要时建立；开发模式复用 PostgreSQL 连接池，避免热更新重复连接。`.env.local` 可缺失，AI Key 可留空，首页、登录页与生产构建仍可运行。缺少认证配置时，登录页显示不可用状态、禁用提交；认证 API 返回固定 503 响应，工作台跳转登录。数据库故障不代表已认证，客户端显示可重试错误。

## 认证与 API 权限

- `GET /api/health`：公开存活检查，仅返回 `status` 和 `service`，不代表数据库就绪，不返回配置与依赖详情。
- `/api/auth/[...all]`：官方 `toNextJsHandler` 和 Drizzle Adapter；按显式数据库选择 pg/sqlite provider，保留来源校验、会话与默认保护。
- `/dashboard`：布局与页面都通过 `requireSession()` 调用服务端 `getSession`。无有效会话跳转 `/login`；不会因 Cookie 存在、伪造或过期而放行。
- 退出通过 Better Auth 撤销数据库会话；旧 Cookie 无法继续进入控制台。邮箱验证和密码找回已有服务端流程；真实网关投递仍是 #21 的开放条件。未实现社交登录、短信和多角色权限。
- 后续每个敏感 API/Server Action 必须独立校验会话与资源归属，不能只依赖布局门禁。输入用 Zod 验证，错误输出不带内部异常、数据库 URL 或密钥。
- `/dashboard/maintenance`、`/api/maintenance/access`：当前会话 + 三项独立持久授权；只显示本人权限，不扩大客户资料范围。受控 CLI、事务审计和故障行为见 [维护说明](maintenance-access.md)。

## Schema 与迁移

`auth.schema.config.ts` 加载 Next 环境文件，复用 `src/lib/auth/options.ts`，供官方 Auth CLI 在无数据库连接、无循环导入时生成 Schema。运行时才组合完整 Drizzle Adapter。四张认证表和关系均来自 CLI，不手工推测认证字段。

`drizzle.config.ts` 与 `drizzle.sqlite.config.ts` 分别维护双方言。`db:generate` 离线生成两者；`db:migrate` 只迁移显式后端。SQLite 使用 Node 24 原生驱动与 Drizzle journal/parser 的原子迁移，外键启用；迁移先审核，不用 `push` 绕过记录。

每次 Schema/migration 变更同步运行 `pnpm db:ddl` 与 `pnpm db:ddl:check`，维护 `drizzle/ddl/postgresql.sql` 和 `sqlite.sql`。快速部署通过 `pnpm db:migrate` 建立历史；全量导入的空库限制及升级边界见 [数据库部署说明](database-deployment.md)。

可选 `compose.yaml` 只提供本机 PostgreSQL，绑定 `127.0.0.1:55432`；显式 Compose 项目名 `geo-pro-phase0` 隔离已有容器，避免占用本机原有 5432 服务。Docker 不是构建前提，可替换成其他开发 PostgreSQL。

## 未来扩展路径

先在对应 `features/` 内落地最小业务用例与资源归属，再由薄页面/API 调用。数据库访问经 DAO 隔离 SQLite3 / PostgreSQL 方言；缓存经统一入口适配 memory / Redis，默认 Redis。具体合同、批量查询、索引审查和失败行为遵循 [数据访问与缓存工程约束](data-access.md)，按已授权用例实现，不提前铺设全部领域表或通用框架。

只有采样耗时、重试和任务恢复有实际需求时，才把执行入口与处理函数分离，使用持久任务记录描述状态；后续可将处理函数移到独立 Worker。Redis 缓存要求不自动引入队列、微服务、Worker 或调度器；初始化任务书中的 Redis 暂缓仅描述当时的 Phase 0 范围。

隔离环境已经实现品牌建档、事实、题集、额度、通道台账、监测执行、证据与概览、优化任务、内容草稿和审核导出、发布核验、复测快照、本人导出和到期清除。常规环境的品牌收集保持关闭。真实官方 API、消费者入口、外网站点试点、生产备份和 AC-M0-GATE 仍未完成。支付、多租户计费、自动发布和外部 CMS 仍未实现。

历史基线见 [Phase 0](../tasks/phase-0.md)。维护授权见 [B08 记录](../tasks/B08-maintenance-access.md)，双库集成见 [M0-38](../tasks/M0-38-dual-database-verification.md)，运行步骤见 [M0 运行手册](../operations/m0-runbook.md)。这些记录都不代表 M0 业务闭环完成。

## 官方实现依据

- [Next.js 安装与 CLI](https://nextjs.org/docs/app/getting-started/installation)
- [shadcn CLI 与官方 registry](https://ui.shadcn.com/docs/cli)
- [Better Auth Next.js Handler](https://better-auth.com/docs/integrations/next)
- [Better Auth Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth CLI](https://better-auth.com/docs/concepts/cli)
- [Next.js 环境变量与 @next/env](https://nextjs.org/docs/app/guides/environment-variables)

执行时按 npm 稳定 dist-tag 和上述官方接口核实版本；未采用 Drizzle 文档中的 RC 安装示例，使用稳定发布版本。
