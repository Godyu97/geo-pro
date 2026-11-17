# GeoPro Agent 统一开发约定

GeoPro（`geo-pro`）是基于 Next.js App Router、TypeScript（`strict`）、PostgreSQL / Drizzle ORM 与 Better Auth 的 AI GEO 监测与优化平台。**已完成 `docs/CODEX_INIT.md` 的 Phase 0 及 T-M0-01 的 B01 双语言、B02 认证恢复、B03 可信官网子项；产品 M0–M2 里程碑仍未完成，其他业务任务按授权与依赖推进。**

已确认的工程目标：DAO 适配 SQLite3 与 PostgreSQL；cache 适配 memory 与 Redis（默认）；避免 N+1 与大量串行 SQL，优先批量操作；表结构精简并按查询路径审查索引；全量 DDL 随 Schema/migration 及时更新。**数据适配目标尚未实现**，详见 [数据访问与缓存工程约束](docs/architecture/data-access.md)；全量 DDL 维护与部署见 [数据库部署说明](docs/architecture/database-deployment.md)。

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
- Schema/migration 变更：同步执行 `pnpm db:ddl` 更新全量 DDL，并以 `pnpm db:ddl:check` 核对；目前仅 PostgreSQL，SQLite 随适配补齐。
- 产品文档变更或核验：`python docs/tools/validate_docs.py`。

## 交付报告要求

任务完成后向用户输出可核验结果，至少包含：**完成内容**、**修改文件与关键决策**、**实际执行的检查及真实结果**、**未验证/受阻项与风险**、**下一步建议**。涉及阶段或里程碑任务时，同步在 `docs/tasks/` 记录实际交付与验证条件。
