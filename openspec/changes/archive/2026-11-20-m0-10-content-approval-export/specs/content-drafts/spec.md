# content-drafts Delta

## MODIFIED Requirements

### Requirement: Small-batch drafts with retry isolation

The system SHALL generate batches of 1–5 confirmed Briefs (default 1). Each unit MUST record success, failure, or blocked independently. Pause, resume, cancel, and retry-failed MUST be supported. Successful ContentVersions MUST remain unchanged when failed units are retried; the batch ledger MUST retain original records and MUST NOT auto-expand unit count. Generated ContentVersions MUST start as `draft` and MUST NOT be auto-approved by generation; later review workflows MAY transition the same ContentVersion through `in_review` / `approved` / `rejected` / `invalidated` without changing batch retry isolation.

#### Scenario: Retry only failed units

- **WHEN** a batch of three units has two successes and one failure, and the owner retries failed only
- **THEN** the two successful ContentVersion IDs and bodies stay identical, the failed unit gains a new attempt, and the batch keeps its original unit set

#### Scenario: Fact revocation blocks affected units only

- **WHEN** a confirmed Brief's bound fact is revoked while a paused batch resumes
- **THEN** affected units become `blocked` with补证, other units may continue, and no draft becomes approved

#### Scenario: Generated drafts are never auto-approved

- **WHEN** a confirmed Brief is generated into a ContentVersion
- **THEN** the ContentVersion status is `draft` and no Approval row is created by generation alone
