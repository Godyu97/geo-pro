import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BrandDao } from "@/features/brands/dao";
import { brandMaterialAccess } from "@/features/brands/intake";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";

export default async function CurrentBrandQuestionsPage() {
  const { user } = await requireSession();
  if (!brandMaterialAccess(await headers(), user.email).ok) redirect("/dashboard/brands");

  const active = await new BrandDao(getConnection()).active(user.id);
  redirect(active ? `/dashboard/brands/${active.id}/questions` : "/dashboard/brands");
}
