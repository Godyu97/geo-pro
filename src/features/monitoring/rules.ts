import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PreviewSnapshot } from "./contracts.ts";
import { previewTtlMs } from "./contracts.ts";

const maximumInteger = 2_147_483_647;

export function expiresAtFor(previewedAt: string) {
  return new Date(Date.parse(previewedAt) + previewTtlMs).toISOString();
}

export function scaleMinor(upperMinor: number, slots: number) {
  if (slots < 1 || upperMinor < 0) return null;
  if (upperMinor > 0 && slots > Math.floor(maximumInteger / upperMinor)) return null;
  return upperMinor * slots;
}

export function previewMaterial(snapshot: PreviewSnapshot) {
  const channels = [...snapshot.channels].sort((left, right) => left.channelId.localeCompare(right.channelId));
  return [
    snapshot.brandId,
    snapshot.track,
    snapshot.promptSetId,
    snapshot.promptSetVersion,
    snapshot.repeats,
    snapshot.requestedNetworkMode,
    channels.map((item) => `${item.channelId}.${item.version}`).join(","),
    snapshot.grantVersion ?? "",
    snapshot.ceiling ? `${snapshot.ceiling.currency}:${snapshot.ceiling.upperMinor}` : "",
    snapshot.questionCount,
    snapshot.naturalCount,
    snapshot.region,
    snapshot.language,
    snapshot.previewedAt,
    snapshot.expiresAt,
  ].join("|");
}

export function previewToken(snapshot: PreviewSnapshot, secret: string) {
  return createHmac("sha256", secret).update(previewMaterial(snapshot)).digest("hex");
}

export function previewTokenMatches(snapshot: PreviewSnapshot, token: string, secret: string) {
  const expected = Buffer.from(previewToken(snapshot, secret));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function runFingerprint(snapshot: PreviewSnapshot) {
  return createHash("sha256").update(previewMaterial(snapshot)).digest("hex");
}
