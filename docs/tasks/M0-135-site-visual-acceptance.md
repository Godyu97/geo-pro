# Issue #135 全站视觉验收

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [ui-visual-v1](../04-产品功能规格-SPEC.md#interface-visual-style) · [验收清单](../08-验收场景与样例.md#ui-visual-checks) · [原视觉基线](M0-135-visual-baseline.md)

品牌负责人从官网和账号页进入工作台，能看出当前分区、当前任务和下一步。读取失败时可用键盘重载当前工作页面。审核和维护人员则能区分读取故障与权限限制。

## 交付

- 行业题包在页首按无品牌、空题包和已有题包提供建档、填写范围和查看历史。输入、保存中、范围拒绝和草稿回读使用相应的界面反馈。适用范围及候选问题保持原文，监管场景仍受题包范围约束。 [S-M2-06](../specs/M2.md#s-m2-06)
- 探索观察在页首提供建档、输入、查看记录和清除无效筛选。读取故障支持带回原品牌筛选。探索记录继续使用 `custom_pipeline`，正文仍排除在自然发现指标分子和分母之外。 [S-M0-06](../specs/M0.md#s-m0-06) · [指标与证据合同](../07-指标与证据合同.md)
- 审批策略可查看现有策略或前往建档。团队访问可跳到邀请输入或历史。两页读取失败可在当前路径恢复。维护能力页允许重试权限读取故障，权限拒绝保留安全反馈。工作台通用资源不可用页保留工作台导航和单一主地标。 [S-M1-08](../specs/M1.md#s-m1-08)
- 上述五个路由复用双语加载骨架。四个业务路由共用安全读取失败样式、追踪编号和重载操作。

## 路由清单

清单从 `src/app/**/page.tsx` 生成。走查每条路由的主标题、主内容地标、工作台位置及页面级横向溢出。正常详情取自各领域的浏览器用例，矩阵另外使用随机不存在的标识核对证据、运行、优化、内容详情和冻结恢复的不可用状态。

| 区域 | 路由 |
| --- | --- |
| 官网与账户（3） | `/`、`/account-access`、`/login` |
| 工作台首页（1） | `/dashboard` |
| 每周行动（2） | `/dashboard/assistant`、`/dashboard/assistant/strategies` |
| 品牌（13） | `/dashboard/brands`、`/dashboard/brands/[id]`、`/dashboard/brands/[id]/delete`、`/dashboard/brands/[id]/entity-corrections`、`/dashboard/brands/[id]/entity-reviews`、`/dashboard/brands/[id]/facts`、`/dashboard/brands/[id]/questions`、`/dashboard/brands/[id]/recovery`、`/dashboard/brands/industry-packs`、`/dashboard/brands/local-observations`、`/dashboard/brands/new`、`/dashboard/brands/questions`、`/dashboard/brands/stores` |
| 监测与证据（12） | `/dashboard/monitoring/alerts`、`/dashboard/monitoring/answers`、`/dashboard/monitoring/capture`、`/dashboard/monitoring/competitors`、`/dashboard/monitoring/demo`、`/dashboard/monitoring/evidence/[observationId]`、`/dashboard/monitoring/explorations`、`/dashboard/monitoring/new`、`/dashboard/monitoring/overview`、`/dashboard/monitoring/plans`、`/dashboard/monitoring/protocols`、`/dashboard/monitoring/runs/[runId]` |
| 优化（2） | `/dashboard/optimization`、`/dashboard/optimization/[taskId]` |
| 内容（12） | `/dashboard/content`、`/dashboard/content/assets`、`/dashboard/content/batches/[batchId]`、`/dashboard/content/briefs/[briefId]`、`/dashboard/content/calendar`、`/dashboard/content/channel-profiles`、`/dashboard/content/media-reviews`、`/dashboard/content/publications/[publicationId]`、`/dashboard/content/sources`、`/dashboard/content/templates`、`/dashboard/content/versions/[versionId]`、`/dashboard/content/versions/[versionId]/variants` |
| 报告（9） | `/dashboard/reports`、`/dashboard/reports/connector-events`、`/dashboard/reports/crawler-visits`、`/dashboard/reports/interventions`、`/dashboard/reports/lead-quality`、`/dashboard/reports/lead-suggestions`、`/dashboard/reports/leads`、`/dashboard/reports/observations`、`/dashboard/reports/shares` |
| 商业交付（3） | `/dashboard/commercial/deliveries`、`/dashboard/commercial/entitlements`、`/dashboard/commercial/orders` |
| 设置（9） | `/dashboard/settings`、`/dashboard/settings/approval-policy`、`/dashboard/settings/connections`、`/dashboard/settings/data-connections`、`/dashboard/settings/delegations`、`/dashboard/settings/notifications`、`/dashboard/settings/sync-authorizations`、`/dashboard/settings/team`、`/dashboard/settings/usage` |
| 维护（3） | `/dashboard/maintenance`、`/dashboard/maintenance/capabilities`、`/dashboard/maintenance/support` |

## 独立验证

| 验证命令 | 实测结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过，构建覆盖运行清单中的路由。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3469 个消息键和 7 项基础测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，32 项。 |
| `node --conditions=react-server --test tests/local-presence/industry-packs.test.mjs tests/monitoring/exploration-observations.test.mjs tests/team-access/*.test.mjs` | 通过，17 项，SQLite3 与 PostgreSQL 均执行，零跳过。覆盖题包范围、草稿状态、探索分母隔离、邀请和审批职责。 |
| `pnpm test:maintenance` | 通过，25 项，零跳过。覆盖维护授权、审计失败、并发和双方言迁移。 |
| `pnpm test:evidence` | 通过，40 项，零跳过。覆盖来源分轨、请求和实测采样条件、分母、零样本 N/A、原文及修订。 |
| `pnpm env:check` | 开发 PostgreSQL、Redis、私有 S3 与 Chrome 等 15 项通过。 |
| `pnpm check:feature-map` | 通过，69 个路由及 438 个代码路径。 |
| `python docs/tools/validate_docs.py` | 通过，26 项需求、29 项任务、81 个验收 ID。 |

### 开发库真实证据

使用 `readObservation` 在回环开发 PostgreSQL 的只读事务中复查 [#133 已授权的三条官方记录](M0-133-official-evidence.md)。三条原文 SHA-256、分析版本 1 和完整空引用均与记录一致。它们属于 `model_api` / `official_api`，请求联网 `off`，实际 `not_triggered`，目标 `CN`，实际地区 `unknown`，每条已知费用 CNY 0.01。另一个 owner 三条均无法读取。本项产生 0 次供应商请求和 0 条数据库写入。

### 浏览器覆盖与证据

Chrome 使用新迁移的回环 PostgreSQL、应用夹具、邮件 Mock 和隔离缓存。全站测试用合成账号和长品牌名称扫描 69 条路由的 `zh-CN` / `en` 及 375、768、1440 像素，共 414 个组合。浏览器快速走查复用一份已核验的客户端会话响应，服务端对每次导航仍执行真实会话判定。登录、会话变更、过期和权限限制另有独立交互用例。

| 验收项 | 实际观测 |
| --- | --- |
| 页面覆盖与视觉 | 414 个组合均通过主标题、单一内容地标、工作台分区及页面宽度检查。代表页面使用共享主题，对比度检查通过，长品牌名称在内容区换行。 |
| 公共状态与键盘 | 四个业务路由在 375 像素分别显示两种语言的骨架、故障通知和追踪编号。键盘重载恢复到原路径，探索观察保留合法的品牌筛选。维护权限读取故障可重试，恢复后按当前账号权限显示。 |
| 业务回归 | 登录、建档、草稿恢复与冻结恢复、证据筛选和下钻、演示、内容审核、发布核验及报告快照均在隔离浏览器用例中回归。M0 路径用合成「北岸设备」贯穿流程。 |

本地完整截图保存在 `.cache/issue-135/full-site-verified/`，共 100 张。仓库中的脱敏代表图覆盖 [中文 375 行业题包](../ui-design/issue-135/industry-packs-zh-CN-375.png)、[英文 768 审批策略](../ui-design/issue-135/approval-policy-en-768.png)、[英文 1440 证据概览](../ui-design/issue-135/evidence-overview-en-1440.png)、[中文加载骨架](../ui-design/issue-135/industry-packs-loading-zh-CN-375.png)和[英文读取故障](../ui-design/issue-135/industry-packs-read-failure-en-375.png)。

全量 `pnpm test:e2e` 完成 134 项，133 项通过，1 项失败。证据概览覆盖率测试将 2026-11-25 的固定槽位当成未来槽位。该槽位在执行时已经到期，页面按合同显示 2/5。测试数据和筛选窗口改用相对运行日期后，在新迁移的隔离库复跑以下 7 项全部通过，覆盖率断言仍是 2/4 和 50.0%。两次运行的临时数据库均已清理。

```sh
GEO_VISUAL_SCREENSHOTS=.cache/issue-135/full-site-verified pnpm exec playwright test \
  tests/e2e/brand-stores.spec.ts tests/e2e/evidence-coverage.spec.ts \
  tests/e2e/industry-packs.spec.ts tests/e2e/local-observations.spec.ts \
  tests/e2e/workspace-visual-audit.spec.ts
```

行业题包的隔离浏览器复跑确认，监管范围外请求发起 0 次模型调用，输入保留。合规范围内的慢响应期间再次按 Enter，回环 Responses mock 只收到 1 次调用。数据库只保存 1 个草稿题包和 1 条问题草稿，过滤了效果保证句。题集和监测运行均为 0 条，另一账号读不到题包。临时账号及记录清理后回读为 0。

## 验收边界

#135 的四项视觉及功能回归验收均通过。正式行业试点、品牌准入、消费者轨道及 M0–M2 阶段验收由对应任务在授权数据、通道和观察窗口齐备后执行。
