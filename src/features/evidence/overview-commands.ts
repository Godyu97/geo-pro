import "server-only";

import { createHash } from "node:crypto";
import type { CacheStore } from "../../lib/cache/store.ts";
import { openCache } from "../../lib/cache/store.ts";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { listPrioritizedTasks } from "../optimization/commands.ts";
import { PromptDao } from "../prompts/dao.ts";
import { questionType } from "../prompts/contracts.ts";
import type { EvidenceError } from "./contracts.ts";
import { EvidenceDao } from "./dao.ts";
import {
  aggregateOverviewMetrics,
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
import type { OverviewScope } from "./overview-contracts.ts";

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
  const refs = slotIds.length ? await dao.adoptedPromptRefs(ownerId, scope.brandId, slotIds) : new Map();
  const promptIds = [...new Set([...refs.values()].map((item) => item.promptSetId))];
  const promptTypes = promptIds.length
    ? await new PromptDao(db, scope.brandId).questionTypes(promptIds)
    : new Map<string, Map<string, QuestionType>>();
  const typeByQuestionId = new Map<string, QuestionType>();
  const samples: OverviewSample[] = [];

  for (const row of rows) {
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

    if (type === "unknown") type = "discovery";

    samples.push({
      observationId: row.observation.id,
      questionKey: questionKeyOf(row.questionId, row.observation.questionText),
      questionText: row.observation.questionText,
      questionType: type,
      sourceMode: row.observation.sourceMode,
      region: row.observation.region,
      requestedNetworkMode: row.observation.requestedNetworkMode,
      capturedAt: row.observation.capturedAt,
      evidenceState: row.observation.evidenceState,
      citationSetState: row.observation.citationSetState,
      mentioned: row.mentioned ?? "unknown",
      recommended: row.recommended ?? "unknown",
      officialSiteCited: row.officialSiteCited ?? "unknown",
      hasOfficialWebsite,
    });
  }

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

  const answerHref = `/dashboard/monitoring/answers?brandId=${scope.brandId}&sourceMode=${scope.sourceMode}`;
  const tasksHref = `/dashboard/optimization?brandId=${scope.brandId}`;
  const nextActions: Array<{ id: string; kind: "start_monitoring" | "view_answers" | "view_tasks"; href: string }> = [];
  if (metrics.viewStatus === "empty") {
    nextActions.push({ id: "start", kind: "start_monitoring", href: "/dashboard/monitoring/new" });
  }
  nextActions.push({ id: "answers", kind: "view_answers", href: answerHref });

  const prioritized = await listPrioritizedTasks(db, ownerId, scope.brandId, 3);
  const suggestions = "error" in prioritized
    ? []
    : prioritized.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priorityBucket: task.priorityBucket,
      href: `/dashboard/optimization/${task.id}`,
    }));
  if (suggestions.length > 0) {
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
    answers,
    suggestions,
    nextActions: nextActions.slice(0, 3),
    demo: false,
  });
  await storeOverviewCache(cache, identity, ownerId, scope.brandId, payload);
  return payload;
}
