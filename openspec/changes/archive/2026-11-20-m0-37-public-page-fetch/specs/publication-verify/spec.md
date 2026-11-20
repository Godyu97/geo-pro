# publication-verify Delta

## ADDED Requirements

### Requirement: 发布核验的受控只读抓取

未提供 fixture 时，系统 SHALL 只抓取该发布记录已保存的 URL。抓取未开启、地址被阻断、超时或正文超限时 MUST 记录 pending_check，不得写入 effective_at，也不得把已核验通过的记录降级为未验证。HTTP 200 本身 MUST NOT 成为 verified_public。草稿、登录墙、撤下和主张不一致仍分别记为 draft_only、access_limited、removed 和 mismatch。

#### Scenario: 关闭时不访问网络

- **GIVEN** 发布记录没有有效生效时间，且公开抓取未开启
- **WHEN** 负责人发起不含 fixture 的核验
- **THEN** 结果为 pending_check，effective_at 仍为空，且不发出网络请求

#### Scenario: 公开匹配只写入一次生效时间

- **GIVEN** 抓取结果是公开页且正文包含全部已批准主张
- **WHEN** 首次核验成功后再次核验
- **THEN** 状态为 verified_public，effective_at 保持首次核验时间
