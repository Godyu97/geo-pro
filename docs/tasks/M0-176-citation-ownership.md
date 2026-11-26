# Issue #176 原生引用归属与页面状态

2026-11-26。对应 R-M0-06、R-M0-07 和 AC-M0-06-2。 [Issue #176](https://github.com/Godyu97/geo-pro/issues/176) · [规格](../specs/M0.md#s-m0-06) · [指标合同](../07-指标与证据合同.md)

## 交付行为

- 有写权限的品牌成员可在证据详情确认或修订 `provider_native` 和 `consumer_visible` 引用的归属与页面状态。保存后，概览和逐题表用更新后的归属计算自有页引用率 `Jo`。搜索候选和分析师链接保留独立分类。
- 只读成员可看聚合概览。只读成员和非本品牌用户从证据详情或 API 请求引用时，收到同一未找到结果。内容规划对只读成员隐藏引用来源记录，仍可读取 Brief 和发布核验证据。
- 原文、指纹和引用集合状态在测试前后逐项相等。历史 ReportSnapshot 的 JSON、HTML 字节及两份 SHA-256 相等。官网引用判定通过独立的分析版本修订。

## 请求与缓存证据

脱敏后的 `POST /api/monitoring/answers` 请求如下。

```json
{
  "action": "update-citation",
  "brandId": "[brand]",
  "observationId": "[observation]",
  "citationId": "[citation]",
  "operationId": "[operation]",
  "ownership": "owned_account",
  "pageStatus": "reachable"
}
```

| 场景 | 实测结果 |
| --- | --- |
| 原生共享平台链接初次确认 | HTTP 200，`citation` 包含 ID、`owned_account` 和 `reachable`，`replayed: false` |
| 同一操作重放 | 返回原归属与状态，`replayed: true`。同 ID 换归属返回 `OPERATION_CONFLICT` |
| 隔离消费者样本 | `Jo` 从 N/A 变为 1/1；内存缓存实例保留旧键时同样读到新值。Redis 两个客户端走另一次修订，清除旧键并从 1/1 变为 N/A |
| 隔离官方回执 | 同一官方轨道同时有完整空引用和归属待确认的原生引用，确认后 `Jo` 从 0/1 变为 1/2 |

事务同时提交引用修订、按操作者存储的请求指纹和按品牌存储的缓存版本。事务完成后清除该品牌的 Redis 或 memory 概览键。概览通过 `brand_operation` 的主键读取版本，即使旧键仍在，也按数据库里的新版本取值。

写成功路径在 SQLite 和 PostgreSQL 各为 6 条 SQL。2026-11-26 本次隔离样本的单次耗时分别为 2.0 ms 和 4.0 ms。SQLite 按 `answer_citation` 主键定位，PostgreSQL 使用 `answer_citation_brand_idx` 按品牌与观察定位后过滤引用 ID 和来源。两端使用现有表及索引。

## 实测记录

| 检查 | 结果 |
| --- | --- |
| 开发预检 | `pnpm env:check` 15 项通过，PostgreSQL、Redis、对象存储探针通过 |
| 静态与生产构建 | `pnpm lint` 通过，`tests/continued-operations/issue-161.test.mjs` 有 2 条既有未使用变量告警；`pnpm typecheck`、`pnpm build` 通过 |
| 双语、地图与 DDL | `pnpm check:i18n` 通过，3995 个键；`pnpm test:i18n` 7 项；`pnpm check:feature-map` 70 个页面与 453 条代码路径；`pnpm db:ddl:check` 双方言通过 |
| 隔离数据库 | `pnpm test:evidence` 48 项、`pnpm test:content` 63 项、`pnpm test:reports` 34 项通过，零跳过 |
| 浏览器 | `pnpm exec playwright test tests/e2e/citation-ownership.spec.ts` 1 项通过。隔离 3100 端口上，写权限成员用键盘把共享平台链接确认为自有账号且可访问；`zh-CN` / `en` 在 375、768、1440 视口下详情归属与概览 `Jo` 均为 `1/1 (100.0%)`，页面无横向溢出。只读成员与另一品牌用户打开详情和读写接口均为未找到，响应不含引用 URL 或状态。同 `operationId` 重放成功，换归属返回 `OPERATION_CONFLICT` |
| 开发库历史兼容性 | 只读回查 #133 已授权的 3 条官方轨道观察及同品牌概览。3 条观察的引用集合均为 `complete` 且原生引用数为 0。引用写入在隔离环境验证。 [#133 记录](M0-133-official-evidence.md) |

正式通道与 M0 试点仍由对应工单跟踪。 [#31 通道核验](https://github.com/Godyu97/geo-pro/issues/31) · [#32 正式试点](https://github.com/Godyu97/geo-pro/issues/32)
