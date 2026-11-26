# 工程架构与实施边界

## 定位与范围

GeoPro 面向中国大陆品牌经营者，将 AI 中的品牌观察连接到真实证据和可核验动作。产品定义以 [Intent](../00-PRODUCT-INTENT.md)、[PRD](../02-产品需求文档-PRD.md)、[公共 SPEC](../04-产品功能规格-SPEC.md) 和 [指标合同](../07-指标与证据合同.md) 为准。

Phase 0 与各阶段的软件切片见 [交付进度](../tasks/delivery-progress.md)。二期的普通用户入口、group 与管理员工作台、真实使用走查按[模块首版计划](../tasks/phase-2.md)跟踪。开发环境真实数据联调的路径见 [品牌管理与 AI 品牌监测](../tasks/brand-monitoring-next.md)。

## 需求分层

| 层次 | 权威输入与范围 | 实施状态 |
| --- | --- | --- |
| 产品方向与公共合同 | Intent / PRD / 公共 SPEC / 指标合同；真实回答 → 证据 → 内容动作 → 公开核验 → 同口径复测 | 已定义，不能用页面、构建或演示代替业务验收 |
| 首期界面语言 | [Web 多语言](i18n.md)：zh-CN / en，默认 zh-CN；界面语言与业务 scope 独立 | 官网、账号、工作台和已交付业务页已接入。隔离浏览器检查见 [M0-39](../tasks/M0-39-browser-e2e.md)。阶段门禁仍要按双语言矩阵单独记录 |
| M0 | [12 项任务](../tasks/M0.md)覆盖单品牌自助、事实/问题、双轨采样、证据诊断、内容交付、人工发布核验和探索复测 | 已有隔离实现及双语浏览器证据，T-M0-07 与 T-M0-08 已勾选。正式阶段门禁待验证 |
| M1 / M2 | [M1](../tasks/M1.md)覆盖持续经营与团队，[M2](../tasks/M2.md)覆盖代理交付、授权连接与受控助理 | 已有计划、告警、团队授权、资料复用、报告、受控连接及助理等软件切片。真实验收随各阶段记录 |
| 数据工程要求 | [数据访问与缓存](data-access.md)：SQLite3 / pg DAO；memory / Redis（默认）；批量 SQL；精简表结构与索引 | 已交付业务 DAO 按任务适配双库。证据概览和支持定位使用统一缓存，默认 Redis。只有 `GEO_CACHE_DRIVER=memory` 才使用进程内缓存；Redis 未配置或不可达时回源数据库 |
| 数据库部署材料 | [全量 DDL 与部署](database-deployment.md)：随 Schema/migration 更新完整表、约束和索引 | PostgreSQL / SQLite 均有独立迁移、全量 DDL 与检查 |
| 对象存储 | [对象存储 PRD](../oss/01-对象存储需求-PRD.md) 与 [对象存储 SPEC](../oss/02-对象存储功能规格-SPEC.md) 规定 S3 协议、私有访问、摘要与清除 | 用户文件通过 `src/lib/storage/` 写入 S3，`stored_object` 保存元数据。历史记录按各业务兼容路径读取 |

产品对象是业务语义，不直接决定表数量。工程要求、当前事实与实际验收分别记录；详细需求追溯仍由 [追溯矩阵](../06-需求追溯矩阵.md) 和 `product-map.json` 维护。

工作台通过各领域路由提供品牌、监测、竞品和来源、优化、内容、报告、团队与维护入口。一期已在获准开发入口接通真实品牌、事实和题集。二期将这条路径接到普通用户工作台。

## 运行架构与边界

单 Next.js App Router 应用，采用模块化单体。TypeScript strict，界面使用 Tailwind CSS、shadcn 和 Lucide。系统字体随客户端环境提供。

| 目录 | 职责 |
| --- | --- |
| `src/app/` | 路由、布局、页面组合和 Route Handlers |
| `src/features/` | `marketing`、`account`、`brands`、`brand-facts`、`prompts`、`capabilities`、`quotas`、`monitoring`、`evidence`、`optimization`、`content`、`reports`、`data-exports`、`support`、`maintenance`。`citations` 仍是占位说明 |
| `src/components/ui/` | 从官方 registry 安装的基础 UI；移动端 Hook 适配当前 React lint 规则 |
| `src/components/layout/` | 品牌标识、导航元数据、侧栏、认证表单和退出按钮 |
| `src/lib/db/` | 双后端连接与当前 Schema/迁移，仅服务端使用 |
| `src/lib/auth/` | Better Auth 服务端工厂、环境校验、客户端、会话门禁和表单校验 |
| `src/lib/ai/`、`src/lib/cache/`、`src/lib/http/` | Responses API 客户端、受控官方采样适配器、Redis 与 memory 缓存、公开页只读抓取 |
| `src/lib/storage/`、`src/features/stored-objects/` | S3 客户端、对象元数据、授权读写、指纹校验和删除 |
| `drizzle/` | 纳入版本控制的 SQL migration、快照和迁移日志 |

`pnpm-workspace.yaml` 仅配置依赖安装脚本许可和两项有范围的安全补丁 override，不声明 workspace packages，也不构成 Monorepo。仅允许必要的 esbuild 安装脚本；保留脚手架对 sharp 与 unrs-resolver 安装脚本的禁用设置。已将间接依赖中受公告影响的 minimatch 与 esbuild 固定到修复版，完整验证见任务记录。

## Server / Client 原则

页面和工作台布局默认使用 Server Components；表单、退出、侧栏等交互最小化客户端边界。公开入口按真实会话分流，维护页面/API 分别鉴权；完整会话令牌不进入展示数据。`next.config.ts` 保留仓库自有 `AGENTS.md`，关闭自动生成规则。

