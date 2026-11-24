import "server-only";

import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { PromptDao } from "../prompts/dao.ts";
import { clusterForAnswer, type AnswerCluster } from "./answer-list.ts";
import { EvidenceDao } from "./dao.ts";

export type AnswerListRow = {
  answerText: string;
  cluster: AnswerCluster | null;
};

export async function readAnswerListContext(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  observationIds: readonly string[],
) {
  const rows = await new EvidenceDao(db).listAnswerContexts(ownerId, brandId, observationIds);
  const promptIds = [...rows.values()].flatMap((row) => row.promptSetId ? [row.promptSetId] : []);
  const needsLatest = [...rows.values()].some((row) => !row.promptSetId);
  const prompts = new PromptDao(db, brandId);
  const [linked, latest] = await Promise.all([
    promptIds.length ? prompts.clusterSources(promptIds) : Promise.resolve(new Map()),
    needsLatest ? prompts.latestClusterSource() : Promise.resolve(null),
  ]);
  return { rows, linked, latest };
}

export function answerListRows(
  answers: ReadonlyArray<{ observationId: string; questionText: string }>,
  context: Awaited<ReturnType<typeof readAnswerListContext>>,
) {
  const detailed = new Map<string, AnswerListRow>();
  for (const answer of answers) {
    const row = context.rows.get(answer.observationId);
    if (!row) {
      detailed.set(answer.observationId, { answerText: "", cluster: null });
      continue;
    }
    detailed.set(answer.observationId, {
      answerText: row.answerText,
      cluster: clusterForAnswer({
        questionText: answer.questionText,
        questionId: row.questionId,
        promptSetId: row.promptSetId,
      }, context.linked, context.latest),
    });
  }
  return detailed;
}
