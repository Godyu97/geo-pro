import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { CacheStore } from "../../lib/cache/store.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { priorityBuckets, taskStatuses } from "../optimization/contracts.ts";
import { sourceModes, triStateSchema } from "./contracts.ts";
import { analysisRuleVersion } from "./rules.ts";
import type { OverviewScope } from "./overview-contracts.ts";

export const overviewRuleVersion = "s-m0-07-v1";
export const overviewCacheTtlSeconds = 60;
const chunkChars = 3500;
const indexLimit = 30;

const rateSchema = z.object({
  status: z.enum(["ready", "na"]),
  reason: z.string().nullable(),
  equalWeight: z.number().nullable(),
  pooled: z.object({
    numerator: z.number(),
    denominator: z.number(),
    rate: z.number().nullable(),
  }),
  coveredQuestions: z.number(),
  fixedQuestions: z.number(),
  unknownRatio: z.number().nullable(),
  perQuestion: z.array(z.object({
    questionKey: z.string(),
    questionText: z.string(),
    numerator: z.number(),
    denominator: z.number(),
    rate: z.number().nullable(),
    unknown: z.number(),
    sampleIds: z.array(z.string()),
  })),
});

export const overviewPayloadSchema = z.object({
  scope: z.object({
    brandId: z.string(),
    brandName: z.string(),
    sourceMode: z.enum(sourceModes),
    region: z.string().nullable(),
    requestedNetworkMode: z.enum(networkModes).nullable(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    hasOfficialWebsite: z.boolean(),
  }),
  viewStatus: z.enum(["empty", "partial", "ready", "insufficient"]),
  eligibleCount: z.number(),
  sampleCount: z.number(),
  smallSample: z.boolean(),
  metrics: z.object({
    mentioned: rateSchema,
    recommended: rateSchema,
    officialSiteCited: rateSchema,
  }),
  sampleIds: z.array(z.string()),
  answers: z.array(z.object({
    observationId: z.string(),
    questionKey: z.string(),
    questionText: z.string(),
    sourceMode: z.enum(sourceModes),
    region: z.string(),
    requestedNetworkMode: z.enum(networkModes),
    capturedAt: z.string(),
    mentioned: triStateSchema,
    recommended: triStateSchema,
    officialSiteCited: triStateSchema,
  })),
  suggestions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(taskStatuses),
    priorityBucket: z.enum(priorityBuckets),
    href: z.string(),
  })),
  activeTasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["doing", "blocked"]),
    priorityBucket: z.enum(priorityBuckets),
    href: z.string(),
  })),
  nextActions: z.array(z.object({
    id: z.string(),
    kind: z.enum(["start_monitoring", "view_answers", "view_tasks"]),
    href: z.string(),
  })),
  demo: z.literal(false),
});

export type OverviewPayload = z.infer<typeof overviewPayloadSchema>;

const metaSchema = z.object({
  n: z.number().int().nonnegative(),
  sha: z.string().length(64),
});

function digest(parts: string[]) {
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 32);
}

function split(value: string) {
  const parts: string[] = [];
  for (let index = 0; index < value.length; index += chunkChars) {
    parts.push(value.slice(index, index + chunkChars));
  }
  return parts.length > 0 ? parts : [""];
}

export function overviewCacheIdentity(input: {
  ownerId: string;
  brandId: string;
  scope: OverviewScope;
  hasOfficialWebsite: boolean;
  token: string;
}) {
  return digest([
    "evidence-overview",
    "v1",
    input.ownerId,
    input.brandId,
    input.scope.sourceMode,
    input.scope.region ?? "",
    input.scope.requestedNetworkMode ?? "",
    input.scope.from ?? "",
    input.scope.to ?? "",
    input.hasOfficialWebsite ? "1" : "0",
    overviewRuleVersion,
    analysisRuleVersion,
    input.token,
  ]);
}

function metaKey(identity: string) {
  return `evidence-overview:v1:${identity}`;
}

function indexKey(ownerId: string, brandId: string) {
  return `evidence-overview:index:v1:${digest([ownerId, brandId])}`;
}

function logUnavailable(fault: string) {
  console.error("evidence-overview-cache-unavailable", { fault });
}

