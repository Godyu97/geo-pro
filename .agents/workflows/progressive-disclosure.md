# 渐进式披露上下文加载规范

本流程用于控制 Coding Agent 的上下文开销，通过 [AGENTS.md](../../AGENTS.md) 建立显式路由：先理解任务，再按需加载治理规则与事实信息。

> 注意：文件路由属于治理约定，任何 Agent 都必须依据根目录 `AGENTS.md` 的索引按需读取，不得假设工具会自动预加载或忽略路由。

## 三级加载模型

### L0：基础上下文（必读、最小化）

Agent 启动或接收任意任务时仅加载：

1. 根目录 [AGENTS.md](../../AGENTS.md)
2. 用户当前任务描述及必要会话上下文

**禁止在任务开始时递归遍历或全量读取 `.agents/` 与 `docs/` 下的所有文件。**

### L1：任务相关治理文档（按任务路由）

在理解任务范围后，按任务性质选择对应文件加载：

| 任务类型 / 触发条件 | 必读治理文档 |
| --- | --- |
| 架构设计、目录调整、路由或数据流划分 | [architecture.md](../governance/architecture.md) |
| DAO、数据库适配、Schema/索引、SQL 性能或缓存 | [数据访问与缓存工程约束](../../docs/architecture/data-access.md) |
| 全量 DDL 更新或数据库快速部署 | [数据库部署说明](../../docs/architecture/database-deployment.md) |
| 页面、组件、Hooks 或 API 编码实现 | [coding.md](../governance/coding.md) |
| 文案、校验、导航、SSR、Metadata、格式化或本地化缓存 | [Web 多语言规范](../../docs/architecture/i18n.md) |
| 认证、会话、输入校验、环境变量、敏感数据或依赖变更 | [security.md](../governance/security.md) |
| 运行检查、验证交付或补充测试 | [quality-gates.md](../governance/quality-gates.md) |
| 普通开发任务（通用执行闭环） | [task-lifecycle.md](task-lifecycle.md) |
| GitHub Issue 驱动开发（含 `docs/tasks/` 任务） | [issue-lifecycle.md](issue-lifecycle.md) |
| 出现规范冲突、重大取舍或需要追溯原则依据 | [principles.md](../governance/principles.md) |

日常小任务的通用原则已概括在 `AGENTS.md` 中，无需每次重复加载完整 `principles.md`。

### L2：细节与参考信息（按需深读）

仅在 L0/L1 不足以支撑判断时读取：

- 技术事实与脚本核对：[project-context.md](../references/project-context.md)、[Phase 0 架构](../../docs/architecture/overview.md)
- 直接受影响的源码、Schema 与配置文件（如 `src/app/...`、`src/lib/auth/...`、`drizzle.config.ts`）
- 相关验证或测试脚本（如 `scripts/verify-auth.mjs`）
- 产品需求与业务契约：仅当实施业务功能时，按 [产品文档入口](../../docs/README.md) 顺序读取对应的 Intent、PRD、SPEC、指标合同与目标里程碑任务（如 [M0 任务](../../docs/tasks/M0.md)）
- 未来接入的专项技能：仅当任务命中具体技能时，按对应 `.agents/skills/<skill-name>/SKILL.md` 按需读取其 `references/`

## 执行规则

1. 先明确任务目标与边界，再决定要读哪些文件。
2. 优先读取直接相关的配置文件、源码与治理章节。
3. 避免无目的的目录全扫描与无关文件全文加载。
4. 信息不足时逐步扩大检索范围（如从单文件扩大到所属 `src/features/<domain>/`）。
5. 涉及跨模块或数据库 Schema 修改时，补齐受影响调用方与迁移配置的上下文。
6. 不得为了节省 Token 而跳过与当前任务直接相关的安全检查、类型边界或质量门禁。
7. 若对话发生上下文压缩，必须保留四项核心状态：**任务目标**、**已确认约束**、**当前进度状态**与**待验证事项**。
