# GeoPro Agent 统一开发约定

GeoPro（`geo-pro`）是基于 Next.js App Router、TypeScript（`strict`）、PostgreSQL / SQLite3、Drizzle ORM 与 Better Auth 的 AI GEO 监测与优化平台。Phase 0 已完成，M0 已有从品牌工作台到证据、内容交付和复测快照的软件路径，M1/M2 也已交付多项软件切片。正式品牌入口及 M0–M2 真实阶段验收仍待核验。按授权和软件依赖推进，当前状态以 [交付进度](docs/tasks/delivery-progress.md) 与阶段任务记录为准。

已交付的业务 DAO 按任务适配 SQLite3/PostgreSQL，证据概览和支持定位使用 Redis 或隔离测试的 memory 缓存。查询优先批量执行，按查询路径审查索引并随 Schema/migration 更新全量 DDL。 [数据访问与缓存工程约束](docs/architecture/data-access.md) · [数据库部署说明](docs/architecture/database-deployment.md)

产品首期界面支持 `zh-CN` / `en`，默认 `zh-CN`；Web 开发从文案、校验、路由、SSR、格式化、布局与缓存设计双语言兼容。界面 locale 独立于业务采样语言、币种和统计时区。现有官网、账号与工作台壳层已接入双语言；后续业务页面继续按任务补齐。规范与验收见 [Web 多语言设计](docs/architecture/i18n.md)。

## 强制约束（不可违背）

1. **禁止跳过适用规范**：不得忽略与当前任务直接相关的架构、编码、安全、产品合同及质量门禁要求。
2. **禁止全量预加载**：不得在任务开始时递归读取所有 `.agents/` 或 `docs/` 文档，必须按下方路由按需加载。
3. **禁止无必要性扩展**：不得未经必要性验证引入新依赖、全局状态管理、微服务/队列或新架构；不得推进未授权的 M0/M1/M2 任务。
4. **禁止越界修改**：不得以为通过检查为由修改无关代码；保护现有文件与未提交改动；不得修改或删除既有产品文档来适配代码；历史 `docs/archive/` 与既有 `openspec/` 不自动成为当前任务范围。
5. **禁止伪造结果与数据**：不得将未执行的验证标记为通过，不得把构建成功当作业务验收通过；严禁伪造监测记录、趋势、客户评价、排名或提升比例。
6. **禁止高危与擅自提交**：不得硬编码或向客户端泄露密钥/连接串（`NEXT_PUBLIC_*` 严禁放密钥）；不得静默改动生产数据、用 `push` 替代迁移或执行破坏性操作；未经明确授权不得 `commit`、`push` 或部署。

## 任务执行原则

- 遵循 **统一入口 → 按需发现 → 最小实现 → 质量验证 → 核验交付** 闭环（详见 [.agents/workflows/task-lifecycle.md](.agents/workflows/task-lifecycle.md)）。
- 一个任务 / Issue 对应清晰可审核的最小改动范围；技术约束以仓库真实状态为准：仅用 `pnpm`（`pnpm-lock.yaml`）与 Node 24 LTS；`src/app/` 保持薄层，业务按 `src/features/<domain>/` 组织；默认 Server Components，服务端密钥/DB/Auth 模块保留 `server-only`，鉴权使用服务端 `auth.api.getSession`。

## 开发阶段约定（长期与本地配置）

