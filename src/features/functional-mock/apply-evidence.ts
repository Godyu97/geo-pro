import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { EvidenceDao } from "../evidence/dao.ts";
import { ingestAdoptedObservation, submitManualEvidence } from "../evidence/commands.ts";
import { MonitoringDao } from "../monitoring/dao.ts";
import { functionalMockMarker } from "./mode.ts";

function mockUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Copies labeled mock answers into the existing evidence contract. Nothing here is a live capture. */
export async function applyMockEvidence(db: DatabaseConnection, ownerId: string, brandId: string) {
  const brand = await new BrandDao(db).version(ownerId, brandId);
  if (!brand || brand.status !== "active") return { ok: false as const, error: "not-found" };
  const monitoring = new MonitoringDao(db);
  const evidence = new EvidenceDao(db);
  const runs = await monitoring.recent(brandId, 10);
  let ingested = 0;
  for (const run of runs) {
    const [slots, attempts] = await Promise.all([monitoring.slots([run.id]), monitoring.attempts([run.id])]);
    const attemptById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
    for (const slot of slots) {
      const adopted = slot.adoptedAttemptId ? attemptById.get(slot.adoptedAttemptId) : undefined;
      if (!adopted?.rawText?.includes(functionalMockMarker)) continue;
      if (await evidence.observationBySlot(ownerId, brandId, slot.id)) continue;
      const saved = await ingestAdoptedObservation(db, ownerId, {
        action: "ingest-adopted",
        brandId,
        slotId: slot.id,
        operationId: mockUuid(`functional-mock:ingest:${slot.id}`),
        brandName: brand.fields.name,
        aliases: brand.fields.aliases,
        officialWebsite: brand.fields.website || null,
      });
      if ("error" in saved && saved.error !== "EVIDENCE_INCOMPLETE") return { ok: false as const, error: saved.error };
      ingested += 1;
    }
  }

  const manual = await submitManualEvidence(db, ownerId, {
    action: "submit-manual",
    brandId,
    operationId: mockUuid(`functional-mock:manual:${brandId}`),
    questionText: `${functionalMockMarker} 合成消费者问题：通勤时适合准备哪种无糖袋泡茶`,
    answerText: `${functionalMockMarker} 合成消费者存证。没有真实走查，也没有真实截图。`,
    region: "CN",
    language: "zh-CN",
    requestedNetworkMode: "unknown",
    entityVersion: brand.entityVersion,
    citationSetState: "partial",
    citations: [{
      rawUrl: "https://functional-mock.example.com/capture",
      citationOrigin: "consumer_visible",
      positionLabel: functionalMockMarker,
      ownership: "unknown",
      pageStatus: "unknown",
    }],
    locatorRef: "functional-mock://consumer-capture/1",
    collectorId: "functional-mock-collector",
    contested: false,
    brandName: brand.fields.name,
    aliases: brand.fields.aliases,
    officialWebsite: brand.fields.website || null,
    evidenceSpan: `${functionalMockMarker} 合成存证`,
  });
  if ("error" in manual && manual.error !== "EVIDENCE_INCOMPLETE") return { ok: false as const, error: manual.error };
  return { ok: true as const, ingested, manual: true as const };
}
