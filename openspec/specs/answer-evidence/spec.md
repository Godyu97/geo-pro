# answer-evidence Specification

## Purpose
为 API 与消费者人工结果提供同一来源可追溯的证据合同：不可变原文、引用完整性与可追加的独立分析版本，使负责人能核对与纠正判定而不覆盖原文。

## Requirements

### Requirement: 不可变 Observation 与双轨录入

系统 SHALL 为每个槽位至多采纳一条 Observation，绑定 slot/attempt 或人工录入。原文与指纹 MUST 只追加、不可覆盖。消费者缺字段 MUST 可保存草稿且不得进入 V；完整且无冲突后才可 complete。截图/原文冲突 MUST 进入 contested。系统 MUST NOT 收集第三方账户密码或会话凭证。未登录或非负责人 MUST 被拒绝。

#### Scenario: API 采用原文入证

- **GIVEN** 槽位已有 adopted Attempt 原文
- **WHEN** 负责人确认入证或系统按 fixture 入证
- **THEN** 生成不可变 Observation，原文指纹可核验，后续不得改写原文

#### Scenario: 消费者缺项草稿

- **GIVEN** 消费者人工录入缺少存证或引用完整性字段
- **WHEN** 保存
- **THEN** 状态为 draft_evidence，不进入 V，可稍后补齐

### Requirement: 引用完整性与来源分类

原生引用 MUST 记录原 URL、规范化 URL、citation_origin、位置与归属。完整空引用集合 MUST 计入 C 且未引用；缺引用字段、partial 或 unsupported MUST NOT 计入 C，并说明原因。搜索候选与分析师找到的页面 MUST NOT 计为原生引用。

#### Scenario: 完整空引用与缺字段

- **GIVEN** 一条完整空引用回答与一条缺引用字段回答
- **WHEN** 统计引用集合
- **THEN** 前者进 C 且未引用；后者不进 C 并显示未知/不支持

### Requirement: 独立三态判定与可追加修订

提及、推荐、官网引用 MUST 分别 true/false/unknown，不得互相推断补全。否定推荐且引用官网时 MUST 得到提及=true、推荐=false、官网引用=true。纠正同名误判 MUST 追加新 analysis_version，原文与历史分析仍可读，旧报告引用保持原 ID。

#### Scenario: 否定推荐仍引用官网

- **GIVEN** 回答说“甲可考虑；乙不适合本需求”并引用乙官网
- **WHEN** 分析乙
- **THEN** 提及=true、推荐=false、官网引用=true

#### Scenario: 纠正同名误判

- **GIVEN** 已有 analysis_version 将同名实体误判为提及
- **WHEN** 负责人提交修订原因与新标签
- **THEN** 原文不变，新 analysis_version 可见，既有引用仍指向旧版本 ID

### Requirement: 归属隔离与清除

证据读写 MUST 校验品牌负责人归属；换品牌/证据/附件 ID MUST 拒绝。品牌冻结 MUST 拒绝新写入。品牌清除 contents 步 MUST 删除该品牌证据正文。界面 MUST 提供 zh-CN/en，语言切换 MUST NOT 改变判定与原文。

#### Scenario: 越权与冻结拒绝

- **GIVEN** 品牌属于负责人 A，且另一品牌已冻结
- **WHEN** 负责人 B 读取 A 的证据，或 A 向冻结品牌写入新 Observation
- **THEN** 读取被拒绝且无内容泄露；冻结品牌写入失败且不产生新行
