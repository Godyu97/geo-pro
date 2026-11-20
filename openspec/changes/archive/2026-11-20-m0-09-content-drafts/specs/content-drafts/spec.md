# content-drafts Specification

## Purpose

让负责人把优化任务转为有批准事实依据的小批次内容草稿：确认 Brief、隔离生成、批次控制与事实绑定；稿件始终待审。

## ADDED Requirements

### Requirement: Brief confirmation gates generation

The system SHALL require an explicit Brief confirmation before any draft generation. A Brief MUST include audience, target gap, applicable boundary, primary page or planned page, conversion action, template kind, up to three editable title candidates, and one or more approved usable `fact_version` IDs. When source, applicable boundary, usable facts, primary page, or conversion action are missing, the system MUST return evidence-request gaps and MUST NOT create marketing body text.

#### Scenario: Missing source or boundary becomes evidence request

- **WHEN** a owner requests generation for a Brief lacking source or applicable boundary
- **THEN** the system rejects generation, returns补证 gaps, and writes no ContentVersion body

#### Scenario: Confirm only when gaps are empty

- **WHEN** a owner confirms a Brief with empty gaps and usable approved facts
- **THEN** the Brief becomes `confirmed` and is eligible for a batch unit

### Requirement: Small-batch drafts with retry isolation

The system SHALL generate batches of 1–5 confirmed Briefs (default 1). Each unit MUST record success, failure, or blocked independently. Pause, resume, cancel, and retry-failed MUST be supported. Successful ContentVersions MUST remain unchanged when failed units are retried; the batch ledger MUST retain original records and MUST NOT auto-expand unit count. Generated ContentVersions MUST remain `draft` (never auto-approved).

#### Scenario: Retry only failed units

- **WHEN** a batch of three units has two successes and one failure, and the owner retries failed only
- **THEN** the two successful ContentVersion IDs and bodies stay identical, the failed unit gains a new attempt, and the batch keeps its original unit set

#### Scenario: Fact revocation blocks affected units only

- **WHEN** a confirmed Brief's bound fact is revoked while a paused batch resumes
- **THEN** affected units become `blocked` with补证, other units may continue, and no draft becomes approved

### Requirement: Fact binding and generation quota

Draft generation MUST run under owner lock with `withEligibleFacts` at stage `review`, recording `brand_fact_use` for each ContentVersion. Generation MUST consume the brand `generation` quota reservation/attempt ledger. When generation capability or cost is unknown, the unit MUST block pending核对 without inventing cost. Without a verified generation provider, the system MUST use isolated deterministic template fill and MUST NOT perform real paid model calls.

#### Scenario: Isolated template fill without provider

- **WHEN** no verified generation provider is configured and a confirmed Brief is generated in isolation
- **THEN** the system writes a structured draft from the selected template using bound fact claims and does not call an external model

### Requirement: Coverage plan and ownership

The system SHALL present a ContentPlan view by question cluster showing existing content, pending updates, and gaps, preferring updates to an existing primary page. All content reads and writes MUST enforce brand ownership; unauthorized access MUST return not-found without leaking body text. UI copy MUST support zh-CN and en without changing frozen business fields.

#### Scenario: Non-owner cannot read drafts

- **WHEN** a non-owner requests Brief, batch, or ContentVersion by id
- **THEN** the system returns not-found and does not reveal titles or bodies
