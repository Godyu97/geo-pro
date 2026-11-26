import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { queryWithParameters, type QueryConnection } from "../../lib/db/connection.ts";
import { triStateSchema } from "../evidence/contracts.ts";
import { draftContent, primaryTypes } from "../prompts/contracts.ts";
import { reportTrackSchema, type GenerateReportInput } from "./contracts.ts";
import { compareWindows } from "./rules.ts";
import { windowInstant } from "./window-observations.ts";

export const snapshotMetrics = ["mention_rate", "recommendation_rate", "official_site_citation_rate"] as const;
export type SnapshotMetric = typeof snapshotMetrics[number];

const observationSchema = z.object({
  id: z.string(),
  questionId: z.string().nullable(),
  naturalQuestion: z.number().nullable(),
  questionText: z.string(),
  promptSetId: z.string().nullable(),
  promptContent: z.string().nullable(),
  track: reportTrackSchema,
  runTrack: reportTrackSchema.nullable(),
  runRegion: z.string().nullable(),
  runLanguage: z.string().nullable(),
  runNetwork: z.string().nullable(),
  channelId: z.string().nullable(),
  channelVersion: z.number().int().nullable(),
  protocolId: z.string().nullable(),
  protocolVersion: z.number().int().nullable(),
  protocolTimezone: z.string().nullable(),
  protocolRegion: z.string().nullable(),
  searchRequired: z.number().nullable(),
  newSessionRequired: z.number().nullable(),
  capturedAt: z.string(),
  targetRegion: z.string(),
  observedRegion: z.string(),
  requestedNetworkMode: z.string(),
  networkTrigger: z.string(),
  newSession: triStateSchema,
  productMode: triStateSchema,
  language: z.string(),
  entityVersion: z.number().int(),
  promptEntityVersion: z.number().int().nullable(),
  brandContent: z.string().nullable(),
  citationSetState: z.string(),
  evidenceState: z.string(),
  analysisId: z.string().nullable(),
  analysisVersion: z.number().int().nullable(),
  analysisEntityVersion: z.number().int().nullable(),
  analysisRuleVersion: z.string().nullable(),
  analysisStatus: z.string().nullable(),
  mentioned: triStateSchema.nullable(),
  recommended: triStateSchema.nullable(),
  officialSiteCited: triStateSchema.nullable(),
});
type Observation = z.infer<typeof observationSchema>;

// Both windows use one statement, so a concurrent correction cannot split the version read.
export function snapshotObservationsQuery(ownerId: string, brandId: string, ids: readonly string[]) {
  return {
    sql: `SELECT o.id, o.question_text AS "questionText", o.source_mode AS track,
      o.captured_at AS "capturedAt", o.target_region AS "targetRegion", o.observed_region AS "observedRegion",
      o.requested_network_mode AS "requestedNetworkMode", o.network_trigger AS "networkTrigger",
      o.new_session AS "newSession", o.product_mode AS "productMode", o.language, o.entity_version AS "entityVersion",
      o.citation_set_state AS "citationSetState", o.evidence_state AS "evidenceState",
      s.question_id AS "questionId", s.natural_question AS "naturalQuestion",
      s.channel_id AS "channelId", s.channel_version AS "channelVersion",
      r.track AS "runTrack", r.region AS "runRegion", r.language AS "runLanguage",
      r.requested_network_mode AS "runNetwork", p.id AS "promptSetId", p.content AS "promptContent",
      p.entity_version AS "promptEntityVersion",
      pin.protocol_id AS "protocolId", pin.version AS "protocolVersion", sp.target_region AS "protocolRegion",
      sp.timezone AS "protocolTimezone", sp.search_required AS "searchRequired", sp.new_session_required AS "newSessionRequired",
      bv.content AS "brandContent",
      a.id AS "analysisId", a.version AS "analysisVersion", a.entity_version AS "analysisEntityVersion",
      a.rule_version AS "analysisRuleVersion", a.status AS "analysisStatus", a.mentioned, a.recommended,
      a.official_site_cited AS "officialSiteCited"
    FROM answer_observation o
    LEFT JOIN monitoring_slot s ON s.id = o.slot_id AND s.brand_id = o.brand_id
    LEFT JOIN monitoring_run r ON r.id = s.run_id AND r.brand_id = o.brand_id AND r.owner_id = o.owner_id
    LEFT JOIN prompt_set p ON p.brand_id = o.brand_id AND p.id = r.prompt_set_id AND p.version = r.prompt_set_version
    LEFT JOIN run_protocol_pin pin ON pin.run_id = r.id AND pin.brand_id = o.brand_id AND pin.owner_id = o.owner_id
    LEFT JOIN sampling_protocol sp ON sp.protocol_id = pin.protocol_id AND sp.version = pin.version
      AND sp.brand_id = o.brand_id AND sp.owner_id = o.owner_id AND sp.status = 'frozen'
    LEFT JOIN brand_version bv ON bv.brand_id = o.brand_id AND bv.version = o.entity_version
    LEFT JOIN answer_analysis_version a ON a.id = (
      SELECT v.id FROM answer_analysis_version v WHERE v.observation_id = o.id AND v.brand_id = o.brand_id
      ORDER BY v.version DESC LIMIT 1
    )
    WHERE o.owner_id = ? AND o.brand_id = ? AND o.id IN (${ids.map(() => "?").join(", ")})`,
    values: [ownerId, brandId, ...ids],
  };
}

