# 项目事实上下文（Project Context）

> 更新日期：2026-11-18｜事实来源：仓库实际配置文件与源码检查（非模板假设）。若技术栈、版本或目录发生实质变化，须同步更新本文件。

## 1. 项目概览

- **包名与版本**：`geo-pro` v`0.1.0`（`"private": true`，`"type": "module"`，见 [package.json](../../package.json)）
- **定位**：GeoPro（AI GEO），面向中国大陆品牌经营者的品牌可见度监测与优化平台。
- **当前实施阶段**：已完成 [Phase 0 工程初始化](../../docs/tasks/phase-0.md)，T-M0-01 的 [B01 双语言](../../docs/tasks/B01-i18n.md)、[B02 认证恢复](../../docs/tasks/B02-auth-session.md)、[B03 可信官网](../../docs/tasks/B03-marketing-entry.md)、[B04 品牌建档](../../docs/tasks/B04-brand-onboarding.md)、[B05 本人数据导出](../../docs/tasks/B05-owned-data-export.md)、[B06 品牌删除与恢复](../../docs/tasks/B06-brand-deletion.md)及 [B07 品牌清除](../../docs/tasks/B07-brand-purge.md)子项，以及 [B08 维护授权基础](../../docs/tasks/B08-maintenance-access.md)、[B10 试点额度](../../docs/tasks/B10-pilot-quotas.md)和 [B15 账户设置](../../docs/tasks/B15-account-settings.md)。产品 M0–M2 尚无完整里程碑交付。

## 2. 技术栈与实际版本

| 类别 | 实际采用 | 说明与配置文件 |
| --- | --- | --- |
| 运行时 | Node.js `>=24 <25` | [.node-version](../../.node-version) 记录 `24.22.0` |
| 包管理器 | `pnpm@12.14.0` | 唯一锁文件 `pnpm-lock.yaml`；`engines` 要求 `pnpm >=12 <13` |
| Web 框架 | `next@16.4.6`（App Router） | [next.config.ts](../../next.config.ts) 配置 `agentRules: false` 与 `@tailwindcss/turbopack` |
| UI 运行时 | `react@19.3.0` / `react-dom@19.3.0` | 默认 React Server Components |
| 语言 | `typescript@^5`（锁文件 `5.9.3`） | [tsconfig.json](../../tsconfig.json) 启用 `strict: true`、`noEmit: true`、路径别名 `@/* -> ./src/*` |
| 样式与组件 | `tailwindcss@4.3.3`、`shadcn@4.23.0`、`radix-ui@^1.8.1`、`lucide-react@^1.73.0` | [components.json](../../components.json)：`style: radix-nova`、`rsc: true`、`tsx: true`、`baseColor: neutral` |
| 表单与校验 | `react-hook-form@^7.92.0`、`@hookform/resolvers@^7.0.6`、`zod@^4.6.7` | 用于登录注册表单与环境变量校验 |
| 数据库与 ORM | PostgreSQL / Node 24 内置 SQLite + `drizzle-orm@0.45.4` + `postgres@4.1.1` + `drizzle-kit@0.31.11` | `DATABASE_PROVIDER` 默认 postgresql；SQLite 显式配置 `SQLITE_PATH`。双方言配置/迁移，SQLite 使用官方 Drizzle proxy，无新增依赖；可选本地 PG Compose |
| 认证 | `better-auth@1.7.25` + `@better-auth/drizzle-adapter@1.7.25` | 同一 [CLI 配置](../../auth.schema.config.ts) 生成 `auth-schema.ts` / `auth-schema.sqlite.ts`；官方 adapter 的 pg/sqlite provider |
| 代码检查 | `eslint@9.39.5` + `eslint-config-next@16.4.6` | [eslint.config.mjs](../../eslint.config.mjs) 采用 Flat Config（`nextVitals` + `nextTs`） |
| 图表（预留） | `recharts@^3.10.1` | 仅安装依赖，当前无任何图表或模拟数据 |
| 依赖安全策略 | [pnpm-workspace.yaml](../../pnpm-workspace.yaml) | 非 Monorepo；仅允许 `esbuild` 安装脚本，并通过 `overrides` 固定 `minimatch`（`11.0.1`）与间接 `esbuild`（`0.25.12`） |

## 3. 实际源码与目录结构

