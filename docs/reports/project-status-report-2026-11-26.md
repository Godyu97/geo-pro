# GeoPro 项目需求规划与开发进度报告

> 报告日期 2026-11-26（UTC+8）｜代码基准 `main` / [`19cd40e`](https://github.com/Godyu97/geo-pro/commit/19cd40e5ad5cd630afc38b23863fbe3526916c88)｜近期统计窗口 11 月 13 日至 26 日

## 1. 执行摘要（Executive Summary）

- **项目定位**　GeoPro 面向中国大陆品牌经营者，监测品牌在 AI 回答中的提及、推荐与引用，支持追溯原始证据，并在内容调整后按同一口径复测。[产品需求文档](../02-产品需求文档-PRD.md)
- **总体状态 🟡 关注，M0 正式开放 🔴 阻塞。** 项目已在本报告归并的 **13 个业务模块**交付可运行的软件能力，PRD 基线为 **26 项需求**。近两周主线有 **281 个提交**（`git log --first-parent`，含代码、测试与文档），GitHub 有 **173 项关闭工单**（163 项按完成关闭、8 项按不计划关闭、2 项按重复关闭），合并 **3 个 PR**。当前 **11 项开放工单**，全部为 M1/M2。[产品文档入口](../README.md) · [功能地图](../feature-map/README.md) · [主线提交](https://github.com/Godyu97/geo-pro/commits/main/) · [开放工单](https://github.com/Godyu97/geo-pro/issues?q=is%3Aissue+is%3Aopen) · [近期关闭工单](https://github.com/Godyu97/geo-pro/issues?q=is%3Aissue+is%3Aclosed+closed%3A2026-11-13..2026-11-26) · [近期合并 PR](https://github.com/Godyu97/geo-pro/pulls?q=is%3Apr+is%3Amerged+merged%3A2026-11-13..2026-11-26)
- **一句话结论**　M0 已具备从建档到复测的软件路径，M1/M2 的关键能力已分批交付，**真实阶段验收仍是 0/3**。下一步发布决策取决于获准品牌的双轨取证、实际发布与可比复测，以及生产准入证据。[交付进度](../tasks/delivery-progress.md) · [里程碑与验收计划](../05-里程碑与验收计划.md) · [M0 运行手册](../operations/m0-runbook.md)

**工单与验收的状态差异**　交付文档保留了此前 20 项开放的记录。11 月 26 日实时查询显示，#21、#31、#32、#57、#70 均按 `NOT_PLANNED` 关闭，原有 `status:blocked` 标签仍在。对应的三道阶段门禁均未勾选，准入及真实试点缺口继续纳入本报告。GitHub 的 11 项开放统计采用当前工单状态。[历史队列记录](../tasks/delivery-progress.md) · [#21](https://github.com/Godyu97/geo-pro/issues/21) · [#31](https://github.com/Godyu97/geo-pro/issues/31) · [#32](https://github.com/Godyu97/geo-pro/issues/32) · [#57](https://github.com/Godyu97/geo-pro/issues/57) · [#70](https://github.com/Godyu97/geo-pro/issues/70)

## 2. 需求规划与里程碑全景（M0 / M1 / M2）

| 阶段 | 核心目标与范围 | 当前阶段状态 | 验收标准 |
| --- | --- | --- | --- |
| **M0 基线与开放条件** | 单品牌完成建档、事实与题集、真实双轨取证、诊断、内容审核交付、人工发布核验及同口径复测。 | 🔴 正式开放和阶段验收待证。软件已有可运行主链路，开发环境已完成一次受控的官方采样入证。任务表已勾 **2/12（16.7%）**，为证据概览下钻、诊断与行动任务。 | 36 项功能验收及共同关键场景，覆盖双语。官方 API 10 题 × 2 轮及消费者人工存证 3 题 × 2 轮。一个授权品牌完成真实内容闭环，实际采用轨道至少 3 道共同非品牌题前后各采一次。5 次独立走查中至少 4 次完成建档与范围确认，中位操作时间不超过 5 分钟，至少 3 次能从原文创建带证据任务。[M0 规格](../specs/M0.md) · [M0 任务表](../tasks/M0.md) · [M0 门禁](../05-里程碑与验收计划.md) |
| **M1 持续经营与团队协作** | 周期监测、质量提醒、竞品与来源、实体纠错、素材与多渠道维护、正式复测、业务反馈和团队分工。 | 🔴 正式验收受 M0 和真实窗口约束。已有到期窗口登记、竞品与分析复核、成员授权和正式观察等软件切片。任务表已勾 **0/8**。[到期窗口](../tasks/M1-134-due-windows.md) · [交付进度](../tasks/delivery-progress.md) | M0 通过，24 项功能验收及双语检查，真实持续计划与 14 天冻结基线、实际生效点及至少 D+7 完整窗口。至少 200 条真实回答独立标注，其中至少 60 条留作独立验收，实体精确率 ≥95%、召回率 ≥90%，原生引用抽取指标 ≥98%。验证两种获准成员身份、撤销、一次跨渠道维护和一次授权业务反馈。D+14/D+28 按自然窗口单列。[M1 规格](../specs/M1.md) · [M1 任务表](../tasks/M1.md) · [M1 门禁](../05-里程碑与验收计划.md) |
| **M2 授权扩展与代理交付** | 辅助采集、授权草稿及外部动作、数据连接、多品牌代理交付、经营助理和行业/本地场景。 | 🔴 正式验收受 M1 和平台/品牌授权约束。连接预览、增量同步、委托登记、交付签收、白标分享及助理等已有软件切片。任务表已勾 **0/6**。[增量同步](../tasks/M2-161-connection-sync.md) · [交付进度](../tasks/delivery-progress.md) | M1 通过，18 项功能验收及双语检查，实证至少一个辅助采集入口、一个草稿连接及一个数据源连接。至少两个获准品牌验证隔离、撤销、在途对账及交付；助理实测每次最多 5 项、预算与逐项确认，完成一个真实行业或本地场景。公开发布、支付及外部通知分别按平台能力验收。[M2 规格](../specs/M2.md) · [M2 任务表](../tasks/M2.md) · [M2 门禁](../05-里程碑与验收计划.md) |

三阶段任务表累计勾选 **2/26（7.7%）**，按功能任务标题计数。三道真实阶段门禁通过 **0/3（0%）**。软件覆盖以第 3 节列出的可运行能力为准。[M0 任务表](../tasks/M0.md) · [M1 任务表](../tasks/M1.md) · [M2 任务表](../tasks/M2.md)

## 3. 各业务模块开发进度明细

| 业务模块 | 已交付能力（软件切片） | 待完成或未闭环项 | 当前状态 |
| --- | --- | --- | --- |
| 双语账号与权限 | 中英文登录、找回、会话恢复；团队邀请、负责人转移、品牌授权及主稿双人审核已有路径。[账号验证](../tasks/B17-account-email-recovery.md) · [成员授权](../tasks/M1-155-brand-access.md) · [负责人转移](../tasks/M1-128-owner-transfer.md) | 团队内容操作仍需按职责接通 [#179](https://github.com/Godyu97/geo-pro/issues/179)；生产投递和账户恢复实证待补。[准入记录](../tasks/M0-21-pilot-admission.md) | 🟡 开发中 |
| 品牌建档、事实与资料资产 | 三步建档、草稿恢复、事实及来源版本、审批与补证；替代事实前可查看受影响稿件和发布。原件导入可显示可识别片段及页码。[开发建档](../tasks/M0-130-dev-brand-intake.md) · [替代事实](../tasks/M0-166-fact-replacement.md) · [原件片段](../tasks/M1-140-source-fragments.md) | 授权原件片段转可追溯事实候选 [#180](https://github.com/Godyu97/geo-pro/issues/180)；🔴 生产品牌入口五项条件待核验。[准入记录](../tasks/M0-21-pilot-admission.md) | 🔴 正式开放有阻塞 |
| 冻结题集与历史人工题单 | 题集冻结、问题分组、专业题集模板；重开历史人工题单按生成时的冻结版本、顺序与原文展示，旧题单证据不足时明确提示。[题集](../tasks/T-M0-03-prompt-sets.md) · [#172](../tasks/M1-172-frozen-manual-sheet.md) · [专业题集](../tasks/M1-158-professional-baseline.md) | 辅助采集选定冻结题目、补齐引用并写入正式证据 [#185](https://github.com/Godyu97/geo-pro/issues/185)。 | 🟡 开发中 |
| 监测登记、通道与预算 | 预览采样范围和费用、设定硬上限、按轨登记、恢复运行；失败时提示可否重试和潜在费用。开发库已有 3 道非品牌题的官方采样与费用回执。[官方执行](../tasks/M0-131-official-run-execution.md) · [失败费用](../tasks/M0-167-run-failure-cost.md) | 🔴 仍缺获准消费者入口与双轨站内联验、实际联网触发证据，以及下一轮真实调用的额度确认。[通道核验](../tasks/M0-31-official-channel-verification.md) · [历史 #31](https://github.com/Godyu97/geo-pro/issues/31) | 🔴 正式双轨有阻塞 |
| 持续监测、竞品与质量提醒 | 到期计划、预算暂停、竞品份额与来源分析、实体纠错；从提醒可回溯具体采样窗口和关联运行。[到期窗口](../tasks/M1-134-due-windows.md) · [竞品与来源](../tasks/T-M1-02-competitor-sources.md) · [#174](../tasks/M1-174-alert-window-drilldown.md) | 第二个完整可比窗口、真实分析标注基准及团队走查。[M1 任务表](../tasks/M1.md) · [历史 #57](https://github.com/Godyu97/geo-pro/issues/57) | 🟡 已开发待验收 |
| 证据下钻与引用归属 | 从指标下钻原文，按通道版本筛选。支持分开记录搜索候选和分析师链接，单独维护 AI 回答实际返回的引用归属及页面状态，刷新自有页引用率并保留历史报告。[官方通道筛选](../tasks/M0-170-official-channel-scope.md) · [核对链接](../tasks/M0-168-reference-links.md) · [#176](../tasks/M0-176-citation-ownership.md) | 🔴 消费者真实存证未完成；真实官方样本中的原生引用归属待实测，当前 3 条品牌观察引用集为空。[官方入证](../tasks/M0-133-official-evidence.md) · [#176 验证范围](../tasks/M0-176-citation-ownership.md) | 🟡 已开发待验收 |
| 内容计划、审核与发布交付 | 按购买问题簇查看现有页面、更新项和内容缺口；已支持绑定事实的草稿、人工审批、逐稿预检导出、发布回填、公开核验及替代版核验后更新发布关系。[#173](../tasks/M0-173-content-plans.md) · [审核与导出](../tasks/M0-28-content-approval-export.md) · [#171](../tasks/M0-171-publication-replacement.md) | 素材权利失效拦截 [#177](https://github.com/Godyu97/geo-pro/issues/177)、渠道变体双审与事实门禁 [#178](https://github.com/Godyu97/geo-pro/issues/178)、团队编辑和发布核验 [#179](https://github.com/Godyu97/geo-pro/issues/179)、图文/口播核对拦截 [#186](https://github.com/Godyu97/geo-pro/issues/186)。🔴 获准品牌真实发布及公开核验待执行。[历史 #32](https://github.com/Godyu97/geo-pro/issues/32) | 🟡 开发中 |
| 复测报告与本人导出 | 同口径快照、已知与待核对费用、执行成果/站点访问/业务反馈的分层展示、下轮决策登记与本人数据导出。源证据清除后提示不可复核，历史快照保留。[复测](../tasks/M0-30-report-retest.md) · [观察分层](../tasks/M0-162-report-observation-layers.md) · [本人导出](../tasks/M0-34-owned-export-and-purge.md) | 🔴 待真实内容生效及可比复测；白标报告快照关联与授权查看见 [#183](https://github.com/Godyu97/geo-pro/issues/183)。[里程碑验收](../05-里程碑与验收计划.md) | 🟡 已开发待验收 |
| 品牌冻结、恢复与清除 | 删除影响预览、访问冻结、身份复核后恢复、到期清除及旧下载失效；未核对费用时可暂停清除并恢复后续处理。[运行手册](../operations/m0-runbook.md) · [清除记录](../tasks/B07-brand-purge.md) | 🔴 私密受理流程、保留与清除披露、目标环境备份恢复及轮换仍待实证。[准入记录](../tasks/M0-21-pilot-admission.md) | 🔴 生产准入有阻塞 |
| 私有对象存储与基础设施 | 资料、附件、交付包、报告、导出与截图可写入私有存储；下载重新核权。已设品牌容量上限时，超限的新原件在写入前拒绝，已有资料可继续访问。[对象存储规格](../oss/02-对象存储功能规格-SPEC.md) · [#123](../tasks/M0-123-brand-storage-limit.md) | 🔴 核验目标生产环境数据库、Redis、私有对象存储与认证配置，并完成存储、导出和备份恢复演练。[运行手册](../operations/m0-runbook.md) | 🟡 开发环境已验证，生产待验收 |
| 数据连接、同步与业务反馈 | 授权预览、增量同步、撤销停止、跨来源咨询去重。旧批次重试不会把最新同步进度和覆盖状态倒退。脱敏 CSV 可预览并写入报告反馈层。[同步](../tasks/M2-161-connection-sync.md) · [#175](../tasks/M2-175-cursor-replay-guard.md) · [反馈层](../tasks/M1-159-business-feedback-snapshot.md) | 线索有效性与跟进状态 [#181](https://github.com/Godyu97/geo-pro/issues/181)；🔴 真实授权数据源与反馈导入、撤销和对账待实测。[M1/M2 验收计划](../05-里程碑与验收计划.md) | 🟡 开发中 |
| 代理委托、外部动作与商业交付 | 代理委托及授权台账、报价订单登记、交付签收、权益版本、白标分享预览、外部连接与通知授权已有软件路径。[交付进度](../tasks/delivery-progress.md) | 委托接入品牌访问与撤销拦截 [#182](https://github.com/Godyu97/geo-pro/issues/182)，白标绑定快照 [#183](https://github.com/Godyu97/geo-pro/issues/183)，外部草稿/发布动作预览及对账 [#184](https://github.com/Godyu97/geo-pro/issues/184)；🔴 真实平台许可及双品牌隔离走查待补。[历史 #70](https://github.com/Godyu97/geo-pro/issues/70) | 🟡 开发中 |
| 经营助理与行业/本地场景 | 有预算与确认流程的周计划、结算后复盘和策略复用；行业题包、门店服务范围及图文/口播核对台账已可操作。[周计划复盘](../tasks/M2-169-weekly-plan-review.md) · [门店范围](../tasks/M0-135-brand-stores.md) · [图文核对](../tasks/M0-135-media-reviews.md) | 内容简报与门店绑定 [#187](https://github.com/Godyu97/geo-pro/issues/187)，媒体核对进入出包门禁 [#186](https://github.com/Godyu97/geo-pro/issues/186)；🔴 获准行业/本地场景与助理实测待补。[M2 任务表](../tasks/M2.md) | 🟡 开发中 |

**近两周交付重点**　11 月 17–22 日完成 Phase 0 基础并接通 M0 隔离主流程，补上内容审核、发布核验、复测及运行手册。11 月 23–25 日打通开发环境受控品牌建档、非联网官方执行与原文入证，完成全站双语视觉走查。11 月 26 日聚焦交付可信度与运营恢复，新增引用归属复核、过往题单准确回读、告警追溯、发布替代关系与同步重放保护。[Phase 0](../tasks/phase-0.md) · [M0 浏览器流程](../tasks/M0-39-browser-e2e.md) · [运行手册交付](../tasks/M0-40-operations-baseline.md) · [品牌联调计划](../tasks/brand-monitoring-next.md) · [#135 视觉验收](../tasks/M0-135-site-visual-acceptance.md) · [主线提交](https://github.com/Godyu97/geo-pro/commits/main/)

**开放队列**　M0 **0**、M1 **5**（#177–#181）、M2 **6**（#182–#187）。优先级为 **P0 0、P1 10、P2 1**；11 项均标记可开始，工单正文均列明直接软件前置已满足，查询时均无负责人。按每项只计一次的主业务归类，内容与资产 **5**（#177–#180、#186）、业务线索 **1**（#181）、代理授权/白标/外部动作 **3**（#182–#184）、辅助采集 **1**（#185）、本地门店 **1**（#187）。近期代表性合并记录包括内容草稿链路和正式准入控制。[实时开放工单](https://github.com/Godyu97/geo-pro/issues?q=is%3Aissue+is%3Aopen) · [PR #33](https://github.com/Godyu97/geo-pro/pull/33) · [PR #71](https://github.com/Godyu97/geo-pro/pull/71) · [PR #72](https://github.com/Godyu97/geo-pro/pull/72)

## 4. 质量保障与上线就绪度评估

### 工程质量基线

| 验证层 | 核验结果 | 依据 |
| --- | --- | --- |
| 静态与构建 | 🟢 本次 `pnpm lint`、`pnpm typecheck`、`pnpm build` 均通过。lint 有 2 条既有的测试变量未使用告警，错误 0。 | 本次执行 · [#176 验证记录](../tasks/M0-176-citation-ownership.md) |
| 双语、功能地图、文档 | 🟢 本次 `pnpm check:i18n` 核对 3,995 个消息键，`pnpm test:i18n` 7 项通过，`pnpm check:feature-map` 覆盖 70/70 个页面、453 条代码路径。`python docs/tools/validate_docs.py` 通过，覆盖 26 项需求、29 项任务、81 个验收编号及本地链接。 | 本次执行 · [功能地图](../feature-map/README.md) · [文档验证脚本](../tools/validate_docs.py) |
| 双库、数据和存储 | 🟢 本次 `pnpm db:ddl:check` 与 `pnpm verify:dual-db` 均通过。在一次性 PostgreSQL 18.4 和临时 SQLite 上执行 14 套检查，零失败、零跳过，包含旧迁移升级和全量建表结构。仓库曾记录的通道画像升级断言失败在本次复跑未重现。#175 的隔离同步回归覆盖重放、去重、并发和撤销。 | 本次执行 · [M0 双库记录](../tasks/M0-38-dual-database-verification.md) · [历史失败记录](../tasks/M0-131-official-run-execution.md) · [#175](../tasks/M2-175-cursor-replay-guard.md) |
| 浏览器与权限 | 🟡 已有隔离 M0 双语主流程、越权及视觉回归。11 月 25 日全套 134 项中 133 项通过，1 项因固定测试日期过期失败；修正后定向复跑 7 项通过。11 月 26 日引用归属定向浏览器 1 项通过。当前代码的全套浏览器测试本次未重跑。 | [#135 全站走查](../tasks/M0-135-site-visual-acceptance.md) · [#176 双语浏览器](../tasks/M0-176-citation-ownership.md) · [测试源码](https://github.com/Godyu97/geo-pro/tree/19cd40e5ad5cd630afc38b23863fbe3526916c88/tests/e2e) |

OpenSpec 现行规格与归档变更要求冻结题集版本、按轨取证、核验发布后记录生效时间，并保存历史报告的原版本。代码回归覆盖这些规则和证据不足时的门禁拒绝。[OpenSpec 现行规格](https://github.com/Godyu97/geo-pro/tree/19cd40e5ad5cd630afc38b23863fbe3526916c88/openspec/specs) · [归档变更](https://github.com/Godyu97/geo-pro/tree/19cd40e5ad5cd630afc38b23863fbe3526916c88/openspec/changes/archive) · [门禁隔离测试](https://github.com/Godyu97/geo-pro/tree/19cd40e5ad5cd630afc38b23863fbe3526916c88/tests/continued-operations) · [M0 门禁试算](../tasks/M0-functional-mock-gate.md)

### M0 正式开放前置条件

| 手册要求 | 已满足的证据 | 上线仍待核验 |
| --- | --- | --- |
| 真实邮件投递 | 开发阶段长期 Mock。严格邮箱验证、找回与重设已用隔离邮件接收器回归。 | 🔴 生产验证与找回邮件的真实投递证据未取得。开发和开发试点可按既定 Mock 策略继续。[账号验证](../tasks/B17-account-email-recovery.md) · [准入五项](../tasks/M0-21-pilot-admission.md) |
| 身份验证与账户恢复 | 开发身份、越权及隔离恢复路径有回归记录。 | 🔴 目标环境的真实身份确认与账户恢复记录待补。[交付验证](../tasks/delivery-progress.md) · [准入五项](../tasks/M0-21-pilot-admission.md) |
| 保留与清除披露 | 建档可记录同意的保留策略版本，有冻结、清除和恢复软件路径。 | 🔴 待确认生产披露文案、私密受理渠道、责任人和正式清除流程。[保留策略](../tasks/M0-122-retention-policy.md) · [M0 运行手册](../operations/m0-runbook.md) |
| 存储导出、备份恢复与环境配置 | 开发 PostgreSQL、Redis、私有 S3 探针通过；隔离验证覆盖本人导出、旧下载失效与清除。 | 🔴 在获准目标环境验证数据库、缓存、私有存储、认证主机、导出与回滚，留存备份恢复、清除清单重放及副本覆盖记录。[交付验证](../tasks/delivery-progress.md) · [M0 运行手册](../operations/m0-runbook.md) |
| 获准试点环境与正式入口 | 有受控开发建档及题集回读，联调材料来自仓库公开 README。运行手册及试点模板已备齐。 | 🔴 待确认真实试点品牌、获准账号和资料、可核验发布页面。生产入口还要登记五项条件、显式开启并核对请求主机。[开发建档](../tasks/M0-130-dev-brand-intake.md) · [准入五项](../tasks/M0-21-pilot-admission.md) · [试点模板](../operations/m0-pilot-templates.md) |
| 官方采样能力、价格与消费者入口 | 已核对一个非联网 API 的模型与配置单价。10 题 × 2 轮返回 20 条通道探针文本，引用集为空，费用按返回用量记录。另在开发工作台跑通 3 道冻结题，入证 3 条并留存已知费用。 | 🔴 待确认试点账号、预算硬上限及供应商账单对账，完成双轨站内联验与消费者 3 题 × 2 轮人工存证。联网试探的实际触发为未知，联网能力保持未核验。[非联网通道核验](../tasks/M0-31-official-channel-verification.md) · [官方执行](../tasks/M0-131-official-run-execution.md) · [官方入证](../tasks/M0-133-official-evidence.md) |

### 真实试点验收缺口

- 🔴 **M0**　缺完整授权品牌闭环。完成双轨留证后，用同一品牌至少三道共同非品牌题完成同轨前采样，经证据下钻、行动任务、事实确认、审批与正式包交付，由获准角色发布并核验公开页面，再做后采样。选用 D+7 时等待实际窗口。还缺五次独立走查及 36 项功能验收与共同场景的证据汇总。[M0 门禁](../05-里程碑与验收计划.md) · [历史 #32](https://github.com/Godyu97/geo-pro/issues/32)
- 🔴 **M1**　当前开发到期窗口复用既有运行，留下 3/3 的覆盖读数，尚无第二个完整可比窗口。需获准真实标注样本、两种团队身份、一次跨渠道修复、真实反馈导入、14 天基线及实际 D+7；D+14/D+28 随自然时间核验。[开发窗口记录](../tasks/M1-134-due-windows.md) · [历史 #57](https://github.com/Godyu97/geo-pro/issues/57)
- 🔴 **M2**　缺真实消费者辅助入口、草稿连接和数据源连接的验证记录，以及两个获准品牌的隔离、到期/撤销、在途对账和交付验证。助理与行业/本地场景需在真实授权范围走查。支付留在登记模式，实际外发按平台能力逐项判断。[M2 门禁](../05-里程碑与验收计划.md) · [历史 #70](https://github.com/Godyu97/geo-pro/issues/70)

## 5. 核心风险、依赖与阻塞项

| 风险或阻塞 | 影响范围 | 严重程度 | 缓解措施与建议责任 |
| --- | --- | --- | --- |
| 🔴 消费者入口无获准账号与平台许可，官方联网证据和正式费用对账未齐。 | M0 能力覆盖、采样质量、开放日期。 | 高 | **供应商接口人 / 业务 / 财务**确认入口许可、有效价格及硬预算；**交付负责人**组织双轨取证，按证据范围启用能力。[通道核验](../tasks/M0-31-official-channel-verification.md) · [历史 #31](https://github.com/Godyu97/geo-pro/issues/31) |
| 🔴 生产品牌准入五项和目标环境演练缺证。 | 品牌入口、账户恢复、数据处置、生产上线。 | 高 | **平台运维 / 数据治理 / 发布负责人**落实真实投递决策、身份恢复、保留披露、导出及备份恢复，逐项签收发布证据。[准入记录](../tasks/M0-21-pilot-admission.md) · [运行手册](../operations/m0-runbook.md) |
| 🔴 五项原验收跟踪工单按不计划关闭，真实品牌、素材与发布页面、前后样本及验收责任尚需重新确认。 | M0 试点排期、验收可追踪性、M1/M2 启动。 | 高 | **PMO / 业务负责人**确认试点范围、排期与签核人，恢复工单或建立等价验收台账；**研发与交付**在获准环境执行取证。[历史 #21](https://github.com/Godyu97/geo-pro/issues/21) · [历史 #32](https://github.com/Godyu97/geo-pro/issues/32) · [阶段门禁](../05-里程碑与验收计划.md) |
| 🔴 M1 正式观察依赖自然时间、真实标注语料及团队职责验证。 | 持续监测效果结论、M1 验收及 M2 正式验收时间。 | 高 | **业务分析 / 试点品牌 / PMO**落实语料授权、固定标注集及独立验收集；以合格基线和实际生效点排定检查窗口。[M1 任务表](../tasks/M1.md) · [历史 #57](https://github.com/Godyu97/geo-pro/issues/57) |
| 🔴 权利失效、团队职责和跨客户授权尚有待开发的拦截点。 | 正式出包质量、跨客户权限、M1/M2 可开放范围。 | 高 | **内容产品 / 研发 / 安全评审**优先完成素材与渠道审批、代理委托撤销，补齐跨品牌和撤销回归后再进入相应实测。[#177](https://github.com/Godyu97/geo-pro/issues/177) · [#178](https://github.com/Godyu97/geo-pro/issues/178) · [#179](https://github.com/Godyu97/geo-pro/issues/179) · [#182](https://github.com/Godyu97/geo-pro/issues/182) |

## 6. 下一阶段行动计划（Next Steps）

### 短期研发冲刺重点

| 建议优先级 | 本阶段行动与完成判据 |
| --- | --- |
| **P0 · M0 发布前置** | 当前开放队列没有 P0 标签。发布关键路径由验收工作承接。恢复 #21/#31/#32 的可追踪记录，确认预算与授权后完成正式双轨留证、站内入证、获准发布及同轨复测，汇总五次走查和 36 项验收。并行补齐五项生产准入证据。[历史 #21](https://github.com/Godyu97/geo-pro/issues/21) · [历史 #31](https://github.com/Godyu97/geo-pro/issues/31) · [历史 #32](https://github.com/Godyu97/geo-pro/issues/32) |
| **P1 · 第一批** | 先完成素材权利和图文核对的出包拦截、渠道变体双审与事实校验、内容协作权限，以及代理委托到期或撤销后的读取、下载和排队拦截。完成判据为拒绝路径与正常授权路径均通过回归。[#177](https://github.com/Godyu97/geo-pro/issues/177) · [#178](https://github.com/Godyu97/geo-pro/issues/178) · [#179](https://github.com/Godyu97/geo-pro/issues/179) · [#182](https://github.com/Godyu97/geo-pro/issues/182) · [#186](https://github.com/Godyu97/geo-pro/issues/186) |
| **P1 · 第二批** | 推进资料片段转可追溯事实、按冻结规则判定线索、白标快照与可撤销访问、外部动作预览及幂等对账、辅助采集补齐后入证。完成判据为工作台各自可操作、证据可回读、敏感外部动作经过单独授权。[#180](https://github.com/Godyu97/geo-pro/issues/180) · [#181](https://github.com/Godyu97/geo-pro/issues/181) · [#183](https://github.com/Godyu97/geo-pro/issues/183) · [#184](https://github.com/Godyu97/geo-pro/issues/184) · [#185](https://github.com/Godyu97/geo-pro/issues/185) |
| **P2 · 后续安排** | 随本地试点安排门店绑定，验证内容简报、事实与服务范围按门店隔离。[#187](https://github.com/Godyu97/geo-pro/issues/187) |

### 需项目管理与业务侧协调

1. **业务负责人确认 M0 试点**　指定一个获准品牌、负责人和实际发布人，落实可用资料、至少三道非品牌题和可核验的公开页面。先确认发布授权及实际生效后可观测的时间窗。[M0 验收计划](../05-里程碑与验收计划.md) · [试点模板](../operations/m0-pilot-templates.md)
2. **供应商接口人、采购及财务确认账号与预算**　提供官方采样与消费者入口的许可范围；确认试点单价、硬上限、费控责任和账单对账口径。M2 另确认平台动作权限、真实数据来源及两个授权品牌。[通道核验](../tasks/M0-31-official-channel-verification.md) · [M2 验收计划](../05-里程碑与验收计划.md)
3. **PMO 与发布负责人确认验收台账及签核人**　为准入、通道和三个里程碑恢复或指定跟踪载体，明确运营、数据治理、平台运维各自要提交的证据。由业务和交付共同签核阶段门禁，生产开放继续按五项准入与发布权限执行。[阶段门禁](../05-里程碑与验收计划.md) · [准入五项](../tasks/M0-21-pilot-admission.md)
4. **M1/M2 业务负责人提前准备需求输入**　安排两种获准成员身份、可独立标注的真实回答、脱敏反馈与自然观察窗口；为 M2 准备跨客户授权、连接器及真实行业场景。阶段验收依 M0 → M1 → M2 的门禁结果启动。[M1 任务表](../tasks/M1.md) · [M2 任务表](../tasks/M2.md)
