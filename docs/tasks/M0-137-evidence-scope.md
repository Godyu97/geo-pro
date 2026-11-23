# Issue #137 证据范围下钻

2026-11-24。 [Issue #137](https://github.com/Godyu97/geo-pro/issues/137) · [S-M0-07](../specs/M0.md#s-m0-07) 第 2 条 · [AC-M0-07-3](../specs/M0.md#s-m0-07) · 指标合同第 1 节

## 交付范围

- 品牌负责人在 `/dashboard/monitoring/overview` 和 `/dashboard/monitoring/answers` 设置轨道、目标地区、请求联网和起止时间。比率、逐题表和回答列表读取这一范围。
- 从概览进入回答列表、从列表进入证据详情，再返回列表或概览时，查询串仍带已选条件。未填写的条件不收窄该维度。
- 回答列表显示当前范围的条数。零条时说明这个范围没有样本，筛选表单仍在页上。
- 请求联网选“开”或“关”时，请求联网为未知的样本不进入。目标地区填写具体代码时，其他目标地区不进入。选择 `unknown` 只匹配该值。筛选比较已保存的 `target_region` 和 `requested_network_mode`，不使用实际采样位置或实际联网触发，也不改写证据。
- 已保存的目标地区是两位代码。选择“未知”因此不会命中现有证据行。内存过滤仍按精确值排除未知样本。
- `zh-CN` / `en` 都有控件、计数和空范围文案。本记录不勾选阶段门禁，也不新增综合分。

## 查询路径

范围查询仍以 `answer_observation_owner_idx` 的 `owner_id` 为入口，再过滤品牌、轨道、目标地区、请求联网、采集时间和证据状态。没有为可选筛选新增索引。SQLite 计划是 `SEARCH o USING INDEX answer_observation_owner_idx`。PostgreSQL 计划是该索引上的 Index Scan，`target_region`、`requested_network_mode` 和 `captured_at` 出现在 Filter 中。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 环境 | `pnpm env:check` 14 项通过。开发 PostgreSQL、Redis 和对象存储探针通过。邮件仍是长期 mock。 |
| 静态与构建 | `pnpm lint` 0 error，既有告警 `tests/competitors/briefs.test.mjs:46`。`pnpm typecheck`、`pnpm build` 通过。 |
| 双语 | `pnpm check:i18n` 通过，2978 个键。`pnpm test:i18n` 7 项通过。 |
| 隔离行为 | `pnpm test:evidence` 28 项通过，覆盖 SQLite 与 PostgreSQL。消费者列表只有消费者样本。目标地区 CN 不纳入实际位置为 CN、目标地区为 US 的样本。联网 `off` 加当日时间窗只留下对应官方样本，推荐率随范围变为 1。联网 `on` 不包含请求联网未知的样本。其他品牌和其他负责人的样本不出现。 |
| 浏览器 | `pnpm exec playwright test tests/e2e/evidence-scope.spec.ts` 1 项通过。隔离账号在概览选择消费者轨道后，列表计数为 1 且只有该样本，返回概览后轨道仍是消费者。再收窄官方轨道、目标地区 CN、请求联网关和 2026-11-20 的时间窗后，概览只剩「官方关联网」，被排除的地区、联网、次日和消费者样本不出现。证据详情返回列表后查询串仍在。英文界面显示 “1 answer in this scope”，证据链接仍是同一条样本。375、768、1440 无横向溢出。地区改为 JP 后显示 0 条和空范围说明，筛选控件仍在。临时账号已清理。 |
| 未验证 | 浏览器样本由测试直接写入隔离账号，不是获准品牌的真实采样。不把本次结果写成 AC-M0-GATE 通过。 |
