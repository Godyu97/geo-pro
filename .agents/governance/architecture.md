# 架构边界规范

本规范基于仓库当前实际结构（`Next.js App Router` + `src/` 单体工程），约束未来模块演进。详细 Phase 0 基线参见 [架构总览](../../docs/architecture/overview.md)。

## 工程结构与目录职责

当前采用单一 Next.js 全栈应用（模块化单体），保留现有目录分工，不得为套用外部模板而迁移源码：

- `src/app/`：仅负责路由、布局、页面组合与 Route Handlers。保持页面与 Handler 薄层，不承载复杂领域逻辑。
- `src/features/<domain>/`：按业务领域存放组件、服务、校验与用例。当前保留 6 个边界占位域（`brands`、`monitoring`、`prompts`、`citations`、`competitors`、`optimization`），业务未启动前不提前定义虚构子目录。
- `src/components/ui/`：仅放基础设计系统组件（shadcn/ui）；`src/components/layout/` 放页面壳层与导航交互组件。
- `src/lib/`：基础设施封装（`db/`、`auth/`、`ai/`、`cache/`、`utils.ts`）。含数据库连接、密钥或服务端配置逻辑的模块必须标记 `"server-only"`。
- `drizzle/`：纳入版本控制的 SQL migration、快照与迁移日志。

## Server / Client Component 边界

- **默认使用 Server Components**：页面、布局和只读数据展示均优先在服务端渲染完成。
- **最小化 `"use client"`**：仅在确实需要表单状态、浏览器事件、Hook 或局部交互（如登录表单、退出按钮、响应式侧栏）时拆出局部 Client Component。
- **严禁服务端边界泄漏**：不得将数据库连接、服务端环境变量、完整会话令牌或仅服务端依赖传递或导入到 Client Components。
- **多语言请求边界**：首期 `zh-CN` / `en` 的 locale 在服务端按请求解析，客户端沿用同一初始值；消息、Metadata、格式化和缓存按 [Web 多语言规范](../../docs/architecture/i18n.md) 处理，不以全局可变语言或整站客户端化实现切换。

## Route Handler 与 API 边界

- **明确公开与私有边界**：
  - 公开接口（如 `GET /api/health`、Better Auth `/api/auth/[...all]`）只返回最小必要状态，健康检查不暴露配置或数据库详情。
  - 私有业务接口与 Server Actions 必须独立校验服务端会话（`auth.api.getSession`）和资源归属，不能仅依赖外层布局鉴权。
- **显式输入输出与错误契约**：入口参数使用 Zod 校验；错误响应返回结构化信息与合理 HTTP 状态码，不暴露内部异常堆栈或连接信息。

## 演进与克制原则

- **不提前引入全局状态管理**：当前无跨页面复杂客户端共享状态需求，不引入 Redux、Zustand 等状态库。
- **数据访问与缓存**：DAO 支持 SQLite3 / pg、cache 支持 memory / Redis（默认）是已确认工程要求，遵循 [数据访问与缓存工程约束](../../docs/architecture/data-access.md)。B08 已接入认证及维护授权双库；其他用例按授权落地，不提前建设通用框架，尚无缓存实现。
- **不提前拆分微服务或任务基础设施**：仅当真实业务出现耗时任务、失败重试与状态恢复需求时，再优先以持久化任务记录分离触发与执行，不提前引入独立队列、后台 Worker 或微服务。Redis 缓存选型不构成引入 Redis 队列或锁的授权。
- **优先使用 Next.js 原生能力**：路由分组、服务端渲染、Metadata、Route Handlers 与 Server Actions。
- **数据库 Schema 演进**：Better Auth 认证表始终走官方生成链；`pnpm db:auth-schema`、`pnpm db:generate` 生成双方言，`pnpm db:migrate` 按显式后端配置执行，见 [数据库部署](../../docs/architecture/database-deployment.md)。表结构保持精简并按访问路径审查索引，先审核 SQL 再迁移，不用 `push` 替代迁移。
- **全量 DDL 维护**：Schema/migration 变更必须同步执行 `pnpm db:ddl` 与 `pnpm db:ddl:check`，维护全部应用表、约束与索引；空库部署和迁移历史边界遵循 [数据库部署说明](../../docs/architecture/database-deployment.md)。
- **随规模渐进建立边界**：当某业务领域代码增长时，再在对应 `src/features/<domain>/` 内部细分 `components/`、`server/`、`schemas/` 等结构。
