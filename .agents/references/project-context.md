# 项目事实上下文（Project Context）

> 更新日期：2026-11-17｜事实来源：仓库实际配置文件与源码检查（非模板假设）。若技术栈、版本或目录发生实质变化，须同步更新本文件。

## 1. 项目概览

- **包名与版本**：`geo-pro` v`0.1.0`（`"private": true`，`"type": "module"`，见 [package.json](../../package.json)）
- **定位**：GeoPro（AI GEO），面向中国大陆品牌经营者的品牌可见度监测与优化平台。
- **当前实施阶段**：已完成 [Phase 0 工程初始化](../../docs/tasks/phase-0.md)；产品 M0–M2 业务功能（见 [docs/tasks/M0.md](../../docs/tasks/M0.md) 等）**均尚未实施**。

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
| 数据库与 ORM | PostgreSQL + `drizzle-orm@0.45.4` + `postgres@4.1.1` + `drizzle-kit@0.31.11` | [drizzle.config.ts](../../drizzle.config.ts) 使用 `@next/env` 加载 `.env.local`；可选本地 `compose.yaml`（`postgres:17-alpine`，端口 `127.0.0.1:55432`） |
| 认证 | `better-auth@1.7.25` + `@better-auth/drizzle-adapter@1.7.25` | [auth.schema.config.ts](../../auth.schema.config.ts) 专供 CLI 生成 `src/lib/db/auth-schema.ts` |
| 代码检查 | `eslint@9.39.5` + `eslint-config-next@16.4.6` | [eslint.config.mjs](../../eslint.config.mjs) 采用 Flat Config（`nextVitals` + `nextTs`） |
| 图表（预留） | `recharts@^3.10.1` | 仅安装依赖，当前无任何图表或模拟数据 |
| 依赖安全策略 | [pnpm-workspace.yaml](../../pnpm-workspace.yaml) | 非 Monorepo；仅允许 `esbuild` 安装脚本，并通过 `overrides` 固定 `minimatch`（`11.0.1`）与间接 `esbuild`（`0.25.12`） |

## 3. 实际源码与目录结构

- `src/app/`：
  - `layout.tsx`、`globals.css`
  - `(marketing)/page.tsx`：公开中文浅色官网首页（`/`）
  - `(auth)/login/page.tsx`：邮箱/密码注册与登录页（`/login`）
  - `(dashboard)/layout.tsx`、`(dashboard)/dashboard/page.tsx`、`error.tsx`、`loading.tsx`：受服务端会话保护的空工作台（`/dashboard`）
  - `api/auth/[...all]/route.ts`：Better Auth Next.js Handler（缺失配置时返回 503）
  - `api/health/route.ts`：固定存活状态 JSON（`{ status: "ok", service: "geo-pro" }`）
- `src/components/`：
  - `ui/`：已安装的 shadcn/ui 基础组件（button、card、input、badge、table、tabs、dialog、sidebar、skeleton、separator、dropdown-menu、form、label、sheet、tooltip）
  - `layout/`：`app-sidebar.tsx`、`auth-form.tsx`、`brand-mark.tsx`、`module-links.ts`、`sign-out-button.tsx`
  - `charts/README.md`：仅边界说明，无图表实现
- `src/features/`：包含 6 个仅含 `README.md` 的业务占位域：`brands/`、`monitoring/`、`prompts/`、`citations/`、`competitors/`、`optimization/`。
- `src/lib/`：`auth/`（`client.ts`、`env.ts`、`options.ts`、`server.ts`、`session.ts`、`validation.ts`）、`db/`（`index.ts`、`auth-schema.ts`），以及仅含 `README.md` 的 `ai/`、`cache/`。
- `src/hooks/use-mobile.ts`、`src/types/README.md`
- `drizzle/`：`0000_nervous_mole_man.sql` 及快照/日志（4 张 Better Auth 基础表）。
- `drizzle/ddl/postgresql.sql`：由当前 Schema 导出的全量应用建表快照，不含迁移历史和客户数据；`scripts/export-ddl.mjs` 提供导出与只读一致性检查。
- `scripts/verify-auth.mjs`：本地 HTTP + PostgreSQL 端到端认证验证脚本（自动清理临时账号）。
- `docs/`：产品文档包（v3.0）、工程初始化任务书与 Phase 0 架构/任务记录。
- `.agents/`：包含本轮接入的 `governance/`、`workflows/`、`references/`，以及仓库原有的 `skills/openspec-*`（保留不自动启用）。
- `openspec/`：仓库初始保留目录，当前不自动纳入开发范围。

