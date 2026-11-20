# Design

## Context

#27 已交付 ContentPlan/Brief/Batch/ContentVersion（始终 draft）与事实绑定。S-M0-10 要求显式审核、批准指纹、主页面+1 外渠交付包，以及批量预检后显式子集导出。

## Goals / Non-Goals

- Goals：ContentVersion 审核状态机与失效；Approval；可选图片资产；正式/审阅交付包（md/html/manifest/sources/checklist）；批量 export job 预检与子集确认；归属与双库；AC-M0-10-1/2/3。
- Non-Goals：发布回填/公开核验（#29）、多渠道变体、自动发布、真实外部标识核验服务、对象存储云适配（M0 用受控字节/元数据即可）。

## Decisions

1. **表**：扩展 `content_version`（status、target_channel、labeling_profile_version、image_asset_ids_json、updated_at）；新增 `content_approval`、`content_asset`、`content_delivery_package`、`content_export_job`。双方言 Schema + migration + 全量 DDL；purge 按依赖序清理。
2. **状态**：`draft → in_review → approved|rejected`；内容变体字段变更 → `invalidated`（旧 Approval/包保留，包标勿再用）。导出作业 `queued|ready|failed`。
3. **批准指纹**：对 title+body+claims+image ids+target_channel+labeling_profile_version+fact_version_ids 计算 `approval_fingerprint`；Approve 时快照；再导出时指纹不一致则要求重审（AC-M0-10-1）。
4. **正式 vs 审阅**：`labeling_profile_status=verified` 且硬门禁通过 → `formal`；否则仅 `review`（非发布用）。私密/内部资产永不进入正式包（AC-M0-10-2）。
5. **批量导出**：先预检全部选中版本；阻塞项返回原因；须显式 `chosenVersionIds` 子集且只能选预检合格项；成功数=子集大小（AC-M0-10-3）。`operationId` 幂等。
6. **包文件**：`content.md`、`content.html`（净化）、`manifest.json`、`public-sources.json`、`publish-checklist.md`；可选公开图元数据；整包 `package_fingerprint`。
7. **事实**：导出正式包时用 `withEligibleFacts(..., stage=delivery)`；过期/撤销 → 预检阻塞。
8. **标识 profile**：M0 以品牌级可配置 fixture 字段表示 `labeling_profile_version` + `verified|unverified`；未验证不阻断审阅导出。
9. **归属**：全部读写 `owner_id`；越权 NOT_FOUND。
10. **UI**：版本详情页支持提交审核/批准/拒绝/附加图/导出；列表区分待审与可交付。

## Risks / Trade-offs

- 标识「已核实」在隔离环境用测试 profile，真实渠道格式由阶段门禁验收。
- 图片存表内元数据+受控内容引用，不做完整 CDN。

## Migration Plan

新增 PG/SQLite 迁移；同步全量 DDL；`pnpm db:ddl:check`。验证：`pnpm test:content`、`check:i18n`、`typecheck`、`lint`、`build`。

## Open Questions

无；发布核验留给 #29。
