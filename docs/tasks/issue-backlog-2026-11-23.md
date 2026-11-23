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

## 同日第二批

#106–#117 已关闭。下面这 12 张是当前 `status:ready` 队列。采样协议、采样条件、探索观察、演示观察、保留政策、容量上限、混杂因素、对照页、渠道画像、策略模板、负责人转移和成员邀请都还没有各自的表。每周行动草案、团队授权和正式检查点已有实现，本批只补这些缺口，不重复建单。

| 顺序 | Issue | 里程碑 | 模块 | 依赖 | 对应任务 |
| --- | --- | --- | --- | --- | --- |
| 1 | [#118](https://github.com/Godyu97/geo-pro/issues/118) | M0 | 采样协议 | 无 | [T-M0-05](M0.md#t-m0-05)、[S-M0-05](../specs/M0.md#s-m0-05) |
| 2 | [#119](https://github.com/Godyu97/geo-pro/issues/119) | M0 | 采样条件 | 无 | [T-M0-06](M0.md#t-m0-06)、[S-M0-06](../specs/M0.md#s-m0-06) |
| 3 | [#120](https://github.com/Godyu97/geo-pro/issues/120) | M0 | 探索观察 | 无 | [T-M0-04](M0.md#t-m0-04)、[S-M0-04](../specs/M0.md#s-m0-04) |
| 4 | [#121](https://github.com/Godyu97/geo-pro/issues/121) | M0 | 演示观察 | 无 | [T-M0-04](M0.md#t-m0-04)、[S-M0-04](../specs/M0.md#s-m0-04) |
| 5 | [#122](https://github.com/Godyu97/geo-pro/issues/122) | M0 | 保留策略 | 无 | [T-M0-01](M0.md#t-m0-01) |
| 6 | [#123](https://github.com/Godyu97/geo-pro/issues/123) | M0 | 对象容量 | 无 | [T-M1-04](M1.md#t-m1-04) |
| 7 | [#124](https://github.com/Godyu97/geo-pro/issues/124) | M1 | 混杂因素 | 无 | [T-M1-06](M1.md#t-m1-06)、[S-M1-06](../specs/M1.md#s-m1-06) |
| 8 | [#125](https://github.com/Godyu97/geo-pro/issues/125) | M1 | 对照预注册 | 无 | [T-M1-06](M1.md#t-m1-06)、[S-M1-06](../specs/M1.md#s-m1-06) |
| 9 | [#126](https://github.com/Godyu97/geo-pro/issues/126) | M1 | 渠道画像 | 无 | [T-M1-05](M1.md#t-m1-05)、[S-M1-05](../specs/M1.md#s-m1-05) |
| 10 | [#127](https://github.com/Godyu97/geo-pro/issues/127) | M2 | 策略模板 | 无 | [T-M2-05](M2.md#t-m2-05)、[S-M2-05](../specs/M2.md#s-m2-05)、AC-M2-05-3 |
| 11 | [#128](https://github.com/Godyu97/geo-pro/issues/128) | M1 | 负责人转移 | 无 | [T-M1-08](M1.md#t-m1-08)、[S-M1-08](../specs/M1.md#s-m1-08) |
| 12 | [#129](https://github.com/Godyu97/geo-pro/issues/129) | M1 | 成员邀请 | 无 | [T-M1-08](M1.md#t-m1-08)、[S-M1-08](../specs/M1.md#s-m1-08) |

建议从 #118 开始。十二张单各自建表，不共用新表。#127 只在起草说明时调用 Responses API，单测使用回环 mock。#129 不发信。

这一批也没有重开 #21、#31、#32。
