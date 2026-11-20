# publication-verify Specification

## Purpose
让负责人回填自行发布的 URL，并区分草稿/受限页与真实公开或人工核验通过，记录可复查的生效时间。

## Requirements

### Requirement: Draft and restricted pages never set effective_at

Backfilling a draft-box or login-wall page MUST record `draft_only` or `access_limited` without writing `effective_at`, and MUST NOT count as public verification success.

#### Scenario: Draft URL backfill

- **WHEN** the owner submits a publication with a draft_box fixture page
- **THEN** the publication status is `draft_only`, `effective_at` remains null, and claimed publish time is stored separately

### Requirement: Public match sets first effective_at

A publicly reachable page whose body matches approved claims MUST become `verified_public`, bind the approval fingerprint, and set `effective_at` to the first successful check time. Later rechecks MUST append history without rewriting the original `effective_at`.

#### Scenario: Public page matches claims

- **WHEN** a public fixture page contains every approved claim and the publication has no prior effective time
- **THEN** the system records `verified_public`, sets `effective_at` to the check timestamp, and keeps `claimed_published_at` unchanged

### Requirement: Manual evidence yields verified_manual

Restricted pages with complete manual evidence (screenshot reference, page marker, observed time, body excerpt) that match claims MUST record `verified_manual` with evidence grade `manual`, distinct from anonymous public success.

#### Scenario: Complete manual evidence on restricted page

- **WHEN** the owner submits complete manual evidence whose excerpt matches approved claims
- **THEN** the publication becomes `verified_manual` with evidence grade `manual`, and may set `effective_at` only if it was previously null

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