- **显式服务配置**：开发和应用启动须指定数据库、Redis、S3 兼容文件存储与认证配置。复用可用的开发服务，`pnpm env:check` 核对实际连通与权限。仅双库隔离验证使用显式设置的 `GEO_DUAL_DB_URL`。 [环境准备](README.md#local-development)
- **AI 接入规范（已就绪）**：所有 AI 模型接入均须支持 OpenAI **Responses API** 标准（`POST ${OPENAI_BASE_URL}/responses`），统一使用服务端模块 [src/lib/ai/responses.ts](src/lib/ai/responses.ts)；本地开发连接参数与模型名在 gitignored 的 `.env.local` 中通过 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`（及官方采样联调配置 `GEO_OFFICIAL_SAMPLING_*`）提供，可直接推进 AI 相关功能开发；严禁将真实密钥写入源码、`.env.example`、文档或 `NEXT_PUBLIC_*`，自动化单测须使用回环 mock。
- **邮件功能长期 Mock（永远成功，暂不接入）**：项目已约定所有邮件发送与邮箱验证功能长期采用 Mock 永远成功策略，暂不接入真实邮件网关，**任何需求开发与 Issue 推进不得因缺少邮件网关或真实发信而阻塞**。本地与开发联调保持 `.env.local` 中 `GEO_AUTH_MAIL_MOCK=true`（跳过外发邮件网关与限流，直接 202 `accepted` 并记录安全 mock 日志）与 `GEO_AUTH_EMAIL_VERIFIED_MOCK=true`（已登录/存在的账号邮箱校验按已验证放行）；隔离安全测试脚本（如 `verify:account-email`、`verify:brands`、`test:monitoring`、`test:brands`）在显式设为 `false` 时继续验证严格契约。
- **Agent 负责验收与正式试点**。所有 Issue 由 Agent 自行在已配置的开发环境运行检查、操作开发数据库并记录实际证据。具备授权数据与服务时，由 Agent 执行正式试点并核验 `T-M0-GATE` / `T-M1-GATE` / `T-M2-GATE`。缺少软件前置、授权数据、可用通道、可信费用上限或未到观察窗口时，记录影响的验收项，继续可独立完成的软件工作。生产开放按现有权限与发布约定执行。 [Issue 生命周期](.agents/workflows/issue-lifecycle.md)
- **品牌与 AI 监测真实联调**：相关增量在开发环境用已授权的真实品牌输入、开发库和真实服务验证，单测仍用隔离库与回环 mock。记录运行条件、脱敏证据和实际结果。 [下一阶段计划](docs/tasks/brand-monitoring-next.md#dev-live-data)

## 治理与上下文路由（渐进式披露）

- **L0（必读）**：本文件 `AGENTS.md` + 用户当前任务。
- **L1（按任务类型按需加载，索引见 [.agents/governance/README.md](.agents/governance/README.md)）**：
  - 架构设计、目录与数据边界 → [.agents/governance/architecture.md](.agents/governance/architecture.md)
  - DAO、数据库适配、Schema/索引、SQL 性能或缓存 → [数据访问与缓存工程约束](docs/architecture/data-access.md)
  - 全量 DDL 更新或数据库快速部署 → [数据库部署说明](docs/architecture/database-deployment.md)
  - 页面、组件、Hooks 或 API 开发 → [.agents/governance/coding.md](.agents/governance/coding.md)
  - 页面文案、表单校验、导航、SSR、Metadata、格式化或本地化缓存 → [Web 多语言设计与兼容规范](docs/architecture/i18n.md)
  - 认证、输入校验、环境变量或依赖 → [.agents/governance/security.md](.agents/governance/security.md)
  - 质量检查、测试与验收判定 → [.agents/governance/quality-gates.md](.agents/governance/quality-gates.md)
  - 按业务域定位页面、弹窗/交互组件或 Service/API → [功能地图索引](docs/feature-map/README.md)（按需只读目标域单表，禁止全量读取）
  - 普通开发任务闭环 → [.agents/workflows/task-lifecycle.md](.agents/workflows/task-lifecycle.md)
  - GitHub Issue 驱动开发 → [.agents/workflows/issue-lifecycle.md](.agents/workflows/issue-lifecycle.md)
  - 规范冲突或重大取舍 → [.agents/governance/principles.md](.agents/governance/principles.md)
- **L2（仅在确需核对事实时读取）**：
  - 仓库技术栈、目录与脚本事实 → [.agents/references/project-context.md](.agents/references/project-context.md)
  - 产品业务合同（仅实施业务任务时按序读取）→ [docs/README.md](docs/README.md) 及对应 Intent/PRD/SPEC/指标合同/Issue
  - 渐进式加载细节与上下文压缩恢复规则 → [.agents/workflows/progressive-disclosure.md](.agents/workflows/progressive-disclosure.md)

## 质量验证要求

每次代码或配置变更结束前，按 [.agents/governance/quality-gates.md](.agents/governance/quality-gates.md) 实际执行适用检查并如实汇报状态（区分**通过 / 失败 / 未配置 / 环境受阻**）：

- 基础门禁：`pnpm lint`、`pnpm typecheck`、`pnpm build`。
- 认证或数据库 Schema 变更：按需执行 `pnpm db:auth-schema` / `pnpm db:generate` / `pnpm db:migrate`，并在本地开发数据库上运行 `pnpm verify:auth`。
- Schema/migration 变更：同步执行 `pnpm db:ddl` 更新 PostgreSQL / SQLite 全量 DDL，并以 `pnpm db:ddl:check` 核对。
- 产品文档变更或核验：`python docs/tools/validate_docs.py`。
- 功能地图同步与校验：新增/删除页面、重构模块目录、增删重要弹窗/抽屉时，顺手更新 `docs/feature-map/` 对应 1 行并运行 `pnpm check:feature-map`。

## 交付报告要求

任务完成后向用户输出可核验结果，至少包含：**完成内容**、**修改文件与关键决策**、**实际执行的检查及真实结果**、**未验证/受阻项与风险**、**下一步建议**。涉及阶段或里程碑任务时，同步在 `docs/tasks/` 记录实际交付与验证条件。
