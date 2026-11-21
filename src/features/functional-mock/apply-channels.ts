import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { capabilityChangeSchema, type CapabilitySnapshot } from "../capabilities/contracts.ts";
import { CapabilityDao } from "../capabilities/dao.ts";
import { mockChannelDraft, mockVendorId } from "./channels.ts";

/** Inserts two labeled channels. This does not call a provider and does not grant maintenance permission. */
export async function applyMockChannels(db: DatabaseConnection, actorId: string) {
  const now = new Date().toISOString();
  return db.transaction(async (transaction) => {
    const dao = new CapabilityDao(transaction);
    const latest = await dao.latest();
    const channelIds: string[] = [];
    for (const kind of ["model_api", "consumer_ui"] as const) {
      const existing = latest.find((item) => item.vendorId === mockVendorId && item.kind === kind
        && item.status === "verified" && item.expiresAt !== null && item.expiresAt > now);
      if (existing) {
        channelIds.push(existing.channelId);
        continue;
      }
      const values = mockChannelDraft(kind, now);
      const channelId = randomUUID();
      const command = capabilityChangeSchema.parse({
        action: "record",
        actorId,
        operationId: randomUUID(),
        expectedVersion: null,
        channelId: null,
        ...values,
      });
      const snapshot: CapabilitySnapshot = { ...values, channelId, version: 1, changedAt: now };
      const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
      await dao.insertChannel(channelId, values.vendorId, kind, now);
      await dao.appendVersion(command, snapshot, fingerprint);
      channelIds.push(channelId);
    }
    return { ok: true as const, channelIds };
  });
}
