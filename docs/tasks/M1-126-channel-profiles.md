# Issue #126 可版本化的渠道画像

2026-11-24。 [Issue #126](https://github.com/Godyu97/geo-pro/issues/126) · [S-M1-05](../specs/M1.md#s-m1-05)

负责人可以发布某个渠道的版式画像。每次发布只插入新版本，不改已有版本的字数上限。新的渠道变体必须钉住该品牌已发布、且渠道键一致的版本。导出时按钉住版本的上限计 Unicode 码位；上限为空则不限制字数。已钉住的变体不能改钉。另一用户读取或发布该品牌画像得到 404。本记录不勾选 T-M1-05，不代替变体独立审批，不连接外部 CMS，也不发送邮件。

## 交付范围

- 双方言表 `channel_profile` 与 `channel_profile_version`。画像按品牌和渠道键唯一。版本保存渠道键、可空最大字数、说明和从 1 递增的版本号。`content_channel_variant.channel_profile_version_id` 可空，删除画像版本时限制删除变体。迁移为 `drizzle/0074_bouncy_carmella_unuscione.sql` 与 `drizzle/sqlite/0073_supreme_darkstar.sql`，并已写入全量 DDL。SQLite 按全量 DDL 重建变体表，旧行复制后新列为 NULL。
- 发布、列表和变体钉选在 `src/features/channel-variants/`。新变体未钉选、版本缺失或渠道不一致时不插入变体。超长导出返回 409，且发生在交付包写入之前。
- 站内页 `/dashboard/content/channel-profiles` 提供中英文发布和版本列表。内容列表和变体页能进入该页，变体页显示所钉版本。登录回跳已登记该路径。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 结构 | `pnpm db:generate` 生成上述迁移后再次执行为无变更。`pnpm db:migrate` 已应用到回环开发 PostgreSQL。`pnpm db:ddl` 与 `pnpm db:ddl:check` 通过。 |
| 隔离行为 | `node --conditions=react-server --test tests/content/channel-profiles.test.mjs` 5 项通过。双方言都覆盖：升级前的变体在迁移后正文仍在且画像引用为空；发布第二版只插入版本、不更新第一版上限；未钉选不能保存；超长导出为 409 且交付包行数不变；钉住更大上限的新变体在正文与主稿一致并单独批准后可以导出，旧钉选仍被拒绝；另一用户为 404。字数上限来自本次发布，不是平台常量。 |
| 查询计划 | 版本列表使用 `channel_profile_version_owner_idx`。 |
| 回归 | `node --conditions=react-server --test tests/channel-variants/persistence.test.mjs` 7 项通过。既有审批回归先发布不限字数的画像，再保存变体。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。构建路由包含 `/dashboard/content/channel-profiles`。 |
| 双语 | `pnpm check:i18n` 通过，2859 个键一致。`pnpm test:i18n` 7 项通过。 |
| 开发库 | 2026-11-24。临时账号发布同一渠道的第 1 版上限 4 与第 2 版上限 100000。第 1 版行仍为上限 4。另一临时用户列表和发布均为 `NOT_FOUND`。画像 1 行、版本 2 行。清理后这三处计数为 0。未改动其他品牌。 |

页面点击、375/768/1440 视口和真实资料走查未在浏览器中执行。当前会话没有浏览器工具。导出、钉选和越权拒绝由双方言隔离测试覆盖。
