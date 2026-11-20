import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { queryWithParameters } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { PromptDao } from "../prompts/dao.ts";
import { questionType } from "../prompts/contracts.ts";
import { listPrioritizedTasks } from "../optimization/commands.ts";
import type { EvidenceError } from "./contracts.ts";
import { EvidenceDao } from "./dao.ts";
import {
  aggregateOverviewMetrics,
  type OverviewSample,
  type QuestionType,
} from "./metrics.ts";
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

async function brandDisplay(db: DatabaseConnection, ownerId: string, brandId: string) {
  const [row] = await queryWithParameters(
    db,
    `SELECT v.name, v.content
     FROM brand b
     JOIN brand_version v ON v.brand_id = b.id AND v.version = b.entity_version
     WHERE b.owner_id = ? AND b.id = ? AND b.frozen_at IS NULL`,
    [ownerId, brandId],
  );
  if (!row) return null;
  const parsed = z.object({ name: z.string(), content: z.string() }).parse(row);
  let hasOfficialWebsite = false;
  try {
    const raw = JSON.parse(parsed.content) as { website?: unknown };
    hasOfficialWebsite = typeof raw.website === "string" && raw.website.trim().length > 0;
  } catch {
    hasOfficialWebsite = false;
  }
  return { name: parsed.name, hasOfficialWebsite };
}

export async function readEvidenceOverview(
  db: DatabaseConnection,
  ownerId: string,
  scope: OverviewScope,
) {
  const brands = new BrandDao(db);
  const brand = await brands.owned(ownerId, scope.brandId);
  if (!brand) return denied("NOT_FOUND");

  const display = await brandDisplay(db, ownerId, scope.brandId);
  const brandName = display?.name ?? scope.brandId;
  const hasOfficialWebsite = scope.hasOfficialWebsite ?? display?.hasOfficialWebsite ?? false;

  const dao = new EvidenceDao(db);
  const rows = await dao.listScopedObservations({
    ownerId,
    brandId: scope.brandId,
    sourceMode: scope.sourceMode,
    region: scope.region,
    requestedNetworkMode: scope.requestedNetworkMode,
    from: scope.from,
    to: scope.to,
  });

  const typeByQuestionId = new Map<string, QuestionType>();
  const samples: OverviewSample[] = [];

  for (const row of rows) {
    let type: QuestionType = "unknown";
    if (row.questionId && row.observation.slotId) {
      const cached = typeByQuestionId.get(row.questionId);
      if (cached) {
        type = cached;
      } else {
        const adopted = await dao.adoptedAttempt(ownerId, scope.brandId, row.observation.slotId);
        if (adopted) {
          const prompt = await new PromptDao(db, scope.brandId).version(adopted.promptSetId);
          const found = prompt?.content.questions.find((item) => item.id === row.questionId);
          if (found) {
            type = parseQuestionType(found.type);
            typeByQuestionId.set(row.questionId, type);
          }
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

  return {
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
    demo: false as const,
  };
}
