# content

内容草稿域（Issue #27 / S-M0-09）：确认 Brief → 小批次隔离模板填充 → 始终 `draft` 的 ContentVersion。

## 接线

- 事实：生成与 Resume 经 `withEligibleFacts(..., stage=review)`，写入 `brand_fact_use`；不可用事实使 unit=`blocked`、Brief=`invalidated`。
- 额度：若存在有效 `generation` grant，则 `reserve → start → reconcile → settle`；否则 `cost_ledger_json.mode=unknown_pending`，不调用付费模型。
- 生成：确定性模板填充（`fact_faq` / `scenario_solution` / `verifiable_comparison`），无真实 LLM / 无读取密钥。

## 验收夹具

- `fixtures.failBriefIds`：强制 unit 失败，供重试 AC。
- `fixtures.pauseAfter`：处理 N 个 unit 后暂停，供撤销事实后 Resume AC。