type WindowSide = "before" | "after";
type Scope = { track: Observation["track"]; entityVersion: number; timezone: string };
type SampleReason = "outside_window" | "missing_scope" | "ineligible_scope" | "non_natural_question"
  | "missing_analysis" | "analysis_entity_mismatch" | "no_official_website" | "incomplete_citations" | "unknown_label";
type ExcludedSample = { observation_id: string; query_id: string | null; reason: SampleReason };

const labelFields = {
  mention_rate: "mentioned",
  recommendation_rate: "recommended",
  official_site_citation_rate: "officialSiteCited",
} as const;

function scopeOf(row: Observation) {
  return {
    track: row.track,
    channel_id: row.channelId,
    channel_version: row.channelVersion,
    protocol_id: row.protocolId,
    protocol_version: row.protocolVersion,
    analysis_rule_version: row.analysisRuleVersion,
    entity_version: row.entityVersion,
    target_region: row.targetRegion,
    observed_region: row.observedRegion,
    requested_network_mode: row.requestedNetworkMode,
    network_trigger: row.networkTrigger,
    new_session: row.newSession,
    product_mode: row.productMode,
    language: row.language,
  };
}

function prepareWindow(
  window: GenerateReportInput[WindowSide],
  observations: Map<string, Observation>,
  scope: Scope,
) {
  const selected = new Set(window.samples.map((item) => item.observationId));
  const excluded: ExcludedSample[] = [];
  const prompts = new Map<string, z.infer<typeof draftContent>>();
  const frozenQuestions = new Set<string>();
  const samples = [];
  const start = windowInstant(window.start, scope.timezone);
  const end = windowInstant(window.endExclusive, scope.timezone);
  let unavailable = 0;
  for (const id of selected) {
    const row = observations.get(id);
    if (!row) {
      unavailable++;
      continue;
    }
    let prompt = row.promptSetId ? prompts.get(row.promptSetId) : undefined;
    if (!prompt && row.promptSetId && row.promptContent) {
      prompt = draftContent.parse(JSON.parse(row.promptContent));
      prompts.set(row.promptSetId, prompt);
      for (const question of prompt.questions) {
        if (question.primary && primaryTypes.has(question.type) && question.status === "confirmed") frozenQuestions.add(question.id);
      }
    }
    const question = prompt?.questions.find((item) => item.id === row.questionId);
    const at = Date.parse(row.capturedAt);
    let reason: SampleReason | undefined;
    if (!(at >= start && at < end)) reason = "outside_window";
    else if (!question || !row.channelId || !row.channelVersion || !row.protocolId || !row.protocolVersion
      || !row.protocolTimezone || !row.brandContent) reason = "missing_scope";
    else if (row.naturalQuestion !== 1 || !question.primary || !primaryTypes.has(question.type)
      || question.status !== "confirmed") reason = "non_natural_question";
    else if (row.track !== scope.track || row.runTrack !== row.track || row.entityVersion !== scope.entityVersion
      || row.promptEntityVersion !== row.entityVersion || row.protocolTimezone !== scope.timezone
      || row.protocolRegion !== row.targetRegion || row.runRegion !== row.targetRegion || row.runLanguage !== row.language
      || row.runNetwork !== row.requestedNetworkMode || row.questionText !== question.text
      || question.region !== row.targetRegion || question.language !== row.language
      || (row.observedRegion !== "unknown" && row.observedRegion !== row.targetRegion)
      || (row.searchRequired === 1 && row.networkTrigger !== "triggered")
      || (row.newSessionRequired === 1 && row.newSession !== "true")
      || (row.evidenceState !== "complete" && row.evidenceState !== "contested")) reason = "ineligible_scope";

    if (reason || !question) {
      excluded.push({ observation_id: row.id, query_id: row.questionId, reason: reason ?? "missing_scope" });
      continue;
    }
    const questionVersion = createHash("sha256")
      .update(JSON.stringify([question.text, question.type, question.region, question.language])).digest("hex");
    const hasOfficialWebsite = Boolean(z.object({ website: z.string().nullable().optional() })
      .parse(JSON.parse(row.brandContent ?? "{}")).website?.trim());
    samples.push({ row, question, questionVersion, hasOfficialWebsite });
  }
  return { samples, excluded, unavailable, frozenQuestions };
}

