import "server-only";

import { randomUUID } from "node:crypto";
import { getConnection } from "@/lib/db/connection";
import { CapabilityDao } from "./dao";
import { formalRunEligibility } from "./rules";
import type { CapabilitySnapshot, UserCapability } from "./contracts";

function toUserCapability(snapshot: CapabilitySnapshot, now: string): UserCapability {
  const { sopSummary, ...publicFields } = snapshot;
  void sopSummary;
  return { ...publicFields, eligibility: formalRunEligibility(snapshot, now) };
}

export async function readUserCapabilities(now = new Date().toISOString()) {
  try {
    const items = (await new CapabilityDao(getConnection()).latest()).map((item) => toUserCapability(item, now));
    return { items };
  } catch {
    const traceId = randomUUID();
    console.error("capability-read-unavailable", { traceId });
    return { traceId };
  }
}

export async function readPublicCapabilities(now = new Date().toISOString()) {
  try {
    return { items: await new CapabilityDao(getConnection()).publicLatest(now) };
  } catch {
    return { items: [] };
  }
}

export async function readMaintenanceCapabilities() {
  try {
    return { items: await new CapabilityDao(getConnection()).latest() };
  } catch {
    const traceId = randomUUID();
    console.error("capability-maintenance-read-unavailable", { traceId });
    return { traceId };
  }
}

export async function readAnswerNetwork(ownerId: string, brandId: string) {
  try {
    return { items: await new CapabilityDao(getConnection()).answerNetworkForOwner(ownerId, brandId) };
  } catch {
    const traceId = randomUUID();
    console.error("capability-evidence-read-unavailable", { traceId });
    return { traceId };
  }
}
