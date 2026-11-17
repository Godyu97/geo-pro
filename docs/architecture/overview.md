# 工程架构与实施边界

## 定位与范围

GeoPro 面向中国大陆品牌经营者，将 AI 中的品牌观察连接到真实证据和可核验动作。产品定义以 [Intent](../00-PRODUCT-INTENT.md)、[PRD](../02-产品需求文档-PRD.md)、[公共 SPEC](../04-产品功能规格-SPEC.md) 和 [指标合同](../07-指标与证据合同.md) 为准。

当前完成 [工程初始化任务书](../CODEX_INIT.md) 的 Phase 0，以及 [B01 双语言基础子项](../tasks/B01-i18n.md)：官网、账号认证、受保护的空工作台、迁移与工程文档。**尚未完成产品 M0**，T-M0-01 也仅交付公共双语言子项。

## 需求分层

| 层次 | 权威输入与范围 | 实施状态 |
| --- | --- | --- |
| 产品方向与公共合同 | Intent / PRD / 公共 SPEC / 指标合同；真实回答 → 证据 → 内容动作 → 公开核验 → 同口径复测 | 已定义，不能用页面、构建或演示代替业务验收 |
| 首期界面语言 | [Web 多语言](i18n.md)：zh-CN / en，默认 zh-CN；界面语言与业务 scope 独立 | 当前官网/账号/工作台壳层已接入；JSON 消息、请求 locale、Cookie 偏好与专项检查可用 |
| M0 | [12 项任务](../tasks/M0.md)：单品牌自助、事实/问题、双轨采样、证据诊断、内容交付、人工发布核验和探索复测 | 尚无完整任务交付；T-M0-01 的 B01 子项已实现，其余按授权和依赖推进 |
| M1 / M2 | [M1 的 8 项任务](../tasks/M1.md)：持续经营与团队；[M2 的 6 项任务](../tasks/M2.md)：代理交付、授权连接与受控助理 | 全部待实施，先满足前级门禁和场景条件 |
| 数据工程要求 | [数据访问与缓存](data-access.md)：SQLite3 / pg DAO；memory / Redis（默认）；批量 SQL；精简表结构与索引 | 要求已确认；当前只有 PostgreSQL 认证基线，无业务 DAO 或缓存实现 |
| 数据库部署材料 | [全量 DDL 与部署](database-deployment.md)：随 Schema/migration 更新完整表、约束和索引 | PostgreSQL 已配置导出与检查入口；SQLite 随适配补齐 |

产品对象是业务语义，不直接决定表数量。工程要求、当前事实与实际验收分别记录；详细需求追溯仍由 [追溯矩阵](../06-需求追溯矩阵.md) 和 `product-map.json` 维护。

旧技术架构文件已在 v3.0 停用。当前产品合同不指定技术栈，本轮按初始化任务书选择技术；保留原文档与已有 OpenSpec 文件，不启用 OpenSpec 工作流。任务书要求六个模块占位，而 PRD 要求避免大量无效菜单，因此导航仅定位当前页面中明确标注“尚未开放”的六张卡片，不增加虚假业务路由。竞品入口不意味着后续对比算法提前进入 M0。

## 运行架构与边界

单 Next.js App Router 应用，采用模块化单体。TypeScript strict；Tailwind CSS 与官方 shadcn registry 组件共用浅色、中性和蓝青主题；Lucide 提供图标。Recharts 仅安装，尚无图表和模拟数据。使用系统字体，构建无需下载 Google Fonts。

| 目录 | 职责 |
| --- | --- |
| `src/app/` | 路由、布局、页面组合和 Route Handlers |
| `src/features/` | 品牌、监测、问题、引用、竞品和优化领域；当前仅目录边界说明 |
| `src/components/ui/` | 从官方 registry 安装的基础 UI；移动端 Hook 适配当前 React lint 规则 |
| `src/components/layout/` | 品牌标识、导航元数据、侧栏、认证表单和退出按钮 |
| `src/lib/db/` | PostgreSQL 连接和 CLI 生成的认证 Schema，仅服务端使用 |
| `src/lib/auth/` | Better Auth 服务端工厂、环境校验、客户端、会话门禁和表单校验 |
| `src/lib/ai/`、`src/lib/cache/` | 扩展说明，无 Provider、缓存系统或队列实现 |
| `drizzle/` | 纳入版本控制的 SQL migration、快照和迁移日志 |

`pnpm-workspace.yaml` 仅配置依赖安装脚本许可和两项有范围的安全补丁 override，不声明 workspace packages，也不构成 Monorepo。仅允许必要的 esbuild 安装脚本；保留脚手架对 sharp 与 unrs-resolver 安装脚本的禁用设置。已将间接依赖中受公告影响的 minimatch 与 esbuild 固定到修复版，完整验证见任务记录。

## Server / Client 原则

