# content-approval-export Specification

## Purpose

让负责人对内容版本逐稿显式审核，并导出可追溯的主页面修改包与单渠道素材包；正式导出受批准指纹与公开事实门禁约束。

## ADDED Requirements

### Requirement: Explicit review and approval with invalidation

The system SHALL support ContentVersion statuses `draft`, `in_review`, `approved`, `rejected`, and `invalidated`. Generating drafts MUST NOT auto-approve. An owner MAY explicitly self-approve or reject while in review, recording actor and time. ANY change to title, body, images, bound fact versions, target channel, or labeling profile for that variant MUST invalidate an existing approval; previous Approval rows and delivery packages MUST remain readable and marked do-not-reuse when superseded.

#### Scenario: Title change invalidates approval before formal export

- **WHEN** an approved ContentVersion has one title character changed and the owner requests a formal export
- **THEN** the system marks the version `invalidated` (or rejects formal export requiring re-approval), refuses formal package creation until a new approval matches the current fingerprint, and keeps the old Approval and any prior package bytes/metadata traceable

### Requirement: Formal package excludes private material

A formal delivery package MUST include only publicly permitted body content, authorized public images (if any), public fact sources, sanitized HTML without executable scripts, a manifest binding approval id and content fingerprint, and a publish checklist. Internal attachments, credentials, private facts, and cross-brand content MUST NOT appear in formal packages.

#### Scenario: Internal attachment omitted from formal package

- **WHEN** a version references an internal/private asset alongside public fact excerpts and the owner exports a formal package under a valid approval
- **THEN** the package files contain only public content and sources, and do not include the internal attachment bytes or credentials

### Requirement: Batch export preflight with explicit subset

Batch export MUST preflight every selected ContentVersion, listing blockers per item. The system MUST NOT silently omit items. The owner MUST explicitly choose a subset of preflight-passing versions; the successful package count MUST equal that subset size.

#### Scenario: One expired fact blocks one of three selections

- **WHEN** the owner selects three versions for export and one has an expired or revoked fact binding
- **THEN** preflight reports the blocker for that version, requires an explicit subset of the two eligible versions, and yields exactly two successful packages when that subset is confirmed

### Requirement: Review-only export when labeling unverified

When the labeling profile is unverified or closed, the system MUST allow only review packages clearly marked non-publishable, and MUST refuse formal export. Frozen brands and non-owners MUST be denied reads/downloads with not-found semantics without leaking package contents.

#### Scenario: Unverified labeling yields review package only

- **WHEN** an approved version is exported while labeling profile status is unverified
- **THEN** the system creates a `review` package marked non-publishable and does not create a `formal` package
