# content

内容草稿域（Issue #27 / S-M0-09）：确认 Brief → 小批次隔离模板填充 → 始终 `draft` 的 ContentVersion。

## 接线

- 事实：生成与 Resume 经 `withEligibleFacts(..., stage=review)`，写入 `brand_fact_use`；不可用事实使 unit=`blocked`、Brief=`invalidated`。
- 额度：若存在有效 `generation` grant，则 `reserve → start → reconcile → settle`；否则 `cost_ledger_json.mode=unknown_pending`，不调用付费模型。
- 生成：确定性模板填充（`fact_faq` / `scenario_solution` / `verifiable_comparison`），无真实 LLM / 无读取密钥。

## 验收夹具

- `fixtures.failBriefIds`：强制 unit 失败，供重试 AC。
- `fixtures.pauseAfter`：处理 N 个 unit 后暂停，供撤销事实后 Resume AC。

## 审核与导出（Issue #28 / S-M0-10）

- 状态机：`draft → in_review → approved | rejected`；标题/正文/图片/渠道/标识任一变更（`update-variant`）使 `approved` 变为 `invalidated`，旧 Approval 与交付包保留可读，旧包标 `do_not_reuse`。
- 批准指纹：`computeApprovalFingerprint`（标题+正文+claims+图片+渠道+标识 profile+事实版本）；Approve 时在 `withEligibleFacts(stage=review)` 内复核事实并快照。
- 交付包：`formal`（需批准指纹匹配、标识已核实、事实可用，经 `withEligibleFacts(stage=delivery)`）或 `review`（标识未核实，标记 `非发布用`）。内部资产与未审核图片永不入包；HTML 经白名单净化。
- 批量导出：`export-preflight`（逐项列阻塞项，`operationId` 幂等）→ `export-confirm`（显式 `chosenVersionIds` ⊆ 预检合格项，成功包数 = 子集大小）。导出成功不等于发布。
- 入口：`/dashboard/content/versions/[versionId]`、`POST /api/content`、`GET /api/content/versions/:id`、`GET /api/content/packages/:id[?file=]`。

## 审核与导出（Issue #28 / S-M0-10）

- 状态机：`draft → in_review → approved | rejected`；标题/正文/图片/渠道/标识任一变更（`update-variant`）使 `approved` 变为 `invalidated`，旧 Approval 与交付包保留可读，旧包标 `do_not_reuse`。
- 批准指纹：`computeApprovalFingerprint`（标题+正文+claims+图片+渠道+标识 profile+事实版本）；Approve 时在 `withEligibleFacts(stage=review)` 内复核事实并快照。
- 交付包：`formal`（需批准指纹匹配、标识已核实、事实可用，经 `withEligibleFacts(stage=delivery)`）或 `review`（标识未核实，标记 `非发布用`）。内部资产与未审核图片永不入包；HTML 经白名单净化。
- 批量导出：`export-preflight`（逐项列阻塞项，`operationId` 幂等）→ `export-confirm`（显式 `chosenVersionIds` ⊆ 预检合格项，成功包数 = 子集大小）。导出成功不等于发布。
- 入口：`/dashboard/content/versions/[versionId]`、`POST /api/content`、`GET /api/content/versions/:id`、`GET /api/content/packages/:id[?file=]`。
