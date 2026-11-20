# report-retest Specification

## Purpose

让负责人按冻结口径发起探索复测或 D+7 站内待办，仅对共同题重算前后指标，并导出不可变、可复算的 HTML/JSON 报告快照；无发布核验时只允许诊断复跑且不得声称经营闭环完成。

## Requirements

### Requirement: Common-question exploratory comparison

When comparing before/after windows, the system MUST recompute rates only on common judgable non-brand questions that share query version, track, channel, protocol, analysis semantics, region and entity version. Modified questions MUST be listed as excluded. Exploratory percentage-point deltas MUST require at least three common judgable questions; otherwise the comparison is incomparable.

#### Scenario: Three common and one modified question

- **GIVEN** before/after windows share three identical query versions with judgable samples and one modified query version
- **WHEN** the owner requests a comparison
- **THEN** only the three common questions are recomputed, the modified question is excluded with a reason, grade is exploratory, and coverage lists included and excluded queries

### Requirement: Diagnostic rerun without publication verification

If content edits exist but no verified publication `effective_at` is present, the system MUST allow a diagnostic retest/report and MUST NOT mark business-loop completion or claim a public intervention took effect.

#### Scenario: Draft done without verified publication

- **GIVEN** the owner completed content edits without a verified publication effective time
- **WHEN** they request a business-loop report
- **THEN** the system returns a diagnostic-only report, refuses business-loop completion, and still allows diagnostic comparison output

### Requirement: Immutable snapshots with successors

Generated report snapshots MUST persist identical HTML and JSON bytes. Label corrections MUST create a successor snapshot that references the previous id; the original snapshot bytes and computed denominators MUST remain unchanged.

#### Scenario: Revise labels after report generation

- **GIVEN** a completed report snapshot
- **WHEN** the owner revises analysis labels and regenerates
- **THEN** a new snapshot is created with `predecessor_id` set, the prior snapshot status becomes `superseded`, and reading the prior JSON/HTML returns the original bytes
