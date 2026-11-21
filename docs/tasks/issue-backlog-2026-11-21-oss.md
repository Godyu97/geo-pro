# 对象存储开发队列（2026-11-21）

本文件只索引对象存储合同拆出的软件 Issue。任务勾选仍以 [M0](M0.md)、[M1](M1.md) 为准。需求见 [对象存储 PRD](../oss/01-对象存储需求-PRD.md)，行为见 [对象存储 SPEC](../oss/02-对象存储功能规格-SPEC.md)。这些 Issue 都是 `status:ready`，代码尚未开始。

| 顺序 | Issue | 里程碑 | 模块 | 依赖 | 对应合同 |
| --- | --- | --- | --- | --- | --- |
| 1 | [#73](https://github.com/Godyu97/geo-pro/issues/73) | M0 | S3 客户端 | 无 | OSS-AC-01、OSS-AC-02、OSS-AC-03、OSS-AC-09 |
| 2 | [#74](https://github.com/Godyu97/geo-pro/issues/74) | M0 | 对象元数据 | #73 | OSS-AC-01、OSS-AC-03、OSS-AC-06、OSS-AC-09 |
| 3 | [#75](https://github.com/Godyu97/geo-pro/issues/75) | M0 | 授权图片与内部附件 | #74、#73 | OSS-AC-04、AC-M0-10-2、AC-M0-02-2 |
| 4 | [#76](https://github.com/Godyu97/geo-pro/issues/76) | M0 | 不可变交付包 | #74、#73 | OSS-AC-01、OSS-AC-05、OSS-AC-10、AC-M0-10-1 |
| 5 | [#77](https://github.com/Godyu97/geo-pro/issues/77) | M0 | 报告快照 | #74、#73 | OSS-AC-05、OSS-AC-06、AC-M0-12-3 |
| 6 | [#78](https://github.com/Godyu97/geo-pro/issues/78) | M0 | 本人导出 | #74、#73 | OSS-AC-06、AC-M0-01-2 |
| 7 | [#79](https://github.com/Godyu97/geo-pro/issues/79) | M0 | 人工核验截图 | #74、#73 | AC-M0-11-3 |
| 8 | [#80](https://github.com/Godyu97/geo-pro/issues/80) | M0 | 冻结与清除 | #74、#73 | OSS-AC-07、OSS-AC-08 |
| 9 | [#81](https://github.com/Godyu97/geo-pro/issues/81) | M1 | 资料原件 | #74、#73 | OSS-AC-07、AC-M1-04-1、AC-M1-04-2 |

建议从 #73 开始。#75 至 #81 都依赖 #74 的元数据命令，彼此可在 #74 完成后按上表顺序做。#76 组装正式包时要使用 #75 的公开图片规则。
