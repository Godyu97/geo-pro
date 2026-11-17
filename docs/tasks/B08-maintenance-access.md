# B08 维护身份与最小管理授权

> Issue [#8](https://github.com/Godyu97/geo-pro/issues/8)｜2026-11-18｜M0 维护前置；完整 M0/T-M0-04 保持未完成。

## 范围与关键决定

- 服务端显式授予 `capabilities.manage`、`quotas.manage`、`support.read`，三项独立、默认拒绝，逐请求读取权威授权。
- 受控服务器 CLI 授予/撤销；核对实际操作者和独立维护账号，无在线提权、共享超级角色或用户冒充。操作方式及失败处理见 [维护说明](../architecture/maintenance-access.md)。
- 授权变更及关键动作与成功审计同事务；失败回滚后单独记录。日志仅白名单动作/原因、已验证不透明账号 ID、时间、结果和追踪 ID；不收请求原文、正文或凭据。数据库整体失败时拒绝并输出安全故障追踪。
- 新增 `maintenance_grant`、`maintenance_audit` 两张表；前者用户/权限联合主键和用户外键，后者独立追加并按操作者/时间索引。账号删除级联授权，不级联最小审计。
- 新增本人权限页面/API，双语言提示真实权限、未开放业务和安全故障；工作台导航及精确返回白名单同步接入。
- 认证和本用例 DAO 接入 PostgreSQL/SQLite，复用 Node 24 内置 SQLite、官方 Drizzle proxy/Auth adapter，无新增依赖或缓存；[双方言迁移与 DDL](../architecture/database-deployment.md) 独立维护。

## 修改入口

领域在 `src/features/maintenance/`；薄路由在 `src/app/(dashboard)/dashboard/maintenance/` 和 `src/app/api/maintenance/access/`。基础设施在 `src/lib/db/`、`src/lib/auth/`，工具在 `scripts/database.mjs`、`maintenance-access.mjs`、`verify-auth.mjs`、`verify-maintenance.mjs`；专项测试在 `tests/maintenance/`、`tests/e2e/maintenance.spec.ts`。工程事实和门禁随实现同步，未修改产品验收口径或历史归档。

## 实际验证

以下是收尾复核的实际结果；不将基础检查扩写为完整 M0 验收。

| 检查 | 当前实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 全部通过；最终构建显式清空 DB/Auth 配置仍通过 |
| `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` | 双方言生成/检查通过，SQL 已审查；无破坏性修改 |
| 本地 PostgreSQL `pnpm db:migrate` | 通过，迁移前后账号数量相同；隔离旧基线升级还验证原认证记录逐字段保持 |
| SQLite `pnpm db:migrate` | 临时文件执行两次通过，历史幂等；校验和错误被拒绝 |
| `pnpm test:maintenance` | 最终 25 项通过，包含无效 CLI 仅记录已核实账号 ID 的隐私负例 |
| `pnpm verify:maintenance` | SQLite/PG 均通过真实 HTTP、受控 CLI、逐权限撤销、账号隔离、故障及审计隐私；各自 `pnpm verify:auth` 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 174 个消息 key/参数与 6 项基础/负例测试通过 |
| `pnpm test:e2e` | 最终完整复跑 41/41 通过（2.7 分钟），含新增 8 项维护场景及原认证/官网/i18n 回归 |
| `python docs/tools/validate_docs.py` | 通过：26 项需求、29 项任务、81 个验收 ID、30 个活动 Markdown、268 个本地链接及样例 |
| OpenSpec strict / 归档 | 5/5 任务完成；主规格及归档 strict 均通过，6 条要求/8 个场景逐项一致 |

浏览器覆盖 zh-CN/en、375/768/1440、普通/维护/撤销身份、语言切换保留权限/查询/片段、刷新/导航键盘操作、故障和加载，无溢出或页面脚本错误。已有共同 UI 测试验证本页沿用主题的 AA 正文对比度。截图由测试输出到 `test-results/maintenance-*`，可通过上述命令重新生成。执行中修正了测试账号 Cookie 切换后相同片段地址不触发新 SSR，以及旧按钮名称断言，随后完整复跑通过。

### 数据与 SQL 证据

双方言分别用隔离空库 migration 和全量 DDL 创建结构，列/约束/索引对照一致；验证外键、权限 CHECK、唯一性、授权幂等、竞争、动作/审计失败回滚。SQLite 验证实际外键启用、独立连接锁竞争及恢复；PostgreSQL 验证旧认证 migration 的增量升级。

纯合成性能测试分别新增 10、500 个账号/授权及对应审计，不是客户或监测数据；两种规模下本人授权检查均为 3 条业务 SQL（锁定账号、集合读授权、追加审计，不含事务边界），没有按权限逐项查询。SQLite 使用联合主键索引及审计 covering index；PG 使用联合主键和审计索引的 Bitmap Index Scan。最终一次运行的 10/500 新增账号场景分别为 SQLite 0.41/0.51ms、PG 2.36/3.14ms，仅为本地单次测试，不承诺线上延迟。每次运行输出真实耗时/计划。

### Issue 验收映射

1. 普通身份直接调用拒绝：双库真实 HTTP 401/403；自报角色、其他用户 ID、重复/非法输入拒绝。
2. 维护身份不扩大客户资料权限：实际验证维护账号替换另一账号 ID 仍只能读写本人；维护 API 仅返回本人权限/追踪 ID。品牌正文、附件、私人报告尚无接口，须随相应 Issue 再验，未伪造其通过结果。
3. 撤销立即生效：三项单独授予/撤销，后续请求立即拒绝；在途数据库动作与撤销串行，其他权限不受影响。
4. 失败与隐私：失败动作、非法 CLI、审计失败和服务故障可追踪；回滚可观察，日志无密码、会话 Cookie 或测试客户正文。
5. 界面 U：双语言授权/拒绝/不可用、三种宽度、键盘、语言切换及加载均通过，最终结果以上表为准。

## 边界与后续

OpenSpec 主规格位于 `openspec/specs/maintenance-access/spec.md`，完整规划和任务归档于 `openspec/changes/archive/2026-11-18-b08-maintenance-authorization/`。这些仓库工程路径不属于可独立复制的产品文档包。`openspec validate --all --strict` 和 `openspec validate --archived --strict` 均通过；无活动变更遗留。

本轮不部署、不创建分支/PR，不给真实账号赋权；真实独立维护身份、服务器授权和故障日志采集需上线前由负责人实际配置。审计保留期限须按批准政策确定，本项不虚构期限。未引入 memory/Redis，其他业务 DAO、B09/B10/B14 业务操作、客户正文/附件归属和完整 M0/真实渠道验收仍由各自任务负责。

GitHub Projects 因令牌缺少 `read:project` 使用现有状态 Labels。本地实现与核验已完成；提交 SHA、Push 和最终 Done/关闭结果在 Issue 最终评论记录，只有推送成功后才关闭。