- `src/app/`：
  - `layout.tsx`、`globals.css`、`error.tsx`、`global-error.tsx`、`not-found.tsx`；`src/proxy.ts` 处理请求路径和禁用公共缓存
  - `(marketing)/page.tsx`：薄层导出公开中英文官网（`/`），按真实会话显示入口，并说明当前能力/试点限制
  - `(auth)/login/page.tsx`：邮箱/密码注册与登录页（`/login`）
  - `(auth)/account-access/`、`api/account-email/`：双语邮箱验证和密码找回；由 `src/features/account/email/` 管理限流、投递与确认。 [B17 记录](../../docs/tasks/B17-account-email-recovery.md)
  - `(dashboard)/layout.tsx`、`(dashboard)/dashboard/page.tsx`、`error.tsx`、`loading.tsx`：受服务端会话保护的工作台（`/dashboard`）
  - `api/auth/[...all]/route.ts`：Better Auth Next.js Handler（缺失配置时返回 503）
  - `api/health/route.ts`：固定存活状态 JSON（`{ status: "ok", service: "geo-pro" }`）
  - `(dashboard)/dashboard/maintenance/`、`api/maintenance/access/route.ts`：本人维护权限页面/接口，独立会话和服务端授权校验
  - `api/maintenance/quotas/route.ts`：试点额度维护写入，复用 `quotas.manage`
  - `(dashboard)/dashboard/settings/`：本人账户设置，显示只读邮箱、编辑称呼、切换界面语言及管理当前会话
  - `(dashboard)/dashboard/brands/`、`api/brands/`：单负责人品牌、草稿、历史版本、删除影响预览与冻结恢复。合成资料用于回环验收，常规入口暂停收集
  - `api/data-exports/`：本人数据生成和受保护下载。设置页显示范围与最近一次结果，品牌导出遵循 B04 的开放条件
- `src/components/`：
  - `ui/`：已安装的 shadcn/ui 基础组件（button、card、input、badge、table、tabs、dialog、sidebar、skeleton、separator、dropdown-menu、form、label、sheet、tooltip）
  - `layout/`：`app-sidebar.tsx`、`auth-form.tsx`、`brand-mark.tsx`、`module-links.ts`、`sign-out-button.tsx`、`session-monitor.tsx`；会话失效/身份切换时整页恢复，服务暂不可用提供重试。
  - `charts/README.md`：仅边界说明，无图表实现
- `src/features/` 包含官网 `marketing/`、维护授权 `maintenance/`、账户设置 `account/`、品牌建档 `brands/`、本人导出 `data-exports/`、试点额度 `quotas/` 和 5 个业务占位域。
- `src/lib/`：`i18n/`、`auth/`、`db/`、`http/`。DB 包含双方言认证、维护、品牌、导出与额度 Schema、显式配置、连接和 SQLite 迁移。`ai/`、`cache/` 仍仅有说明。
- `src/hooks/use-mobile.ts`、`src/types/README.md`
- `drizzle/`、`drizzle/sqlite/`：PostgreSQL 与 SQLite 独立迁移，覆盖认证及账号邮件限流、维护权限、品牌建档、本人导出、品牌清除和试点额度，每库 17 张应用表。
- `drizzle/ddl/postgresql.sql`、`sqlite.sql`：双方言全量 DDL；`scripts/export-ddl.mjs` 离线生成/只读检查，不含迁移历史或数据。
- `scripts/verify-auth.mjs`：本地 HTTP + 所选后端的认证验证，临时账号清理；`verify-maintenance.mjs` 在双方言隔离库启动实际 Next 服务并运行维护/认证验证。
- `scripts/maintenance-access.mjs`：仅受控服务器可执行的授权/撤销命令；无在线提权，详见 [维护说明](../../docs/architecture/maintenance-access.md)。
- `docs/`：产品文档包（v3.0）、工程初始化任务书与 Phase 0 架构/任务记录。
- `.agents/`：包含本轮接入的 `governance/`、`workflows/`、`references/`，以及仓库原有的 `skills/openspec-*`（保留不自动启用）。
- `openspec/` 包含 `account-session`、`public-product-entry`、`maintenance-access`、`account-settings`、`brand-onboarding`、`owned-data-export` 和 `pilot-quotas` 的能力规格及对应归档。按当前任务授权加载相关规格。

## 4. 可用命令与检查现状

