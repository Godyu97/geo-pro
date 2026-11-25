import "server-only";

import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { PromptDao } from "../prompts/dao.ts";
import { clusterForAnswer, type AnswerCluster } from "./answer-list.ts";
import { EvidenceDao } from "./dao.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";

export type AnswerListRow = {
  answerText: string;
  cluster: AnswerCluster | null;
};

export async function readAnswerClusterSources(
  db: DatabaseConnection,
  brandId: string,
  promptSetIds: Iterable<string | null>,
) {
  const promptIds: string[] = [];
  let needsLatest = false;
  for (const id of promptSetIds) {
    if (id) promptIds.push(id);
    else needsLatest = true;
  }
  const prompts = new PromptDao(db, brandId);
  const [linked, latest] = await Promise.all([
    prompts.clusterSources(promptIds),
    needsLatest ? prompts.latestClusterSource() : null,
  ]);
  return { linked, latest };
}

export async function readAnswerListContext(
  db: DatabaseConnection,
  ownerId: string,
  brandId: string,
  observationIds: readonly string[],
) {
  const adopted = await authorizeBrandActor(db, ownerId, brandId, "read");
  if (!adopted) return { rows: new Map(), linked: new Map(), latest: null };
  ownerId = adopted.ownerId;
  const rows = await new EvidenceDao(db).listAnswerContexts(ownerId, brandId, observationIds);
  const sources = await readAnswerClusterSources(db, brandId, Array.from(rows.values(), (row) => row.promptSetId));
  return { rows, ...sources };
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
