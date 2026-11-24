import "server-only";

import { createHash } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { listPrioritizedTasks } from "../optimization/commands.ts";
import { functionalMockMarker } from "../functional-mock/mode.ts";
import { PromptDao } from "../prompts/dao.ts";
import { questionType } from "../prompts/contracts.ts";
import { SamplingPlanDao } from "../sampling-plans/dao.ts";
import type { EvidenceError } from "./contracts.ts";
import { EvidenceDao } from "./dao.ts";
import {
  aggregateOverviewMetrics,
  capabilityIsExpired,
  latestCompleteCapture,
  ownedPageJudgement,
  summarizeCoverage,
  type CoverageAnswer,
  type CoveragePlanSlot,
  type OverviewSample,
  type QuestionType,
} from "./metrics.ts";
import {
  overviewCacheIdentity,
  overviewPayloadSchema,
  readOverviewCache,
  storeOverviewCache,
  type OverviewPayload,
} from "./overview-cache.ts";
import { overviewScopePath, type OverviewScope } from "./overview-contracts.ts";

type Failure = { error: EvidenceError };

function denied(error: EvidenceError): Failure {
  return { error };
}

function questionKeyOf(questionId: string | null, questionText: string) {
  if (questionId) return questionId;
  return createHash("sha256").update(questionText.trim(), "utf8").digest("hex").slice(0, 32);
}

function parseQuestionType(value: unknown): QuestionType {
  const parsed = questionType.safeParse(value);
  return parsed.success ? parsed.data : "unknown";
}

