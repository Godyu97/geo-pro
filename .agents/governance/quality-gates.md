# 分级质量门禁

本规范基于仓库 [package.json](../../package.json) 中的真实脚本与现有工具链定义质量检查标准。

## 可用检查清单

| 级别 | 检查项 | 真实命令 | 适用条件与说明 |
| --- | --- | --- | --- |
| 基础静态门禁 | ESLint 检查 | `pnpm lint` | 实际执行 `eslint`；所有代码改动必须执行 |
| 基础静态门禁 | TypeScript 类型检查 | `pnpm typecheck` | 实际执行 `tsc --noEmit`；所有 TS/TSX 改动必须执行 |
| 构建门禁 | Next.js 生产构建 | `pnpm build` | 实际执行 `next build`；不依赖数据库或 AI Key |
| 专项认证门禁 | 本地认证与 DB 端到端校验 | `pnpm verify:auth` | 当前仅 HTTP + PostgreSQL；包含伪造/过期/撤销会话读写拒绝及账号隔离；涉及认证、会话、DB Schema 变更时运行（需本地应用运行且开发库已迁移），不覆盖 SQLite |
| 数据库迁移核验 | Auth Schema 与迁移检查 | `pnpm db:auth-schema` / `pnpm db:generate` / `pnpm db:migrate` | 当前仅配置 PostgreSQL；涉及表结构或认证选项变更时按需生成、审核 SQL 再迁移，SQLite 须另补适用入口 |
| 全量 DDL 一致性 | 防止建表快照过期 | `pnpm db:ddl:check` | 当前仅 PostgreSQL；Schema/migration、DDL 或导出脚本变更时执行；过期先运行 `pnpm db:ddl` 并审核；结构变化还须验证隔离空库部署 |
| 文档包核验 | 产品文档一致性检查 | `python docs/tools/validate_docs.py` | 仅当核对或变更 `docs/` 产品文档时运行（仅检查链接、映射与样例，不代表业务验收） |
| 多语言消息 | key / 参数完整性 | `pnpm check:i18n` | 消息目录、页面与本地化变更执行 |
| 多语言基础测试 | Node.js 原生测试 | `pnpm test:i18n` | 覆盖解析、缺 key/参数负例、格式化、校验与返回地址 |
| 多语言界面 E2E | Playwright + 本机 Chrome | `pnpm test:e2e` | 本地 PostgreSQL、完整认证环境和独立 3100 端口；副本触发加载/故障，临时账号自动清理 |

## 执行与判定规则

1. **优先使用已有脚本**：首先核对 `package.json` 中的脚本，直接通过 `pnpm <script>` 执行。
2. **明确区分四种结果状态**，严禁混淆或虚报：
   - **检查通过**：命令实际执行完成且退出码为 0。
   - **检查失败**：命令实际执行并报错或未达到预期，如实报告错误摘要与影响。
   - **未配置**：项目当前尚无对应基础设施（如业务 DAO / SQLite 专项验证尚未接入），不得编造测试通过记录。
   - **环境受阻**：因缺少本地运行服务、PostgreSQL 实例、浏览器环境或外部 API 凭证导致无法运行，必须标明阻塞原因与未验证范围。
3. **禁止破坏性通过**：不得为了通过检查而关闭 `strict`、删除有效的 Zod 校验、注释 ESLint 规则或修改无关业务代码。
4. **区分工程检查与业务验收**：`pnpm build` 或 `validate_docs.py` 通过不等于产品 M0/M1/M2 业务验收通过；未接入或未实测的外部能力必须标注为未验证。

## 数据访问与缓存专项门禁

涉及 DAO、数据库适配、缓存、SQL 或表/索引时，执行 [数据访问与缓存工程约束](../../docs/architecture/data-access.md) 中适用的专项验收：分别覆盖 SQLite3 / PostgreSQL、memory / Redis 的合同与失败行为，并提交查询次数、计划和表/索引用途证据。只改某个既有后端时说明实际覆盖范围；不能把单后端结果扩写成双后端通过。

当前 SQLite、业务 DAO、cache 合同与 SQL 性能的自动验证入口均**未配置**。后续实施时补齐所需验证并记录真实命令；不能因规范、DDL 导出或构建通过而将尚未实现的目标标为通过。

全量 DDL 导出与检查入口已配置；其结果只证明与当前 Schema 一致。空库导入、migration 对照与持续升级的验证边界见 [数据库部署说明](../../docs/architecture/database-deployment.md)，不得对现有数据直接重复导入全量建表 SQL。

## Web 多语言专项门禁

页面、文案、表单/校验、导航、Metadata、格式化、SSR 或本地化缓存变更，按 [Web 多语言规范](../../docs/architecture/i18n.md) 与 [兼容矩阵](../../docs/08-验收场景与样例.md#i18n-checks) 验证适用场景；分别记录 `zh-CN` / `en` 的消息完整性、切换/恢复、首屏一致性、路由/会话、数值与业务语言隔离、375/768/1440 布局和键盘行为。

B01 已接入消息、切换与上述专项命令，范围和证据见 [B01 记录](../../docs/tasks/B01-i18n.md)。当前 E2E 只覆盖现有官网、账号、工作台壳层及边界；未来业务页面、图表和导出须继续补测。文档、lint、类型检查或构建通过不代表双语言验收通过，不能只改 `<html lang>` 或依赖中文回退宣称英文支持。
