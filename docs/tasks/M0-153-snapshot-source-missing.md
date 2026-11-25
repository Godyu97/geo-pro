# Issue #153 历史报告快照的来源缺失标注

2026-11-25。 [Issue #153](https://github.com/Godyu97/geo-pro/issues/153) · [S-M0-12](../specs/M0.md#s-m0-12) 第 6 条 · [04 产品功能规格](../04-产品功能规格-SPEC.md)

品牌负责人在 `/dashboard/reports` 或报告 API 查看已经保存的快照。若快照引用的 `answer_observation` 随后被清除，列表、快照摘要和单份读取都标明来源不可复核。对象存储和数据库里的 `report.json`、`report.html` 原字节与 SHA-256 保持不变。

## 范围

- 从 `report-v4` 的三项比较，以及历史单指标快照的 `queries`，收集 `before` / `after` 的 `observation_ids`。同一观察只计一次。
- 按当前 `owner_id` 与 `brand_id` 分块查询 `answer_observation`，每块最多 100 个编号。其他品牌的同号观察不算仍存在，响应里也不列出编号。
- 任一引用已不存在，或快照行原本 `source_missing = 1`，元信息返回 `sourceMissing: true` 和缺失条数。卡片用中英文显示“部分源证据已清除，历史快照不可复核原证据”。
- 不更新快照行，不重写对象。跨账号或跨品牌读取仍是 `NOT_FOUND`，且不会去查观察是否存在。

## 本轮核验

- 隔离 SQLite 与 PostgreSQL：对象存储中的 `report-v4` 在删去 2 条观察后，`listReports`、`snapshotViews` 和 `readSnapshot` 都返回 `sourceMissing: true`、缺失 2 条；JSON 与 HTML 字符串、SHA-256 和存储字节与删除前一致，行上的 `source_missing` 仍为 0。删光本品牌观察后缺失数为 4，文件仍相同。
- 历史 `report-v3` 单指标快照同样返回缺失 1 条，行内字节不变。原本标记来源缺失、观察仍在的快照返回 `sourceMissing: true` 且缺失数为 0。
- 快照引用另一品牌的观察编号时，缺失数为 1。该行在库中仍存在，但响应只有布尔值和计数。另一账号读取快照得到 `NOT_FOUND`，查询记录里没有 `answer_observation`。
- 105 个编号分成 2 条 `IN` 查询。查询计划：SQLite 使用 `answer_observation_owner_idx`；PostgreSQL 在关闭顺序扫描后使用 `answer_observation_pkey` 的位图索引扫描，再用负责人和品牌过滤。120 个编号中属于其他品牌的 40 个没有返回。
- 浏览器在隔离账号上删除当前快照引用的一条观察后，中英文和 375、768、1440 宽度都显示不可复核提示。再次下载的 JSON 与 HTML 字节和删除前一致。列表 API 的 `sources` 为 `sourceMissing: true` 且缺失数大于 0。其他账号仍看不到该快照。本轮快照为 `e64b5451-1030-4492-807c-4edf6a992628` → `daab34c7-848a-4b7c-bfa8-cfabaa1ebc59`，历史快照 `096ce0a3-8401-4f6c-a716-f879bf35cf96`。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`（3668 个消息键）、`pnpm check:feature-map`、`pnpm test:reports`（23 项）、`pnpm test:query-plans`（4 项）、`pnpm env:check`（15 项）和 `pnpm exec playwright test tests/e2e/report-snapshot.spec.ts`（2 项）通过。

T-M0-12 保持未勾选。正式验收仍需要获准品牌、已核验公开发布和真实前后窗口。
