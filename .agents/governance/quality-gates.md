# 分级质量门禁

本规范基于仓库 [package.json](../../package.json) 中的真实脚本与现有工具链定义质量检查标准。

## 可用检查清单

| 级别 | 检查项 | 真实命令 | 适用条件与说明 |
| --- | --- | --- | --- |
| 基础静态门禁 | ESLint 检查 | `pnpm lint` | 实际执行 `eslint`；所有代码改动必须执行 |
| 基础静态门禁 | TypeScript 类型检查 | `pnpm typecheck` | 实际执行 `tsc --noEmit`；所有 TS/TSX 改动必须执行 |
| 构建门禁 | Next.js 生产构建 | `pnpm build` | 实际执行 `next build`；不依赖数据库或 AI Key |
| 专项认证门禁 | 本地认证与 DB 端到端校验 | `pnpm verify:auth` | HTTP + 显式选择的 PostgreSQL/SQLite；包含伪造/过期/撤销会话读写拒绝及账号隔离；需本地应用运行且开发库已迁移 |
| 账号邮件专项 | 邮箱验证、限流、密码重设与品牌恢复 | `pnpm verify:account-email` | 先 `pnpm build`，在 3117 端口使用双方言隔离库、回环邮件接收器和本机 Chrome |
| 数据库迁移核验 | Auth Schema 与迁移检查 | `pnpm db:auth-schema` / `pnpm db:generate` / `pnpm db:migrate` | 前两项生成双方言；迁移只执行显式选择后端。先审核 SQL 再迁移 |
| 全量 DDL 一致性 | 防止建表快照过期 | `pnpm db:ddl:check` | 检查 PostgreSQL/SQLite；过期先运行 `pnpm db:ddl` 并审核；结构变化还须验证隔离空库部署 |
| 维护 DAO 合同 | 双数据库事务/隔离/迁移 | `pnpm test:maintenance` | 本地 PostgreSQL 可创建隔离测试库；SQLite 临时文件；含约束、并发、回滚、审计失败、DDL 对照与查询计划 |
| 环境与应用启动 | 显式配置及服务实测 | `pnpm env:check` | `pnpm dev`、`pnpm start` 先核对必填配置。开发预检实际读取数据库、写读清理 Redis 和 S3 探针。`--probe-ai` 增加 Responses API 冒烟检查 |
| M0 双库集成 | 迁移升级、全量 DDL 与模块测试零跳过 | `pnpm verify:dual-db` | 显式配置 `GEO_DUAL_DB_URL` 指向测试用回环 PostgreSQL。脚本创建和清理随机隔离库，并拒绝任何跳过的模块测试 |
| 维护 HTTP 集成 | 实际会话、CLI 与维护边界 | `pnpm verify:maintenance` | 先 `pnpm build`；启动独立 3103 端口，分别使用双方言隔离库，并分别执行 `pnpm verify:auth` |
| 品牌事实 DAO | 双库升级、版本、审批、资格和撤销 | `pnpm test:brand-facts` |
| 品牌事实集成 | 双语工作台、归属和公开投影 | `pnpm verify:brand-facts` |
| 题集 DAO | 双库升级、版本、重复题、引用和查询计划 | `pnpm test:prompts` | SQLite 临时文件及本地 PostgreSQL 隔离库 |
| 题集集成 | 双语监测问题、归属和冻结边界 | `pnpm verify:prompts` | 先 `pnpm build`，在 3119 端口使用双方言隔离库 |
| 监测登记 DAO | 双库升级、幂等受理、分轨预留和查询计划 | `pnpm test:monitoring` | SQLite 临时文件及本地 PostgreSQL 隔离库 |
| 品牌 DAO | 双库迁移、归属、版本、并发与查询计划 | `pnpm test:brands` | SQLite 临时文件及本地 PostgreSQL 隔离库 |
| 品牌 HTTP 集成 | 实际会话、归属和收集边界 | `pnpm verify:brands` | 先 `pnpm build`，在 3105 端口使用双方言隔离库 |
| 本人数据导出 DAO | 双库升级、批量查询、生成状态与回滚 | `pnpm test:data-exports` | SQLite 临时文件及本地 PostgreSQL 隔离库 |
| 本人数据导出 HTTP | 会话、归属、语言、失效和失败状态 | `pnpm verify:data-exports` | 先 `pnpm build`，在 3106 端口使用双方言隔离库 |
| 试点额度 DAO | 双库升级、版本、权限、预算和回滚 | `pnpm test:quotas` | SQLite 临时文件及本地 PostgreSQL 隔离库 |
| 试点额度集成 | 维护接口及双语设置 | `pnpm verify:quotas` | 先 `pnpm build`，3107 端口、双方言隔离库和本机 Chrome |
| 通道能力 DAO | 双库升级、双轨版本、正式运行门禁与联网证据 | `pnpm test:capabilities` | SQLite 临时文件及本地 PostgreSQL 隔离库 |
| 通道能力集成 | 维护接口、设置范围与运行确认 | `pnpm verify:capabilities` | 先 `pnpm build`，3108 端口、双方言隔离库和本机 Chrome |
| 文档包核验 | 产品文档一致性检查 | `python docs/tools/validate_docs.py` | 仅当核对或变更 `docs/` 产品文档时运行（仅检查链接、映射与样例，不代表业务验收） |
| 多语言消息 | key / 参数完整性 | `pnpm check:i18n` | 消息目录、页面与本地化变更执行 |
| 多语言基础测试 | Node.js 原生测试 | `pnpm test:i18n` | 覆盖解析、缺 key/参数负例、格式化、校验与返回地址 |
| 多语言界面 E2E | Playwright + 本机 Chrome | `pnpm test:e2e` | 本地 PostgreSQL、完整认证环境和独立 3100 端口；副本触发加载/故障，临时账号自动清理 |

