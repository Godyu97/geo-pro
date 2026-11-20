# 标准任务开发闭环（Task Lifecycle）

适用于所有在 GeoPro 仓库内执行的开发、配置与维护任务。避免形式主义：不要求每一步都新建过程文档，但每一步的思考与核验必须真实发生。

## Step 1：Understand（理解需求）

- 阅读用户任务书或指定的 Issue，明确目标、边界、非目标（Out-of-Scope）与验收标准。
- 核对当前阶段边界：工程基线当前处于 **Phase 0**；未经授权不得推进 `docs/tasks/M0.md` 业务功能或宣称业务验收完成。

## Step 2：Discover（按需发现）

- 遵循 [渐进式披露规范](progressive-disclosure.md)，按任务类型加载 L1 治理文档与 L2 相关文件（如 [项目上下文](../references/project-context.md)、目标源码或产品文档）。
- 盘点现有能力、依赖版本、数据库/环境变量现状及未提交的本地改动，保护已有文件。
- 涉及 DAO、数据库适配、Schema/索引、SQL 或缓存时，加载 [数据访问与缓存工程约束](../../docs/architecture/data-access.md)，区分已确认要求和实际能力。

## Step 3：Plan（制定计划）

- 明确拟修改的文件清单、关键技术决策、风险边界及对应的验证命令。
- 小任务保持简短口头或内部计划；跨文件或涉及 Schema/认证的任务先理清依赖顺序与回滚/保护策略。
- 严禁未经必要性验证引入新依赖、新状态管理或复杂架构。
- 数据任务同时明确所选后端、表与索引用途、SQL 批量/事务边界、缓存失效和失败行为，以及需要验证的兼容范围；不以缓存替代查询优化。
- Schema/migration 任务把全量 DDL 同步列为交付项，按 [数据库部署说明](../../docs/architecture/database-deployment.md) 生成、检查，并验证适用的空库部署与升级路径。

## Step 4：Implement（最小实现）

- 按计划实施最小必要改动，遵守 [architecture.md](../governance/architecture.md)、[coding.md](../governance/coding.md) 与 [security.md](../governance/security.md)。
- 不做无关重构；若实施过程中发现未预见的约束或文档冲突，先暂停扩大改动并更新计划。

## Step 5：Verify（质量验证）

- 按 [quality-gates.md](../governance/quality-gates.md) 执行实际可运行的检查（至少覆盖 `pnpm lint`、`pnpm typecheck`、`pnpm build`；认证/Schema 变更在条件允许时运行 `pnpm verify:auth`）。
- 严格区分**检查通过**、**检查失败**、**未配置**与**环境受阻**，禁止虚报结果或修改无关代码凑过检查。

## Step 6：Review（变更自审）

- 核对本次变更是否完整覆盖需求、是否超出授权范围、是否存在硬编码密钥或伪造数据。
- 检查新增或修改的 Markdown 文档引用路径是否全部有效。
- 工程要求变化时更新唯一约束正文及路由；实现变化时同步项目事实与适用门禁，不复制多份现行规则或把目标提前标为完成。

## Step 7：Report（交付报告）

向用户提供简洁、可核验的交付报告，至少包含：

1. **完成内容**：本次实际落地的能力或规范范围。
2. **修改文件与关键决策**：列出新增/修改文件及重要取舍。
3. **实际验证与结果**：逐项列出执行的命令及真实结果（含未配置或环境受阻项）。
4. **遗留风险与限制**：尚未验证的外部能力、前置条件或已知限制。
5. **后续建议**：如适用，给出下一步最小可执行的任务建议（不越权提前实施）。

当任务属于工程阶段或产品里程碑（如 `docs/tasks/` 跟踪的任务）时，按要求在 `docs/tasks/` 同步记录交付、验证条件、未运行项与下一步。

## 处于 Issue 串行循环中的一轮

由 `scripts/run-issue-loop.py` 的固定提示词发起时，仍走上面七步，但一轮只做一个 Issue 的一个可验证增量。Step 5 的适用门禁通过后才提交；未通过不得把任务报成完成。Step 7 的结论写入 Issue 评论，格式见 [issue-lifecycle.md](issue-lifecycle.md) 的串行循环。写完就结束本轮，下一轮是新的 session，不继承这次对话。
