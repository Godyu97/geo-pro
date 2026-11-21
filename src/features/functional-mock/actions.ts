"use server";

import { headers } from "next/headers";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { applyMockChannels } from "./apply-channels";
import { applyMockMaterials } from "./apply-materials";
import { applyMockContent } from "./apply-content";
import { applyMockPublication } from "./apply-publication";
import { applyMockEvidence } from "./apply-evidence";
import { applyMockSamplingQuota } from "./apply-run";

export async function applyMockMaterialsAction(brandId: string) {
  const intake = brandIntakeOrigin(await headers());
  if (intake?.mode !== "mock") return { ok: false as const, error: "closed" };
  const id = brandIdSchema.safeParse(brandId);
  if (!id.success) return { ok: false as const, error: "invalid" };
  const { user } = await requireSession();
  try {
    return await applyMockMaterials(getConnection(), { ownerId: user.id, brandId: id.data });
  } catch {
    return { ok: false as const, error: "unavailable" };
  }
}

export async function applyMockChannelsAction() {
  const intake = brandIntakeOrigin(await headers());
  if (intake?.mode !== "mock") return { ok: false as const, error: "closed" };
  const { user } = await requireSession();
  try {
    return await applyMockChannels(getConnection(), user.id);
  } catch {
    return { ok: false as const, error: "unavailable" };
  }
}

export async function applyMockSamplingQuotaAction(brandId: string) {
  const intake = brandIntakeOrigin(await headers());
  if (intake?.mode !== "mock") return { ok: false as const, error: "closed" };
  const id = brandIdSchema.safeParse(brandId);
  if (!id.success) return { ok: false as const, error: "invalid" };
  const { user } = await requireSession();
  try {
    return await applyMockSamplingQuota(getConnection(), user.id, id.data);
  } catch {
    return { ok: false as const, error: "unavailable" };
  }
}

export async function applyMockEvidenceAction(brandId: string) {
  const intake = brandIntakeOrigin(await headers());
  if (intake?.mode !== "mock") return { ok: false as const, error: "closed" };
  const id = brandIdSchema.safeParse(brandId);
  if (!id.success) return { ok: false as const, error: "invalid" };
  const { user } = await requireSession();
  try {
    return await applyMockEvidence(getConnection(), user.id, id.data);
  } catch {
    return { ok: false as const, error: "unavailable" };
  }
}

export async function applyMockContentAction(brandId: string) {
  const intake = brandIntakeOrigin(await headers());
  if (intake?.mode !== "mock") return { ok: false as const, error: "closed" };
  const id = brandIdSchema.safeParse(brandId);
  if (!id.success) return { ok: false as const, error: "invalid" };
  const { user } = await requireSession();
  try {
    return await applyMockContent(getConnection(), user.id, id.data);
  } catch {
    return { ok: false as const, error: "unavailable" };
  }
}

export async function applyMockPublicationAction(brandId: string) {
  const intake = brandIntakeOrigin(await headers());
  if (intake?.mode !== "mock") return { ok: false as const, error: "closed" };
  const id = brandIdSchema.safeParse(brandId);
  if (!id.success) return { ok: false as const, error: "invalid" };
  const { user } = await requireSession();
  try {
    return await applyMockPublication(getConnection(), user.id, id.data);
  } catch {
    return { ok: false as const, error: "unavailable" };
  }
}
