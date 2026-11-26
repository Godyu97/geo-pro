# 项目事实

2026-11-26。技术栈以 [package.json](../../package.json)、[锁文件](../../pnpm-lock.yaml) 与实际源码为准。产品范围和验收进度见 [交付进度](../../docs/tasks/delivery-progress.md)。

二期开发顺序与 GitHub 工单以[模块首版计划](../../docs/tasks/phase-2.md)为准。当前代码通过 `src/features/team-access/brand-scope.ts` 核对品牌负责人和成员授权。目标平台角色是 admin 和 user，group 聚合用户、品牌和操作权限。现有维护授权保持独立，新的跨组管理员及普通用户数据迁移由 #188 和 #191 交付。

## 技术栈

| 类别 | 当前配置 |
| --- | --- |
| 工具链 | Node 24 LTS，`.node-version` 为 `24.22.0`；`pnpm@12.14.0`，唯一锁文件 `pnpm-lock.yaml` |
| Web | `next@16.4.6` App Router，`react@19.3.0`，TypeScript `strict`，`@/*` 映射 `src/*` |
| UI | Tailwind CSS 4、shadcn、Radix UI 与 Lucide，`zh-CN` 和 `en` 界面消息由服务端加载 |
| 认证 | Better Auth `1.7.25` 和官方 Drizzle Adapter，服务端按请求校验会话、来源与资源归属 |
| 数据库 | Drizzle ORM `0.45.4`，`postgres@4.1.1`，Node 24 内置 SQLite；SQL migration、日志、快照及全量 DDL 各维护两套 |
| 缓存 | `src/lib/cache/store.ts` 为支持定位及证据概览提供 Redis 和显式 memory 适配 |
| 文件 | `src/lib/storage/` 使用 AWS SDK v3 访问 S3，`src/features/stored-objects/` 管理授权、元数据与字节生命周期 |
| AI | `src/lib/ai/responses.ts` 提供通用 Responses API；官方采样使用专用能力、价格和证据合同 |
| 验证 | ESLint 9、`tsc --noEmit`、Next 构建、Node 原生测试及 Playwright |

## 运行时入口

`pnpm dev` 与 `pnpm start` 先校验认证和显式的数据库、Redis、S3 配置。`pnpm env:check` 核验当前开发服务，按需用 `--probe-ai` 验证模型连通。`pnpm build` 可离线执行。开发邮件及邮箱校验使用长期 Mock。 [开发服务](../../docs/architecture/overview.md#development-services)

- 公开路由在 `src/app/`，首页 `/` 根据服务端会话分流，`/login` 提供邮箱/密码入口，`/account-access` 处理验证和找回。`GET /api/health` 仅返回存活状态。
- 工作台布局和各敏感页、Route Handler 分别验证会话。账号设置、本人导出和维护授权各自核对权限。维护支持只读脱敏故障元信息。 [维护说明](../../docs/architecture/maintenance-access.md)
- `brands` 管理建档、实体版本、归档、冻结和恢复。`brand-facts` 与 `prompts` 已有开发品牌的资料及冻结题集入口。一期正式建档使用试点准入证明，#189 跟踪普通用户自助建档。 [品牌联调计划](../../docs/tasks/brand-monitoring-next.md)
- `monitoring` 与 `evidence` 管理台账、协议、预算与运行、官方端口、双轨证据和下钻。运行控制已接功能 mock，正式开发执行和证据联动见下一阶段计划。周期计划、站内告警、竞品与来源使用各自工作台页。
- `content`、`optimization`、`reports` 分别管理诊断、独立审核、发布核验与报告。团队授权、外部连接、商业和助理采用各领域服务与独立授权校验。各已交付切片及验证缺口由 [交付进度](../../docs/tasks/delivery-progress.md) 维护。
- `src/lib/` 封装数据库、Auth、AI、缓存、私有存储、公开页只读抓取与多语言。`drizzle/` 包含各方言 Schema 生成结果及 DDL。 [数据访问约束](../../docs/architecture/data-access.md) · [数据库部署](../../docs/architecture/database-deployment.md) · [多语言](../../docs/architecture/i18n.md)

## 命令与边界

| 命令 | 用途 |
| --- | --- |
| `pnpm env:check` | 验证开发数据库的认证与品牌表，读写清理 Redis 和 S3 探针，检查 AI 与开发工具配置 |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 静态与构建门禁 |
| `pnpm db:auth-schema`、`pnpm db:generate` | 按固定版本生成双方言认证 Schema、迁移文件与快照 |
| `pnpm db:migrate` | 将已审核迁移应用到显式选择的库 |
| `pnpm db:ddl`、`pnpm db:ddl:check` | 离线生成与检查双方言全量 DDL |
| `pnpm verify:dual-db` | 指定 `GEO_DUAL_DB_URL`，创建和清理回环 PostgreSQL 隔离库，对照迁移结构并运行 M0 关键模块测试 |
| `pnpm verify:auth`、`pnpm verify:brands` 等 | 实际 HTTP 或浏览器验证，使用各脚本规定的端口和测试环境 |
| `pnpm test:storage`、`pnpm test:monitoring`、`pnpm test:evidence` 等 | 领域合同与隔离数据库、回环服务测试 |
| `pnpm check:i18n`、`pnpm test:i18n`、`pnpm test:e2e` | 消息、基础多语言与隔离浏览器检查 |
| `python docs/tools/validate_docs.py` | 文档链接、产品映射、验收 ID 和指标样例验证 |

精确命令与执行条件见 [质量门禁](../governance/quality-gates.md)。开发环境真实品牌与采样依 [联调计划](../../docs/tasks/brand-monitoring-next.md#dev-live-data) 留证。开发环境业务验收见[二期计划](../../docs/tasks/phase-2.md)。生产开放参考 [运行手册](../../docs/operations/m0-runbook.md) 与对应阶段记录。
