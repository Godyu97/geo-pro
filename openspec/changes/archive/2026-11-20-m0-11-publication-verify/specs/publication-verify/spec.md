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
