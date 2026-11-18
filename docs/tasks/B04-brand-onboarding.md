# B04 品牌建档交付

[Issue #4](https://github.com/Godyu97/geo-pro/issues/4) · [S-M0-01](../specs/M0.md#s-m0-01) · [T-M0-01](M0.md#t-m0-01)

OpenSpec 变更 `b04-brand-onboarding` 包含 4 条要求和 8 个场景。 [主规格](https://github.com/Godyu97/geo-pro/blob/main/openspec/specs/brand-onboarding/spec.md) · [归档](https://github.com/Godyu97/geo-pro/tree/main/openspec/changes/archive/2026-11-18-b04-brand-onboarding)

## 使用与设计

- 工作台进入 `/dashboard/brands`。负责人可新建、继续草稿、编辑活跃品牌和查看历史版本，也可归档或在没有活跃品牌时恢复。
- 品牌、关注范围、问题草稿为三个步骤。下一步和保存草稿会提交到本人账号。重新登录可从已保存的步骤继续，保存动作由用户触发。界面切换保留表单，地区和业务语言默认 `CN` 和 `zh-CN`。
- 名称及描述按修剪后的 Unicode 码点检查。官网、别名、竞品与问题均可跳过。官网接受使用公开域名的 HTTP(S) 地址并保存原文，录入时不会发起网络请求。无官网显示官网引用不适用。无已开放通道时可建档，界面说明监测当前不可启动。问题留在草稿范围。
- 私有页面与 API 依据当前会话和负责人取数据。品牌档案及实体版本可分别按 ID 和版本定位。档案修订检查避免覆盖并发更改，草稿使用不可复用的版本标识。已成功的写请求可用同一操作 ID 和同一输入核对结果。
- SQLite3 和 PostgreSQL 均有 `brand`、`brand_version`、`brand_draft`、`brand_operation` 四张表。以负责人和活跃状态的部分唯一索引保护上限。档案、快照、草稿和操作结果在同一事务提交。快照使用品牌和实体版本联合主键。操作记录含不透明标识、输入摘要及最小结果。数据库查询绑定参数，品牌响应使用私有 `no-store`。

## 隔离验收与正式开放

`pnpm build` 后运行 `pnpm verify:brands`，会在回环地址启动应用，使用临时 SQLite 文件和本机 PostgreSQL 随机测试库，结束后清理。手工验收可在已迁移的专用测试库上启用服务端 `GEO_BRANDS_FIXTURE=1`。将 `BETTER_AUTH_URL` 指向应用监听的回环地址，例如 `http://localhost:3000`，以 `pnpm dev --hostname localhost` 启动。进入工作台后按页面提示仅录入合成资料。

常规运行先显示开放条件，品牌读写接口保持关闭。测试环境披露草稿、版本与归档留在隔离库，测试库由运行者清理。正式收集前需要实际核验并公布保留期限、身份验证与恢复方式、持久副本及备份清除流程、私密申请受理人和渠道。B06–07 跟踪删除、恢复与清除链路。D4 的线上操作与备份演练未执行。

## 验收结果

| 场景 | 证据 |
| --- | --- |
| AC-M0-01-1 | 浏览器从官网经工作台完成三步引导，无官网及竞品仍能保存。官网引用显示不适用，界面显示当前无监测通道。 |
| AC-M0-01-2 的品牌范围 | SQLite3 与 PostgreSQL 实际 HTTP 独立拒绝匿名、伪造、过期和撤销会话。另一账号和未拥有品牌的维护身份收到与未知品牌相同的答复。浏览器直接访问也看不到内容。事实、证据及下载随对应任务验收。 |
| AC-M0-01-3 的品牌范围 | 对原档案修改别名后创建新版，旧快照的原文保持可读。退出和会话过期后可回到相同已保存步骤。真实报告引用联调由 T-M0-12 承接。 |
| 并发和回滚 | 双方言验证并行建档、并行更新、创建与恢复竞争、相同请求重发及同键异参拒绝。注入 SQL 约束失败后档案回滚，原草稿仍可继续。 |
| D4 | 常规运行双语显示关闭说明，拒绝合法会话调用写入且表仍为空。回环测试在输入前展示合成资料说明。 |

查询计划在 10 和 500 条合成归档上核对，两种规模均为每页一条 SQL，最多取 21 条判断是否还有下一页。PostgreSQL 使用 `brand_owner_status_created_idx` 倒序扫描并通过 `brand_version_brand_id_version_pk` 查名称。SQLite3 使用同一档案索引及快照联合主键。单次观察分别约为 SQLite3 0.79 / 0.81 ms 和 PostgreSQL 2.39 / 3.25 ms。活跃档案按负责人和状态过滤。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 基础静态与生产构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。构建时清空数据库和认证配置。 |
| Schema、升级与全量 DDL | `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。双方言 SQL 已审核。隔离库从 B08 Schema 使用 `pnpm db:migrate` 升级并复跑，保留已有账号和授权。空库全量 DDL 与迁移结构一致。 |
| DAO 与实际 HTTP | `pnpm test:brands` 3 项通过。`pnpm test:maintenance` 25 项通过。`pnpm verify:brands`、`pnpm verify:maintenance` 和其中双方言的 `pnpm verify:auth` 通过。 |
| 双语言与浏览器 | `pnpm check:i18n` 核对 276 个消息键及参数，`pnpm test:i18n` 6 项通过。Chrome 专项 9 项、全量 59 项通过，含 375/768/1440、焦点、中文输入法组合、界面语言切换、加载和失败反馈。 |
| 文档与规格 | `python docs/tools/validate_docs.py` 与 OpenSpec 严格验证通过。 |

首次浏览器全量运行有两项用例在关闭测试上下文时超时。测试增加了重新登录后的会话同步，并在清理账号前关闭页面。完整复跑 59 项通过。

本项的软件和隔离验收范围为 B04。真实渠道、真实报告、导出、删除清除和完整 T-M0-01 验收继续由对应任务覆盖。
