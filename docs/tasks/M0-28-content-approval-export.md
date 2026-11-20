# M0-28 稿件审核与单渠道交付包导出

Issue [#28](https://github.com/Godyu97/geo-pro/issues/28)｜2026-11-20｜对应 R-M0-10 / S-M0-10 / T-M0-10；前置 #27（内容草稿）。AC-M0-10-1/2/3 以 SQLite 与本地 PostgreSQL 集成测试验证；发布回填与公开核验留给 #29。

## 范围与关键决定

- `content_version` 扩展：状态 `draft|in_review|approved|rejected|invalidated`、`target_channel`、标识 profile 版本/核实状态、`image_asset_ids_json`、`fact_version_ids_json`（批准指纹快照，生成时取自 Brief）、`updated_at`。
- 新表：`content_approval`、`content_asset`、`content_delivery_package`、`content_export_job`（`(brand_id, operation_id)` 唯一）；purge 先删导出/包/批准/资产再删版本。
- 迁移：PostgreSQL `0017_content_approval_export`（先删 CHECK、补列并回填 `updated_at`/事实快照、再加新 CHECK）；SQLite `0016_content_approval_export`（重建 `content_version`，回填同上）。全量 DDL 已同步。
- 批准指纹覆盖标题、正文、claims、图片、渠道、标识 profile、事实版本；任一变化使批准失效，旧批准/包可读并标「勿再使用」。
- 正式包仅含：`content.md`、净化 `content.html`、`manifest.json`（绑定 approval id 与指纹）、`public-sources.json`、`publish-checklist.md`，及公开且已审核图的 `public-images.json`；内部/未审核资产只计入 `excludedAssetCount`。
- 标识未核实（`auto` 模式）只生成带「非发布用」标记的审阅包；显式 `formal` 返回 `LABELING_UNVERIFIED`。
- 批量导出：先预检全部选中项并逐项给出阻塞码（`APPROVAL_REQUIRED`/`FACT_INVALID`/`LABELING_UNVERIFIED`），再由负责人显式选择合格子集；确认时重新复核事实与批准；非子集返回 `SUBSET_INVALID`，缺预检返回 `PREFLIGHT_REQUIRED`。
- 越权、冻结品牌读写一律 NOT_FOUND。M0 的标识 profile 为负责人在变体上声明的 fixture 字段，不代表真实渠道核验。

## 修改入口

- `src/lib/db/content-schema(.sqlite).ts`、drizzle `0017_*` / sqlite `0016_*`、`drizzle/ddl/*`
- `src/features/content/{contracts,package,dao,commands,api,actions,version-page,list-page}`、`src/app/(dashboard)/dashboard/content/versions/`、`src/app/api/content/{versions,packages}`
- `src/features/brands/purge-dao.ts`、i18n（`content` 命名空间）；专项测试：`tests/content/approval-export.test.mjs`

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:content` | 通过（含 sqlite + 本地 PostgreSQL 容器；AC-M0-10-1/2/3、审阅包、越权/冻结、迁移升级既有草稿） |
| `pnpm lint` / `pnpm typecheck` / `pnpm check:i18n` / `pnpm db:ddl:check` | 通过 |
| `pnpm test:maintenance` / `brands` / `brand-facts` / `prompts` / `data-exports` | 通过（含 DDL 与迁移结构一致性） |
| `pnpm build` | 通过 |

未接入真实对象存储或外部标识核验服务；导出成功不等于公开发布。