async function deleteStored(cache: CacheStore, key: string) {
  const meta = await cache.get(key);
  if (meta.state === "hit") {
    try {
      const parsed = metaSchema.safeParse(JSON.parse(meta.value));
      if (parsed.success) {
        for (let index = 0; index < parsed.data.n; index += 1) {
          await cache.delete(`${key}:${index}`);
        }
      }
    } catch {
      // A corrupt manifest is removed with the key below.
    }
  }
  await cache.delete(key);
}

export async function readOverviewCache(
  cache: CacheStore,
  identity: string,
  expected: { brandId: string; sourceMode: OverviewPayload["scope"]["sourceMode"]; hasOfficialWebsite: boolean },
): Promise<OverviewPayload | null> {
  const key = metaKey(identity);
  let logged = false;
  function fault(code: string) {
    if (!logged) {
      logged = true;
      logUnavailable(code);
    }
  }
  const meta = await cache.get(key);
  if (meta.state === "blocked") {
    fault(meta.fault);
    return null;
  }
  if (meta.state === "miss") return null;
  let parsedMeta: z.infer<typeof metaSchema>;
  try {
    parsedMeta = metaSchema.parse(JSON.parse(meta.value));
  } catch {
    await cache.delete(key);
    return null;
  }
  const parts: string[] = [];
  for (let index = 0; index < parsedMeta.n; index += 1) {
    const part = await cache.get(`${key}:${index}`);
    if (part.state === "blocked") {
      fault(part.fault);
      return null;
    }
    if (part.state === "miss") return null;
    parts.push(part.value);
  }
  const raw = parts.join("");
  const sha = createHash("sha256").update(raw, "utf8").digest("hex");
  if (sha !== parsedMeta.sha) {
    await deleteStored(cache, key);
    return null;
  }
  try {
    const payload = overviewPayloadSchema.parse(JSON.parse(raw));
    if (payload.scope.brandId !== expected.brandId
      || payload.scope.sourceMode !== expected.sourceMode
      || payload.scope.hasOfficialWebsite !== expected.hasOfficialWebsite) {
      return null;
    }
    return payload;
  } catch {
    await deleteStored(cache, key);
    return null;
  }
}

export async function storeOverviewCache(cache: CacheStore, identity: string, ownerId: string, brandId: string, payload: OverviewPayload) {
  const canonical = JSON.stringify(overviewPayloadSchema.parse(payload));
  const parts = split(canonical);
  if (parts.length > indexLimit) {
    console.error("evidence-overview-cache-skipped", { reason: "payload-limit" });
    return;
  }
  const key = metaKey(identity);
  const sha = createHash("sha256").update(canonical, "utf8").digest("hex");
  for (let index = 0; index < parts.length; index += 1) {
    const stored = await cache.set(`${key}:${index}`, parts[index] ?? "", overviewCacheTtlSeconds);
    if (stored !== "stored") {
      logUnavailable("store-blocked");
      return;
    }
  }
  const metaStored = await cache.set(key, JSON.stringify({ n: parts.length, sha }), overviewCacheTtlSeconds);
  if (metaStored !== "stored") {
    logUnavailable("store-blocked");
    return;
  }
  const current = await cache.get(indexKey(ownerId, brandId));
  let prior: string[] = [];
  if (current.state === "hit") {
    try {
      const existing = z.array(z.string()).safeParse(JSON.parse(current.value));
      if (existing.success) prior = existing.data;
    } catch {
      prior = [];
    }
  }
  const next = [...prior.filter((item) => item !== key), key].slice(-indexLimit);
  for (const removed of prior) {
    if (!next.includes(removed)) await deleteStored(cache, removed);
  }
  await cache.set(indexKey(ownerId, brandId), JSON.stringify(next), overviewCacheTtlSeconds);
}

export async function invalidateEvidenceOverview(ownerId: string, brandId: string, cache: CacheStore) {
  try {
    const key = indexKey(ownerId, brandId);
    const current = await cache.get(key);
    if (current.state !== "hit") return;
    const parsed = z.array(z.string()).safeParse(JSON.parse(current.value));
    if (!parsed.success) {
      await cache.delete(key);
      return;
    }
    for (const stored of parsed.data) await deleteStored(cache, stored);
    await cache.delete(key);
  } catch {
    console.error("evidence-overview-cache-invalidate-failed");
  }
}
