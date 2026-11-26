import "server-only";

import { createHash } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { listPrioritizedTasks } from "../optimization/commands.ts";
import { SamplingPlanDao } from "../sampling-plans/dao.ts";
import { clusterForAnswer, type AnswerCluster } from "./answer-list.ts";
import { readAnswerClusterSources } from "./answer-list-context.ts";
import type { EvidenceError } from "./contracts.ts";
import { EvidenceDao } from "./dao.ts";
import {
  aggregateOverviewMetrics,
  answerQuality,
  capabilityIsExpired,
  latestCompleteCapture,
  ownedPageJudgement,
  summarizeCoverage,
  summarizeQuestionClusters,
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
import { officialChannelKey, overviewScopePath, unknownOfficialChannel, type OverviewScope } from "./overview-contracts.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";

type Failure = { error: EvidenceError };

function denied(error: EvidenceError): Failure {
  return { error };
}

function questionKeyOf(questionId: string | null, questionText: string) {
  if (questionId) return questionId;
  return createHash("sha256").update(questionText.trim(), "utf8").digest("hex").slice(0, 32);
}

type PlanLink = Awaited<ReturnType<EvidenceDao["overviewPlanLinks"]>>[number];

function planChannel(channelId: string, links: readonly PlanLink[]) {
  const keys = new Set(links
    .filter((link) => link.runId && link.channelId === channelId)
    .map((link) => officialChannelKey(link.channelId, link.channelVersion)));
  return keys.size === 1 ? [...keys][0] : unknownOfficialChannel;
}

function linkInScope(link: PlanLink, scope: OverviewScope) {
  return (!scope.region || scope.region === link.region)
    && (!scope.requestedNetworkMode || scope.requestedNetworkMode === link.requestedNetworkMode);
}

export async function readEvidenceOverview(
  db: DatabaseConnection,
  ownerId: string,
  scope: OverviewScope,
  cache: CacheStore = openCache(),
  now: () => string = () => new Date().toISOString(),
): Promise<OverviewPayload | Failure> {
  const adopted = await authorizeBrandActor(db, ownerId, scope.brandId, "read", now());
  if (!adopted) return denied("NOT_FOUND");
  ownerId = adopted.ownerId;
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
    channel: scope.channel,
    hasOfficialWebsite,
  });
  if (cached) return cached;

  const observationScope = { ...scope, ownerId };
  const plans = new SamplingPlanDao(db);
  const [scopedRows, optionRows, planRows, links] = await Promise.all([
    dao.listScopedObservations(observationScope),
    scope.channel ? dao.listScopedOfficialChannels(observationScope) : null,
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
  const linksByRunChannel = new Map<string, PlanLink>();
  const linksBySlot = new Map<string, PlanLink[]>();
  for (const link of links) {
    if (link.runId) {
      const key = `${link.runId}:${link.channelId}`;
      if (!linksByRunChannel.has(key)) linksByRunChannel.set(key, link);
    }
    const list = linksBySlot.get(link.planSlotId) ?? [];
    list.push(link);
    linksBySlot.set(link.planSlotId, list);
  }
  const channelKeys = new Set<string>();
  const availableRows = optionRows ?? scopedRows;
  const planChannelIds = [...new Set(planSlots.map((slot) => slot.channelId))];
  const channelIds = [...new Set([
    ...planChannelIds,
    ...availableRows.flatMap((row) => row.channelId ? [row.channelId] : []),
  ])];
  if (scope.sourceMode === "model_api") {
    for (const row of availableRows) channelKeys.add(officialChannelKey(row.channelId, row.channelVersion));
    for (const slot of planSlots) {
      if ((scope.from && slot.at < scope.from) || (scope.to && slot.at > scope.to)) continue;
      const related = (linksBySlot.get(slot.id) ?? []).filter((link) => link.channelId === slot.channelId);
      const key = planChannel(slot.channelId, related);
      if (key !== unknownOfficialChannel && related.some((link) => linkInScope(link, scope))) channelKeys.add(key);
    }
  }
  const channelSelectionRequired = !scope.channel && channelKeys.size > 1;
  const rows = channelSelectionRequired ? [] : scopedRows;
  const slotIds = rows.flatMap((row) => row.questionId && row.observation.slotId ? [row.observation.slotId] : []);
  const observationIds = rows.map((row) => row.observation.id);
  const [refs, ownership, channelKinds, capabilities] = await Promise.all([
    slotIds.length ? dao.adoptedPromptRefs(ownerId, scope.brandId, slotIds) : new Map(),
    observationIds.length ? dao.citationOwnership(scope.brandId, observationIds) : new Map<string, string[]>(),
    dao.channelKinds(planChannelIds),
    dao.overviewCapabilities(channelIds),
  ]);
  const sources = await readAnswerClusterSources(db, scope.brandId, [
    ...rows.map((row) => row.promptSetId),
    ...Array.from(refs.values(), (ref) => ref.promptSetId),
  ]);
  const typeByQuestionId = new Map<string, QuestionType>();
  const samples: OverviewSample[] = [];
  const coverageAnswers: CoverageAnswer[] = [];
  const captured: Array<{ capturedAt: string; evidenceState: string }> = [];

  for (const row of rows) {
    if (row.naturalQuestion === 0) continue;
    let type: QuestionType = "unknown";
    if (row.questionId && row.observation.slotId) {
      const cachedType = typeByQuestionId.get(row.questionId);
      if (cachedType) {
        type = cachedType;
      } else {
        const ref = refs.get(row.observation.slotId);
        const found = ref
          ? sources.linked.get(ref.promptSetId)?.questions.find((item) => item.id === row.questionId)?.type
          : undefined;
        if (found) {
          type = found;
          typeByQuestionId.set(row.questionId, type);
        }
      }
    }

    if (type === "exploration") continue;
    if (type === "unknown") type = "discovery";

    const link = row.runId && row.channelId ? linksByRunChannel.get(`${row.runId}:${row.channelId}`) : undefined;
    const frozenOfficial = scope.sourceMode === "model_api" && row.channelVersion !== null;
    const ownedPageCited = ownedPageJudgement(
      row.observation.citationSetState,
      ownership.get(row.observation.id) ?? [],
    );
    captured.push({ capturedAt: row.observation.capturedAt, evidenceState: row.observation.evidenceState });
    const coverageAnswer: CoverageAnswer = {
      planSlotId: link?.planSlotId ?? null,
      evidenceState: row.observation.evidenceState,
      citationSetState: row.observation.citationSetState,
      requestedNetworkMode: row.observation.requestedNetworkMode,
      networkTrigger: row.observation.networkTrigger,
      newSession: row.observation.newSession,
      searchRequired: (frozenOfficial || Boolean(link)) && row.searchRequired,
      newSessionRequired: (frozenOfficial || Boolean(link)) && row.newSessionRequired,
      frozenOfficial,
    };
    coverageAnswers.push(coverageAnswer);
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
      protocolQualified: frozenOfficial ? answerQuality(coverageAnswer).qualified : undefined,
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
  for (const slot of channelSelectionRequired ? [] : planSlots) {
    const kind = channelKinds.get(slot.channelId);
    if (kind !== "model_api" && kind !== "consumer_ui") continue;
    const allLinks = linksBySlot.get(slot.id) ?? [];
    if (scope.channel && planChannel(slot.channelId, allLinks) !== scope.channel) continue;
    const related = scope.channel
      ? allLinks.filter((link) => link.channelId === slot.channelId && linkInScope(link, scope))
      : allLinks;
    if (kind === scope.sourceMode) watchedChannels.push(slot.channelId);
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
  if (channelSelectionRequired) coverage.reason = "channel-selection-required";
  const watchedVersion = scope.channel ?? (channelKeys.size === 1 ? [...channelKeys][0] : undefined);
  const collection = {
    lastCapturedAt: latestCompleteCapture(captured),
    capabilityExpired: capabilityIsExpired(
      watchedVersion
        ? [capabilities.get(watchedVersion)?.expiresAt ?? null]
        : [...new Set(watchedChannels)].map((channelId) => capabilities.get(channelId)?.expiresAt ?? null),
      capturedNow,
    ),
  };
  const metrics = aggregateOverviewMetrics(samples, hasOfficialWebsite);
  const primaryIds = new Set(metrics.sampleIds);
  const clusters = new Map<string, AnswerCluster | null>();
  for (const row of rows) {
    if (!primaryIds.has(row.observation.id)) continue;
    clusters.set(row.observation.id, clusterForAnswer({
      questionText: row.observation.questionText,
      questionId: row.promptSetId ? row.questionId : null,
      promptSetId: row.promptSetId,
    }, sources.linked, sources.latest));
  }
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
  if (metrics.viewStatus === "empty" && !channelSelectionRequired && answers.length === 0) {
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
      channel: scope.channel ?? null,
      region: scope.region ?? null,
      requestedNetworkMode: scope.requestedNetworkMode ?? null,
      from: scope.from ?? null,
      to: scope.to ?? null,
      hasOfficialWebsite,
    },
    ...metrics,
    channelSelectionRequired,
    channelOptions: [...channelKeys].sort().map((value) => ({
      value,
      displayName: capabilities.get(value)?.displayName ?? null,
    })),
    questionClusters: summarizeQuestionClusters(metrics.metrics, clusters),
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
