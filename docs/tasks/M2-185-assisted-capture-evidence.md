# Issue #185 从冻结题集保存可下钻的消费者回答

2026-11-27。 [Issue #185](https://github.com/Godyu97/geo-pro/issues/185) · [S-M2-01](../specs/M2.md#s-m2-01) · [AC-M2-01-1 / AC-M2-01-2 / AC-M2-01-3](../specs/M2.md#s-m2-01)

在 `/dashboard/monitoring/capture` 补全「从冻结题集选题 → 记录回答与引用预览 → 确认写入消费者轨道证据 → 下钻消费者回答列表与原文详情」软件路径，并沿用统一品牌授权（`authorizeBrandActor` / `workspaceBrand`）。开发库当前尚无已验证 `consumer_ui` 通道与可访问消费者入口，不写入伪造监测记录；本记录不勾选 `T-M2-01`。

## 交付范围

- **数据库与迁移**：PostgreSQL（`0102_famous_sharon_carter.sql`）与 SQLite（`0101_colorful_champions.sql`）在 `capture_attempt` 新增可空字段 `prompt_id`、`question_text`、`answer_text`、`citations_json`、`citation_set_state`、`locator_ref`、`collector_id`、`requested_network_mode`、`target_region`、`observed_region`、`new_session`、`product_mode` 与 `observation_id`（外键 `answer_observation.id` `ON DELETE SET NULL`），并约束 `handoff` 不可绑定 `observation_id`，同步更新全量 DDL。
- **领域与证据写入**：
  - `readCaptureWorkspace`、`listCaptureSheets`、`getCaptureSheet`、`createCaptureSheet`、`recordCaptureAttempt`、`confirmCaptureAttempt` 与 `degradeCaptureSheet` 接入 `authorizeBrandActor` / `workspaceBrand`（`owner`/`member` 可读写，`read_only` 仅可读且写操作返回 403，`outsider` 返回 404 不泄露品牌与题号）。
  - `confirmCaptureAttempt` 在非 `handoff` 且存在可见回答原文时，在同一事务内写入 `answer_observation`（`source_mode = 'consumer_ui'`、`capture_method = 'assisted' | 'manual'`）、规范化去重后的 `consumer_visible` `answer_citation` 与 `v1` `answer_analysis_version`（完整或待复核状态），并在提交后失效证据概览缓存。
  - `citationCount === 0` 或缺少引用 URL 时保持 `citation_set_state = 'partial'`（不静默写入完整空引用），支持确认前补充引用 URL；缺失定位符或采集标识时保存为 `draft_evidence` 并可在详情页继续补全（`completeManualEvidence` 与 `detail-page.tsx` 同步放行 `captureMethod = 'assisted'` 草稿）；`handoff`（验证码/登录墙）仅停留在交接态并提供现有手动入口链接。
- **页面与双语**：`/dashboard/monitoring/capture` 支持按版本勾选品牌冻结题集、预览并确认写入证据、直接跳转 `/dashboard/monitoring/evidence/[observationId]` 与 `/dashboard/monitoring/answers?...&sourceMode=consumer_ui`；`/dashboard/monitoring/answers` 补充「打开采集助手」导航，详情页展示 `collectorId` 与 `locatorRef`；同步更新 `zh-CN` / `en` 消息与功能地图。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境与静态门禁 | `pnpm env:check`（15/15）、`pnpm db:migrate`（开发 PostgreSQL）、`pnpm db:ddl:check`、`pnpm lint`（0 错误，8 条既有测试/临时脚本告警）、`pnpm typecheck`、`pnpm build`、`pnpm check:i18n`（4167 键）、`pnpm test:i18n`（7/7）、`pnpm check:feature-map`（71/71）与 `node --test tests/layout/workspace-landmark.test.mjs`（30/30）全部通过。 |
| 领域与双库测试 | `node --conditions=react-server --test tests/assisted-capture/capture.test.mjs`（6/6，覆盖 SQLite3 与 PostgreSQL 迁移、DDL 对照、`handoff` 阻断、`partial` 不进完整空引用、草稿补全、`manual` 降级、组内成员/只读/外部隔离与概览缓存失效）及 `pnpm test:evidence`（48/48）全部通过。 |
| 隔离 Chrome E2E | `pnpm test:e2e tests/e2e/assisted-capture.spec.ts` 与 `tests/e2e/manual-evidence.spec.ts` 均通过，覆盖中英文 375/768/1440 视口、键盘操作、在途防重、交接/部分/降级流转、真实预览确认入证并下钻至消费者回答列表及证据详情回读原文/采集标识/定位符与跨账号隔离。 |
| 开发环境实测 | 在本地启动连接开发 PostgreSQL、Redis 与私有 S3 的服务（`http://localhost:3099`），使用 `./tmp/dev/accounts.json` 持久化账号在品牌 `674a4755` 核对：`owner` 与 `member` 在 `/dashboard/monitoring/capture` 回读冻结题集 v1 的 3 道中文题目、勾选联动及跳转消费者回答页，中英文 375/768/1440 均无横向溢出；`readonly` 仅见只读提示且 POST 返回 403；`outsider` 不见品牌名与题号且 POST 返回 404。 |
| 未验证 / 阻塞项 | 开发库 `capability_channel` 当前仅有 `model_api` 通道（0 个已验证 `consumer_ui` 通道），且本机尚无无需绕过登录墙/验证码即可访问的消费者 AI 入口；未向持久化品牌 `674a4755` 写入虚构消费者回答。取得可访问消费者入口并完成通道核验后，再按正常操作保存一条真实回答、引用状态与存证定位并回读同一证据。 |
