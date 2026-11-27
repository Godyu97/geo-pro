import "server-only";

import { queryWithParameters, type QueryConnection, type QueryValue } from "../../lib/db/connection.ts";
import type { ExportScope } from "./contracts.ts";

const pageSize = 64;
export const exportSectionBytes = 8 * 1024 * 1024;

type Slice = {
  key: string;
  select: string;
  from: string;
  extra?: string;
  orderSql: string;
  cursorWidth: number;
  cursor: (row: Record<string, unknown>) => QueryValue[];
};

const brandId = (row: Record<string, unknown>) => String(row.brandId);
const textId = (row: Record<string, unknown>, key: string) => String(row[key]);

function byId(key: string, from: string, columns: string, extra?: string): Slice {
  return {
    key, from, extra, select: `src.brand_id AS "brandId", src.id AS "id", ${columns}`,
    orderSql: "src.brand_id, src.id", cursorWidth: 2,
    cursor: (row) => [brandId(row), textId(row, "id")],
  };
}

const sections: Record<Exclude<ExportScope, "profile" | "brands">, Slice[]> = {
  factsAndMaterials: [
    byId("pastes", "brand_fact_paste", `src.previous_id AS "previousId", src.original AS "original", src.created_at AS "createdAt"`),
    byId("versions", "brand_fact_version", `src.fact_id AS "factId", src.version AS "version", src.entity_version AS "entityVersion",
      src.paste_id AS "pasteId", src.revision AS "revision", src.state AS "state", src.content AS "content",
      src.created_at AS "createdAt", src.confirmed_at AS "confirmedAt", src.revoked_at AS "revokedAt"`),
    {
      key: "uses", from: "brand_fact_use",
      select: `src.brand_id AS "brandId", src.fact_version_id AS "factVersionId", src.content_version_id AS "contentVersionId", src.stage AS "stage"`,
      orderSql: "src.brand_id, src.fact_version_id, src.content_version_id", cursorWidth: 3,
      cursor: (row) => [brandId(row), textId(row, "factVersionId"), textId(row, "contentVersionId")],
    },
  ],
  monitoringAndEvidence: [
    byId("runs", "monitoring_run", `src.track AS "track", src.prompt_set_id AS "promptSetId", src.prompt_set_version AS "promptSetVersion",
      src.repeat_count AS "repeatCount", src.question_count AS "questionCount", src.region AS "region", src.language AS "language",
      src.currency AS "currency", src.upper_minor AS "upperMinor", src.customer_payable_minor AS "customerPayableMinor",
      src.status AS "status", src.created_at AS "createdAt"`),
    byId("slots", "monitoring_slot", `src.run_id AS "runId", src.question_id AS "questionId", src.channel_id AS "channelId",
      src.repeat_index AS "repeatIndex", src.status AS "status", src.created_at AS "createdAt"`),
    byId("attempts", "monitoring_attempt", `src.slot_id AS "slotId", src.kind AS "kind", src.ordinal AS "ordinal",
      src.raw_text AS "rawText", src.currency AS "currency", src.upper_minor AS "upperMinor", src.actual_minor AS "actualMinor",
      src.cost_state AS "costState", src.receipt AS "officialReceipt", src.created_at AS "createdAt"`),
    byId("observations", "answer_observation", `src.question_text AS "questionText", src.answer_text AS "answerText",
      src.source_mode AS "sourceMode", src.region AS "region", src.language AS "language", src.captured_at AS "capturedAt",
      src.evidence_state AS "evidenceState"`),
    byId("competitorSets", "competitor_set", `src.version AS "version", src.labels_json AS "labelsJson", src.created_at AS "createdAt"`),
    byId("researchBriefs", "research_brief", `src.question_cluster AS "questionCluster", src.gap AS "gap",
      src.facts_json AS "factsJson", src.source_ids_json AS "sourceIdsJson", src.status AS "status", src.updated_at AS "updatedAt"`),
    byId("sourceInspections", "source_inspection", `src.citation_id AS "citationId", src.state AS "state", src.support AS "support",
      src.page_live AS "pageLive", src.readable AS "readable", src.supported_claim AS "supportedClaim",
      src.fact_version_id AS "factVersionId", src.updated_at AS "updatedAt"`),
    byId("competitorMentions", "competitor_mention", `src.set_id AS "setId", src.observation_id AS "observationId",
      src.competitor_label AS "competitorLabel", src.mention_state AS "mentionState", src."ordered" AS "ordered", src.position AS "position", src.created_at AS "createdAt"`),
    byId("citations", "answer_citation", `src.observation_id AS "observationId", src.raw_url AS "rawUrl",
      src.normalized_url AS "normalizedUrl", src.ownership AS "ownership", src.created_at AS "createdAt"`),
    byId("analyses", "answer_analysis_version", `src.observation_id AS "observationId", src.version AS "version",
      src.mentioned AS "mentioned", src.recommended AS "recommended", src.official_site_cited AS "officialSiteCited",
      src.evidence_span AS "evidenceSpan", src.status AS "status", src.created_at AS "createdAt"`),
    byId("findings", "optimization_finding", `src.gap_type AS "gapType", src.question_cluster AS "questionCluster",
      src.target_page AS "targetPage", src.problem_statement AS "problemStatement", src.hypothesis AS "hypothesis",
      src.created_at AS "createdAt"`),
    byId("tasks", "optimization_task", `src.primary_finding_id AS "primaryFindingId", src.title AS "title", src.status AS "status",
      src.gap_type AS "gapType", src.target_page AS "targetPage", src.created_at AS "createdAt", src.updated_at AS "updatedAt"`),
    {
      key: "taskEvidence", from: "optimization_task_evidence",
      select: `src.brand_id AS "brandId", src.task_id AS "taskId", src.finding_id AS "findingId", src.created_at AS "createdAt"`,
      orderSql: "src.brand_id, src.task_id, src.finding_id", cursorWidth: 3,
      cursor: (row) => [brandId(row), textId(row, "taskId"), textId(row, "findingId")],
    },
    byId("pageChecks", "page_check_record", `src.task_id AS "taskId", src.url AS "url", src.public_status AS "publicStatus",
      src.title AS "title", src.body_excerpt AS "bodyExcerpt", src.checked_at AS "checkedAt"`),
    byId("networks", "sampling_answer_network", `src.requested_network_mode AS "requestedNetworkMode",
      src.actual_network AS "actualNetwork", src.created_at AS "createdAt"`),
  ],
  content: [
    byId("plans", "content_plan", `src.question_cluster AS "questionCluster", src.coverage_json AS "coverageJson", src.updated_at AS "updatedAt"`),
    byId("briefs", "content_brief", `src.plan_id AS "planId", src.status AS "status", src.updated_at AS "updatedAt"`),
    byId("briefVersions", "content_brief_version", `src.brief_id AS "briefId", src.revision AS "revision", src.title_candidates_json AS "titleCandidatesJson",
      src.fact_version_ids_json AS "factVersionIdsJson", src.created_at AS "createdAt"`),
    byId("batches", "content_batch", `src.status AS "status", src.cost_ledger_json AS "costLedgerJson", src.updated_at AS "updatedAt"`),
    byId("batchUnits", "content_batch_unit", `src.batch_id AS "batchId", src.brief_id AS "briefId", src.status AS "status", src.updated_at AS "updatedAt"`),
    byId("versions", "content_version", `src.title AS "title", src.body_markdown AS "bodyMarkdown", src.claims_json AS "claimsJson",
      src.status AS "status", src.target_channel AS "targetChannel", src.updated_at AS "updatedAt"`),
    byId("channelVariants", "content_channel_variant", `src.content_version_id AS "contentVersionId", src.channel AS "channel",
      src.body_markdown AS "bodyMarkdown", src.approval_status AS "approvalStatus", src.needs_own_approval AS "needsOwnApproval",
      src.blocked AS "blocked", src.updated_at AS "updatedAt"`),
    byId("assets", "content_asset", `src.kind AS "kind", src.rights_statement AS "rightsStatement", src.visibility AS "visibility",
      src.review_status AS "reviewStatus", src.content_ref AS "contentRef", src.created_at AS "createdAt"`, `AND src.visibility <> 'internal'`),
    byId("approvals", "content_approval", `src.content_version_id AS "contentVersionId", src.decision AS "decision",
      src.fact_version_ids_json AS "factVersionIdsJson", src.created_at AS "createdAt"`),
    byId("packages", "content_delivery_package", `src.content_version_id AS "contentVersionId", src.kind AS "kind",
      src.target_channel AS "targetChannel", src.manifest_json AS "manifestJson", src.created_at AS "createdAt"`),
    byId("exportJobs", "content_export_job", `src.status AS "status", src.selection_json AS "selectionJson", src.updated_at AS "updatedAt"`),
    byId("publications", "content_publication", `src.page_url AS "pageUrl", src.status AS "status", src.channel_declaration AS "channelDeclaration",
      src.claimed_published_at AS "claimedPublishedAt", src.updated_at AS "updatedAt"`),
    byId("publicationChecks", "content_publication_check", `src.publication_id AS "publicationId", src.method AS "method",
      src.result_status AS "resultStatus", src.evidence_json AS "evidenceJson", src.checked_at AS "checkedAt"`),
    byId("publicationActions", "content_publication_action", `src.publication_id AS "publicationId", src.kind AS "kind",
      src.status AS "status", src.reason AS "reason", src.updated_at AS "updatedAt"`),
    byId("maintenanceTasks", "content_maintenance_task", `src.fact_version_id AS "factVersionId", src.status AS "status",
      src.reason AS "reason", src.updated_at AS "updatedAt"`),
    byId("maintenancePages", "content_maintenance_page", `src.task_id AS "taskId", src.page_url AS "pageUrl",
      src.channel AS "channel", src.planned_on AS "plannedOn", src.verified_on AS "verifiedOn",
      src.status AS "status", src.updated_at AS "updatedAt"`),
  ],
  reports: [
    byId("retests", "report_retest", `src.kind AS "kind", src.status AS "status", src.intent AS "intent", src.track AS "track",
      src.timezone AS "timezone", src.comparison_json AS "comparisonJson", src.updated_at AS "updatedAt"`),
    byId("todos", "report_todo", `src.retest_id AS "retestId", src.kind AS "kind", src.status AS "status", src.due_at AS "dueAt",
      src.progress_json AS "progressJson"`),
    byId("formalObservations", "formal_observation", `src.frozen_set_id AS "frozenSetId", src.effective_on AS "effectiveOn",
      src.frozen_non_brand_count AS "frozenNonBrandCount", src.status AS "status", src.stop_reason AS "stopReason",
      src.created_at AS "createdAt"`),
    byId("formalCheckpoints", "formal_checkpoint", `src.observation_id AS "observationId", src.checkpoint AS "checkpoint",
      src.mode AS "mode", src.comparable_count AS "comparableCount", src.excluded_json AS "excludedJson",
      src.evaluation_json AS "evaluationJson", src.conclusion AS "conclusion",
      src.evaluated_on AS "evaluatedOn", src.created_at AS "createdAt"`),
    byId("formalConfounders", "formal_confounder", `src.observation_id AS "observationId", src.factor AS "factor",
      src.note AS "note", src.recorded_at AS "recordedAt"`),
    byId("formalControlPages", "formal_control_page", `src.observation_id AS "observationId", src.page_key AS "pageKey",
      src.label AS "label", src.registered_at AS "registeredAt"`),
    byId("businessLeads", "business_lead", `src.event_id AS "eventId", src.primary_class AS "primaryClass", src.created_at AS "createdAt"`),
    byId("businessLeadEvidence", "business_lead_evidence", `src.lead_id AS "leadId", src.category AS "category",
      src.position AS "position", src.created_at AS "createdAt"`),
    byId("leadValidityRules", "lead_validity_rule", `src.version AS "version", src.frozen AS "frozen",
      src.requires_real_need AS "requiresRealNeed", src.requires_industry AS "requiresIndustry",
      src.requires_follow_up AS "requiresFollowUp", src.created_at AS "createdAt"`),
    byId("leadQualifications", "lead_qualification", `src.rule_id AS "ruleId", src.rule_version AS "ruleVersion",
      src.status AS "status", src.real_need AS "realNeed", src.target_industry AS "targetIndustry",
      src.follow_up AS "followUp", src.created_at AS "createdAt"`),
    byId("leadFeedback", "(SELECT f.*, l.brand_id FROM lead_feedback f JOIN business_lead l ON l.id = f.lead_id)",
      `src.lead_id AS "leadId", src.rule_id AS "ruleId", src.revision, src.status, src.real_need AS "realNeed",
       src.target_industry AS "targetIndustry", src.can_follow_up AS "canFollowUp", src.outcome, src.created_at AS "createdAt"`),
    byId("leadObservations", "lead_observation", `src.identified_referrals AS "identifiedReferrals",
      src.session_denominator AS "sessionDenominator", src.self_reported AS "selfReported",
      src.crawler_visits AS "crawlerVisits", src.answer_citations AS "answerCitations",
      src.called_included AS "calledIncluded", src.created_at AS "createdAt"`),
    byId("decisions", "report_decision", `src.snapshot_id AS "snapshotId", src.action AS "action",
      src.decided_by AS "decidedBy", src.decided_at AS "decidedAt"`),
    byId("snapshots", "report_snapshot", `src.retest_id AS "retestId", src.status AS "status", src.grade AS "grade",
      src.timezone AS "timezone", src.locale AS "locale", src.json_sha256 AS "jsonSha256", src.html_sha256 AS "htmlSha256",
      src.html_object_id AS "htmlObjectId", src.json_object_id AS "jsonObjectId",
      src.json_bytes AS "jsonBytes", src.created_at AS "createdAt"`),
  ],
  usageAndCosts: [
    {
      key: "grants", from: "quota_grant",
      select: `src.brand_id AS "brandId", src.kind AS "kind", src.version AS "version", src.count_limit AS "countLimit",
        src.budget_minor AS "budgetMinor", src.currency AS "currency", src.action AS "action", src.expires_at AS "expiresAt",
        src.changed_at AS "changedAt", src.reason AS "reason"`,
      orderSql: "src.brand_id, src.kind, src.version", cursorWidth: 3,
      cursor: (row) => [brandId(row), textId(row, "kind"), Number(row.version)],
    },
    {
      key: "reservations", from: "quota_reservation",
      select: `src.brand_id AS "brandId", src.kind AS "kind", src.id AS "id", src.grant_version AS "grantVersion",
        src.upper_minor AS "upperMinor", src.state AS "state", src.created_at AS "createdAt", src.finalized_at AS "finalizedAt"`,
      orderSql: "src.brand_id, src.kind, src.id", cursorWidth: 3,
      cursor: (row) => [brandId(row), textId(row, "kind"), textId(row, "id")],
    },
    {
      key: "attempts", from: "quota_attempt",
      select: `src.brand_id AS "brandId", src.kind AS "kind", src.reservation_id AS "reservationId", src.id AS "id",
        src.upper_minor AS "upperMinor", src.actual_minor AS "actualMinor", src.state AS "state", src.started_at AS "startedAt",
        src.reconciled_at AS "reconciledAt"`,
      orderSql: "src.brand_id, src.kind, src.reservation_id, src.id", cursorWidth: 4,
      cursor: (row) => [brandId(row), textId(row, "kind"), textId(row, "reservationId"), textId(row, "id")],
    },
  ],
};

