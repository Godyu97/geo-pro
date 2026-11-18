# B05 本人数据导出

本项交付设置中的范围预览、生成结果和受保护下载，覆盖 AC-M0-01-2 的导出路径。 [Issue #5](https://github.com/Godyu97/geo-pro/issues/5) · [T-M0-01](M0.md#t-m0-01) · [S-M0-01](../specs/M0.md#s-m0-01)

OpenSpec 变更 `b05-owned-data-export` 已同步 3 条要求和 7 个场景。 [主规格](https://github.com/Godyu97/geo-pro/blob/main/openspec/specs/owned-data-export/spec.md) · [归档](https://github.com/Godyu97/geo-pro/tree/main/openspec/changes/archive/2026-11-18-b05-owned-data-export)

## 使用与范围

- 进入工作台的「账户设置 → 数据管理」，选择范围后生成。个人资料包含当前称呼和登录邮箱。品牌范围包含本人可读的活跃及归档档案、各实体版本和已保存草稿。界面列出尚未开放的事实、附件、监测证据、内容、报告和用量费用。
- 最近一次结果显示生成时间、导出语言、已生成及失败范围。部分完成时附件包含成功的范围和缺失清单。范围全部失败时显示失败状态。
- 可下载版本化 UTF-8 JSON。文件用 `requested`、`included`、`missing`、`unavailable` 和 `data` 记录范围。`locale` 和文件名使用生成时的界面语言。原始文字及业务语言保持原值。个人资料仅投影 `name`、`email`，品牌字段遵循 B04 验证规则。
- 生成和下载分别核验会话。下载查询绑定当前账号及最近一次记录 ID，重新检查范围、归属与内容。源资料变化、失权、删除或再次生成后，旧地址拒绝读取旧内容。普通账号和没有对应归属的维护者收到一致的未找到提示。文件响应为 `private, no-store`。

## 存储与运行

`user_data_export` 通过负责人主键保存一条生成记录，包含随机 ID、语言、时间、请求及已生成范围、完整性指纹。账号删除级联移除记录。下载重读源数据并核对指纹，服务端持久化生成元数据。PostgreSQL 使用账号行锁，SQLite3 使用现有立即事务，失败范围由保存点隔离。并发请求仅能推进同一份前置记录一次，重试可刷新确认。

品牌版本与草稿按每批 64 条读取。品牌内容累计超过 8 MiB 时，该范围反馈失败。双方言在测试中以 10 和 500 条其他账号的合成品牌比较查询，当前账号的版本和草稿均各需一条 SQL。SQLite3 单次测量总计约 1.55 / 1.25 ms，PostgreSQL 约 1.92 / 1.59 ms。双方言使用品牌负责人范围索引和版本联合主键；SQLite3 用草稿联合主键过滤，PostgreSQL 对两行草稿小表使用顺序扫描。生成记录按负责人主键查询，复用相关索引。

先在指定环境应用双方言对应的 `pnpm db:migrate`。常规环境开放本人账户资料导出。品牌部分沿用 `GEO_BRANDS_FIXTURE=1` 的回环验收路径，使用合成资料。正式品牌资料开放条件继续由 B04、B06–07 的验证和披露承接。冻结新增后须同步让冻结范围退出普通读取及下载，清除前须验证持久副本和备份行为。 [数据库部署说明](../architecture/database-deployment.md) · [B04 的正式开放条件](B04-brand-onboarding.md)

## 实际验证

| 检查 | 结果 |
| --- | --- |
| 静态检查与生产构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。构建时清空数据库与认证配置。 |
| Schema、迁移及 DDL | `pnpm db:generate`、双方言 SQL 审核、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。在隔离库从 B04 升级，两次运行 `pnpm db:migrate`，已有账号、品牌档案及草稿可读，空库 DDL 与迁移结果一致。 |
| `pnpm test:data-exports` | 3 项通过。覆盖双库批量读取、完整与部分结果、容量上限、保存点回滚、记录写入回滚、并发、过期文件及账号级联。 |
| `pnpm verify:data-exports` | SQLite3 和 PostgreSQL 生产 HTTP 验收通过，覆盖匿名、伪造、过期和撤销会话、其他账号、维护授权、归属变更、源内容删除、部分失败及中英文 UTF-8 文件名。常规环境核验账户资料可导出及品牌范围关闭。 |
| 回归 | `pnpm test:brands` 3 项、`pnpm test:maintenance` 25 项通过。`pnpm verify:brands` 和 `pnpm verify:maintenance` 通过。后者包含双方言的 `pnpm verify:auth`。 |
| 消息校验 | `pnpm check:i18n` 核对 305 个键及参数，`pnpm test:i18n` 6 项通过。 |
| `pnpm test:e2e` | 隔离 PostgreSQL 的 Chrome 全量 67 项通过，其中导出专项 8 项。覆盖双语 375/768/1440、键盘及焦点、AA 正文对比度、语言切换、加载、部分失败和 Unicode 下载。 |
| 文档与规格 | `python docs/tools/validate_docs.py` 和 OpenSpec 严格检查通过。 |

故障注入初次发现 PostgreSQL 驱动会在外层事务保留失败语句。改用驱动保存点后，部分结果与外层提交在两种数据库上均复验通过。
