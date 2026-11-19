# Channel capabilities

## Purpose

为监测通道提供可核验的能力台账与双轨采样范围，使用户只选择真实可用且限制明确的来源，并阻止未验证或过期通道进入正式运行。

## ADDED Requirements

### Requirement: 双轨独立通道身份

系统 SHALL 为每个通道分配稳定 ID，并按厂商与 `consumer_ui` / `model_api` / `custom_pipeline` 分轨。同一厂商的 API 与消费者入口 MUST 作为两个独立来源展示，不得合成为一个品牌推荐率。

#### Scenario: 同厂商两轨选择器

- **GIVEN** 同一厂商同时登记官方 API 与消费者入口
- **WHEN** 用户查看能力选择器或报告范围
- **THEN** 系统显示两个独立来源及其各自限制，不得合并为一个通道或一个推荐率

### Requirement: 不可变能力版本与验证有效期

系统 SHALL 以不可变版本保存能力状态 `candidate` / `verified` / `degraded` / `disabled`、验证时间、限制和人工 SOP。仅未过期的 `verified` 可新建正式计划；默认验证有效期 30 天，显著行为变化 MUST 立即失效并产生新版本，不得覆盖旧报告口径。

#### Scenario: 未验证或过期阻止正式运行

- **GIVEN** 通道未验证、已过期、降级或已禁用
- **WHEN** 用户请求新建正式运行
- **THEN** 系统阻止正式执行并说明原因，不得返回模拟成功

#### Scenario: 显著变化立即失效

- **GIVEN** 已验证通道发生显著行为变化
- **WHEN** 维护者提交失效记录
- **THEN** 新版本不再处于未过期 verified，旧版本保留供历史证据引用

### Requirement: 联网配置不等于实际触发

系统 SHALL 分别记录请求的联网模式（on/off/unknown）与实际触发证据。实际联网 MUST 为 true/false/unknown；配置开关开启但无触发证据时实际联网为 unknown，不得进入 required 联网合格分母。

#### Scenario: 配置联网但无触发证据

- **GIVEN** 通道配置了联网且 search_required 为真
- **WHEN** 保存回答且没有实际触发证据
- **THEN** 实际联网为 unknown，该记录不得计入 required 联网合格分母

### Requirement: 禁用后历史证据仍可查看

系统 MUST 在通道禁用后保留既有能力版本与联网证据元数据，允许所属用户继续查看历史记录。维护页面 MUST NOT 展示客户正文、附件或密钥。

#### Scenario: 禁用后查阅历史

- **GIVEN** 通道已禁用且存在引用旧版本的联网证据
- **WHEN** 所属用户查看历史证据
- **THEN** 仍可看到该记录的通道版本与联网口径，且不出现客户正文

### Requirement: 仅维护身份可改验证结果

系统 MUST 仅允许持有 `capabilities.manage` 且经服务端会话核验的维护身份写入通道与验证结果。普通用户、匿名、伪造或过期会话不得改验证；拒绝时不泄露密钥、内部端点或跨品牌存在性。

#### Scenario: 普通用户改验证

- **WHEN** 匿名或普通登录会话直接提交通道验证变更
- **THEN** 服务端拒绝写入，且响应不含密钥、SOP 之外的内部配置或客户正文

### Requirement: 用户可见范围与公开投影

系统 SHALL 在双语设置中展示当前可用通道范围、状态、限制和验证信息。官网仅投影允许公开的名称、范围、状态、限制和验证时间；没有未过期 verified 公开记录时 MUST NOT 宣称通道已支持或监测可用。

#### Scenario: 无已核验公开通道

- **WHEN** 台账中没有未过期且允许公开的 verified 通道
- **THEN** 官网继续说明没有已开放的真实监测通道，设置页标明正式运行不可用

#### Scenario: 设置页展示可用范围

- **GIVEN** 台账中存在 candidate 与 verified 通道
- **WHEN** 登录用户打开设置中的监测能力
- **THEN** 分别标明演示/待核验与可正式使用范围，且不展示密钥或客户正文
