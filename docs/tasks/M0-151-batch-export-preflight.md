# Issue #151 内容列表批量导出预检

2026-11-25。 [Issue #151](https://github.com/Godyu97/geo-pro/issues/151) · [S-M0-10](../specs/M0.md#s-m0-10) · [T-M0-10](M0.md#t-m0-10)

## 交付范围

- 品牌负责人在 `/dashboard/content` 勾选多篇稿件，选择 `auto` / `formal` / `review` 后运行批量导出预检。预检只写入导出任务，不生成交付包。
- 结果逐篇显示标题、正式包或审阅包、可导出或被阻塞，以及阻塞码和说明。已覆盖 `FACT_INVALID`、`APPROVAL_REQUIRED`、`LABELING_UNVERIFIED`。
- 确认导出必须由用户再勾选子集。未勾选返回 `NONE_SELECTED`。含阻塞稿返回 `SUBSET_INVALID`，不生成包。跳过预检仍由既有 `PREFLIGHT_REQUIRED` 拒绝。确认前会按原规则重跑事实与批准校验。
- 只勾选合格稿时，生成的包数量等于勾选数，并可经 `/api/content/packages/<id>` 重鉴权下载。导出成功不记为公开发布。
- 单篇详情页仍用原来的单稿预检和确认。`zh-CN` / `en` 都有列表文案。本记录不勾选 T-M0-10。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 15 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件仍是长期 mock。 |
| 静态与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。 |
| 双语与地图 | `pnpm check:i18n` 通过，3638 个消息键。`pnpm check:feature-map` 通过，69 个页面和 440 条代码路径。 |
| 隔离行为 | `pnpm test:content` 52 项中 50 项通过，退出码 1。SQLite 与 PostgreSQL 的 AC-M0-10-3 均通过：3 篇预检、1 篇事实撤销被标为 `FACT_INVALID`，连同阻塞稿确认返回 `SUBSET_INVALID` 且包数为 0，只确认另外 2 篇则生成 2 个包。失败的 2 项是渠道画像升级用例，假定倒数第二个迁移还没有 `channel_profile`。该表在 SQLite `0073` 与 PostgreSQL `0074` 已创建，当前倒数第二个迁移已是 `0084`。本轮没有改迁移或该测试。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/content-batch-export.spec.ts` 1 项通过。隔离账号有 3 篇已批准稿，其中 1 篇事实已撤销。未勾选预检被拒绝且没有下载链接。键盘勾选 3 篇并以正式模式预检后，页面显示 2 篇可导出、1 篇 `FACT_INVALID`，交付包仍为空。把阻塞稿一起确认被拒绝，包数仍为 0。只勾选 2 篇合格稿后生成 2 个 `content.md`，正文分别含对应标题且不含被撤销稿标题。另一账号下载返回 404，也看不到这些标题。中英文在 375、768、1440 下无横向溢出。单篇详情仍有「运行预检」。临时账号已清理。 |
| 未验证 | 浏览器样本是隔离账号里的合成品牌，不是获准内容的真实发布。不把本次结果写成 T-M0-10 或阶段门禁通过。 |