function metricWindow(window: ReturnType<typeof prepareWindow>, metric: SnapshotMetric) {
  const excluded = [...window.excluded];
  const samples = window.samples.flatMap(({ row, question, questionVersion, hasOfficialWebsite }) => {
    const label = row[labelFields[metric]];
    let reason: SampleReason | undefined;
    if (!row.analysisId || !row.analysisRuleVersion || row.analysisStatus === "pending") reason = "missing_analysis";
    else if (row.analysisEntityVersion !== row.entityVersion) reason = "analysis_entity_mismatch";
    else if (metric === "official_site_citation_rate" && !hasOfficialWebsite) reason = "no_official_website";
    else if (metric === "official_site_citation_rate" && row.citationSetState !== "complete") reason = "incomplete_citations";
    else if (label !== "true" && label !== "false") reason = "unknown_label";
    if (reason) excluded.push({ observation_id: row.id, query_id: question.id, reason });
    if (reason === "missing_analysis" || reason === "analysis_entity_mismatch") return [];
    return [{
      observationId: row.id,
      queryId: question.id,
      queryVersion: questionVersion,
      track: row.track,
      channelVersion: String(row.channelVersion),
      protocolVersion: String(row.protocolVersion),
      analysisRuleVersion: row.analysisRuleVersion ?? "",
      region: row.targetRegion,
      entityVersion: row.entityVersion,
      scopeKey: JSON.stringify(scopeOf(row)),
      judgable: !reason,
      numerator: !reason && label === "true" ? 1 : 0,
      denominator: reason ? 0 : 1,
    }];
  });
  return { samples, excluded };
}

export async function loadSnapshotComparisons(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
  windows: Pick<GenerateReportInput, WindowSide>,
  scope: Scope,
) {
  const ids = [...new Set([...windows.before.samples, ...windows.after.samples].map((item) => item.observationId))];
  const query = snapshotObservationsQuery(ownerId, brandId, ids);
  const rows = ids.length ? await queryWithParameters(db, query.sql, query.values) : [];
  const observations = new Map(rows.map((row) => {
    const parsed = observationSchema.parse(row);
    return [parsed.id, parsed];
  }));
  const before = prepareWindow(windows.before, observations, scope);
  const after = prepareWindow(windows.after, observations, scope);
  const frozenCount = new Set([...before.frozenQuestions, ...after.frozenQuestions]).size;

  function compare(metric: SnapshotMetric) {
    const left = metricWindow(before, metric);
    const right = metricWindow(after, metric);
    const result = compareWindows(left.samples, right.samples);
    return {
      result: { ...result, frozenQueryCount: frozenCount, sourceMissing: before.unavailable + after.unavailable > 0 },
      excludedSamples: { before: left.excluded, after: right.excluded },
      unavailable: { before: before.unavailable, after: after.unavailable },
    };
  }

  return {
    comparisons: {
      mention_rate: compare("mention_rate"),
      recommendation_rate: compare("recommendation_rate"),
      official_site_citation_rate: compare("official_site_citation_rate"),
    },
    evidence: Object.fromEntries([...observations].map(([id, row]) => [id, {
      prompt_set_id: row.promptSetId,
      analysis_id: row.analysisId,
      analysis_version: row.analysisVersion,
      scope: scopeOf(row),
    }])),
  };
}

export type SnapshotComparisons = Awaited<ReturnType<typeof loadSnapshotComparisons>>;
