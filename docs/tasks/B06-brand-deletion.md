# B06 品牌删除、访问冻结与恢复

[Issue #6](https://github.com/Godyu97/geo-pro/issues/6) · [S-M0-01](../specs/M0.md#s-m0-01) · [T-M0-01](M0.md#t-m0-01) · [公共规格](../04-产品功能规格-SPEC.md)

## 交付范围

- 账户设置指向品牌管理。负责人可在品牌详情预览品牌、草稿、版本、附件、历史报告、在途动作及保留的账务审计范围。页面明确标出尚未接入的附件和报告。预览及取消只读。
- 确认后冻结普通详情、历史版本、品牌草稿、旧导出和新额度动作。私有读取禁用缓存，品牌链接禁用预取。通过浏览器历史返回品牌页面或设置时重新请求服务端。既有尝试可继续核对费用。冻结与操作结果以单事务写入，重复确认使用原结果。
- 待删除列表与恢复页只提供不透明品牌标识和日期。默认 30 天。恢复要求负责人邮箱已验证、冻结后重新登录，并在登录后五分钟内明确提交。活跃品牌额度仍适用。成功恢复原业务状态、版本及冻结前可继续的草稿，旧导出需重新生成。

## 双库与受控操作

在 PostgreSQL / SQLite3 追加 `brand.frozen_at`、`brand.restore_until`，当前状态与修订留在原行。活跃品牌唯一索引仅包含未冻结记录。按负责人、冻结时间和 ID 排序的部分索引支持有界翻页。单品牌影响预览一次查询，利用品牌 ID、版本、草稿及额度表的键完成计数。PostgreSQL 使用账户及品牌行锁，SQLite3 使用即时事务。品牌新路径沿用原数据库连接和部署流程。 [数据库部署说明](../architecture/database-deployment.md)

提前处理由有权操作人员通过已核验的私密渠道受理，再在受控服务端运行：

```sh
pnpm brands:shorten-recovery <owner-id> <brand-id> <operator-id> <approved-request-uuid> <expected-revision> <utc-iso-deadline-with-milliseconds>
```

命令仅缩短既有冻结的期限，使用账户、修订及请求标识核验并留存操作结果。操作记录只保留标识、时间和结果。请求正文留在获准的受理渠道。到期仍冻结，由 B07 承接清除。B07 接入实际清除时须先处理 `brand` 的级联关系及应独立保留的费用记录。

## 验收记录

| 检查 | 已验证的结果 |
| --- | --- |
| 工程与数据 | `pnpm lint`、`pnpm typecheck`、`pnpm build`、双方言生成及增量迁移、`pnpm db:ddl`、`pnpm db:ddl:check` 通过。维护测试核对空库 DDL 和迁移结果。 |
| 双库 DAO | `pnpm test:brands`、`pnpm test:data-exports`、`pnpm test:quotas`、`pnpm test:maintenance` 通过。实测事务回滚、重复确认、提前处理与恢复竞争、逾期、撤销旧下载及在途费用核对。两库的预览都使用一条查询，执行计划使用品牌版本和额度账本主键索引。 |
| AC-M0-01-2 | `pnpm verify:brands` 以双方言实际 HTTP 确认会话与归属、冻结后普通读写和旧下载失效、未验证邮箱和旧会话均不能恢复。重新登录后本人恢复，旧下载继续失效。 |
| 界面 U | 本机 Chrome 73 项通过，其中新增 6 项覆盖 zh-CN/en、375/768/1440、键盘确认与取消、语言切换、失败重试、冻结后浏览器返回以及重新登录后恢复。 |
| 回归 | `pnpm verify:data-exports`、`pnpm verify:quotas`、`pnpm verify:maintenance`（包含双方言 `pnpm verify:auth`）、`pnpm check:i18n`、`pnpm test:i18n` 及文档校验通过。 |

## 开放条件

本项在隔离环境使用合成品牌资料及已验证邮箱 fixture 验收。再次登录使用实际 Better Auth 会话。真实品牌入口保持关闭。正式开放还需 B17 邮箱投递与验证、核验并公布私密受理渠道，以及 B07 的物理清除、持久副本和备份演练。当前无 memory / Redis 业务缓存、附件或报告，相关领域接入时须纳入冻结读写边界。
