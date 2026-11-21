"use server";

import { headers } from "next/headers";
import { brandIdSchema } from "@/features/brands/contracts";
import { brandIntakeOrigin } from "@/features/brands/intake";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { applyMockMaterials } from "./apply-materials";

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
