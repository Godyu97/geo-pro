# M0-34 本人全量导出与品牌清除一致性

本项补齐 AC-M0-01-2 中已交付业务域的本人导出，并修复含优化任务品牌的到期清除。 [Issue #34](https://github.com/Godyu97/geo-pro/issues/34) · [T-M0-01](M0.md#t-m0-01) · [S-M0-01](../specs/M0.md#s-m0-01)

OpenSpec 变更 `m0-34-owned-export-purge` 已同步 `owned-data-export` 与 `brand-deletion`。正式试点开关、真实通道和账户注销不在本次范围。

## 使用与范围

- 账户设置的数据管理可预览并选择个人资料、品牌、事实与材料、监测与证据、内容、报告、用量与费用。界面提供 zh-CN / en。常规环境仍只允许个人资料；品牌业务范围沿用本地验收开关。
- 导出 JSON 的 `unavailable` 为空。单域读取失败或超过 8 MiB 时，该域进入 `missing`，其余已成功范围仍可下载。原文、引用、minor 金额、币种和业务语言保持原值。内部素材、维护审计和其他账号数据不进入文件。
- 下载继续复核会话、归属和指纹，响应为 `private, no-store`。冻结品牌不进入新导出；清除后旧的品牌业务导出不能继续读到已删正文。

## 存储与清除

`user_data_export` 的范围位图上限从 3 调整为 127。PostgreSQL 替换检查约束。SQLite 复制旧行后按全量 DDL 重建该表，避免改名后引号与空库 DDL 不一致。

到期清除先删除页面检查、任务证据、优化任务和优化发现，再删除监测、内容、事实链和品牌版本。粘贴链先断开 `previous_id`。未核对费用仍阻止删除品牌。完成后只保留 `brand_purged_cost` 最小凭证。

事实粘贴按每页 64 行读取。71 行合成粘贴在两种数据库上都是 2 条 SQL。SQLite 使用 `brand_owner_status_created_idx` 与 `fact_paste_previous_uidx`，排序使用临时 B-tree。PostgreSQL 使用 `brand_fact_paste` 主键和 `brand_owner_status_created_idx`。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n` | 通过，1150 个键及参数一致。 |
| `pnpm db:generate`、`pnpm db:ddl`、`pnpm db:ddl:check` | 通过。双方言迁移已审核。 |
| `pnpm test:data-exports` | 6 项通过。覆盖升级后结构一致、分页、部分失败、容量上限、冻结与越权。 |
| `pnpm test:brands` | 9 项通过。含优化任务、事实链和监测运行的清除幂等重跑。 |
| `pnpm verify:data-exports` | 通过。常规环境拒绝品牌业务范围并允许个人资料；双方言生产 HTTP 覆盖授权、UTF-8 文件名、撤销和部分失败。 |
| `pnpm exec playwright test tests/e2e/data-export.spec.ts` | 8 项通过。覆盖 zh-CN / en、375/768/1440、键盘焦点和 Unicode 文件名。未跑完整 `pnpm test:e2e`。 |
| `openspec validate` | 变更与同步后的主规格通过严格检查。 |

本地开发库在浏览器验收前缺少 `prompt_draft`，已执行 `pnpm db:migrate` 补齐后复测。未验证真实发信、备份演练或正式试点开放。
