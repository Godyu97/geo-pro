# 可执行开发队列（2026-11-23）

本文件只索引本批新建的 `status:ready` 软件 Issue。任务勾选仍以 [M2](M2.md) 为准。这些单都要求 1–2 轮内交付可自动化验证的双库表、DAO、API、双语页面或 Responses API 接入，并用回环 mock 测 AI。不包含真人试点、真实发信、真实支付、真实外部连接或阶段门禁勾选。

品牌委托、通知端点、外部发布连接、辅助采集和每周行动草案已有双库表与页面，本批不重复建单。报价订单、白标分享、数据连接、跨源事件、爬虫身份、同步撤销、本地观察、门店范围、图文核对、交付签收、权益版本和行业题包仍只有判定函数或规格状态，没有持久化。

| 顺序 | Issue | 里程碑 | 模块 | 依赖 | 对应任务 |
| --- | --- | --- | --- | --- | --- |
| 1 | [#106](https://github.com/Godyu97/geo-pro/issues/106) | M2 | 登记订单 | 无 | [T-M2-03](M2.md#t-m2-03)、AC-M2-03-3 |
| 2 | [#107](https://github.com/Godyu97/geo-pro/issues/107) | M2 | 白标分享 | 无 | [T-M2-03](M2.md#t-m2-03)、AC-M2-03-2 |
| 3 | [#108](https://github.com/Godyu97/geo-pro/issues/108) | M2 | 连接预览 | 无 | [T-M2-04](M2.md#t-m2-04)、[S-M2-04](../specs/M2.md#s-m2-04) |
| 4 | [#109](https://github.com/Godyu97/geo-pro/issues/109) | M2 | 跨源去重 | 无 | [T-M2-04](M2.md#t-m2-04)、AC-M2-04-1 |
| 5 | [#110](https://github.com/Godyu97/geo-pro/issues/110) | M2 | 爬虫身份 | 无 | [T-M2-04](M2.md#t-m2-04)、AC-M2-04-2 |
| 6 | [#111](https://github.com/Godyu97/geo-pro/issues/111) | M2 | 同步撤销 | 无 | [T-M2-04](M2.md#t-m2-04)、AC-M2-04-3 |
| 7 | [#112](https://github.com/Godyu97/geo-pro/issues/112) | M2 | 本地观察 | 无 | [T-M2-06](M2.md#t-m2-06)、AC-M2-06-1 |
| 8 | [#113](https://github.com/Godyu97/geo-pro/issues/113) | M2 | 门店范围 | 无 | [T-M2-06](M2.md#t-m2-06)、AC-M2-06-3 |
| 9 | [#114](https://github.com/Godyu97/geo-pro/issues/114) | M2 | 图文核对 | 无 | [T-M2-06](M2.md#t-m2-06)、AC-M2-06-2 |
| 10 | [#115](https://github.com/Godyu97/geo-pro/issues/115) | M2 | 交付签收 | 无 | [T-M2-03](M2.md#t-m2-03)、[S-M2-03](../specs/M2.md#s-m2-03) |
| 11 | [#116](https://github.com/Godyu97/geo-pro/issues/116) | M2 | 权益版本 | 无 | [T-M2-03](M2.md#t-m2-03)、[S-M2-03](../specs/M2.md#s-m2-03) |
| 12 | [#117](https://github.com/Godyu97/geo-pro/issues/117) | M2 | 行业题包 | 无 | [T-M2-06](M2.md#t-m2-06)、[S-M2-06](../specs/M2.md#s-m2-06) |

建议从 #106 开始。#106–#114 是 P1，各自使用已有纯函数，彼此不共用新表。#115–#117 是 P2，也各自建表。#117 只在范围允许时调用 Responses API，单测使用回环 mock。

本批没有重开 #21、#31、#32。这三张仍是真人试点项。
