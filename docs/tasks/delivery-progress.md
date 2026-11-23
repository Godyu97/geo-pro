# 需求交付进度

2026-11-23。按源码入口、迁移、既有验证记录和 GitHub Issue 核对。阶段勾选以 [M0](M0.md)、[M1](M1.md)、[M2](M2.md) 为准。M0 的 T-M0-07 和 T-M0-08 已勾选，各阶段真实门禁均待核验。

## 已有软件与剩余验证

| 需求 | 已有软件 | 待核验或继续开发 |
| --- | --- | --- |
| T-M0-01 账号与品牌 | 双语入口、登录与找回、单负责人建档、草稿恢复、版本、导出、归档、冻结恢复及到期清除。开发库另有获准账号的真实资料入口，见 [B04](B04-brand-onboarding.md)、[B06](B06-brand-deletion.md)、[B07](B07-brand-purge.md)、[B17](B17-account-email-recovery.md)、[开发建档](M0-130-dev-brand-intake.md) | 保留策略版本、正式品牌准入 |
| T-M0-02/03 品牌事实与题集 | 来源、补证、事实版本与审批、问题簇、题集冻结及 Responses API 题目候选。见 [事实](T-M0-02-brand-facts.md) 与 [题集](T-M0-03-prompt-sets.md) | 使用获准真实品牌的公开或获准资料验证建档到冻结路径 |
| T-M0-04/05 通道与执行 | 能力台账、范围确认、冻结采样协议、槽位/预算/费用核对、隔离执行和真实官方 HTTP 适配器。工作台可对官方轨道发起执行：调用前写入尝试和额度上限，回执与费用状态随尝试保存。见 [台账](B09-channel-capabilities.md)、[执行](M0-12-run-execution.md)、[官方适配器](M0-36-official-sampling-adapter.md) 与 [官方执行](M0-131-official-run-execution.md)。开发库另有一条非联网官方 API verified 版本，见 [M0-31](M0-31-official-channel-verification.md) | 消费者人工入口、联网触发，以及在仍有额度时用本路径再跑一轮并核对回执。正式通道核验仍由 #31 跟踪 |
| T-M0-06/07/08 证据、概览与诊断 | 人工存证、原文与独立判定、AI 判定草案、同口径题等权概览、Redis 缓存、优化任务和公开页面检查。见 [回答证据](M0-24-answer-evidence.md)、[概览](M0-25-evidence-overview.md)、[任务](M0-26-optimization-tasks.md) | 真实官方结果入证和下钻联验，区分目标与实际地区、请求联网与实际触发、自然与探索分母 |
| T-M0-09–12 内容与复测 | Brief、事实绑定的 Responses API 草稿、审核与包、人工发布回填、公开核验和同口径复测快照。见 [草稿](M0-27-content-drafts.md)、[发布核验](M0-29-publication-verify.md)、[复测](M0-30-report-retest.md) | 获准试点的实际交付与发布、前后观察窗口 |
| M0/M1 文件存储 | `stored_object` 元数据与 S3 私有字节、指纹回读、重鉴权下载、失权与清除。已覆盖交付包、报告、导出、附件、核验截图和资料原件 | 品牌总容量上限 [#123](https://github.com/Godyu97/geo-pro/issues/123) 和正式环境的存储、备份演练。 [对象存储](../oss/02-对象存储功能规格-SPEC.md) |
| T-M1-01/02/03 持续监测、竞品与实体 | 计划、版本及预算暂停，质量告警与发生记录、竞品/来源下钻、人工实体复核、消歧和纠错记录。见 [M1](M1.md)、[竞品与来源](T-M1-02-competitor-sources.md) | 到期计划和真实证据贯通、连续窗口、真实实体样本和分析质量基准 |
| T-M1-04/05 资产与内容维护 | 私有资料原件、素材权利和撤销待办、受控模板、逐变体审核与事实影响维护日历 | 真实资料走查与渠道画像 [#126](https://github.com/Godyu97/geo-pro/issues/126) |
| T-M1-06/07/08 观察、反馈与团队 | 正式计划、基线和检查点记录、干预批次页面核验、脱敏线索导入及来源去重、资格规则、成员授权与双人审核 | 自然观察窗口、授权反馈及团队走查，保留混杂因素 [#124](https://github.com/Godyu97/geo-pro/issues/124)、对照 [#125](https://github.com/Godyu97/geo-pro/issues/125)、转移与邀请 [#128](https://github.com/Godyu97/geo-pro/issues/128) / [#129](https://github.com/Godyu97/geo-pro/issues/129) |
| T-M2-01–06 授权扩展 | 已有受控采集预览、草稿和通知授权、代理委托、登记订单及签收、白标报告、连接器预览和撤销、经营助理草案、门店/行业题包与图文核验。见 [M2](M2.md) 和 [本期变更记录](issue-backlog-2026-11-23.md) | 各连接的真实授权、跨品牌走查、策略模板 [#127](https://github.com/Godyu97/geo-pro/issues/127)、真实行业场景和阶段验收 |

基础工程已覆盖双方言迁移与全量 DDL、认证、维护授权、双语言和隔离浏览器流程。旧版本的实际执行证据见 [Phase 0](phase-0.md)、[双库验证](M0-38-dual-database-verification.md) 与 [浏览器流程](M0-39-browser-e2e.md)。功能 mock 的品牌、监测及报告单独记录在各自的功能 mock 任务记录中。

## GitHub 队列与 Agent 正式试点

2026-11-23 复核前有 18 个开放 Issue。全部已补充 Agent 验收步骤，另重开此前记录隔离软件交付的 M1/M2 阶段验收，现为 20 个开放 Issue。13 项可独立推进，7 项仍有具体前置。正式开发试点由 Agent 自行操作开发数据库、获准账号和服务执行。

- [#31 通道核验](https://github.com/Godyu97/geo-pro/issues/31) 已记录非联网官方 API 的 10 题 × 2 轮、单价和台账版本。消费者人工入口与站内执行仍有前置。 [#21 品牌试点](https://github.com/Godyu97/geo-pro/issues/21) 等待 #130 的受控开发入口。 [#32 M0 正式试点](https://github.com/Godyu97/geo-pro/issues/32) 依赖品牌准入、真实双轨采样与站内入证。
- [#57 M1 阶段验收](https://github.com/Godyu97/geo-pro/issues/57) 和 [#70 M2 阶段验收](https://github.com/Godyu97/geo-pro/issues/70) 已重开，按前一阶段结果和对应软件、数据或通道前置顺序执行。
- 使用 [品牌管理与 AI 品牌监测计划](brand-monitoring-next.md)、[运行手册](../operations/m0-runbook.md) 和 [试点模板](../operations/m0-pilot-templates.md) 记录实际通道、走查与发布证据。

## 上一轮环境与规划验证

- `pnpm env:check --probe-ai` 通过。现有开发 PostgreSQL 的认证与品牌表可读，Redis 和 S3 对象探针完成写入、回读及清理，Responses API 可达。另以临时 SQLite 文件验证了 SQLite 预检。
- 缺数据库、Redis 或 S3 端点时启动检查分别拒绝。`pnpm dev` 在临时源码副本验证，`pnpm start` 使用独立回环端口，两者均返回预期存活响应。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm db:ddl:check`、`pnpm test:storage`、`pnpm verify:dual-db` 与文档检查通过。lint 有一条竞品测试中既有的未使用变量告警。对象清除与采样条件的历史迁移测试已固定到各自正确的升级起点。
- `python3 scripts/run-issue-loop.py --dry-run` 验证了 17 个开放 Issue 中 11 个可开发、6 个待依赖或待试点，首选 #130。真实品牌建档、官方通道采样及正式试点证据随各 Issue 记录。

## 本轮 Agent 实测记录

- `pnpm env:check --probe-ai` 15 项通过。开发 PostgreSQL 读取、Redis 与 S3 写读清理、通用 Responses API 冒烟通过。正式采样配置只读访问模型目录返回 HTTP 200，单价表中 1 个模型与目录匹配。开发库中符合该配置且未过期的已验证 API 通道为 0，已验证的非隔离消费者入口为 0。
- `pnpm verify:auth` 在开发 PostgreSQL 验证注册、会话、本人写入、越权拒绝，并清理测试账号。在同一开发 PostgreSQL 实例的临时隔离库执行 `pnpm test:e2e tests/e2e/m0-flow.spec.ts`，合成品牌的 M0 双语主流程与越权回归通过。`pnpm verify:brands`、`pnpm verify:capabilities` 在双方言隔离库通过，`pnpm test:continued-operations` 67 项通过。
- 串行循环 `--dry-run` 通过，20 个开放 Issue 中 13 项可执行，队列首选 #31。正式双轨样本、获准试点发布和真实复测窗口仍按对应 Issue 留证。