页面和工作台布局默认使用 Server Components。只有表单、退出按钮、响应式侧栏等交互使用 Client Components。服务端完成身份校验，只将展示需要的用户名称渲染到页面，不序列化完整会话令牌。公开主页不初始化认证；登录页只检查环境配置是否齐全，不连接数据库。`next.config.ts` 关闭自动生成 Agent 规则，保留仓库维护的 `AGENTS.md` 作为规则来源。

数据库和认证实例在首次需要时建立；开发模式复用 PostgreSQL 连接池，避免热更新重复连接。`.env.local` 可缺失，AI Key 可留空，首页、登录页与生产构建仍可运行。缺少认证配置时，登录页显示不可用状态、禁用提交；认证 API 返回固定 503 响应，工作台跳转登录。数据库故障不代表已认证，客户端显示可重试错误。

## 认证与 API 权限

- `GET /api/health`：公开存活检查，仅返回 `status` 和 `service`，不代表数据库就绪，不返回配置与依赖详情。
- `/api/auth/[...all]`：官方 `toNextJsHandler` 委托 Better Auth；启用邮箱/密码注册与登录，使用 `@better-auth/drizzle-adapter`、`provider: pg`，保留框架的来源校验、会话与默认保护。
- `/dashboard`：布局与页面都通过 `requireSession()` 调用服务端 `getSession`。无有效会话跳转 `/login`；不会因 Cookie 存在、伪造或过期而放行。
- 退出通过 Better Auth 撤销数据库会话；旧 Cookie 无法继续进入控制台。未实现邮件验证、找回密码、社交登录、短信或复杂角色权限。
- 后续每个敏感 API/Server Action 必须独立校验会话与资源归属，不能只依赖布局门禁。输入用 Zod 验证，错误输出不带内部异常、数据库 URL 或密钥。

## Schema 与迁移

`auth.schema.config.ts` 加载 Next 环境文件，复用 `src/lib/auth/options.ts`，供官方 Auth CLI 在无数据库连接、无循环导入时生成 Schema。运行时才组合完整 Drizzle Adapter。四张认证表和关系均来自 CLI，不手工推测认证字段。

`drizzle.config.ts` 通过 `@next/env` 加载根目录 `.env.local`。`db:generate` 无需数据库或 URL；`db:migrate` 要求明确配置的数据库。迁移先生成、审核，再应用到目标环境，不能用 `push` 绕过记录。

每次 Schema/migration 变更同步运行 `pnpm db:ddl` 与 `pnpm db:ddl:check`，维护 `drizzle/ddl/postgresql.sql` 全量快照。项目数据库快速部署继续通过 `pnpm db:migrate` 建立迁移历史；直接导入全量 SQL 的空库限制与后续升级边界见 [数据库部署说明](database-deployment.md)。

可选 `compose.yaml` 只提供本机 PostgreSQL，绑定 `127.0.0.1:55432`；显式 Compose 项目名 `geo-pro-phase0` 隔离已有容器，避免占用本机原有 5432 服务。Docker 不是构建前提，可替换成其他开发 PostgreSQL。

## 未来扩展路径

先在对应 `features/` 内落地最小业务用例与资源归属，再由薄页面/API 调用。数据库访问经 DAO 隔离 SQLite3 / PostgreSQL 方言；缓存经统一入口适配 memory / Redis，默认 Redis。具体合同、批量查询、索引审查和失败行为遵循 [数据访问与缓存工程约束](data-access.md)，按已授权用例实现，不提前铺设全部领域表或通用框架。

只有采样耗时、重试和任务恢复有实际需求时，才把执行入口与处理函数分离，使用持久任务记录描述状态；后续可将处理函数移到独立 Worker。Redis 缓存要求不自动引入队列、微服务、Worker 或调度器；初始化任务书中的 Redis 暂缓仅描述当时的 Phase 0 范围。

Phase 0 尚未实现任何品牌 CRUD、真实 GEO 采样、AI 调用、网页抓取、引用解析、指标计算、内容生产、竞品算法、报告、发布、支付、多租户计费、CI/CD 或外部渠道验证。

验证证据和剩余事项见 [Phase 0 任务记录](../tasks/phase-0.md)。

## 官方实现依据

- [Next.js 安装与 CLI](https://nextjs.org/docs/app/getting-started/installation)
- [shadcn CLI 与官方 registry](https://ui.shadcn.com/docs/cli)
- [Better Auth Next.js Handler](https://better-auth.com/docs/integrations/next)
- [Better Auth Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth CLI](https://better-auth.com/docs/concepts/cli)
- [Next.js 环境变量与 @next/env](https://nextjs.org/docs/app/guides/environment-variables)

执行时按 npm 稳定 dist-tag 和上述官方接口核实版本；未采用 Drizzle 文档中的 RC 安装示例，使用稳定发布版本。
