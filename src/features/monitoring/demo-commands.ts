import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import {
  type CreateDemoObservationInput,
  type DemoError,
  type DemoObservationList,
  type DemoObservationView,
} from "./demo-contracts.ts";
import { DemoObservationDao, type DemoRecord } from "./demo-dao.ts";

type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

function failed(error: DemoError): { error: DemoError } {
  return { error };
}

function toView(row: {
  id: string;
  brandId: string;
  questionText: string;
  answerText: string;
  createdAt: string;
}): DemoObservationView {
  return {
    id: row.id,
    brandId: row.brandId,
    questionText: row.questionText,
    answerText: row.answerText,
    is_demo: true,
    createdAt: row.createdAt,
  };
}

export async function listDemoBrands(db: QueryConnection, ownerId: string) {
  return new DemoObservationDao(db).activeBrandIds(ownerId);
}

export async function listDemoObservations(
  db: QueryConnection,
  ownerId: string,
  brandId: string,
): Promise<DemoObservationList | { error: DemoError }> {
  const rows = await new DemoObservationDao(db).listForOwner(ownerId, brandId);
  if (rows.length === 0) return failed("NOT_FOUND");
  return {
    is_demo: true,
    observations: rows.flatMap((row) => {
      if (!row.id || row.questionText === null || row.answerText === null || row.isDemo !== 1 || !row.createdAt) {
        return [];
      }
      return [toView({
        id: row.id,
        brandId: row.brandId,
        questionText: row.questionText,
        answerText: row.answerText,
        createdAt: row.createdAt,
      })];
    }),
  };
}

type DemoWriteInput = CreateDemoObservationInput & {
  copyToAnswerObservation?: boolean;
  copyToRetest?: boolean;
  copyToReport?: boolean;
};

export async function recordDemoObservation(
  db: DatabaseConnection,
  ownerId: string,
  input: DemoWriteInput,
  clock: Clock = systemClock,
): Promise<{ observation: DemoObservationView } | { error: DemoError }> {
  // Refused before any write, including answer_observation, retest, and report snapshots.
  if (input.copyToAnswerObservation === true || input.copyToRetest === true || input.copyToReport === true) {
    return failed("COPY_REJECTED");
  }
  return db.transaction(async (tx) => {
    const brands = new BrandDao(tx);
    if (!await brands.lockOwner(ownerId)) return failed("NOT_FOUND");
    const owned = await brands.owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return failed("NOT_FOUND");
    const dao = new DemoObservationDao(tx);
    const existing = await dao.byOperation(ownerId, input.operationId);
    if (existing) {
      const same = sameDemo(existing, input);
      if (!same) return failed("OPERATION_CONFLICT");
      return { observation: toView(existing) };
    }
    const id = randomUUID();
    await dao.insert({
      id,
      brandId: input.brandId,
      ownerId,
      questionText: input.questionText,
      answerText: input.answerText,
      isDemo: 1,
      operationId: input.operationId,
      createdAt: clock(),
    });
    const stored = await dao.rowForOwner(ownerId, id);
    if (!stored || !sameDemo(stored, input)) throw new Error("demo-observation-missing");
    return { observation: toView(stored) };
  });
}

function sameDemo(row: DemoRecord, input: CreateDemoObservationInput) {
  return row.brandId === input.brandId
    && row.questionText === input.questionText
    && row.answerText === input.answerText
    && row.isDemo === 1;
}