export async function readEvidenceOverview(
  db: DatabaseConnection,
  ownerId: string,
  scope: OverviewScope,
  cache: CacheStore = openCache(),
  now: () => string = () => new Date().toISOString(),
): Promise<OverviewPayload | Failure> {
  const dao = new EvidenceDao(db);
  const context = await dao.overviewReadContext(ownerId, scope.brandId);
  if (!context) return denied("NOT_FOUND");

  const brandName = context.name;
  const hasOfficialWebsite = scope.hasOfficialWebsite ?? context.hasOfficialWebsite;
  const identity = overviewCacheIdentity({
    ownerId,
    brandId: scope.brandId,
    scope,
    hasOfficialWebsite,
    token: context.token,
  });
  const cached = await readOverviewCache(cache, identity, {
    brandId: scope.brandId,
    sourceMode: scope.sourceMode,
    hasOfficialWebsite,
  });
  if (cached) return cached;

  const rows = await dao.listScopedObservations({
    ownerId,
    brandId: scope.brandId,
    sourceMode: scope.sourceMode,
    region: scope.region,
    requestedNetworkMode: scope.requestedNetworkMode,
    from: scope.from,
    to: scope.to,
  });

  const slotIds = rows.flatMap((row) => row.questionId && row.observation.slotId ? [row.observation.slotId] : []);
  const observationIds = rows.map((row) => row.observation.id);
  const plans = new SamplingPlanDao(db);
  const [refs, ownership, planRows, links] = await Promise.all([
    slotIds.length ? dao.adoptedPromptRefs(ownerId, scope.brandId, slotIds) : new Map(),
    observationIds.length ? dao.citationOwnership(scope.brandId, observationIds) : new Map<string, string[]>(),
    plans.plansForBrand(scope.brandId, ownerId),
    dao.overviewPlanLinks(ownerId, scope.brandId),
  ]);
  const latestPlan = new Map<string, { version: number; phase: string }>();
  for (const plan of planRows) {
    const current = latestPlan.get(plan.id);
    if (!current || plan.version > current.version) latestPlan.set(plan.id, { version: plan.version, phase: plan.phase });
  }
  const planIds = [...latestPlan.entries()].filter(([, plan]) => plan.phase !== "draft").map(([id]) => id);
  const planSlots = planIds.length ? await plans.slotsForPlans(ownerId, planIds) : [];
  const channelIds = [...new Set([
    ...planSlots.map((slot) => slot.channelId),
    ...rows.flatMap((row) => row.channelId ? [row.channelId] : []),
  ])];
  const [channelKinds, expiries] = await Promise.all([
    dao.channelKinds(channelIds),
    dao.capabilityExpiries(channelIds),
  ]);
  const linksByRun = new Map<string, (typeof links)[number]>();
  const linksBySlot = new Map<string, (typeof links)[number][]>();
  for (const link of links) {
    if (link.runId && !linksByRun.has(link.runId)) linksByRun.set(link.runId, link);
    const list = linksBySlot.get(link.planSlotId) ?? [];
    list.push(link);
    linksBySlot.set(link.planSlotId, list);
  }
  const promptIds = [...new Set([...refs.values()].map((item) => item.promptSetId))];
  const promptTypes = promptIds.length
    ? await new PromptDao(db, scope.brandId).questionTypes(promptIds)
    : new Map<string, Map<string, QuestionType>>();
  const typeByQuestionId = new Map<string, QuestionType>();
  const samples: OverviewSample[] = [];
  const coverageAnswers: CoverageAnswer[] = [];
  const captured: Array<{ capturedAt: string; evidenceState: string }> = [];

  for (const row of rows) {
    if (row.observation.answerText.includes(functionalMockMarker)) continue;
    if (row.naturalQuestion === 0) continue;
    let type: QuestionType = "unknown";
    if (row.questionId && row.observation.slotId) {
      const cachedType = typeByQuestionId.get(row.questionId);
      if (cachedType) {
        type = cachedType;
      } else {
        const ref = refs.get(row.observation.slotId);
        const found = ref ? promptTypes.get(ref.promptSetId)?.get(row.questionId) : undefined;
        if (found) {
          type = parseQuestionType(found);
          typeByQuestionId.set(row.questionId, type);
        }
      }
    }

    if (type === "exploration") continue;
    if (type === "unknown") type = "discovery";

    const link = row.runId ? linksByRun.get(row.runId) : undefined;
    const ownedPageCited = ownedPageJudgement(
      row.observation.citationSetState,
      ownership.get(row.observation.id) ?? [],
    );
    captured.push({ capturedAt: row.observation.capturedAt, evidenceState: row.observation.evidenceState });
    coverageAnswers.push({
      planSlotId: link?.planSlotId ?? null,
      evidenceState: row.observation.evidenceState,
      citationSetState: row.observation.citationSetState,
      requestedNetworkMode: row.observation.requestedNetworkMode,
      networkTrigger: row.observation.networkTrigger,
      newSession: row.observation.newSession,
      searchRequired: link?.searchRequired ?? false,
      newSessionRequired: link?.newSessionRequired ?? false,
    });
    samples.push({
      observationId: row.observation.id,
      questionKey: questionKeyOf(row.questionId, row.observation.questionText),
      questionText: row.observation.questionText,
      questionType: type,
      sourceMode: row.observation.sourceMode,
      region: row.observation.targetRegion,
      requestedNetworkMode: row.observation.requestedNetworkMode,
      capturedAt: row.observation.capturedAt,
      evidenceState: row.observation.evidenceState,
      citationSetState: row.observation.citationSetState,
      mentioned: row.mentioned ?? "unknown",
      recommended: row.recommended ?? "unknown",
      officialSiteCited: row.officialSiteCited ?? "unknown",
      ownedPageCited,
      hasOfficialWebsite,
    });
  }

  const coverageSlots: CoveragePlanSlot[] = [];
  const watchedChannels: string[] = [];
  for (const slot of planSlots) {
    const kind = channelKinds.get(slot.channelId);
    if (kind !== "model_api" && kind !== "consumer_ui") continue;
    if (kind === scope.sourceMode) watchedChannels.push(slot.channelId);
    const related = linksBySlot.get(slot.id) ?? [];
    coverageSlots.push({
      id: slot.id,
      at: slot.at,
      status: slot.status,
      sourceMode: kind,
      regions: related.flatMap((item) => item.region ? [item.region] : []),
      networks: related.flatMap((item) => item.requestedNetworkMode ? [item.requestedNetworkMode] : []),
    });
  }
  for (const row of rows) {
    if (row.channelId) watchedChannels.push(row.channelId);
  }
  const capturedNow = now();
  const coverage = summarizeCoverage({
    slots: coverageSlots,
    answers: coverageAnswers,
    scope: {
      sourceMode: scope.sourceMode,
      region: scope.region,
      requestedNetworkMode: scope.requestedNetworkMode,
      from: scope.from,
      to: scope.to,
    },
    now: capturedNow,
  });
  const collection = {
    lastCapturedAt: latestCompleteCapture(captured),
    capabilityExpired: capabilityIsExpired(
      [...new Set(watchedChannels)].map((channelId) => expiries.get(channelId) ?? null),
      capturedNow,
    ),
  };
  const metrics = aggregateOverviewMetrics(samples);
  const answers = samples
    .filter((item) => item.evidenceState === "complete" || item.evidenceState === "contested")
    .map((item) => ({
      observationId: item.observationId,
      questionKey: item.questionKey,
      questionText: item.questionText,
      sourceMode: item.sourceMode,
      region: item.region,
      requestedNetworkMode: item.requestedNetworkMode,
      capturedAt: item.capturedAt,
      mentioned: item.mentioned,
      recommended: item.recommended,
      officialSiteCited: item.officialSiteCited,
    }));

  const answerHref = overviewScopePath("/dashboard/monitoring/answers", scope);
  const tasksHref = `/dashboard/optimization?brandId=${scope.brandId}`;
  const nextActions: Array<{ id: string; kind: "start_monitoring" | "view_answers" | "view_tasks"; href: string }> = [];
  if (metrics.viewStatus === "empty") {
    nextActions.push({ id: "start", kind: "start_monitoring", href: "/dashboard/monitoring/new" });
  }
  nextActions.push({ id: "answers", kind: "view_answers", href: answerHref });

  const prioritized = await listPrioritizedTasks(db, ownerId, scope.brandId, 1_000);
  const openTasks = "error" in prioritized ? [] : prioritized.tasks;
  const toLink = (task: (typeof openTasks)[number]) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priorityBucket: task.priorityBucket,
    href: `/dashboard/optimization/${task.id}`,
  });
  const suggestions = openTasks.slice(0, 3).map(toLink);
  const activeTasks = openTasks
    .filter((task) => task.status === "doing" || task.status === "blocked")
    .map(toLink);
  if (suggestions.length > 0 || activeTasks.length > 0) {
    nextActions.push({ id: "tasks", kind: "view_tasks", href: tasksHref });
  }

  const payload = overviewPayloadSchema.parse({
    scope: {
      brandId: scope.brandId,
      brandName,
      sourceMode: scope.sourceMode,
      region: scope.region ?? null,
      requestedNetworkMode: scope.requestedNetworkMode ?? null,
      from: scope.from ?? null,
      to: scope.to ?? null,
      hasOfficialWebsite,
    },
    ...metrics,
    coverage,
    collection,
    answers,
    suggestions,
    activeTasks,
    nextActions: nextActions.slice(0, 3),
    demo: false,
  });
  await storeOverviewCache(cache, identity, ownerId, scope.brandId, payload);
  return payload;
}