## 4. 可用命令与检查现状

| 命令 | 底层动作 | 用途与前提 |
| --- | --- | --- |
| `pnpm dev` | `next dev` | 启动本地开发服务器 |
| `pnpm build` | `next build` | 生产构建检查（不依赖数据库或 AI Key） |
| `pnpm start` | `next start` | 启动生产构建产物 |
| `pnpm lint` | `eslint` | 静态代码与 React/Next/TS 规则检查 |
| `pnpm typecheck` | `tsc --noEmit` | TypeScript 严格类型检查 |
| `pnpm db:auth-schema` | `pnpm dlx auth@1.7.25 generate ...` | 重新生成 `src/lib/db/auth-schema.ts` |
| `pnpm db:generate` | `drizzle-kit generate` | 生成 SQL migration（不依赖数据库） |
| `pnpm db:migrate` | `drizzle-kit migrate` | 将迁移应用到 `DATABASE_URL` 指向的数据库 |
| `pnpm db:ddl` | `node scripts/export-ddl.mjs` | 通过现有 Drizzle 配置离线导出 PostgreSQL 全量 DDL，不连接数据库 |
| `pnpm db:ddl:check` | `node scripts/export-ddl.mjs --check` | 只读比较 Schema 导出与快照；过期或缺失返回失败 |
| `pnpm verify:auth` | `node scripts/verify-auth.mjs` | 本地认证闭环校验（需应用在 `BETTER_AUTH_URL` 运行且开发库已迁移） |
| `python docs/tools/validate_docs.py` | 标准库 Python 脚本 | 校验 `docs/` 产品文档链接、映射与指标样例 |

- **测试框架现状**：当前 `package.json` **未配置**单元测试或 E2E 测试框架（如 Vitest、Jest、Playwright）。

## 5. 已确认工程要求与适配差距

完整约束与专项验收在 [数据访问与缓存工程约束](../../docs/architecture/data-access.md) 维护：DAO 适配 SQLite3 / PostgreSQL；cache 适配 memory / Redis（默认）；避免 N+1 和大量串行 SQL，优先批量操作；表结构精简并审查索引；全量 DDL 随 Schema/migration 更新。全量 DDL 生成、防漂移与快速部署流程见 [数据库部署说明](../../docs/architecture/database-deployment.md)。

**当前事实**：数据库连接、Auth Adapter、Schema 生成和迁移均为 PostgreSQL，认证验证脚本也直接使用 PostgreSQL；没有业务 DAO、SQLite 适配或缓存实现。现有 Redis 暂缓规则属于 Phase 0 实施边界，不再表示后续缓存后端选型未定。

**多语言要求与差距**：首期界面支持 `zh-CN` / `en`，默认 `zh-CN`，详见 [Web 多语言规范](../../docs/architecture/i18n.md)。当前 [根布局](../../src/app/layout.tsx) 固定 `lang="zh-CN"` 和中文 Metadata，[认证表单](../../src/components/layout/auth-form.tsx) 与 [校验消息](../../src/lib/auth/validation.ts) 为中文；无消息目录、英文界面、语言切换/持久化及专用 i18n 验证命令。需求已确认，运行时适配未实施。

## 6. 尚未确定的重要技术决策

以下决策在当前 Phase 0 刻意保持开放，待对应 M0–M2 任务启动时按实际需求再行确定：

1. **业务数据模型设计**：品牌、事实版本、问题集、监测样本与证据对象的具体 Drizzle 表结构。
2. **AI Provider 适配方案**：`src/lib/ai/` 的多模型调用接口、重试、限流与成本记录方式。
3. **异步采样与任务恢复机制**：当出现长耗时采样的持久化任务表设计与后续是否拆分独立 Worker。
4. **自动化测试选型**：后续业务单测与端到端测试工具链（如 Vitest / Playwright）的引入时机与范围。
5. **适配实现细节**：SQLite 驱动、双方言 Schema/迁移配置、DAO 的具体用例接口，以及 Redis 客户端、后端选择配置、各用例 TTL 与失效范围。后端支持集合和 Redis 默认值已确定，不重新作为开放选型。
6. **i18n 实现细节**：消息工具/目录、locale URL 策略、偏好承载方式、消息一致性检查入口；支持集合与默认值已确认，选型须满足服务端/客户端、鉴权路径及缓存隔离要求。