数据库和认证实例按需建立，开发模式复用 PostgreSQL 连接池。运行时认证不完整或数据库故障时，认证入口返回受控的不可用状态。

<a id="development-services"></a>
### 开发服务与启动

常规 `pnpm dev` 和 `pnpm start` 启动前校验四组显式配置。PostgreSQL 设置 `DATABASE_URL`，SQLite 设置 `DATABASE_PROVIDER=sqlite` 和 `SQLITE_PATH`；Redis 设置 `REDIS_URL`；S3 设置 `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID` 和 `S3_SECRET_ACCESS_KEY`；认证设置 `BETTER_AUTH_URL` 和 `BETTER_AUTH_SECRET`。通过 `.env.local` 或进程配置注入。纯构建可离线执行。

`pnpm env:check` 读取所选开发库的认证与品牌表，读写并清理 Redis 临时键和 S3 对象探针。配置浏览器预签名时另填 `S3_ENDPOINT_BROWSER`；客户端可达性由下载联调验证。AI 连通性可用 `pnpm env:check --probe-ai` 检查。正常运行读取开发库或部署库，双库自动化只在显式指定的测试 PostgreSQL 以及隔离 SQLite 上建测试数据。

## 认证与 API 权限

- `GET /api/health`：公开存活检查，仅返回 `status` 和 `service`，不代表数据库就绪，不返回配置与依赖详情。
- `/api/auth/[...all]`：官方 `toNextJsHandler` 和 Drizzle Adapter；按显式数据库选择 pg/sqlite provider，保留来源校验、会话与默认保护。
- `/dashboard`：布局与页面都通过 `requireSession()` 调用服务端 `getSession`。无有效会话跳转 `/login`；不会因 Cookie 存在、伪造或过期而放行。
- 退出通过 Better Auth 撤销数据库会话。邮箱验证和密码找回已有服务端流程，开发使用长期邮件 Mock，生产投递证据归 #21。团队授权与撤销在 `src/features/team-access/` 层实现。
- 后续每个敏感 API/Server Action 必须独立校验会话与资源归属，不能只依赖布局门禁。输入用 Zod 验证，错误输出不带内部异常、数据库 URL 或密钥。
- `/dashboard/maintenance`、`/api/maintenance/access`：当前会话 + 三项独立持久授权；只显示本人权限，不扩大客户资料范围。受控 CLI、事务审计和故障行为见 [维护说明](maintenance-access.md)。

## Schema 与迁移

`auth.schema.config.ts` 加载 Next 环境文件，复用 `src/lib/auth/options.ts`，供官方 Auth CLI 在无数据库连接、无循环导入时生成 Schema。运行时才组合完整 Drizzle Adapter。四张认证表和关系均来自 CLI，不手工推测认证字段。

`drizzle.config.ts` 与 `drizzle.sqlite.config.ts` 分别维护双方言。`db:generate` 离线生成两者；`db:migrate` 只迁移显式后端。SQLite 使用 Node 24 原生驱动与 Drizzle journal/parser 的原子迁移，外键启用；迁移先审核，不用 `push` 绕过记录。

每次 Schema/migration 变更同步运行 `pnpm db:ddl` 与 `pnpm db:ddl:check`，维护 `drizzle/ddl/postgresql.sql` 和 `sqlite.sql`。快速部署通过 `pnpm db:migrate` 建立历史；全量导入的空库限制及升级边界见 [数据库部署说明](database-deployment.md)。

日常开发使用已配置的开发库，手动建本地 PostgreSQL 可使用 Compose 的 `local-postgres` profile 并配置目标端口与凭据。 [数据库部署说明](database-deployment.md#database-setup)

## 未来扩展路径

先在对应 `features/` 内落地最小业务用例与资源归属，再由薄页面/API 调用。数据库访问经 DAO 隔离 SQLite3 / PostgreSQL 方言；缓存经统一入口适配 memory / Redis，默认 Redis。具体合同、批量查询、索引审查和失败行为遵循 [数据访问与缓存工程约束](data-access.md)，按已授权用例实现，不提前铺设全部领域表或通用框架。

只有采样耗时、重试和任务恢复有实际需求时，才把执行入口与处理函数分离，使用持久任务记录描述状态；后续可将处理函数移到独立 Worker。Redis 缓存要求不自动引入队列、微服务、Worker 或调度器；初始化任务书中的 Redis 暂缓仅描述当时的 Phase 0 范围。

监测运行和预算已持久化。官方端口已有 HTTP 适配与隔离契约，工作台运行控制当前只接入功能 mock 的执行动作。消费者证据走人工路径。受控开发环境的官方执行入口、结果入证和持续计划联调见 [下一阶段计划](../tasks/brand-monitoring-next.md)。

历史基线见 [Phase 0](../tasks/phase-0.md)。维护授权见 [B08 记录](../tasks/B08-maintenance-access.md)，双库集成见 [M0-38](../tasks/M0-38-dual-database-verification.md)，运行步骤见 [M0 运行手册](../operations/m0-runbook.md)。这些记录都不代表 M0 业务闭环完成。

## 官方实现依据

- [Next.js 安装与 CLI](https://nextjs.org/docs/app/getting-started/installation)
- [shadcn CLI 与官方 registry](https://ui.shadcn.com/docs/cli)
- [Better Auth Next.js Handler](https://better-auth.com/docs/integrations/next)
- [Better Auth Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth CLI](https://better-auth.com/docs/concepts/cli)
- [Next.js 环境变量与 @next/env](https://nextjs.org/docs/app/guides/environment-variables)

执行时按 npm 稳定 dist-tag 和上述官方接口核实版本；未采用 Drizzle 文档中的 RC 安装示例，使用稳定发布版本。
