import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { localObservation } from "./rules.ts";
import type { LocalObservationList, LocalObservationView, RegisterLocalObservationInput } from "./contracts.ts";
import { unknownSampledPlace } from "./contracts.ts";
import { LocalObservationDao, type LocalObservationRecord } from "./dao.ts";

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

function toView(row: LocalObservationRecord): LocalObservationView {
  const facts = localObservation({ targetCity: row.targetCity, sampledCity: row.sampledCity });
  if (facts.ranked || facts.claimedLocalUsers || facts.targetCity !== row.targetCity || facts.sampledCity !== row.sampledCity) {
    throw new Error("local-observation-ranked");
  }
  return {
    id: row.id,
    brandId: row.brandId,
    targetCity: facts.targetCity,
    sampledCity: facts.sampledCity,
    actualStatus: facts.sampledCity === null ? unknownSampledPlace : "sampled",
    ranked: facts.ranked,
    claimedLocalUsers: facts.claimedLocalUsers,
    recordedAt: row.recordedAt,
  };
}

export async function listLocalObservations(db: DatabaseConnection, ownerId: string): Promise<LocalObservationList> {
  return db.transaction(async (tx) => {
    const dao = new LocalObservationDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const observations = await dao.observationsForOwner(ownerId);
    return { brands, observations: observations.map(toView) };
  });
}

export async function readLocalObservation(db: DatabaseConnection, ownerId: string, observationId: string) {
  return db.transaction(async (tx) => {
    const dao = new LocalObservationDao(tx);
    const [row] = await dao.observationsByIds(ownerId, [observationId]);
    if (!row) return { error: "NOT_FOUND" as const };
    return { observation: toView(row) };
  });
}

export async function registerLocalObservation(
  db: DatabaseConnection,
  ownerId: string,
  input: RegisterLocalObservationInput,
  clock: Clock = systemClock,
): Promise<{ observation: LocalObservationView } | { error: "NOT_FOUND" }> {
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, input.brandId);
    if (!owned || owned.status !== "active") return { error: "NOT_FOUND" as const };
    const facts = localObservation({
      targetCity: input.targetCity,
      sampledCity: input.sampledCity ?? null,
    });
    if (facts.ranked || facts.claimedLocalUsers) throw new Error("local-observation-ranked");
    const id = randomUUID();
    const recordedAt = clock();
    const dao = new LocalObservationDao(tx);
    await dao.insertObservations([{
      id,
      brandId: input.brandId,
      ownerId,
      targetCity: facts.targetCity,
      sampledCity: facts.sampledCity,
      ranked: 0,
      claimedLocalUsers: 0,
      recordedAt,
    }]);
    const [stored] = await dao.observationsByIds(ownerId, [id]);
    if (!stored) throw new Error("local-observation-missing");
    return { observation: toView(stored) };
  });
}