## 执行与判定规则

1. **优先使用已有脚本**：首先核对 `package.json` 中的脚本，直接通过 `pnpm <script>` 执行。
2. **明确区分四种结果状态**，严禁混淆或虚报：
   - **检查通过**：命令实际执行完成且退出码为 0。
   - **检查失败**：命令实际执行并报错或未达到预期，如实报告错误摘要与影响。
   - **未配置**：项目当前尚无对应基础设施（如后续业务 DAO / Redis 专项尚未接入），不得编造测试通过记录。
   - **环境受阻**：因缺少本地运行服务、PostgreSQL 实例、浏览器环境或外部 API 凭证导致无法运行，必须标明阻塞原因与未验证范围。
3. **禁止破坏性通过**：不得为了通过检查而关闭 `strict`、删除有效的 Zod 校验、注释 ESLint 规则或修改无关业务代码。
4. **区分工程检查与业务验收**：`pnpm build` 或 `validate_docs.py` 通过不等于产品 M0/M1/M2 业务验收通过；未接入或未实测的外部能力必须标注为未验证。
5. Agent 自行执行适用验收，使用指定的开发库操作并核对状态。品牌管理与 AI 监测记录开发环境真实联调、隔离回归与正式试点各自的证据。 [开发环境走查](../../docs/tasks/brand-monitoring-next.md#dev-live-data) · [阶段门禁](../../docs/05-里程碑与验收计划.md)

## 数据访问与缓存专项门禁

涉及 DAO、数据库适配、缓存、SQL 或表/索引时，执行 [数据访问与缓存工程约束](../../docs/architecture/data-access.md) 中适用的专项验收：分别覆盖 SQLite3 / PostgreSQL、memory / Redis 的合同与失败行为，并提交查询次数、计划和表/索引用途证据。只改某个既有后端时说明实际覆盖范围；不能把单后端结果扩写成双后端通过。

双库及 HTTP 专项证据见 [B08 维护授权](../../docs/tasks/B08-maintenance-access.md)、[B04 品牌建档](../../docs/tasks/B04-brand-onboarding.md)、[B05 本人数据导出](../../docs/tasks/B05-owned-data-export.md)和 [B10 试点额度](../../docs/tasks/B10-pilot-quotas.md)。品牌事实、补证和版本资格的专项证据见 [T-M0-02](../../docs/tasks/T-M0-02-brand-facts.md)。购买问题簇与题集冻结的专项证据见 [T-M0-03](../../docs/tasks/T-M0-03-prompt-sets.md)。其他业务 DAO 与 cache 专项按对应任务补齐。

全量 DDL 导出与检查入口已配置；其结果只证明与当前 Schema 一致。空库导入、migration 对照与持续升级的验证边界见 [数据库部署说明](../../docs/architecture/database-deployment.md)，不得对现有数据直接重复导入全量建表 SQL。

## Web 多语言专项门禁

页面、文案、表单/校验、导航、Metadata、格式化、SSR 或本地化缓存变更，按 [Web 多语言规范](../../docs/architecture/i18n.md) 与 [兼容矩阵](../../docs/08-验收场景与样例.md#i18n-checks) 验证适用场景；分别记录 `zh-CN` / `en` 的消息完整性、切换/恢复、首屏一致性、路由/会话、数值与业务语言隔离、375/768/1440 布局和键盘行为。

B01 已接入消息、切换与上述专项命令，范围和证据见 [B01 记录](../../docs/tasks/B01-i18n.md)。`pnpm test:e2e` 覆盖官网、账号、工作台壳层、维护权限，以及 [M0-39](../../docs/tasks/M0-39-browser-e2e.md) 的隔离「北岸设备」主流程。该流程使用合成数据和隔离传输，不代表真实通道或试点门禁通过。后续图表和新增页面仍须继续补测。文档、lint、类型检查或构建通过不代表双语言验收通过，不能只改 `<html lang>` 或依赖中文回退宣称英文支持。

## Web 视觉专项门禁

新增或改版界面时，按 [全站视觉验收清单](../../docs/08-验收场景与样例.md#ui-visual-checks) 核对受影响页面的主题复用、状态反馈、响应式和键盘行为。整站改版交付页面覆盖清单、代表性截图及实际交互结果。
