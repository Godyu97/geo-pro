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
import { SamplingProtocolDao } from "./protocol-dao";
import {
  classifyMonitoringReadiness,
  selectFrozenProtocol,
  summarizeFactReadiness,
  summarizePromptSet,
  summarizeSamplingGrant,
} from "./readiness.ts";

export async function readRegistration(ownerId: string, brandId?: string) {
  try {
    const connection = getConnection();
    const brands = new BrandDao(connection);
    const requested = brandId === undefined ? null : brandIdSchema.safeParse(brandId);
    if (requested && !requested.success) return { brand: null, missing: true, sets: [], channels: [], grant: null, recent: [] };
    const selected = requested?.success ? await brands.version(ownerId, requested.data) : null;
    if (requested?.success && !selected) return { brand: null, missing: true, sets: [], channels: [], grant: null, recent: [] };
    if (selected && selected.status !== "active") {
      return {
        brand: { id: selected.id, name: selected.fields.name, status: selected.status },
        missing: false,
        sets: [],
        channels: [],
        grant: null,
        recent: [],
      };
    }
    const active = selected ? null : await brands.active(ownerId);
    const brand = selected
      ? { id: selected.id, name: selected.fields.name, status: selected.status }
      : active ? { id: active.id, name: active.name, status: active.status } : null;
    if (!brand) return { brand: null, missing: false, sets: [], channels: [], grant: null, recent: [] };
    const [versions, capabilities, summary, recent] = await Promise.all([
      new PromptDao(connection, brand.id).versions(),
      readUserCapabilities(),
      new QuotaDao(connection).ownerSummary(ownerId),
      new MonitoringDao(connection).recent(brand.id, 10),
    ]);
    const sampling = summary.find((item) => item.kind === "sampling");
    const time = new Date().toISOString();
    return {
      brand: { id: brand.id, name: brand.name, status: brand.status },
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
      missing: false,
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-registration-unavailable", { traceId });
    return { traceId };
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
    const [sets, capabilities, grant, ledger, facts, protocols] = await Promise.all([
      new PromptDao(connection, brand.id).versions(),
      readUserCapabilities(),
      quotas.grant(brand.id, "sampling"),
      quotas.ledger(brand.id, "sampling"),
      new FactDao(connection, { ownerId, brandId: brand.id }).latestVersions(),
      new SamplingProtocolDao(connection).protocolsForOwner(ownerId),
    ]);
    if (!capabilities.items) return { traceId: capabilities.traceId };
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
    const frozen = selectFrozenProtocol(protocols, brand.id);
    const factSummary = summarizeFactReadiness(facts, time.slice(0, 10));
    return {
      traceId: null,
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
        facts: factSummary,
      }),
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-readiness-unavailable", { traceId });
    return { traceId };
  }
}

export async function readOwnedRun(ownerId: string, runId: string) {
  try {
    const connection = getConnection();
    const dao = new MonitoringDao(connection);
    const run = await dao.runForOwner(ownerId, runId);
    if (!run) return null;
    const [slots, attempts, prompt] = await Promise.all([
      dao.slots([run.id]),
      dao.attempts([run.id]),
      new PromptDao(connection, run.brandId).version(run.promptSetId),
    ]);
    const text = new Map((prompt?.content.questions ?? []).map((question) => [question.id, question.text]));
    return {
      ...run,
      attempts,
      slots: slots.map((slot) => ({ ...slot, questionText: text.get(slot.questionId) ?? slot.questionId })),
    };
  } catch {
    const traceId = randomUUID();
    console.error("monitoring-run-read-unavailable", { traceId });
    return { traceId };
  }
}
