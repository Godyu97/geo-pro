import "server-only";

import { randomUUID } from "node:crypto";
import { getConnection } from "@/lib/db/connection";
import { FactDao } from "../brand-facts/dao";
import { BrandDao } from "../brands/dao";
import { brandIdSchema } from "../brands/contracts";
import { readUserCapabilities } from "../capabilities/service";
import { PromptDao } from "../prompts/dao";
import { QuotaDao } from "../quotas/dao";
import { grantState } from "../quotas/ledger";
import { MonitoringDao } from "./dao";
import { authorizeBrandActor } from "../team-access/brand-scope";
import { SamplingProtocolDao } from "./protocol-dao";
import {
  classifyMonitoringReadiness,
  summarizeFactReadiness,
  summarizePromptSet,
  summarizeSamplingGrant,
} from "./readiness.ts";

export async function readRegistration(ownerId: string, brandId?: string) {
  try {
    const connection = getConnection();
    const brands = new BrandDao(connection);
    const requested = brandId === undefined ? null : brandIdSchema.safeParse(brandId);
    if (requested && !requested.success) return { kind: "not-found" as const };
    const selected = requested?.success ? await brands.version(ownerId, requested.data) : null;
    if (requested?.success && !selected) return { kind: "not-found" as const };
    if (selected?.status === "archived") return { kind: "archived" as const };
    const active = selected ? null : await brands.active(ownerId);
    const brand = selected
      ? { id: selected.id, name: selected.fields.name }
      : active ? { id: active.id, name: active.name } : null;
    if (!brand) return { kind: "no-brand" as const };
    const quotas = new QuotaDao(connection);
    const [versions, capabilities, grant, ledger, recent] = await Promise.all([
      new PromptDao(connection, brand.id).versions(),
      readUserCapabilities(),
      quotas.grant(brand.id, "sampling"),
      quotas.ledger(brand.id, "sampling"),
      new MonitoringDao(connection).recent(brand.id, 10),
    ]);
    if (!capabilities.items) return { kind: "unavailable" as const, traceId: capabilities.traceId };
    const time = new Date().toISOString();
    return {
      kind: "ready" as const,
      brand,
      sets: versions.map((item) => ({
        id: item.id,
        version: item.version,
        region: item.region,
        language: item.language,
        questionCount: item.content.questions.filter((question) => question.status === "confirmed").length,
        naturalCount: item.content.questions.filter((question) => question.status === "confirmed" && question.primary).length,
      })),
      channels: capabilities.items.map((item) => ({
        channelId: item.channelId,
        kind: item.kind,
        displayName: item.displayName,
        eligibility: item.eligibility,
        version: item.version,
      })),
      grant: grant && grantState(grant, time) === "active" ? {
        version: grant.version,
        currency: grant.currency,
        countLimit: grant.countLimit,
        budgetMinor: grant.budgetMinor,
        reserved: ledger.reserved,
        committedMinor: ledger.committedMinor,
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
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-registration-unavailable", { traceId });
    return { kind: "unavailable" as const, traceId };
  }
}

export async function readBrandMonitoringReadiness(ownerId: string, brand: {
  id: string;
  status: "active" | "archived";
  website: string;
}, historical: boolean) {
  try {
    const connection = getConnection();
    const quotas = new QuotaDao(connection);
    const [sets, capabilities, grant, ledger, facts, frozen] = await Promise.all([
      new PromptDao(connection, brand.id).versions(),
      readUserCapabilities(),
      quotas.grant(brand.id, "sampling"),
      quotas.ledger(brand.id, "sampling"),
      new FactDao(connection, { ownerId, brandId: brand.id }).latestVersions(),
      new SamplingProtocolDao(connection).latestFrozenForBrand(ownerId, brand.id),
    ]);
    if (!capabilities.items) return { kind: "unavailable" as const, traceId: capabilities.traceId };
    const time = new Date().toISOString();
    const state = grantState(grant, time);
    const samplingGrant = summarizeSamplingGrant({
      state,
      version: grant?.version ?? null,
      currency: grant?.currency ?? null,
      countLimit: grant?.countLimit ?? 0,
      budgetMinor: grant?.budgetMinor ?? 0,
      reserved: ledger.reserved,
      settled: ledger.settled,
      committedMinor: ledger.committedMinor,
    });
    const latest = sets[0] ?? null;
    const promptSet = summarizePromptSet(latest ? {
      id: latest.id,
      version: latest.version,
      region: latest.region,
      language: latest.language,
      questions: latest.content.questions,
    } : null);
    const factSummary = summarizeFactReadiness(facts, time.slice(0, 10));
    return {
      kind: "ready" as const,
      promptSet,
      grant: samplingGrant,
      facts: factSummary,
      protocol: frozen ? {
        id: frozen.protocolId,
        version: frozen.version,
        targetRegion: frozen.targetRegion,
        timezone: frozen.timezone,
      } : null,
      report: classifyMonitoringReadiness({
        brandStatus: brand.status,
        historical,
        websiteEmpty: brand.website.trim().length === 0,
        promptSet,
        channels: capabilities.items.map((item) => ({
          channelId: item.channelId,
          kind: item.kind,
          displayName: item.displayName,
          eligibility: item.eligibility,
          version: item.version,
        })),
        grant: samplingGrant,
      }),
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-readiness-unavailable", { traceId });
    return { kind: "unavailable" as const, traceId };
  }
}

export async function readOwnedRun(ownerId: string, runId: string) {
  try {
    const connection = getConnection();
    const dao = new MonitoringDao(connection);
    const identity = await dao.runIdentity(runId);
    if (!identity) return null;
    const adopted = await authorizeBrandActor(connection, ownerId, identity.brandId, "read");
    if (!adopted || adopted.ownerId !== identity.ownerId) return null;
    ownerId = adopted.ownerId;
    const run = await dao.runForOwner(ownerId, runId);
    if (!run) return null;
    const [slots, attempts, prompt, protocol] = await Promise.all([
      dao.slots([run.id]),
      dao.attempts([run.id]),
      new PromptDao(connection, run.brandId).version(run.promptSetId),
      new SamplingProtocolDao(connection).pinForRun(ownerId, run.id),
    ]);
    const text = new Map((prompt?.content.questions ?? []).map((question) => [question.id, question.text]));
    return {
      ...run,
      entityVersion: prompt?.entityVersion ?? null,
      protocol,
      attempts,
      slots: slots.map((slot) => ({ ...slot, questionText: text.get(slot.questionId) ?? slot.questionId })),
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-run-read-unavailable", { traceId });
    return { traceId };
  }
}
