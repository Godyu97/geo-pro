import "server-only";

import { randomUUID } from "node:crypto";
import { getConnection } from "@/lib/db/connection";
import { BrandDao } from "../brands/dao";
import { readUserCapabilities } from "../capabilities/service";
import { PromptDao } from "../prompts/dao";
import { QuotaDao } from "../quotas/dao";
import { grantState } from "../quotas/ledger";
import { MonitoringDao } from "./dao";

export async function readRegistration(ownerId: string) {
  try {
    const connection = getConnection();
    const brand = await new BrandDao(connection).active(ownerId);
    if (!brand) return { brand: null, sets: [], channels: [], grant: null, recent: [] };
    const [versions, capabilities, summary, recent] = await Promise.all([
      new PromptDao(connection, brand.id).versions(),
      readUserCapabilities(),
      new QuotaDao(connection).ownerSummary(ownerId),
      new MonitoringDao(connection).recent(brand.id, 10),
    ]);
    const sampling = summary.find((item) => item.kind === "sampling");
    const time = new Date().toISOString();
    return {
      brand: { id: brand.id, name: brand.name },
      sets: versions.map((item) => ({
        id: item.id,
        version: item.version,
        region: item.region,
        language: item.language,
        questionCount: item.content.questions.filter((question) => question.status === "confirmed").length,
        naturalCount: item.content.questions.filter((question) => question.status === "confirmed" && question.primary).length,
      })),
      channels: (capabilities.items ?? []).map((item) => ({
        channelId: item.channelId,
        kind: item.kind,
        displayName: item.displayName,
        eligibility: item.eligibility,
        version: item.version,
      })),
      grant: sampling?.grant && grantState(sampling.grant, time) === "active" ? {
        version: sampling.grant.version,
        currency: sampling.grant.currency,
        countLimit: sampling.grant.countLimit,
        budgetMinor: sampling.grant.budgetMinor,
        reserved: sampling.ledger.reserved,
        committedMinor: sampling.ledger.committedMinor,
      } : null,
      recent: recent.map((item) => ({
        id: item.id,
        track: item.track,
        questionCount: item.questionCount,
        naturalCount: item.naturalCount,
        channelCount: item.channelCount,
        repeatCount: item.repeatCount,
        slotCount: item.slotCount,
        createdAt: item.createdAt,
      })),
      traceId: capabilities.items ? null : capabilities.traceId,
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-registration-unavailable", { traceId });
    return { traceId };
  }
}

export async function readOwnedRun(ownerId: string, runId: string) {
  try {
    const connection = getConnection();
    const dao = new MonitoringDao(connection);
    const run = await dao.runForOwner(ownerId, runId);
    if (!run) return null;
    const [slots, prompt] = await Promise.all([
      dao.slots([run.id]),
      new PromptDao(connection, run.brandId).version(run.promptSetId),
    ]);
    const text = new Map((prompt?.content.questions ?? []).map((question) => [question.id, question.text]));
    return {
      ...run,
      slots: slots.map((slot) => ({ ...slot, questionText: text.get(slot.questionId) ?? slot.questionId })),
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-run-read-unavailable", { traceId });
    return { traceId };
  }
}
