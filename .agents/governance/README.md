# GeoPro 工程治理索引

本目录存放工具无关、长期有效的工程规范，供所有 Coding Agent 按任务类型按需加载（见 [渐进式披露规范](../workflows/progressive-disclosure.md)）。

## 治理文档列表

| 文件 | 适用场景 | 核心内容 |
| --- | --- | --- |
| [principles.md](principles.md) | 复杂取舍、规则冲突、跨模块决策 | 工程基本原则、禁止假设与规则优先级 |
| [architecture.md](architecture.md) | 架构设计、新增模块/路由/数据边界 | App Router 分层、Server/Client 边界、演进约束 |
| [数据访问与缓存](../../docs/architecture/data-access.md) | DAO、数据库适配、Schema/索引、SQL 性能或缓存 | SQLite3 / pg、memory / Redis（默认）、批量 SQL、最小表结构与专项验收 |
| [全量 DDL 与部署](../../docs/architecture/database-deployment.md) | Schema/migration 变更、全量 DDL 维护或数据库部署 | DDL 生成/防漂移检查、空库部署与增量迁移边界 |
| [coding.md](coding.md) | 页面、组件、Hooks 或 API 开发 | TypeScript strict、组件职责、异步错误处理与风格 |
| [Web 多语言](../../docs/architecture/i18n.md) | 文案、校验、导航、SSR、Metadata、格式化或本地化缓存 | 首期 zh-CN / en、消息合同、语言隔离、兼容矩阵与维护 |
| [security.md](security.md) | 认证、用户输入、环境变量、依赖或敏感数据 | 密钥隔离、`server-only`、鉴权与输入校验、安全底线 |
| [quality-gates.md](quality-gates.md) | 开发验收、检查执行、交付前验证 | 真实可用命令、分级门禁与状态区分规则 |

## 与其他目录的关系

- 根目录 [AGENTS.md](../../AGENTS.md)：所有 Agent 的统一最小规则入口与文档路由。
- [工作流程](../workflows/task-lifecycle.md)：任务闭环、渐进式披露与 Issue 生命周期流转规范。
- [项目上下文](../references/project-context.md)：基于真实仓库状态记录的技术栈、目录与命令事实。
- [产品文档包](../../docs/README.md)：产品 Intent、PRD、功能规格（SPEC）、指标合同与 M0–M2 任务来源。
- 现有 `.agents/skills/` 与 `openspec/`：仓库初始保留的 OpenSpec 技能与目录，默认不作为当前 Phase 0 / M0 治理的自动执行流程。

## 权威来源与维护

产品 Intent/PRD/SPEC/指标合同负责业务要求，包含公共多语言合同 `ui-i18n-v1`；`docs/architecture/data-access.md` 负责数据工程约束，数据库部署说明负责全量 DDL 流程，Web 多语言规范负责界面实现与兼容边界；[项目上下文](../references/project-context.md) 记录实际实现与未决选型。目标、事实和验证结果分别维护，不把规则写入当成功能完成。要求变化时更新约束正文及路由，实现变化时更新事实与实际验证记录；本框架不依赖仓库外技能才能运行。