async function readSlice(db: QueryConnection, ownerId: string, slice: Slice, budget: { bytes: number }) {
  const rows: Record<string, unknown>[] = [];
  let cursor: QueryValue[] | undefined;
  for (;;) {
    const values: QueryValue[] = cursor ? [ownerId, ...cursor, pageSize] : [ownerId, pageSize];
    const page = await queryWithParameters(db, `SELECT ${slice.select}
      FROM ${slice.from} src JOIN brand b ON b.id = src.brand_id
      WHERE b.owner_id = ? AND b.frozen_at IS NULL AND b.status IN ('active', 'archived')
      ${slice.extra ?? ""}
      ${cursor ? `AND (${slice.orderSql}) > (${Array(slice.cursorWidth).fill("?").join(", ")})` : ""}
      ORDER BY ${slice.orderSql} LIMIT ?`, values);
    for (const row of page) {
      budget.bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
      if (budget.bytes > exportSectionBytes) throw new Error("export-section-limit");
      rows.push(row);
    }
    if (page.length < pageSize) return rows;
    const last = page.at(-1);
    if (!last) return rows;
    cursor = slice.cursor(last);
  }
}

export async function readExportSection(db: QueryConnection, ownerId: string, scope: keyof typeof sections) {
  const budget = { bytes: 0 };
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const slice of sections[scope]) data[slice.key] = await readSlice(db, ownerId, slice, budget);
  return data;
}
