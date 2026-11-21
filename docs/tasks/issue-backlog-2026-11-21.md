# 可执行开发队列（2026-11-21）

本文件只索引本批新建的 `status:ready` 软件 Issue。任务勾选仍以 [M0](M0.md)、[M1](M1.md)、[M2](M2.md) 为准。这些单都要求 1–2 轮内交付可自动化验证的表、DAO、API、双语页面或 Responses API 接入，并用回环 mock 测 AI。不包含真人试点、真实发信或阶段门禁勾选。

竞品份额、来源复核和资料原件已有双库表与页面，本批不重复建单。业务线索台账（[T-M1-07](M1.md#t-m1-07)）和团队授权（[T-M1-08](M1.md#t-m1-08)）仍只有判定函数，留待下一批。

| 顺序 | Issue | 里程碑 | 模块 | 依赖 | 对应任务 |
| --- | --- | --- | --- | --- | --- |
| 1 | [#82](https://github.com/Godyu97/geo-pro/issues/82) | M0 | 问题簇候选 | 无 | [T-M0-03](M0.md#t-m0-03)、AC-M0-03-2 |
| 2 | [#83](https://github.com/Godyu97/geo-pro/issues/83) | M0 | 证据判定草案 | 无 | [T-M0-06](M0.md#t-m0-06)、AC-M0-06-1、AC-M0-06-3 |
| 3 | [#84](https://github.com/Godyu97/geo-pro/issues/84) | M0 | 诊断行动草案 | 无 | [T-M0-08](M0.md#t-m0-08)、AC-M0-08-1、AC-M0-08-2 |
| 4 | [#85](https://github.com/Godyu97/geo-pro/issues/85) | M0 | 事实边界草稿 | 无 | [T-M0-09](M0.md#t-m0-09)、AC-M0-09-1、AC-M0-09-3 |
| 5 | [#86](https://github.com/Godyu97/geo-pro/issues/86) | M1 | 采样计划 | 无 | [T-M1-01](M1.md#t-m1-01)、AC-M1-01-1 |
| 6 | [#87](https://github.com/Godyu97/geo-pro/issues/87) | M1 | 质量提醒 | 无 | [T-M1-01](M1.md#t-m1-01)、AC-M1-01-2、AC-M1-01-3 |
| 7 | [#88](https://github.com/Godyu97/geo-pro/issues/88) | M1 | 抽样错误率 | 无 | [T-M1-03](M1.md#t-m1-03)、AC-M1-03-2 |
| 8 | [#89](https://github.com/Godyu97/geo-pro/issues/89) | M1 | 同名消歧 | 与 #88 并行 | [T-M1-03](M1.md#t-m1-03)、AC-M1-03-1、AC-M1-03-3 |
| 9 | [#90](https://github.com/Godyu97/geo-pro/issues/90) | M1 | 渠道变体 | 无 | [T-M1-05](M1.md#t-m1-05)、AC-M1-05-1 |
| 10 | [#91](https://github.com/Godyu97/geo-pro/issues/91) | M1 | 内容日历 | 与 #90 并行 | [T-M1-05](M1.md#t-m1-05)、AC-M1-05-2、AC-M1-05-3 |
| 11 | [#92](https://github.com/Godyu97/geo-pro/issues/92) | M1 | 正式检查点 | 冻结题集夹具 | [T-M1-06](M1.md#t-m1-06)、AC-M1-06-1、AC-M1-06-2 |
| 12 | [#93](https://github.com/Godyu97/geo-pro/issues/93) | M2 | 每周行动草案 | 已批准事实夹具 | [T-M2-05](M2.md#t-m2-05)、AC-M2-05-1、AC-M2-05-2、AC-M2-05-3 |

建议从 #82 开始。#82–#85 都只依赖现有 M0 模块和 `src/lib/ai/responses.ts`，可按编号顺序做。#86–#92 各自使用已有纯函数，彼此不阻塞。#93 放在 M1 持久化单之后。
