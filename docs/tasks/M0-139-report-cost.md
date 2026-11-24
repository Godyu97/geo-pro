# Issue #139 快照中的已知费用、待核对费用和未记录工时

2026-11-24。 [Issue #139](https://github.com/Godyu97/geo-pro/issues/139) · [S-M0-12](../specs/M0.md#s-m0-12) · [指标合同](../07-指标与证据合同.md) 第 8 节

## 交付范围

- 品牌负责人生成或下载复测快照时，JSON 与 HTML 使用同一份字节中的费用和工时。已知采样费用按币种合计最小货币单位。`pending` 与 `unknown` 计为待核对条数，不写成 0。`none` 和不在前后窗口内的尝试不进入合计。其他品牌的尝试不计入。
- 窗口内没有可关联的采样费用时，费用为 N/A，原因是窗口内没有可关联的采样费用。
- 仓库没有报告用工时记录。快照写人工工时 N/A 和“未记录人工工时”。费用为 0 或用户未付费时，也不把工时写成 0。
- 报告页用当前界面语言显示这三项。内部状态码留在 JSON，不直接当页面或 HTML 文案。金额数字不随界面语言改变。
- 纠错仍生成新快照。旧快照的费用和工时字节保持不变，新快照按当时窗口重新汇总。这次读取不从客户额度再扣待核对费用。
- 不接入真实支付，不把待支付订单写成已收款，不估算缺失工时，不改比较口径，不勾选 T-M0-12。

## 查询路径

生成和纠错各执行一次分组查询。条件是同一品牌、`sampling`、费用状态为 `known` / `pending` / `unknown`，并且尝试时间落在报告的前窗或后窗。查询先按 `monitoring_attempt_brand_idx` 的品牌与 `created_at` 范围定位，再连接该品牌的 `monitoring_run`。SQLite 计划使用该索引，运行表走主键。空表上的 PostgreSQL 计划对尝试表做顺序扫描，运行表走 `monitoring_run_brand_recent_idx`。这是空表上的计划，不是客户延迟。没有新增表或索引。

报告列表先按品牌一次取快照对象元数据，再读取最多 20 份 JSON。读不到或旧快照没有这两个字段时，页面说明无法读取或这份快照没有写入，不显示 0。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 静态与构建 | `pnpm lint` 通过。`pnpm typecheck` 通过。`pnpm build` 通过。`pnpm check:i18n` 通过，3011 个键。 |
| 隔离行为 | `pnpm test:reports` 18 项通过，覆盖 SQLite 与 PostgreSQL。窗口内 CNY 已知 1 分和 2 分，另有一条 `unknown` 时，JSON 与 HTML 都是已知 3 分、待核对 1 条、工时 N/A。窗口外、边界上、`none` 和其他品牌的尝试不进入合计。没有采样费用时两边都是 N/A 和原因，可见文本没有数字 0。纠错后旧快照字节不变，新快照已知 7 分、待核对 2 条。`quota_attempt` 行数不变。同一 JSON 的中文文案含“CNY 3 分”，英文文案含 “CNY 3 minor units”。`pnpm test:monitoring` 25 项通过。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` 1 项通过。隔离「北岸设备」报告页中文显示已知费用 N/A、待核对费用 N/A、窗口内没有可关联的采样费用、人工工时 N/A 和未记录人工工时。英文显示 Known cost N/A、Cost pending reconciliation N/A、No sampling cost can be associated in this window 和 Labor hours were not recorded。下载的 JSON 与 HTML 使用同一费用状态，HTML 不含 `unrecorded`。375、768 和 1440 沿用原流程检查，无横向溢出。 |
| 未验证 | 浏览器走的是没有窗口内采样费用的隔离报告。已知 3 分的合计在双方言隔离库验证，没有在浏览器里用获准品牌的真实回执再走一遍。不把本次结果写成阶段门禁通过。 |