| 命令 | 底层动作 | 用途与前提 |
| --- | --- | --- |
| `pnpm dev` | `next dev` | 启动本地开发服务器 |
| `pnpm build` | `next build` | 生产构建检查（不依赖数据库或 AI Key） |
| `pnpm start` | `next start` | 启动生产构建产物 |
| `pnpm lint` | `eslint` | 静态代码与 React/Next/TS 规则检查 |
| `pnpm typecheck` | `tsc --noEmit` | TypeScript 严格类型检查 |
| `pnpm db:auth-schema` | `scripts/database.mjs auth-schema` | 同版本官方 CLI 生成 pg/sqlite 两套认证 Schema |
| `pnpm db:generate` | `scripts/database.mjs generate` | Drizzle Kit 生成双方言 migration，不依赖数据库 |
| `pnpm db:migrate` | `scripts/database.mjs migrate` | 只迁移所选后端；PG Drizzle Kit，SQLite Drizzle journal + 原生事务 |
| `pnpm db:ddl` | `node scripts/export-ddl.mjs` | 离线导出双方言全量 DDL |
| `pnpm db:ddl:check` | `node scripts/export-ddl.mjs --check` | 只读比较 Schema 导出与快照；过期或缺失返回失败 |
| `pnpm verify:auth` | `node --conditions=react-server scripts/verify-auth.mjs` | 本地应用 + 所选后端的认证与本人资料更新，需先迁移 |
| `pnpm verify:account-email` | Node.js HTTP + Playwright | 构建后用 3117 端口、双方言隔离库、回环邮件接收器和 Chrome 验证账号邮件与品牌恢复 |
| `pnpm maintenance:access` | `node --conditions=react-server scripts/maintenance-access.mjs` | 受控服务器授予/撤销单项维护权限 |
| `pnpm test:maintenance` | Node.js 原生测试 | 双库 DAO/迁移/DDL/锁竞争/索引测试，需要本地 PG 隔离建库权限 |
| `pnpm verify:maintenance` | Node.js HTTP/CLI 集成脚本 | 构建后，在 3103 端口、双方言隔离库验证维护和认证 |
| `pnpm test:brands` | Node.js 原生测试 | 品牌双库并发、版本、迁移、回滚、冻结及索引验证 |
| `pnpm verify:brands` | Node.js HTTP 集成脚本 | 构建后，在 3105 端口及隔离库验证品牌接口、收集条件、删除与限期恢复 |
| `pnpm brands:purge` | 受控服务端 CLI | 批量清除到期品牌、核对凭证及离线重放清除记录 |
| `pnpm brands:shorten-recovery` | 受控服务端 CLI | 依据已核验的提前请求缩短冻结品牌的恢复期限 |
| `pnpm test:data-exports` | Node.js 原生测试 | 导出双库升级、并发、回滚和查询验证 |
| `pnpm verify:data-exports` | Node.js HTTP 集成脚本 | 构建后，在 3106 端口及隔离库验证导出授权和反馈 |
| `pnpm test:quotas` | Node.js 原生测试 | 双库额度升级、授权、账本与并发 |
| `pnpm verify:quotas` | Node.js HTTP + Playwright | 构建后在 3107 端口验证双方言会话、权限和额度页面 |
| `python docs/tools/validate_docs.py` | 标准库 Python 脚本 | 校验 `docs/` 产品文档链接、映射与指标样例 |

- **测试现状**：已配置消息检查、Node 基础测试、维护、品牌、导出和额度双库专项及 Playwright。E2E 在 `.cache/i18n-app` 的生产副本核验官网、认证、壳层、维护权限、账户设置、品牌建档和本人导出，清理本轮测试账号。其他业务 DAO/Redis 专项仍待接入。

## 5. 已确认工程要求与适配差距

完整约束与专项验收在 [数据访问与缓存工程约束](../../docs/architecture/data-access.md) 维护：DAO 适配 SQLite3 / PostgreSQL；cache 适配 memory / Redis（默认）；避免 N+1 和大量串行 SQL，优先批量操作；表结构精简并审查索引；全量 DDL 随 Schema/migration 更新。全量 DDL 生成、防漂移与快速部署流程见 [数据库部署说明](../../docs/architecture/database-deployment.md)。

**当前事实**：认证、维护授权、品牌建档、本人导出和试点额度适配 PostgreSQL/SQLite，保持独立 Schema、迁移与 DDL。原生 SQLite 外键、事务及 Auth provider 已实测。其他业务 DAO 和全部缓存实现仍待实施。

**多语言现状**：当前官网、账号入口、工作台壳层、维护权限、账户设置、品牌建档、本人导出和试点额度均提供 `zh-CN` / `en`。请求解析、Cookie 偏好、Metadata、消息和参数检查及浏览器 E2E 已接入。未来业务页面、图表及真实采样范围的语言隔离随业务任务验收。 [Web 多语言规范](../../docs/architecture/i18n.md)

## 6. 尚未确定的重要技术决策

以下决策在当前 Phase 0 刻意保持开放，待对应 M0–M2 任务启动时按实际需求再行确定：

1. **业务数据模型设计**：事实版本、正式问题集、监测样本与证据对象的具体 Drizzle 表结构。
2. **AI Provider 适配方案**：`src/lib/ai/` 的多模型调用接口、重试、限流与成本记录方式。
3. **异步采样与任务恢复机制**：当出现长耗时采样的持久化任务表设计与后续是否拆分独立 Worker。
4. **业务自动化测试**：已采用 Node.js 原生基础测试与 Playwright；业务用例、DAO 与渠道测试的覆盖方式随对应任务补齐。
5. **剩余适配细节**：后续领域 DAO 的具体用例接口，以及 Redis 客户端、配置、TTL 与失效范围；SQLite 驱动和双方言 Schema/迁移已由 B08 确定，后端支持集合和 Redis 默认值不重新选型。
6. **后续 i18n 扩展**：B01 已确定 JSON/Intl、原路径与 Cookie 偏好；新增业务领域按当前消息、SSR、格式化与测试边界扩展，不重新选择默认语言或改写业务 scope。
